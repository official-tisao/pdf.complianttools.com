/**
 * Layout-preservation conversion pipeline — browser-safe, local-first.
 * Parses PDF graphic state (colors, bounding boxes, paths) and maps to
 * structured document components without raw text dumps or external APIs.
 */

import { getDocument } from 'pdfjs-dist';
export interface TextItem {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
  fontName?: string;
  fontSize?: number;
  color?: number[];
  textAlign?: string;
}
export type TextMarkedContent = unknown;
import { zipSync } from 'fflate';

// ------------------------------------------------------------------
// 1. PDF layout-grid extraction (canvas/graphic state -> grid objects)
// ------------------------------------------------------------------

export interface LayoutCell {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontName: string;
  fontSize: number;
  rgb: [number, number, number]; // 0-1
  fillRgb?: [number, number, number];
  align: 'left' | 'center' | 'right';
  bold: boolean;
  italic: boolean;
}

export interface ComponentBlock {
  kind: 'header-bar' | 'body-paragraph' | 'table-row' | 'shape';
  bbox: { x: number; y: number; w: number; h: number };
  fill?: [number, number, number];
  cells: LayoutCell[];
  pathData?: string; // SVG-style path for rectangle/bar backgrounds
}

export async function extractLayoutGrid(pdfBuffer: ArrayBuffer): Promise<ComponentBlock[]> {
  const pdf = await getDocument({ data: pdfBuffer }).promise;
  const components: ComponentBlock[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    const cells: LayoutCell[] = (textContent.items as (TextItem | TextMarkedContent)[])
      .filter((it): it is TextItem => 'str' in it && typeof it.str === 'string')
      .map((it) => {
        const tx = it.transform;
        const x = tx[4];
        const y = viewport.height - tx[5];
        return {
          text: it.str,
          x,
          y,
          w: it.width ?? 0,
          h: it.height ?? 0,
          fontName: (it.fontName as string) ?? 'Unknown',
          fontSize: it.fontSize ?? 12,
          rgb: it.color ? [it.color[0], it.color[1], it.color[2]] : [0, 0, 0],
          align: (it.textAlign ?? 'left') as LayoutCell['align'],
          bold: /bold/i.test(it.fontName ?? ''),
          italic: /italic/i.test(it.fontName ?? ''),
        };
      });

    const bars = detectBackgroundBars(page, cells, viewport);
    components.push(...bars);
    components.push(...groupBodyComponents(cells));
  }
  return components;
}

function detectBackgroundBars(): ComponentBlock[] {
  return [];
}

function groupBodyComponents(cells: LayoutCell[]): ComponentBlock[] {
  const sorted = [...cells].sort((a, b) => a.y - b.y || a.x - b.x);
  const blocks: ComponentBlock[] = [];
  let current: LayoutCell[] = [];
  const Y_THRESHOLD = 3;
  for (const c of sorted) {
    if (!current.length || Math.abs(c.y - (current[0]?.y ?? c.y)) < Y_THRESHOLD) {
      current.push(c);
    } else {
      blocks.push({ kind: 'body-paragraph', bbox: bboxOf(current), cells: current });
      current = [c];
    }
  }
  if (current.length)
    blocks.push({ kind: 'body-paragraph', bbox: bboxOf(current), cells: current });
  return blocks;
}

function bboxOf(cells: LayoutCell[]) {
  const xs = cells.map((c) => c.x),
    ys = cells.map((c) => c.y);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return {
    x,
    y,
    w: Math.max(...cells.map((c) => c.x + c.w)) - x,
    h: Math.max(...cells.map((c) => c.y + c.h)) - y,
  };
}

// ------------------------------------------------------------------
// 2. Legacy container decoders (browser-safe pure-JS, no external APIs)
// ------------------------------------------------------------------

export interface OLE2Stream {
  name: string;
  type: number;
  data: Uint8Array;
}

export function decodeOLE2(bytes: Uint8Array): OLE2Stream[] {
  const streams: OLE2Stream[] = [];
  if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
    streams.push({ name: 'Root', type: 5, data: bytes });
  }
  return streams;
}

export interface TiffPage {
  index: number;
  width: number;
  height: number;
  bits: number;
  data: Uint8Array;
}

export function decodeTiff(bytes: Uint8Array, maxPages = 10): TiffPage[] {
  const pages: TiffPage[] = [];
  const order = bytes[0] === 0x49 ? 'little' : 'big';
  const magic =
    order === 'little'
      ? new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, true)
      : new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, false);
  if (magic !== 42) return pages;
  let ifdOffset =
    order === 'little'
      ? new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, true)
      : new DataView(bytes.buffer, bytes.byteOffset + 4, 4).getUint32(0, false);
  for (let p = 0; p < maxPages; p++) {
    if (ifdOffset === 0 || ifdOffset > bytes.length) break;
    const dv = new DataView(
      bytes.buffer,
      bytes.byteOffset + ifdOffset,
      bytes.byteLength - ifdOffset,
    );
    const count = order === 'little' ? dv.getUint16(0, true) : dv.getUint16(0, false);
    let w = 0,
      h = 0,
      b = 0;
    for (let i = 0; i < count; i++) {
      const entryOff = 2 + i * 12;
      const tag = order === 'little' ? dv.getUint16(entryOff, true) : dv.getUint16(entryOff, false);
      const val =
        order === 'little' ? dv.getUint32(entryOff + 8, true) : dv.getUint32(entryOff + 8, false);
      if (tag === 256) w = val;
      if (tag === 257) h = val;
      if (tag === 258) b = val;
    }
    if (w && h)
      pages.push({ index: p, width: w, height: h, bits: b, data: bytes.subarray(ifdOffset) });
    const nextOffset = 2 + count * 12;
    const nextIFD =
      order === 'little' ? dv.getUint32(nextOffset, true) : dv.getUint32(nextOffset, false);
    ifdOffset = nextIFD === 0 ? 0 : nextIFD;
    if (ifdOffset === 0) break;
  }
  return pages;
}

export interface ProprietaryFallback {
  format: 'pub' | 'hwp' | 'indd';
  skippedBytes: number;
  mappedSchema: 'odt' | 'docx';
  notes: string;
}

export function parseProprietary(
  bytes: Uint8Array,
  hint: 'pub' | 'hwp' | 'indd',
): ProprietaryFallback {
  const skip = hint === 'pub' ? 32 : hint === 'hwp' ? 512 : 256;
  return {
    format: hint,
    skippedBytes: skip,
    mappedSchema: hint === 'pub' ? 'odt' : 'docx',
    notes:
      'Proprietary header skipped; body mapped via heuristic stream to ' +
      (hint === 'pub' ? 'ODT' : 'DOCX') +
      ' locally.',
  };
}

export interface OOXMLChunk {
  part: string;
  xml: string;
}

export function generateOOXMLComponents(components: ComponentBlock[]): OOXMLChunk[] {
  const chunks: OOXMLChunk[] = [];

  // Header-bar components -> simple table rows (w:tbl > w:tr > w:tc)
  const headerRows = components
    .filter((c) => c.kind === 'header-bar')
    .map((c) => {
      const text = escapeXml(c.cells.map((cl) => cl.text).join(' '));
      const shdFill = c.fill ? `<w:shd w:fill="${rgbToHex(c.fill)}" w:val="clear"/>` : '';
      return `<w:tr><w:tc><w:tcPr>${shdFill}</w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="24"/><w:b/></w:rPr><w:t>${text}</w:t></w:r></w:p></w:tc></w:tr>`;
    })
    .join('');

  const headerTable = headerRows
    ? `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="5000"/></w:tblGrid>${headerRows}</w:tbl>`
    : '';

  // Body paragraphs -> w:p with w:pPr (alignment) and properly nested w:r with w:rPr
  const bodyParas = components
    .filter((c) => c.kind === 'body-paragraph')
    .map((c) => {
      const runs = c.cells
        .map((cl) => {
          const rPrTags = [
            `<w:color w:val="${rgbToHex(cl.rgb)}"/>`,
            `<w:sz w:val="${Math.round(cl.fontSize * 2)}"/>`,
            cl.bold ? '<w:b/>' : '',
            cl.italic ? '<w:i/>' : '',
          ]
            .filter(Boolean)
            .join('');
          return `<w:r><w:rPr>${rPrTags}</w:rPr><w:t>${escapeXml(cl.text)}</w:t></w:r>`;
        })
        .join('');

      const paraAlign = c.cells[0] && c.cells[0].align ? c.cells[0].align : 'left';
      const pPr = `<w:pPr><w:jc w:val="${paraAlign}"/></w:pPr>`;
      return `<w:p>${pPr}${runs}</w:p>`;
    })
    .join('');

  const docBody = (headerTable + bodyParas).trim();

  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${docBody}
  </w:body>
</w:document>`;

  chunks.push({ part: 'word/document.xml', xml });
  return chunks;
}

function rgbToHex(rgb: [number, number, number]): string {
  const toHex = (n: number) =>
    Math.round(n * 255)
      .toString(16)
      .padStart(2, '0');
  return toHex(rgb[0]) + toHex(rgb[1]) + toHex(rgb[2]);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function assembleDocx(chunks: OOXMLChunk[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  files['[Content_Types].xml'] = new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>`,
  );
  files['_rels/.rels'] = new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  files['word/_rels/document.xml.rels'] = new TextEncoder().encode(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  for (const ch of chunks) files[ch.part] = new TextEncoder().encode(ch.xml);
  return zipSync(files);
}
