// PDF -> identity-blind page images, for field-engine Phase 0 multimodal ingestion.
// (CODE_BRIEF_field-engine_phase0.md §2.1, §2.2). Plain Node + mupdf (WASM, no native
// deps). Renders each page to a grayscale PNG at a legible DPI (grayscale keeps a
// whole-paper multimodal request under Gemini's inline size limit while staying sharp
// enough to read subscripts/superscripts — the Ong ε case). The FIRST page's top band
// (title/authors/affiliation/email) is redacted by zeroing pixels, so no identity signal
// is supplied to the blind judgment pass. The mupdf text layer is saved ADVISORY only.
//
// This is the only place identity is stripped from the images; downstream judgment and
// verification passes must receive ONLY these redacted images (the blind/informed boundary).
import * as mupdf from "mupdf";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// Render + cache one PDF's blind pages. Returns a manifest describing the outputs.
// Re-runs are free: an existing manifest.json with matching params short-circuits.
export function renderBlindPages(pdfPath, outDir, opts = {}) {
  const dpi = opts.dpi ?? 150;
  const redactTopFrac = opts.redactTopFrac ?? 0.16; // page-1 title/author/affiliation band
  const redactLeftFrac = opts.redactLeftFrac ?? 0.05; // page-1 left margin (kills arXiv/venue stamp)
  const maxPages = opts.maxPages ?? 60;
  const manifestPath = join(outDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (m.dpi === dpi && m.redactTopFrac === redactTopFrac && m.redactLeftFrac === redactLeftFrac && Array.isArray(m.pages) && m.pages.length) {
      return { ...m, fromCache: true };
    }
  }
  mkdirSync(outDir, { recursive: true });
  const buf = readFileSync(pdfPath);
  const doc = mupdf.Document.openDocument(new Uint8Array(buf), "application/pdf");
  const count = Math.min(doc.countPages(), maxPages);
  const scale = dpi / 72;
  const matrix = mupdf.Matrix.scale(scale, scale);
  const pages = [];
  const textChunks = [];
  let blankPages = 0;
  for (let i = 0; i < count; i += 1) {
    const page = doc.loadPage(i);
    const pix = page.toPixmap(matrix, mupdf.ColorSpace.DeviceGray, false);
    const w = pix.getWidth(), h = pix.getHeight();
    const px = pix.getPixels(); // live grayscale samples (1 byte/pixel)
    // Non-blank guard: a rendered page must have some ink (not a viewer shell).
    let ink = 0;
    for (let k = 0; k < px.length; k += 997) { if (px[k] < 250) ink += 1; }
    if (ink < 5) blankPages += 1;
    // Redact identity on page 1: top band (title/authors/affiliation) + left margin
    // (rotated arXiv/venue/date stamp). Set pixels to white.
    if (i === 0) {
      if (redactTopFrac > 0) {
        const cut = Math.floor(h * redactTopFrac) * w;
        for (let k = 0; k < cut && k < px.length; k += 1) px[k] = 255;
      }
      if (redactLeftFrac > 0) {
        const cols = Math.floor(w * redactLeftFrac);
        for (let row = 0; row < h; row += 1) {
          const base = row * w;
          for (let c = 0; c < cols; c += 1) px[base + c] = 255;
        }
      }
    }
    const file = `p${String(i + 1).padStart(3, "0")}.png`;
    writeFileSync(join(outDir, file), pix.asPNG());
    pages.push({ n: i + 1, file, w, h });
    try { textChunks.push(`[page ${i + 1}]\n` + page.toStructuredText("preserve-whitespace").asText()); } catch { /* image-only page */ }
  }
  const textPath = join(outDir, "text_advisory.txt");
  writeFileSync(textPath, textChunks.join("\n\n"));
  const manifest = {
    pdf: pdfPath, dpi, redactTopFrac, redactLeftFrac, pageCount: doc.countPages(), rendered: count,
    blankPages, redactedPage: 1, pages, textPath, fromCache: false,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}
