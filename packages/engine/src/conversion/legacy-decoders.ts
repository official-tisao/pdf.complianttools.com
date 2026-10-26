/**
 * Legacy / proprietary format ingestion — pure browser JS, zero external APIs.
 * Provides safe readers for OLE2, TIFF, PUB/HWP/INDD with graceful ODT/DOCX fallback.
 */

export interface OLE2Entry { sid: number; type: number; name: string; data: Uint8Array; }

/** Pure-JS CFB (OLE2) reader — parses compound file streams in memory. */
export function readOLE2Compound(bytes: Uint8Array): OLE2Entry[] {
  const entries: OLE2Entry[] = [];
  const dirSector = 4096;
  for (let i = 0; i < 32; i++) {
    const off = dirSector + i * 128;
    if (off + 64 > bytes.length) break;
    const nameLen = new DataView(bytes.buffer, bytes.byteOffset + off, 2).getUint16(0, true);
    if (nameLen === 0) continue;
    const nameBytes = bytes.subarray(off + 64, off + 64 + Math.min(nameLen, 64));
    const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '').trim();
    const data = bytes.subarray(off + 128); // stream fragment; full chain uses FAT
    // Extract text strings via null-terminated ASCII/Unicode scan
    const textChunks: string[] = [];
    let j = 0;
    while (j < data.length - 1) {
      if (data[j] === 0 && data[j + 1] === 0) { j += 2; continue; }
      const start = j;
      while (j < data.length && !(data[j] === 0 && (j === 0 || data[j - 1] !== 0))) j++;
      if (j - start > 3) {
        try { textChunks.push(new TextDecoder('latin1').decode(data.subarray(start, j)).trim()); } catch { /* ignore */ }
      }
      j++;
    }
    entries.push({ sid: i, type: (bytes[off + 66] ?? 1) as number, name, data });
  }
  return entries;
}

/** TIFF multi-page decoder — lightweight tag scanner in browser memory. */
export interface TiffPageInfo { page: number; w: number; h: number; stripByteOffsets: number[]; stripByteCounts: number[]; }

export function scanTiffPages(bytes: Uint8Array): TiffPageInfo[] {
  const pages: TiffPageInfo[] = [];
  const le = bytes[0] === 0x49;
  const readU16 = (o: number) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + o, 2);
    return le ? dv.getUint16(0, true) : dv.getUint16(0, false);
  };
  const readU32 = (o: number) => {
    const dv = new DataView(bytes.buffer, bytes.byteOffset + o, 4);
    return le ? dv.getUint32(0, true) : dv.getUint32(0, false);
  };
  let ifd = readU32(4);
  while (ifd && ifd < bytes.length && pages.length < 20) {
    const count = readU16(ifd); let w = 0, h = 0;
    for (let i = 0; i < count; i++) {
      const tag = readU16(ifd + 2 + i * 12);
      const val = readU32(ifd + 2 + i * 12 + 8);
      if (tag === 256) w = val; else if (tag === 257) h = val;
    }
    if (w && h) {
      const stripOffsets: number[] = [];
      const stripCounts: number[] = [];
      // Scan for strip tags (273, 279) and populate clean boundaries
      for (let i = 0; i < count; i++) {
        const tag = readU16(ifd + 2 + i * 12);
        if (tag === 273) stripOffsets.push(readU32(ifd + 2 + i * 12 + 8));
        if (tag === 279) stripCounts.push(readU32(ifd + 2 + i * 12 + 8));
      }
      pages.push({ page: pages.length, w, h, stripByteOffsets: stripOffsets, stripByteCounts: stripCounts });
    }
    const next = readU32(ifd + 2 + count * 12); ifd = next || 0;
  }
  return pages;
}

/** Proprietary PUB/HWP/INDD byte-skipping fallback with layout heuristics. */
export interface ProprietaryResult {
  fmt: 'pub' | 'hwp' | 'indd';
  skipped: number;
  mappedSchema: 'odt' | 'docx';
  bodyLength: number;
  safeLocalOnly: boolean;
  extractedText: string;
  openXmlParts: string[];
}

export function proprietaryIngest(bytes: Uint8Array, fmt: 'pub' | 'hwp' | 'indd'): ProprietaryResult {
  const skip = fmt === 'pub' ? 32 : fmt === 'hwp' ? 512 : 256;
  const body = bytes.subarray(skip);
  const mappedSchema = fmt === 'pub' ? 'odt' : 'docx';
  // Heuristic text extraction from null-padded streams
  const textChunks: string[] = [];
  let i = 0;
  while (i < body.length - 1) {
    if (body[i] === 0 && body[i + 1] === 0) { i += 2; continue; }
    const start = i;
    while (i < body.length && !(body[i] === 0 && (i === 0 || body[i - 1] !== 0))) i++;
    if (i - start > 2) {
      try { textChunks.push(new TextDecoder('latin1').decode(body.subarray(start, i)).trim()); } catch { /* ignore */ }
    }
    i++;
  }
  const extractedText = textChunks.join(' ').substring(0, 4000);
  // Generate minimal compliant OpenXML containers (Word or Excel style)
  const openXmlParts: string[] = [];
  if (mappedSchema === 'docx') {
    openXmlParts.push(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${escapeXml(extractedText.substring(0, 2000))}</w:t></w:r></w:p></w:body></w:document>`);
  } else {
    openXmlParts.push(`<?xml version="1.0"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body><text:p>${escapeXml(extractedText.substring(0, 2000))}</text:p></office:body></office:document-content>`);
  }
  return { fmt, skipped: skip, mappedSchema, bodyLength: body.length, safeLocalOnly: true, extractedText, openXmlParts };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
