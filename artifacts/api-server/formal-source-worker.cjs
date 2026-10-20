// Dedicated bounded PDF text worker. Only source bytes are transferred in;
// API credentials and the parent environment are not inherited.
const { parentPort, workerData } = require('node:worker_threads');
const PDFJS = require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js');
PDFJS.disableWorker = true;
PDFJS.disableFontFace = true;
PDFJS.isEvalSupported = false;
const MAX_LINES = 900, MAX_CHARS = 45000, MAX_ITEMS = 20000;
function bounded(message) { const error = new Error(message); error.bounded = true; throw error; }
(async () => {
  let doc;
  try {
    doc = await PDFJS.getDocument({ data: new Uint8Array(workerData.bytes), disableFontFace: true, isEvalSupported: false });
    const pageCount = doc.numPages;
    if (pageCount > 12) bounded('This pilot analyzes complete papers up to 12 pages; upload a concise summary or matching text. Nothing has been silently truncated.');
    const lines = []; let total = 0;
    for (let n = 1; n <= pageCount; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      if (!Array.isArray(content.items) || content.items.length > MAX_ITEMS) bounded('This PDF page exceeds the text extraction complexity limit. Upload its concise TeX/text source.');
      const items = [];
      for (const item of content.items) {
        if (typeof item.str !== 'string' || !item.str.trim()) continue;
        if (item.str.length > 8000) bounded('A PDF text item exceeds the extraction limit. Upload the matching text source with line breaks.');
        items.push({ text: item.str, x: Number(item.transform?.[4]) || 0, y: Number(item.transform?.[5]) || 0 });
      }
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const rows = [];
      // Sorted descending coordinates mean only the last row can be close;
      // avoid a quadratic scan through every prior row on complex documents.
      for (const item of items) {
        let row = rows[rows.length - 1];
        if (!row || Math.abs(row.y - item.y) >= 3) { row = { y: item.y, items: [] }; rows.push(row); }
        row.items.push(item);
      }
      let index = 0;
      for (const row of rows) {
        const text = row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (text.length > 4000) bounded('A PDF source line exceeds 4,000 characters. Upload the matching text source with line breaks.');
        total += text.length;
        if (total > MAX_CHARS || lines.length >= MAX_LINES) bounded('This pilot accepts up to 45,000 extracted characters and 900 source lines. Submit a concise summary; no lines were silently omitted.');
        lines.push({ id: `p${n}-l${String(++index).padStart(3, '0')}`, page: n, line: index, text });
      }
      page.cleanup();
    }
    if (total < 80) bounded('This PDF has too little extractable text. Upload its TeX/text source; scanned-PDF OCR is not supported yet.');
    parentPort.postMessage({ ok: true, pageCount, lines });
  } catch (error) {
    parentPort.postMessage({ ok: false, message: error.bounded ? error.message : 'The PDF could not be read. Try an unencrypted PDF or upload the matching TeX/text source.' });
  } finally {
    if (doc) await Promise.resolve(doc.destroy()).catch(() => {});
  }
})().catch(() => { parentPort.postMessage({ ok: false, message: 'The PDF could not be read. Upload the matching TeX/text source.' }); });
