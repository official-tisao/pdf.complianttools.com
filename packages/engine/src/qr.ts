import QRCode from 'qrcode';
import { PDFDocument } from 'pdf-lib';
import { zlibSync } from 'fflate';
import { PdfEngineError } from './errors.js';
import type { QrPayload, QrRender } from './types.js';

function payloadText(payload: QrPayload): string {
  if (payload.kind === 'vcard') {
    if (!payload.name.trim())
      throw new PdfEngineError({
        kind: 'invalid-operation',
        operation: 'qr-code',
        remedy: 'Enter a contact name for the vCard.',
      });
    return [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${payload.name}`,
      payload.organization ? `ORG:${payload.organization}` : '',
      payload.phone ? `TEL:${payload.phone}` : '',
      payload.email ? `EMAIL:${payload.email}` : '',
      'END:VCARD',
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (!payload.value?.trim())
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'qr-code',
      remedy: 'Enter text or a URL to encode.',
    });
  return payload.value;
}

function matrixSvg(matrix: readonly boolean[][], margin = 4, moduleSize = 4): string {
  const size = matrix.length;
  const total = (size + margin * 2) * moduleSize;
  const paths: string[] = [];
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark)
        paths.push(
          `M${(x + margin) * moduleSize} ${(y + margin) * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`,
        );
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${paths.join('')}"/></svg>`;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(12 + data.length);
  new DataView(output.buffer).setUint32(0, data.length);
  output.set(typeBytes, 4);
  output.set(data, 8);
  new DataView(output.buffer).setUint32(
    8 + data.length,
    crc32(output.subarray(4, 8 + data.length)),
  );
  return output;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function matrixPng(matrix: readonly boolean[][], margin = 4, moduleSize = 8): Uint8Array {
  const size = (matrix.length + margin * 2) * moduleSize;
  const raw = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const qx = Math.floor(x / moduleSize) - margin;
      const qy = Math.floor(y / moduleSize) - margin;
      const dark =
        qx >= 0 && qy >= 0 && qy < matrix.length && qx < matrix.length && matrix[qy]?.[qx];
      const value = dark ? 0 : 255;
      const offset = row + 1 + x * 4;
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
      raw[offset + 3] = 255;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header[8] = 8;
  header[9] = 6;
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibSync(raw)),
    pngChunk('IEND', new Uint8Array()),
  ];
  const output = new Uint8Array(chunks.reduce((sum, item) => sum + item.length, 0));
  let offset = 0;
  chunks.forEach((item) => {
    output.set(item, offset);
    offset += item.length;
  });
  return output;
}

export async function generateQr(payload: QrPayload): Promise<QrRender> {
  const text = payloadText(payload);
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M', maskPattern: 0 });
  const modules = Array.from({ length: qr.modules.size }, (_, row) =>
    Array.from({ length: qr.modules.size }, (_, col) => qr.modules.get(row, col) === 1),
  );
  const png = matrixPng(modules);
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const image = await pdf.embedPng(png);
  const page = pdf.addPage([612, 792]);
  page.drawImage(image, { x: 96, y: 240, width: 420, height: 420 });
  page.drawText(text.slice(0, 120), { x: 48, y: 180, size: 10 });
  return {
    modules,
    version: qr.version,
    svg: matrixSvg(modules),
    png,
    pdf: await pdf.save({ useObjectStreams: true, addDefaultPage: false }),
  };
}

export function qrPayloadText(payload: QrPayload): string {
  return payloadText(payload);
}

/** Professional customization layer using qr-code-styling (browser/DOM only). Preserves basic generateQr. */
export interface QrStyleOptions {
  cornerSquare?: 'square' | 'rounded' | 'circle';
  cornerDot?: 'square' | 'rounded' | 'dot';
  dotsType?: 'square' | 'rounded' | 'dots' | 'extra-rounded';
  foreground?: string;
  background?: string;
  logoUrl?: string;
  logoSize?: number;
  frame?: boolean;
  frameText?: string;
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
}

export function buildStyledQrOptions(text: string, opts: QrStyleOptions = {}) {
  return {
    width: 300,
    height: 300,
    type: 'svg' as const,
    data: text,
    image: opts.logoUrl || '',
    dotsOptions: {
      type: (opts.dotsType || 'rounded') as string,
      color: opts.foreground || '#181818',
    },
    cornersSquareOptions: {
      type: (opts.cornerSquare || 'square') as string,
      color: opts.foreground || '#181818',
    },
    cornersDotOptions: {
      type: (opts.cornerDot || 'square') as string,
      color: opts.foreground || '#181818',
    },
    backgroundOptions: {
      color: opts.background || '#ffffff',
    },
    qrOptions: {
      errorCorrectionLevel: (opts.errorCorrection || 'M') as string,
    },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: (opts.logoSize || 30) / 100,
    },
  };
}

/**
 * Renders the styled QR as an SVG string. Requires a DOM (browser). In Node the library's
 * svg window shim is absent, so this throws — callers must feature-detect `document`.
 */
export async function generateStyledQrSvg(
  text: string,
  opts: QrStyleOptions = {},
): Promise<string> {
  // Dynamic import avoids pulling the DOM library into Node build graph eagerly.
  const mod = await import('qr-code-styling');
  const QRCodeStyling =
    (mod as unknown as { default?: new (opts: unknown) => unknown }).default || mod;
  if (typeof (globalThis as Record<string, unknown>).document === 'undefined')
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'styled QR rendering',
      remedy:
        'Styled QR rendering needs a browser environment. Use generateQr for server-side generation.',
    });
  const instance = new (
    QRCodeStyling as unknown as new (o: unknown) => {
      _getElement: (e: string) => Promise<Record<string, unknown> | undefined>;
    }
  )(buildStyledQrOptions(text, opts));
  const svgElement: Record<string, unknown> | undefined = await instance._getElement('svg');
  if (!svgElement || typeof svgElement !== 'object')
    throw new PdfEngineError({
      kind: 'conversion-failed',
      format: 'svg',
      direction: 'to-pdf',
      cause: 'styled renderer returned no element',
      remedy: 'Simplify the QR design and retry.',
    });
  return (svgElement as { outerHTML?: string }).outerHTML ?? String(svgElement);
}

/** Renders the styled QR as PNG bytes at a given scale for print-quality export. Browser only. */
export async function generateStyledQrPng(
  text: string,
  opts: QrStyleOptions = {},
  size = 1024,
): Promise<Uint8Array> {
  if (typeof (globalThis as Record<string, unknown>).document === 'undefined')
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'styled QR rendering',
      remedy: 'Styled QR export needs a browser environment.',
    });
  const options = {
    ...buildStyledQrOptions(text, opts),
    width: size,
    height: size,
    type: 'canvas' as const,
  };
  const mod = await import('qr-code-styling');
  const QRCodeStyling =
    (mod as unknown as { default?: new (opts: unknown) => unknown }).default || mod;
  const instance = new (
    QRCodeStyling as unknown as new (o: unknown) => {
      getRawData: (e?: string) => Promise<Blob | null>;
    }
  )(options);
  const blob = await instance.getRawData('png');
  if (!(blob instanceof Blob))
    throw new PdfEngineError({
      kind: 'conversion-failed',
      format: 'png',
      direction: 'to-pdf',
      cause: 'styled renderer returned no PNG data',
      remedy: 'Simplify the QR design and retry.',
    });
  return new Uint8Array(await blob.arrayBuffer());
}
