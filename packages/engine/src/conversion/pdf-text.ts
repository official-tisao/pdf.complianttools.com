import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ConversionOptions } from '../types.js';

export type PdfTextPage = {
  readonly pageNumber: number;
  readonly lines: readonly string[];
};

type TextItem = { str?: string; transform?: readonly number[]; hasEOL?: boolean };

export async function extractPdfTextPages(bytes: Uint8Array): Promise<readonly PdfTextPage[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const document = await loadingTask.promise;
  const pages: PdfTextPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items as unknown as TextItem[];
      const lines: string[] = [];
      let current = '';
      let previousY: number | undefined;
      for (const item of items) {
        const value = item.str ?? '';
        const y = item.transform?.[5];
        const startsNewLine =
          item.hasEOL ||
          (y !== undefined && previousY !== undefined && Math.abs(y - previousY) > 3);
        if (startsNewLine && current.trim()) {
          lines.push(current.trimEnd());
          current = '';
        }
        current += value;
        if (y !== undefined) previousY = y;
      }
      if (current.trim()) lines.push(current.trimEnd());
      pages.push({ pageNumber, lines });
    }
  } finally {
    await loadingTask.destroy();
  }
  return pages;
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pages = await extractPdfTextPages(bytes);
  return pages.map((page) => page.lines.join('\n')).join('\n\n');
}

export async function pdfToMarkdown(bytes: Uint8Array): Promise<string> {
  const pages = await extractPdfTextPages(bytes);
  const output: string[] = [];
  for (const page of pages) {
    output.push(`## Page ${page.pageNumber}`, '', ...inferMarkdownLines(page.lines), '');
  }
  return `${output.join('\n').trim()}\n`;
}

function inferMarkdownLines(lines: readonly string[]): string[] {
  return lines.map((line) => {
    if (/^[-*]\s/u.test(line)) return line;
    if (/^\d+[.)]\s/u.test(line)) return line;
    if (/^.{0,80}:$/u.test(line)) return `### ${line.slice(0, -1)}`;
    return line;
  });
}

export async function pdfToHtml(bytes: Uint8Array): Promise<string> {
  const pages = await extractPdfTextPages(bytes);
  const body = pages
    .map(
      (page) =>
        `<section data-page="${page.pageNumber}"><h2>Page ${page.pageNumber}</h2>${page.lines
          .map((line) => `<p>${escapeHtml(line)}</p>`)
          .join('')}</section>`,
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>PDF text export</title></head><body>${body}</body></html>`;
}

export function pdfToRtf(text: string): string {
  const escaped = text
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
    .replaceAll('\n', '\\par\n');
  return `{\\rtf1\\ansi\\deff0 ${escaped}}`;
}

export function csvToRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.trim().length > 0));
}

export function rowsToCsv(rows: readonly (readonly string[])[]): string {
  return `${rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\n')}\n`;
}

export async function textPagesToPdf(
  pages: readonly (readonly string[])[],
  options: ConversionOptions = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pageSize: [number, number] =
    options.pageSize === 'letter' || options.pageSize === undefined
      ? [612, 792]
      : options.pageSize === 'a4'
        ? [595.28, 841.89]
        : [612, 1008];
  const margin = options.margin ?? 48;
  const lineHeight = 16;
  const maxLines = Math.floor((pageSize[1] - margin * 2) / lineHeight);
  for (const sourcePage of pages.length > 0 ? pages : [[]]) {
    let page = document.addPage(pageSize as [number, number]);
    let lineNumber = 0;
    for (const sourceLine of sourcePage.length > 0 ? sourcePage : ['']) {
      const wrapped = wrapText(sourceLine, 100);
      for (const line of wrapped) {
        if (lineNumber >= maxLines) {
          page = document.addPage(pageSize as [number, number]);
          lineNumber = 0;
        }
        page.drawText(line, {
          x: margin,
          y: pageSize[1] - margin - lineNumber * lineHeight,
          size: 10,
          font,
          color: rgb(0.12, 0.11, 0.1),
        });
        lineNumber += 1;
      }
    }
  }
  return document.save();
}

export function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

export function stripRtf(input: string): string {
  return input
    .replaceAll(/\\[a-z]+\d* ?/giu, '')
    .replaceAll(/[{}]/gu, '')
    .replaceAll(/\\'[0-9a-f]{2}/giu, '')
    .trim();
}

export function stripHtml(input: string): string {
  return input
    .replaceAll(/<script[\s\S]*?<\/script>/giu, '')
    .replaceAll(/<style[\s\S]*?<\/style>/giu, '')
    .replaceAll(/<br\s*\/?\s*>/giu, '\n')
    .replaceAll(/<\/p\s*>/giu, '\n')
    .replaceAll(/<[^>]+>/gu, '')
    .replaceAll(/&nbsp;/giu, ' ')
    .replaceAll(/&amp;/giu, '&')
    .replaceAll(/&lt;/giu, '<')
    .replaceAll(/&gt;/giu, '>')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
