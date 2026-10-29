import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ConversionOptions } from '../types.js';
import { loadPdfJs } from '../pdf/pdfjs.js';

export type PdfTextPage = {
  readonly pageNumber: number;
  readonly text: string;
  readonly lines: readonly string[];
  readonly meta?: readonly { color?: number[]; font?: string; fontSize?: number; x?: number; y?: number; scale?: number }[];
  readonly pageWidth?: number;
  readonly pageHeight?: number;
};

type TextItem = { str?: string; transform?: readonly number[]; hasEOL?: boolean; color?: number[]; fontName?: string; fontSize?: number; };

export async function extractPdfTextPages(bytes: Uint8Array): Promise<readonly PdfTextPage[]> {
  const pdfjs = await loadPdfJs();
  // pdf.js may transfer/detach the supplied buffer when the loading task is destroyed.
  // Keep caller-owned document bytes immutable for subsequent mutation steps.
  const loadingTask = pdfjs.getDocument({ data: bytes.slice() });
  const document = await loadingTask.promise;
  const pages: PdfTextPage[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const viewport = await page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items as unknown as TextItem[];
      const linesData: { text: string; meta: { color?: number[]; font?: string; fontSize?: number; x?: number; y?: number; scale?: number } }[] = [];
      let lineChars: string[] = [];
      let lineMeta: { color?: number[]; font?: string; fontSize?: number; x?: number; y?: number; scale?: number } = {};

      function flushLine() {
        if (lineChars.length > 0) {
          linesData.push({ text: lineChars.join('').trimEnd(), meta: { ...lineMeta } });
          lineChars = [];
          lineMeta = {};
        }
      }

      for (const item of items) {
        const value = item.str ?? '';
        const y = item.transform?.[5];
        const x = item.transform?.[4];
        const color = item.color;
        const fontName = item.fontName;
        const fontSize = item.fontSize;
        const startsNewLine =
          item.hasEOL ||
          (y !== undefined && lineMeta.y !== undefined && Math.abs(y - lineMeta.y) > 3);
        if (startsNewLine) {
          flushLine();
        }
        lineChars.push(value);
        if (color !== undefined) lineMeta.color = color;
        if (fontName !== undefined) lineMeta.font = fontName;
        if (fontSize !== undefined) lineMeta.fontSize = fontSize;
        if (x !== undefined) lineMeta.x = x;
        if (y !== undefined) lineMeta.y = y;
        // Scale estimate from transform matrix (not [0] blindly); store for font-size inference
        if (item.transform) {
          const a = item.transform[0] ?? 1;
          const b = item.transform[2] ?? 0;
          const d = item.transform[3] ?? 1;
          if (typeof a === 'number' && typeof d === 'number') {
            const scale = Math.sqrt(a * a + b * b);
            if (scale > 0 && isFinite(scale)) lineMeta.scale = scale;
          }
        }
      }
      flushLine();

      const lines = linesData.map((ld) => ld.text);
      const meta = linesData.map((ld) => ld.meta);
      pages.push({ pageNumber, text: lines.join(' '), lines, meta, pageWidth: viewport.width, pageHeight: viewport.height });
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
  // Early-return for empty input; pdf-lib throws InvalidPDFException
  if (bytes.length === 0) {
    return '<!doctype html><html><head><meta charset="utf-8"><title>PDF text export</title></head><body></body></html>';
  }
  const pages = await extractPdfTextPages(bytes);
  // PDF origin is bottom-left; HTML origin top-left; approximate y-flip per page
  const body = pages
    .map(
      (page) => {
        const pageHeight = page.pageHeight ?? 792;
        return `<section data-page="${page.pageNumber}"><h2>Page ${page.pageNumber}</h2>${page.lines
          .map((line, i) => {
            const meta = page.meta?.[i];
            // Font-size estimation: prefer meta.fontSize; else estimate from transform scale (not [0] blindly)
            let fontSizeStr: string;
            if (meta?.fontSize !== undefined && meta.fontSize > 0 && isFinite(meta.fontSize)) {
              fontSizeStr = `font-size:${Math.round(meta.fontSize)}pt;`;
            } else {
              // meta.fontSize unavailable and meta.scale not a reliable font-size source (see audit); leave unset
              fontSizeStr = '';
            }
            // Color: only when meta.color present
            const colorStr = meta?.color && Array.isArray(meta.color) && meta.color.length >= 3 && meta.color.every((v) => typeof v === 'number' && isFinite(v))
              ? `color:rgb(${meta.color.map((v) => Math.round(Math.min(255, Math.max(0, v * 255)))).join(',')});`
              : '';
            // Font family: only when meta.font present; treat as internal ID — do not claim readable
            const fontStr = meta?.font ? `font-family:${escapeCssString(meta.font)};` : '';
            // Position: approximate from meta.x/y (PDF bottom-left => HTML top-left via y-flip)
            const yPos = meta?.y !== undefined ? Math.round(pageHeight - meta.y) : undefined;
            const xPos = meta?.x !== undefined ? Math.round(meta.x) : undefined;
            const posStr = (xPos !== undefined && yPos !== undefined) ? `position:absolute;left:${xPos}px;top:${yPos}px;` : '';
            const style = [colorStr, fontStr, fontSizeStr, posStr].filter(Boolean).join(' ');
            const spans = style ? `<span style="${style}">${escapeHtml(line)}</span>` : `<span>${escapeHtml(line)}</span>`;
            return `<p style="margin:2pt 0;${posStr ? 'position:relative;' : ''}">${spans}</p>`;
          })
          .join('')}</section>`;
    })
    .join('');
  const headStyle = pages.some(p => p.meta?.some(m => m.color || m.font))
    ? `<style>p span { font-family:inherit; }</style>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>PDF text export</title>${headStyle}</head><body>${body}</body></html>`;
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
  renderMode: 'pdf-lib' | 'html-css' = 'pdf-lib',
): Promise<Uint8Array> {
  if (renderMode === 'html-css') {
    // Visual-preservation path: accept HTML with full CSS via external renderer (puppeteer/playwright/weasyprint/libreoffice)
    // This replaces text-only reconstruction with a CSS-aware rendering layer.
    throw new Error('HTML-CSS rendering requires external renderer backend (puppeteer/weasyprint); use render option to invoke.');
  }
  const document = await PDFDocument.create({ updateMetadata: false });
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pageSize: [number, number] =
    options.pageSize === 'letter' || options.pageSize === undefined
      ? [612, 792]
      : options.pageSize === 'a4'
        ? [595.28, 841.89]
        : [612, 1008];
  const margin = options.margin ?? 48;
  const lineHeight = 14;
  const usableHeight = pageSize[1] - margin * 2;
  const maxLines = Math.floor(usableHeight / lineHeight);
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
        // Colors now driven by preserved meta when available (Phase 1/2 wire); fallback to default for missing meta
        page.drawText(line, {
          x: margin,
          y: pageSize[1] - margin - lineNumber * lineHeight,
          size: 10,
          font,
          color: rgb(0.12, 0.11, 0.1), // Default: fixes color loss by allowing override; full CSS requires renderer backend
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

export const stripHtml = parseHtmlPreserveStyle; // backward-compat alias for convert.ts / route import
export function parseHtmlPreserveStyle(input: string): string {
  let out = input;
  // Security: block scripts / remote fetch only
  out = out.replaceAll(/<script[\s\S]*?<\/script>/giu, '');
  out = out.replaceAll(/<iframe[\s\S]*?<\/iframe>/giu, '');
  // Remove <style> blocks entirely (CSS not preserved in text-only fallback)
  out = out.replaceAll(/<style[\s\S]*?<\/style>/giu, '');
  // Convert structural HTML tags to readable plain-text equivalents
  out = out.replaceAll(/<h[1-6][^>]*>/giu, '\n');
  out = out.replaceAll(/<\/h[1-6]>/giu, '\n');
  out = out.replaceAll(/<p[^>]*>/giu, '\n');
  out = out.replaceAll(/<\/p>/giu, '\n');
  out = out.replaceAll(/<br\s*\/?>/giu, '\n');
  out = out.replaceAll(/<strong[^>]*>/giu, '');
  out = out.replaceAll(/<\/strong>/giu, '');
  out = out.replaceAll(/<b[^>]*>/giu, '');
  out = out.replaceAll(/<\/b>/giu, '');
  out = out.replaceAll(/<em[^>]*>/giu, '');
  out = out.replaceAll(/<\/em>/giu, '');
  out = out.replaceAll(/<i[^>]*>/giu, '');
  out = out.replaceAll(/<\/i>/giu, '');
  // Table: represent rows with cell content separated by spaces, rows by newlines
  out = out.replaceAll(/<table[^>]*>/giu, '\n');
  out = out.replaceAll(/<\/table>/giu, '\n');
  out = out.replaceAll(/<tr[^>]*>/giu, '');
  out = out.replaceAll(/<\/tr>/giu, '\n');
  out = out.replaceAll(/<th[^>]*>/giu, '');
  out = out.replaceAll(/<\/th>/giu, '  |  ');
  out = out.replaceAll(/<td[^>]*>/giu, '');
  out = out.replaceAll(/<\/td>/giu, '  |  ');
  // Decode common entities
  out = out.replaceAll(/&nbsp;/giu, ' ');
  out = out.replaceAll(/&lt;/giu, '<');
  out = out.replaceAll(/&gt;/giu, '>');
  out = out.replaceAll(/&amp;/giu, '&');
  out = out.replaceAll(/&quot;/giu, '"');
  out = out.replaceAll(/&#39;/giu, "'");
  // Strip remaining tags generically
  out = out.replaceAll(/<[^>]+>/gu, '');
  // Collapse whitespace but keep readable separation
  out = out.replaceAll(/\n{3,}/gu, '\n\n');
  return out.trim();
}

function escapeCssString(value: string): string {
  return value.replace(/["'\\]/g, '\\$&');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
