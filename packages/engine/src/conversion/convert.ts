import { unzipSync, zipSync, zlibSync } from 'fflate';
import { PdfEngineError } from '../errors.js';
import { mergePdfBuffers } from '../pdf/merge.js';
import type {
  ConversionDirection,
  ConversionOptions,
  ConversionResult,
  FormatId,
} from '../types.js';
import { getFormatCapability } from './registry.js';
import {
  csvToRows,
  extractPdfText,
  extractPdfTextPages,
  pdfToHtml,
  pdfToMarkdown,
  pdfToRtf,
  rowsToCsv,
  stripHtml,
  stripRtf,
  textPagesToPdf,
} from './pdf-text.js';
import { imageToPdf, renderPdfPageToPng } from './images.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ConversionInput = Readonly<{
  bytes: Uint8Array;
  format: FormatId;
  fileName?: string;
}>;

type StatementRow = Readonly<{
  date: string;
  description: string;
  amount: string;
  balance?: string;
}>;

export type BankStatementExtraction = Readonly<{
  headers: readonly string[];
  rows: readonly StatementRow[];
  confidence: number;
  notes: readonly string[];
}>;

export type BankStatementAccuracy = Readonly<{
  expectedRows: number;
  matchedRows: number;
  precision: number;
  recall: number;
}>;

export const PDF_MARKDOWN_ESCALATION = Object.freeze({
  tool: 'T29',
  tier: 3,
  reason:
    'Inferring structure with no visual cues requires judgement beyond deterministic extraction.',
  localFallback: 'Best-effort Markdown with an explicit review warning.',
  requiresGesture: true,
});

export function convertToPdf(
  input: ConversionInput,
  options?: ConversionOptions,
): Promise<ConversionResult>;
export function convertToPdf(
  format: FormatId,
  bytes: Uint8Array,
  options?: ConversionOptions,
): Promise<ConversionResult>;
export function convertToPdf(
  inputOrFormat: ConversionInput | FormatId,
  bytesOrOptions?: Uint8Array | ConversionOptions,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  if (typeof inputOrFormat === 'string') {
    return convertToPdfRequest(
      {
        format: inputOrFormat,
        bytes: bytesOrOptions as Uint8Array,
        ...(options.fileName ? { fileName: options.fileName } : {}),
      },
      options,
    );
  }
  return convertToPdfRequest(
    inputOrFormat,
    (bytesOrOptions as ConversionOptions | undefined) ?? {},
  );
}

async function convertToPdfRequest(
  input: ConversionInput,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  assertDirection(input.format, 'to-pdf');
  const bytes = input.bytes;
  let pdf: Uint8Array;
  const warnings: string[] = [];
  switch (input.format) {
    case 'docx':
      pdf = await docxToPdf(bytes, options);
      warnings.push(
        'DOCX layout is reconstructed locally; review columns, footnotes, and embedded fonts.',
      );
      break;
    case 'doc':
    case 'xls':
      pdf = await textToPdf(legacyCompoundToText(bytes, input.format), options);
      warnings.push(
        'Legacy binary office layout is best-effort; content is extracted from readable compound-file streams.',
      );
      break;
    case 'xlsx':
      pdf = await xlsxToPdf(bytes, options);
      break;
    case 'pptx':
      pdf = await pptxToPdf(bytes, options);
      break;
    case 'rtf':
      pdf = await textToPdf(stripRtf(decoder.decode(bytes)), options);
      break;
    case 'txt':
      pdf = await textToPdf(decodeText(bytes), options);
      break;
    case 'markdown':
      pdf = await markdownToPdf(decoder.decode(bytes), options);
      break;
    case 'html':
      pdf = await htmlToPdf(decoder.decode(bytes), options);
      warnings.push(
        'Only pasted HTML is processed locally; external URLs and active content are removed.',
      );
      break;
    case 'odt':
    case 'ods':
    case 'odp':
    case 'odg':
      pdf = await odfToPdf(bytes, input.format, options);
      break;
    case 'epub':
      pdf = await epubToPdf(bytes, options);
      break;
    case 'csv':
      pdf = await csvToPdf(decoder.decode(bytes), options);
      break;
    case 'xml-einvoice':
      pdf = await xmlInvoiceToPdf(decoder.decode(bytes), options);
      break;
    case 'zip':
    case 'cbz':
      pdf = await archiveToPdf(bytes, options);
      break;
    case 'jpg':
    case 'png':
    case 'bmp':
    case 'gif':
    case 'tiff':
    case 'webp':
    case 'heic':
    case 'svg':
      pdf = await imageToPdf(bytes, input.format, options);
      break;
    case 'psd':
      pdf = await imageToPdf(await psdCompositeToPng(bytes), 'png', options);
      warnings.push('Only the flattened PSD composite is exported; layers are not re-exported.');
      break;
    case 'ai':
      if (!decoder.decode(bytes.slice(0, 5)).startsWith('%PDF-'))
        throw unavailable(
          input.format,
          'to-pdf',
          'This AI file is not PDF-backed. Export it as SVG or PDF locally and retry.',
        );
      pdf = bytes;
      warnings.push(
        'PDF-backed AI was preserved as PDF; layer-aware Illustrator editing is not claimed.',
      );
      break;
    default:
      throw unavailable(input.format, 'to-pdf');
  }
  return result(pdf, 'application/pdf', '.pdf', input.fileName, warnings);
}

export function convertFromPdf(
  bytes: Uint8Array,
  target: FormatId,
  options?: ConversionOptions,
): Promise<ConversionResult>;
export function convertFromPdf(
  target: FormatId,
  bytes: Uint8Array,
  options?: ConversionOptions,
): Promise<ConversionResult>;
export function convertFromPdf(
  first: Uint8Array | FormatId,
  second: FormatId | Uint8Array,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  return typeof first === 'string'
    ? convertFromPdfRequest(second as Uint8Array, first, options)
    : convertFromPdfRequest(first, second as FormatId, options);
}

async function convertFromPdfRequest(
  bytes: Uint8Array,
  target: FormatId,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  assertDirection(target, 'from-pdf');
  let output: Uint8Array;
  let mimeType: string;
  let extension: string;
  const warnings: string[] = [];
  switch (target) {
    case 'pdf-markdown':
    case 'markdown':
      output = encoder.encode(await pdfToMarkdown(bytes));
      mimeType = 'text/markdown';
      extension = '.md';
      warnings.push('Structure is inferred from text order; review headings and tables.');
      break;
    case 'pdf-txt':
    case 'txt':
      output = encoder.encode(await extractPdfText(bytes));
      mimeType = 'text/plain';
      extension = '.txt';
      break;
    case 'pdf-html':
    case 'html':
      output = encoder.encode(await pdfToHtml(bytes));
      mimeType = 'text/html';
      extension = '.html';
      break;
    case 'pdf-rtf':
    case 'rtf':
      output = encoder.encode(pdfToRtf(await extractPdfText(bytes)));
      mimeType = 'application/rtf';
      extension = '.rtf';
      break;
    case 'csv':
      output = encoder.encode(await pdfToCsv(bytes));
      mimeType = 'text/csv';
      extension = '.csv';
      break;
    case 'docx':
      output = await textToDocx(await extractPdfText(bytes));
      mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      extension = '.docx';
      warnings.push('PDF positioning is reconstructed as flowing paragraphs.');
      break;
    case 'xlsx':
      output = await textToXlsx(await extractPdfTextPages(bytes));
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = '.xlsx';
      warnings.push(
        'PDF text is placed into rows; formulas and original cell types cannot be recovered.',
      );
      break;
    case 'pptx':
      output = await textToPptx(await extractPdfTextPages(bytes));
      mimeType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      extension = '.pptx';
      warnings.push('Each PDF page becomes one text slide; visual objects are not reconstructed.');
      break;
    case 'odt':
    case 'ods':
    case 'odp':
      output = createOdf(
        target,
        (await extractPdfTextPages(bytes)).map((page) => page.lines),
      );
      mimeType = odfMime(target);
      extension = `.${target}`;
      break;
    case 'epub':
      output = createEpub((await extractPdfTextPages(bytes)).map((page) => page.lines.join('\n')));
      mimeType = 'application/epub+zip';
      extension = '.epub';
      break;
    case 'png':
    case 'pdf-image':
      if (!isRenderer(options.renderer))
        throw unavailable(
          'pdf-image',
          'from-pdf',
          'PNG export needs the local pdfium renderer supplied by the browser worker.',
        );
      output = (await renderPdfPageToPng(bytes, options.pageRange?.[0] ?? 1, options.renderer))
        .bytes;
      mimeType = 'image/png';
      extension = '.png';
      break;
    default:
      throw unavailable(target, 'from-pdf');
  }
  return result(output, mimeType, extension, options.fileName, warnings);
}

export function convertFile(
  direction: ConversionDirection,
  format: FormatId,
  bytes: Uint8Array,
  options: ConversionOptions = {},
): Promise<ConversionResult> {
  return direction === 'to-pdf'
    ? convertToPdf(format, bytes, options)
    : convertFromPdf(format, bytes, options);
}

export function requestPdfMarkdownEscalation(options: ConversionOptions = {}): void {
  if (!options.allowAiEscalation) {
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'Tier 3 PDF-to-Markdown restructuring',
      remedy:
        'Review the local Markdown first, then explicitly enable the BYOK AI escalation for this session.',
    });
  }
}

export function markdownToBlocks(markdown: string): readonly string[] {
  const output: string[] = [];
  let inCode = false;
  for (const sourceLine of markdown.replaceAll('\r\n', '\n').split('\n')) {
    if (/^\s*```/u.test(sourceLine)) {
      inCode = !inCode;
      continue;
    }
    if (inCode) output.push(`  ${sourceLine}`);
    else if (/^\s*#{1,6}\s/u.test(sourceLine))
      output.push(sourceLine.replace(/^\s*#+\s*/u, '').toUpperCase());
    else if (/^\s*[-*+]\s/u.test(sourceLine))
      output.push(`• ${sourceLine.replace(/^\s*[-*+]\s*/u, '')}`);
    else if (/^\s*\d+[.)]\s/u.test(sourceLine)) output.push(sourceLine.trim());
    else if (/^\s*\|.*\|\s*$/u.test(sourceLine) && !/^\s*\|?\s*:?-{2,}/u.test(sourceLine))
      output.push(sourceLine.replace(/^\s*\|\s*|\s*\|\s*$/gu, '').replaceAll('|', '  |  '));
    else output.push(sourceLine.replaceAll(/[*_`]/gu, '').trim());
  }
  return output;
}

export function htmlToPlainText(input: string): string {
  return stripHtml(input.replaceAll(/\s+(?:src|href)\s*=\s*["'][^"']*["']/giu, ''));
}

export function htmlHasRemoteFetch(input: string): boolean {
  return /(?:src|href)\s*=\s*["']https?:\/\//iu.test(input);
}

export function extractBankStatement(input: string): BankStatementExtraction {
  const lines = input
    .replaceAll('\r\n', '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) =>
    /date|transaction|description|debit|credit|amount|balance/iu.test(line),
  );
  const source = headerIndex >= 0 ? lines.slice(headerIndex + 1) : lines;
  const rows: StatementRow[] = [];
  for (const line of source) {
    if (/^(?:date|transaction|description|debit|credit|amount|balance)\b/iu.test(line)) continue;
    const cells = line.includes('|')
      ? line.split('|').map((cell) => cell.trim())
      : line.split(/\s{2,}|\t/u).map((cell) => cell.trim());
    const date =
      cells.find((cell) => /^\d{1,4}[/-]\d{1,2}[/-]\d{1,4}$/u.test(cell)) ??
      /(\d{1,4}[/-]\d{1,2}[/-]\d{1,4})/u.exec(line)?.[1] ??
      '';
    const amounts = [...line.matchAll(/(?:\(?-?\$?\s*[\d,]+\.\d{2}\)?)/gu)].map((match) =>
      match[0].replaceAll(/[$,\s()]/gu, ''),
    );
    if (!date || amounts.length === 0) continue;
    const matchedDate = date;
    const matchedAmount = amounts[0] ?? '';
    const description =
      cells
        .filter(
          (cell) =>
            cell !== matchedDate &&
            !amounts.some((amount) => cell.replaceAll(/[$,()\s]/gu, '') === amount),
        )
        .join(' ')
        .trim() || line.replace(matchedDate, '').replace(matchedAmount, '').trim();
    rows.push({
      date,
      description,
      amount: amounts[0] ?? '',
      ...(amounts[1] ? { balance: amounts[1] } : {}),
    });
  }
  const confidence =
    rows.length === 0
      ? 0
      : Math.min(0.98, 0.55 + (headerIndex >= 0 ? 0.2 : 0) + (rows.length >= 3 ? 0.2 : 0));
  return {
    headers: [
      'Date',
      'Description',
      'Amount',
      ...(rows.some((row) => row.balance) ? ['Balance'] : []),
    ],
    rows,
    confidence,
    notes: [
      'Heuristic extraction only; verify dates, signs, and running balances before using financial data.',
    ],
  };
}

export function compareBankStatementRows(
  actual: readonly StatementRow[],
  expected: readonly StatementRow[],
): BankStatementAccuracy {
  const matches = expected.filter((wanted) =>
    actual.some(
      (candidate) =>
        candidate.date === wanted.date &&
        candidate.amount === wanted.amount &&
        candidate.description.toLowerCase().includes(wanted.description.toLowerCase()),
    ),
  ).length;
  return {
    expectedRows: expected.length,
    matchedRows: matches,
    precision: actual.length === 0 ? 1 : matches / actual.length,
    recall: expected.length === 0 ? 1 : matches / expected.length,
  };
}

export async function bankStatementToXlsx(
  extraction: BankStatementExtraction,
): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Statement');
  sheet.addRow(extraction.headers);
  for (const row of extraction.rows)
    sheet.addRow([row.date, row.description, row.amount, row.balance ?? '']);
  sheet.columns.forEach((column) => {
    column.width = Math.min(
      48,
      Math.max(
        12,
        ...Array.from(
          { length: sheet.rowCount },
          (_, index) => String(sheet.getCell(index + 1, column.number).value ?? '').length + 2,
        ),
      ),
    );
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

function assertDirection(format: FormatId, direction: ConversionDirection): void {
  const capability = getFormatCapability(format);
  if (capability.status !== 'supported' || !capability.directions.includes(direction))
    throw unavailable(format, direction);
}

function unavailable(
  format: string,
  direction: ConversionDirection,
  reason = 'No permissive browser-compatible implementation is available for this format. The original file is unchanged.',
): never {
  throw new PdfEngineError({ kind: 'unsupported-format', format, direction, remedy: reason });
}

function result(
  bytes: Uint8Array,
  mimeType: string,
  extension: string,
  fileName: string | undefined,
  warnings: readonly string[] = [],
): ConversionResult {
  const stem = (fileName ?? 'converted').replace(/\.[^.]+$/u, '') || 'converted';
  return { bytes, mimeType, extension, suggestedName: `${stem}${extension}`, warnings };
}

async function textToPdf(text: string, options: ConversionOptions): Promise<Uint8Array> {
  return textPagesToPdf([text.split(/\r?\n/u)], options);
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(bytes.slice(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder('utf-16be').decode(bytes.slice(2));
  return decoder.decode(bytes);
}

async function markdownToPdf(markdown: string, options: ConversionOptions): Promise<Uint8Array> {
  return textPagesToPdf([markdownToBlocks(markdown)], options);
}

async function htmlToPdf(html: string, options: ConversionOptions): Promise<Uint8Array> {
  return textToPdf(htmlToPlainText(html), options);
}

async function csvToPdf(csv: string, options: ConversionOptions): Promise<Uint8Array> {
  const rows = csvToRows(csv);
  const widths = rows.reduce<number[]>(
    (current, row) =>
      row.map((cell, index) => Math.min(28, Math.max(current[index] ?? 0, cell.length))),
    [],
  );
  const lines = rows
    .map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index] ?? cell.length))
        .join('   ')
        .trimEnd(),
    )
    .join('\\n');
  return textToPdf(lines, options);
}

async function xmlInvoiceToPdf(xml: string, options: ConversionOptions): Promise<Uint8Array> {
  const values = [...xml.matchAll(/<(?:cbc:)?([A-Za-z][\w.-]*)\b[^>]*>([^<]+)</gu)].map(
    (match) => `${match[1] ?? 'field'}: ${(match[2] ?? '').trim()}`,
  );
  return textToPdf(
    values.length > 0 ? values.join('\n') : 'No readable invoice fields found.',
    options,
  );
}

async function docxToPdf(bytes: Uint8Array, options: ConversionOptions): Promise<Uint8Array> {
  const mammoth = await import('mammoth');
  const html = await mammoth.convertToHtml({ arrayBuffer: bytes.slice().buffer });
  return htmlToPdf(html.value, options);
}

async function xlsxToPdf(bytes: Uint8Array, options: ConversionOptions): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  const pages: string[][] = [];
  for (const worksheet of workbook.worksheets) {
    pages.push([`Sheet: ${worksheet.name}`]);
    for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      const values = row.values as unknown as readonly unknown[];
      pages.push([
        values
          .slice(1)
          .map((value: unknown) => String(value ?? ''))
          .join('   '),
      ]);
    }
  }
  return textPagesToPdf(pages, options);
}

async function pptxToPdf(bytes: Uint8Array, options: ConversionOptions): Promise<Uint8Array> {
  const slides = await readPptxSlides(bytes);
  return textPagesToPdf(
    slides.map((slide, index) => [`Slide ${index + 1}`, ...slide]),
    options,
  );
}

export async function readPptxSlides(bytes: Uint8Array): Promise<readonly (readonly string[])[]> {
  const files = unzipSync(bytes);
  const names = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort(
      (a, b) =>
        Number.parseInt(a.match(/\d+/u)?.[0] ?? '0') - Number.parseInt(b.match(/\d+/u)?.[0] ?? '0'),
    );
  return names.map((name) => {
    const xml = decoder.decode(files[name]);
    return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/gu)].map((match) => unescapeXml(match[1] ?? ''));
  });
}

async function textToDocx(text: string): Promise<Uint8Array> {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const document = new Document({
    sections: [
      {
        children: text
          .split(/\r?\n/u)
          .map((line) => new Paragraph({ children: [new TextRun(line)] })),
      },
    ],
  });
  return new Uint8Array(await Packer.toBuffer(document));
}

async function textToXlsx(pages: readonly { lines: readonly string[] }[]): Promise<Uint8Array> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('PDF text');
  for (const page of pages) for (const line of page.lines) sheet.addRow([line]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

async function textToPptx(pages: readonly { lines: readonly string[] }[]): Promise<Uint8Array> {
  const module = await import('pptxgenjs');
  const Presentation = module.default;
  const presentation = new Presentation();
  presentation.layout = 'LAYOUT_WIDE';
  for (const page of pages) {
    const slide = presentation.addSlide();
    slide.addText(page.lines.join('\n'), {
      x: 0.5,
      y: 0.5,
      w: 12.3,
      h: 6.2,
      fontSize: 16,
      breakLine: false,
    });
  }
  const output = await presentation.write({ outputType: 'arraybuffer' });
  return new Uint8Array(output as ArrayBuffer);
}

async function pdfToCsv(bytes: Uint8Array): Promise<string> {
  const pages = await extractPdfTextPages(bytes);
  const rows = pages.flatMap((page) =>
    page.lines
      .filter(Boolean)
      .map((line) => (line.includes('|') ? line.split('|').map((cell) => cell.trim()) : [line])),
  );
  return rowsToCsv(rows);
}

function odfMime(format: FormatId): string {
  return format === 'odt'
    ? 'application/vnd.oasis.opendocument.text'
    : format === 'ods'
      ? 'application/vnd.oasis.opendocument.spreadsheet'
      : 'application/vnd.oasis.opendocument.presentation';
}

async function odfToPdf(
  bytes: Uint8Array,
  format: FormatId,
  options: ConversionOptions,
): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const content = files['content.xml'];
  if (!content)
    throw conversionFailure(format, 'to-pdf', 'The ODF container has no content.xml file.');
  const text = readOdfText(decoder.decode(content));
  return textToPdf(text, options);
}

export function readOdfText(xml: string): string {
  return [
    ...xml.matchAll(
      /<(?:text:)?(?:h|p|list-item)\b[^>]*>([\s\S]*?)<\/(?:text:)?(?:h|p|list-item)>/giu,
    ),
  ]
    .map((match) => stripXml(match[1] ?? ''))
    .join('\n');
}

export function createOdf(
  format: 'odt' | 'ods' | 'odp',
  pages: readonly (readonly string[])[],
): Uint8Array {
  const mime = odfMime(format);
  const paragraphs = pages
    .flat()
    .map((line) => `<text:p>${escapeXml(line)}</text:p>`)
    .join('');
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:text>${paragraphs}</office:text></office:body></office:document-content>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:media-type="${mime}" manifest:full-path="/"/><manifest:file-entry manifest:media-type="text/xml" manifest:full-path="content.xml"/></manifest:manifest>`;
  return zipSync({
    mimetype: encoder.encode(mime),
    'content.xml': encoder.encode(content),
    'META-INF/manifest.xml': encoder.encode(manifest),
  });
}

async function epubToPdf(bytes: Uint8Array, options: ConversionOptions): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const root = decoder.decode(files['META-INF/container.xml'] ?? new Uint8Array());
  const opfPath = root.match(/full-path=["']([^"']+)["']/iu)?.[1];
  const opf = opfPath ? decoder.decode(files[opfPath] ?? new Uint8Array()) : '';
  const base = opfPath?.includes('/') ? `${opfPath.slice(0, opfPath.lastIndexOf('/') + 1)}` : '';
  const ids = [...opf.matchAll(/<item\b[^>]*id=["']([^"']+)["'][^>]*href=["']([^"']+)["']/giu)].map(
    (match) => ({ id: match[1], href: match[2] }),
  );
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref=["']([^"']+)["']/giu)].map(
    (match) => match[1],
  );
  const chapters = spine
    .map((id) => ids.find((item) => item.id === id)?.href)
    .filter((href): href is string => Boolean(href))
    .map((href) => htmlToPlainText(decoder.decode(files[`${base}${href}`] ?? new Uint8Array())));
  return textPagesToPdf(
    chapters.map((chapter) => chapter.split(/\r?\n/u)),
    options,
  );
}

export function createEpub(chapters: readonly string[]): Uint8Array {
  const items = chapters
    .map(
      (_, index) =>
        `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    )
    .join('');
  const spine = chapters.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join('');
  const files: Record<string, Uint8Array> = {
    mimetype: encoder.encode('application/epub+zip'),
    'META-INF/container.xml': encoder.encode(
      '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    ),
    'OEBPS/content.opf': encoder.encode(
      `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">local-pdf-export</dc:identifier><dc:title>PDF export</dc:title></metadata><manifest>${items}</manifest><spine>${spine}</spine></package>`,
    ),
  };
  chapters.forEach((chapter, index) => {
    files[`OEBPS/chapter-${index + 1}.xhtml`] = encoder.encode(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Page ${index + 1}</title></head><body>${chapter
        .split(/\r?\n/u)
        .map((line) => `<p>${escapeXml(line)}</p>`)
        .join('')}</body></html>`,
    );
  });
  return zipSync(files);
}

async function archiveToPdf(bytes: Uint8Array, options: ConversionOptions): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const pdfs: Uint8Array[] = [];
  for (const name of Object.keys(files).sort()) {
    const entry = files[name];
    if (!entry) continue;
    if (/\.pdf$/iu.test(name)) pdfs.push(entry);
    else if (/\.(?:jpg|jpeg|png)$/iu.test(name))
      pdfs.push(await imageToPdf(entry, /\.png$/iu.test(name) ? 'png' : 'jpg', options));
  }
  if (pdfs.length === 0)
    throw conversionFailure('zip', 'to-pdf', 'The archive contains no PDF, JPEG, or PNG entries.');
  return pdfs.length === 1 ? (pdfs[0] ?? new Uint8Array()) : mergePdfBuffers(pdfs);
}

export function legacyCompoundToText(bytes: Uint8Array, format: 'doc' | 'xls' = 'doc'): string {
  if (
    bytes.length < 8 ||
    !bytes
      .slice(0, 8)
      .every((byte, index) => byte === [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1][index])
  )
    throw conversionFailure(
      format,
      'to-pdf',
      'The file is not an OLE2/Compound File binary document.',
    );
  const ascii = decoder
    .decode(bytes)
    .replaceAll(/[^\p{ASCII}]+/gu, '\n')
    .split(/\n+/u)
    .filter((line) => line.trim().length >= 3);
  const utf16 = new TextDecoder('utf-16le')
    .decode(bytes)
    .replaceAll(/[^\p{ASCII}]+/gu, '\n')
    .split(/\n+/u)
    .filter((line) => line.trim().length >= 3);
  const unique = [...new Set([...utf16, ...ascii].map((line) => line.trim()))];
  if (unique.length === 0)
    throw conversionFailure(
      format,
      'to-pdf',
      'No readable text streams were found in this legacy binary file.',
    );
  return unique.join('\n');
}

export async function psdCompositeToPng(bytes: Uint8Array): Promise<Uint8Array> {
  if (decoder.decode(bytes.slice(0, 4)) !== '8BPS')
    throw conversionFailure('psd', 'to-pdf', 'The file is not a Photoshop PSD document.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(12);
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  const depth = view.getUint16(22);
  const mode = view.getUint16(24);
  if (depth !== 8 || (mode !== 3 && mode !== 1) || channels < 3)
    throw conversionFailure(
      'psd',
      'to-pdf',
      'Only 8-bit RGB/CMYK flattened PSD composites are supported.',
    );
  let offset = 26;
  offset += view.getUint32(offset) + 4;
  offset += view.getUint32(offset) + 4;
  offset += view.getUint32(offset) + 4;
  const compression = view.getUint16(offset);
  offset += 2;
  const planeSize = width * height;
  const planes: Uint8Array[] = [];
  if (compression === 0) {
    for (let channel = 0; channel < Math.min(channels, 4); channel += 1)
      planes.push(bytes.slice(offset + channel * planeSize, offset + (channel + 1) * planeSize));
  } else if (compression === 1) {
    const rowCount = height * channels;
    const lengths: number[] = [];
    for (let index = 0; index < rowCount; index += 1)
      lengths.push(view.getUint16(offset + index * 2));
    offset += rowCount * 2;
    for (let channel = 0; channel < Math.min(channels, 4); channel += 1) {
      const plane = new Uint8Array(planeSize);
      let planeOffset = 0;
      for (let row = 0; row < height; row += 1) {
        const length = lengths[channel * height + row] ?? 0;
        const decoded = unpackBits(bytes.slice(offset, offset + length), width);
        plane.set(decoded, planeOffset);
        planeOffset += width;
        offset += length;
      }
      planes.push(plane);
    }
  } else
    throw conversionFailure('psd', 'to-pdf', 'The PSD uses an unsupported image compression mode.');
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < planeSize; index += 1) {
    const red = planes[0]?.[index] ?? 0;
    rgba[index * 4] = red;
    rgba[index * 4 + 1] = planes[1]?.[index] ?? red;
    rgba[index * 4 + 2] = planes[2]?.[index] ?? red;
    rgba[index * 4 + 3] = planes[3]?.[index] ?? 255;
  }
  return rgbaToPng(rgba, width, height);
}

function unpackBits(bytes: Uint8Array, width: number): Uint8Array {
  const output = new Uint8Array(width);
  let out = 0;
  for (let index = 0; index < bytes.length && out < width;) {
    const value = bytes[index++] ?? 0;
    if (value <= 127) {
      const count = value + 1;
      output.set(bytes.slice(index, index + count), out);
      out += count;
      index += count;
    } else if (value >= 129) {
      const count = 257 - value;
      output.fill(bytes[index++] ?? 0, out, out + count);
      out += count;
    }
  }
  return output;
}

function rgbaToPng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width * 4 + 1)] = 0;
    raw.set(rgba.slice(row * width * 4, (row + 1) * width * 4), row * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const typeBytes = encoder.encode(type);
    return concat(uint32(data.length), typeBytes, data, uint32(crc32(concat(typeBytes, data))));
  };
  return concat(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', uint32(width, height, 8, 6, 0, 0, 0)),
    chunk('IDAT', deflate(raw)),
    chunk('IEND', new Uint8Array()),
  );
}

function deflate(value: Uint8Array): Uint8Array {
  return zlibSync(value);
}

function uint32(...values: number[]): Uint8Array {
  return new Uint8Array(
    values.flatMap((value) => [
      (value >>> 24) & 255,
      (value >>> 16) & 255,
      (value >>> 8) & 255,
      value & 255,
    ]),
  );
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
function stripXml(value: string): string {
  return unescapeXml(
    value
      .replaceAll(/<[^>]+>/gu, '')
      .replaceAll(/\s+/gu, ' ')
      .trim(),
  );
}
function unescapeXml(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
function isRenderer(value: unknown): value is Parameters<typeof renderPdfPageToPng>[2] {
  return Boolean(value && typeof value === 'object' && 'renderPage' in value);
}
function conversionFailure(format: string, direction: ConversionDirection, cause: string): never {
  throw new PdfEngineError({
    kind: 'conversion-failed',
    format,
    direction,
    cause,
    remedy: 'Preserve the original file, export it to a supported format, and retry.',
  });
}
