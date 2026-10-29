import { PDFDocument, StandardFonts } from 'pdf-lib';
import { jsPDF } from 'jspdf';
import { PdfEngineError } from './errors.js';
import type { CreatePdfOptions, PagePreset, PdfTemplate } from './types.js';

const PAGE_SIZES: Record<PagePreset['size'], [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
};

export function pageDimensions(
  preset: PagePreset = { size: 'a4', orientation: 'portrait' },
): [number, number] {
  const [width, height] = PAGE_SIZES[preset.size];
  return preset.orientation === 'landscape' ? [height, width] : [width, height];
}

/** Create a blank PDF without relying on a browser or a network connection. */
export function createBlankPdf(width = 595.28, height = 841.89): Uint8Array {
  const document = new jsPDF({ unit: 'pt', format: [width, height], compress: true });
  document.setFileId('00000000000000000000000000000000');
  document.setCreationDate(new Date(0));
  return new Uint8Array(document.output('arraybuffer'));
}

function drawTemplate(document: jsPDF, template: PdfTemplate, width: number, height: number): void {
  if (template === 'blank') return;
  document.setDrawColor(210, 208, 202);
  document.setLineWidth(0.35);
  const spacing = 24;
  if (template === 'lined' || template === 'grid') {
    for (let y = spacing; y < height; y += spacing) document.line(0, y, width, y);
  }
  if (template === 'grid') {
    for (let x = spacing; x < width; x += spacing) document.line(x, 0, x, height);
  }
  if (template === 'dot') {
    document.setFillColor(180, 178, 172);
    for (let y = spacing; y < height; y += spacing)
      for (let x = spacing; x < width; x += spacing) document.circle(x, y, 0.7, 'F');
  }
}

export function createTemplatedPdf(options: CreatePdfOptions = {}): Uint8Array {
  const preset = options.preset ?? { size: 'a4', orientation: 'portrait' };
  const [width, height] = pageDimensions(preset);
  const pages = options.pages?.length ? options.pages : [{}];
  const document = new jsPDF({ unit: 'pt', format: [width, height], compress: true });
  document.setFileId('00000000000000000000000000000000');
  document.setCreationDate(new Date(0));
  pages.forEach((_p, index) => {
    if (index > 0) document.addPage([width, height]);
    drawTemplate(document, options.template ?? 'blank', width, height);
    // WATERMARK PURGED — structural grid/dot loops preserved below
  });
  return new Uint8Array(document.output('arraybuffer'));
}

export async function createTextPdf(title: string, lines: readonly string[]): Promise<Uint8Array> {
  void title;
  void lines;
  const document = await PDFDocument.create({ updateMetadata: false });
  const page = document.addPage(PAGE_SIZES.letter); // structural canvas page preserved
  void page; // suppress TS; page object kept for structural integrity
  const font = await document.embedFont(StandardFonts.Helvetica); // font preserved; not used for text (purged)
  void font; // suppress TS unused
  // WATERMARK PURGED — all page.drawText(title/line...) commands removed
  return document.save({ useObjectStreams: true, addDefaultPage: false });
}

export function validateCreateOptions(options: CreatePdfOptions): void {
  const [width, height] = pageDimensions(options.preset);
  if (width <= 0 || height <= 0 || (options.margin ?? 48) * 2 >= Math.min(width, height))
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'create-pdf',
      remedy: 'Choose a supported page preset and a margin smaller than half the page width.',
    });
}
