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

// Upload paths must keep working even for malformed PDFs that pdf-lib
// cannot parse; in that case the original bytes flow on and the blind
// prompt's ignore-identity rules remain the only protection.
export async function stripPdfIdentifyingMetadataSafe(pdfBytes: Buffer): Promise<Buffer> {
  try {
    return await stripPdfIdentifyingMetadata(pdfBytes);
  } catch (err) {
    logger.warn({ err }, "PDF metadata stripping failed; continuing with original PDF bytes");
    return pdfBytes;
  }
}
