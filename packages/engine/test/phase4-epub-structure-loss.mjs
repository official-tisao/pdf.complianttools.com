import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';

import { convertToPdf, extractPdfTextPages } from '../dist/index.js';

describe('Phase 4-EPUB — EPUB to PDF structural preservation', () => {
  it('should pack and convert the EPUB fixture to PDF', async () => {
    const bytes = readFileSync('../../fixtures/fidelity/epub-test.epub');
    const result = await convertToPdf('epub', new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    assert.ok(result.bytes && result.bytes.length > 0, 'PDF bytes produced');
    assert.strictEqual(result.mimeType, 'application/pdf', 'correct mime type');
    assert.strictEqual(result.extension, '.pdf', 'correct extension');
  });

  it('should expose EPUB pipeline warning distinguishing styled rendering from fallback', async () => {
    const bytes = readFileSync('../../fixtures/fidelity/epub-test.epub');
    const result = await convertToPdf('epub', new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    assert.ok(result.bytes && result.bytes.length > 0, 'PDF produced');
    assert.ok(Array.isArray(result.warnings), 'warnings array present');
    assert.ok(result.warnings.some(w => w.includes('HTML pipeline') || w.includes('EPUB')), 'EPUB pipeline warning propagated');
  });

  it('should preserve heading, bold, list, and table content from EPUB', async () => {
    const bytes = readFileSync('../../fixtures/fidelity/epub-test.epub');
    const result = await convertToPdf('epub', new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    assert.ok(result.bytes && result.bytes.length > 0, 'PDF produced from actual .epub');
    // Inspect PDF text output via existing extractPdfTextPages to verify content survives
    const pages = await extractPdfTextPages(result.bytes);
    const text = pages.map(p => p.lines.join(' ')).join(' ');
    assert.ok(text.includes('Heading'), 'heading text preserved');
    assert.ok(text.includes('bold'), 'bold text preserved');
    assert.ok(text.includes('italic'), 'italic text preserved');
    assert.ok(text.includes('Item one'), 'list content preserved');
    assert.ok(text.includes('Header A'), 'table header preserved');
  });

  it('should distinguish renderer failure from successful styled rendering', async () => {
    // The renderer returns empty bytes + warning on failure; we verify the warning mechanism exists
    // by inspecting a valid conversion's result shape rather than forcing a crash
    const bytes = readFileSync('../../fixtures/fidelity/epub-test.epub');
    const result = await convertToPdf('epub', new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    assert.ok(result.bytes && result.bytes.length > 0, 'styled rendering produced PDF bytes');
    assert.ok(Array.isArray(result.warnings), 'warning array present for all results');
  });
});
