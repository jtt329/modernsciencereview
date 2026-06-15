import { PDFDocument, PDFName } from "pdf-lib";
import { logger } from "./logger";

// Strips identifying PDF metadata before any model (including the
// gemini-native-pdf-fallback) sees the file: blanks the DocInfo
// Title/Author/Subject/Keywords/Creator/Producer fields and removes the
// XMP metadata stream from the document catalog. Page content is untouched.
export async function stripPdfIdentifyingMetadata(pdfBytes: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes, {
    ignoreEncryption: true,
    updateMetadata: false,
  });
  doc.setTitle("");
  doc.setAuthor("");
  doc.setSubject("");
  doc.setKeywords([]);
  doc.setCreator("");
  doc.setProducer("");
  doc.catalog.delete(PDFName.of("Metadata"));
  const saved = await doc.save();
  return Buffer.from(saved);
}

// Above this size, skip pdf-lib stripping. pdf-lib loads the entire
// document into a JS object graph many times the byte size — the dominant
// allocation in the submission path and the prime OOM suspect for large or
// image-only/OCR'd scans. Past the gate the original bytes flow on and the
// blind prompt's ignore-identity rules remain the protection (the same
// fallback already used for malformed PDFs). Default 4 MB covers the
// largest benchmark PDF (Brown-York ~2.4 MB) while excluding pathological
// scans; override with PDF_STRIP_MAX_BYTES.
const PDF_STRIP_MAX_BYTES = Number(process.env.PDF_STRIP_MAX_BYTES) || 4 * 1024 * 1024;

// B2 decision: a PDF whose text layer is effectively empty (a pure scan)
// should auto-route to PDF-visible review rather than fail with a 422 that
// needs a manual retry. Pure predicate so the routing rule is unit-tested.
export function shouldAutoPdfVisible(opts: {
  readableCharCount: number;
  hasPdfBase64: boolean;
  pdfVisibleLastResortRequested: boolean;
  extractionBlocking: boolean;
  minChars?: number;
}): boolean {
  const minChars = opts.minChars ?? 100;
  return (
    !opts.pdfVisibleLastResortRequested &&
    opts.hasPdfBase64 &&
    opts.readableCharCount < minChars &&
    opts.extractionBlocking
  );
}

// Upload paths must keep working even for malformed or very large PDFs that
// pdf-lib cannot parse / would balloon memory on; in those cases the
// original bytes flow on and the blind prompt's ignore-identity rules
// remain the protection.
export async function stripPdfIdentifyingMetadataSafe(pdfBytes: Buffer): Promise<Buffer> {
  if (pdfBytes.length > PDF_STRIP_MAX_BYTES) {
    logger.warn(
      { byteCount: pdfBytes.length, limit: PDF_STRIP_MAX_BYTES },
      "PDF exceeds metadata-strip size gate; skipping pdf-lib load to bound memory and continuing with original bytes",
    );
    return pdfBytes;
  }
  try {
    return await stripPdfIdentifyingMetadata(pdfBytes);
  } catch (err) {
    logger.warn({ err }, "PDF metadata stripping failed; continuing with original PDF bytes");
    return pdfBytes;
  }
}
