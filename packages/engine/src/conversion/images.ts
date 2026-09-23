import { PDFDocument, rgb } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { PdfEngineError } from '../errors.js';
import type { ConversionOptions } from '../types.js';
import type { PdfiumRenderer } from '../pdf/read.js';

export type RenderedPage = {
  readonly pageNumber: number;
  readonly bytes: Uint8Array;
  readonly mimeType: 'image/png';
  readonly width: number;
  readonly height: number;
};

export async function imageToPdf(
  bytes: Uint8Array,
  format: 'jpg' | 'png' | 'bmp' | 'gif' | 'tiff' | 'webp' | 'heic' | 'svg',
  options: ConversionOptions = {},
): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const background = options.backgroundColor ?? { r: 1, g: 1, b: 1 };
  if (format === 'jpg') {
    const image = await document.embedJpg(bytes);
    const page = document.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return document.save();
  }
  if (format === 'png') {
    const image = await document.embedPng(bytes);
    const page = document.addPage([image.width, image.height]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
      color: rgb(background.r, background.g, background.b),
    });
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
    return document.save();
  }
  if (format === 'svg') return svgToPdf(bytes);
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new PdfEngineError({
      kind: 'unsupported-format',
      format,
      direction: 'to-pdf',
      remedy: `This runtime cannot decode ${format.toUpperCase()} locally. Open the file in a browser with a platform image decoder, or export it as PNG/JPEG first.`,
    });
  }
  const blob = new Blob([new Uint8Array(bytes).buffer as ArrayBuffer]);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The browser image canvas is unavailable.');
  context.drawImage(bitmap, 0, 0);
  const png = new Uint8Array(
    await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
  );
  return imageToPdf(png, 'png', options);
}

export async function svgToPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const source = new TextDecoder().decode(bytes);
  if (!/^\s*<svg\b/iu.test(source)) {
    throw new PdfEngineError({
      kind: 'conversion-failed',
      format: 'svg',
      direction: 'to-pdf',
      cause: 'The input does not contain an SVG root element.',
      remedy: 'Export a valid SVG document and retry.',
    });
  }
  const viewBox =
    /viewBox\s*=\s*["']\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)\s*["']/iu.exec(source);
  const width = Number.parseFloat(/width\s*=\s*["']([\d.]+)/iu.exec(source)?.[1] ?? '') || 595;
  const height = Number.parseFloat(/height\s*=\s*["']([\d.]+)/iu.exec(source)?.[1] ?? '') || 842;
  const document = await PDFDocument.create();
  const page = document.addPage([width, height]);
  const shapes =
    source.match(
      /<(?:rect|circle|line|text)\b[^>]*>(?:[^<]*)<\/text>|<(?:rect|circle|line)\b[^>]*\/>/giu,
    ) ?? [];
  if (shapes.length === 0) {
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'SVG vector elements',
      remedy:
        'Use SVG rect, circle, line, or text elements, or export the artwork as PNG before creating the PDF.',
    });
  }
  const scaleX = viewBox ? width / Number.parseFloat(viewBox[3] ?? '1') : 1;
  const scaleY = viewBox ? height / Number.parseFloat(viewBox[4] ?? '1') : 1;
  for (const shape of shapes) {
    const attrs = (name: string): number =>
      Number.parseFloat(new RegExp(`${name}=["']([\\d.]+)`, 'iu').exec(shape)?.[1] ?? '0');
    const color = parseSvgColor(/(?:fill|stroke)=["']([^"']+)/iu.exec(shape)?.[1]);
    const x = attrs('x') * scaleX;
    const y = height - attrs('y') * scaleY;
    if (/^<rect\b/iu.test(shape)) {
      page.drawRectangle({
        x,
        y: y - attrs('height') * scaleY,
        width: attrs('width') * scaleX,
        height: attrs('height') * scaleY,
        color,
      });
    } else if (/^<circle\b/iu.test(shape)) {
      page.drawCircle({
        x: attrs('cx') * scaleX,
        y: height - attrs('cy') * scaleY,
        size: attrs('r') * Math.min(scaleX, scaleY),
        color,
      });
    } else if (/^<line\b/iu.test(shape)) {
      page.drawLine({
        start: { x, y },
        end: { x: attrs('x2') * scaleX, y: height - attrs('y2') * scaleY },
        thickness: attrs('stroke-width') || 1,
        color,
      });
    } else {
      const text = shape.replaceAll(/<[^>]+>/gu, '').trim();
      if (text) page.drawText(text, { x, y, size: attrs('font-size') || 12, color });
    }
  }
  return document.save();
}

export async function renderPdfPageToPng(
  bytes: Uint8Array,
  pageNumber: number,
  renderer: PdfiumRenderer,
): Promise<RenderedPage> {
  const rendered = await renderer.renderPage(bytes, pageNumber);
  return {
    pageNumber,
    bytes: encodePng(rendered.pixels, rendered.width, rendered.height),
    mimeType: 'image/png',
    width: rendered.width,
    height: rendered.height,
  };
}

export function extractEmbeddedImages(bytes: Uint8Array): readonly Uint8Array[] {
  const output: Uint8Array[] = [];
  const text = new TextDecoder('latin1').decode(bytes);
  const imageObjectPattern = /<<[\s\S]*?\/Subtype\s*\/Image[\s\S]*?stream\s*\r?\n/gu;
  for (const match of text.matchAll(imageObjectPattern)) {
    const start = (match.index ?? 0) + match[0].length;
    const end = text.indexOf('endstream', start);
    if (end < 0) continue;
    const dictionary = match[0];
    const filter = /\/Filter\s*\/(DCTDecode|JPXDecode)/u.exec(dictionary)?.[1];
    if (filter === 'DCTDecode') output.push(bytes.slice(start, end));
    else if (filter === 'JPXDecode') output.push(bytes.slice(start, end));
  }
  return output;
}

function parseSvgColor(value: string | undefined) {
  if (!value || value === 'none') return rgb(0, 0, 0);
  const hex = /^#([\da-f]{6})$/iu.exec(value.trim());
  if (!hex) return rgb(0, 0, 0);
  const digits = hex[1];
  if (!digits) return rgb(0, 0, 0);
  return rgb(
    Number.parseInt(digits.slice(0, 2), 16) / 255,
    Number.parseInt(digits.slice(2, 4), 16) / 255,
    Number.parseInt(digits.slice(4, 6), 16) / 255,
  );
}

function encodePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    raw.set(rgba.slice(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return concat(
    signature,
    pngChunk('IHDR', uint32(width, height, 8, 6, 0, 0, 0)),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  );
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  return concat(uint32(data.byteLength), typeBytes, data, uint32(crc32(concat(typeBytes, data))));
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
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}
