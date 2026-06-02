declare module "pdf-parse" {
  export interface PdfParseInfo {
    Title?: string;
    Author?: string;
    Creator?: string;
    Producer?: string;
    CreationDate?: string;
    ModDate?: string;
    [key: string]: unknown;
  }

  export interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info?: PdfParseInfo;
    metadata?: unknown;
    version?: string;
  }

  export interface PdfParseOptions {
    max?: number;
    pagerender?: (pageData: unknown) => string | Promise<string>;
    [key: string]: unknown;
  }

  export default function pdfParse(
    dataBuffer: Buffer | Uint8Array,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;
}
