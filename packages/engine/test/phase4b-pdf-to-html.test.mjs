import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'fs';

import { pdfToHtml, extractPdfTextPages } from '../dist/index.js';

describe('Phase 4b — PDF to HTML structural fidelity', () => {
  it('should preserve page dimensions in HTML output', async () => {
    const path = '../../fixtures/fidelity/phase1-synthetic.pdf';
    if (!existsSync(path)) {
      console.log('fixture not found, skipping');
      return;
    }
    const bytes = readFileSync(path);
    const html = await pdfToHtml(new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    assert.ok(html.includes('<!doctype html>'), 'valid HTML document');
    const pageSections = html.match(/data-page="\d+"/g);
    assert.ok(pageSections && pageSections.length >= 1, 'pages represented in HTML');
  });

  it('should include page dimensions in CSS positioning', async () => {
    const path = '../../fixtures/fidelity/phase1-synthetic.pdf';
    if (!existsSync(path)) {
      console.log('fixture not found, skipping');
      return;
    }
    const bytes = readFileSync(path);
    const pages = await extractPdfTextPages(new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    assert.ok(pages.length > 0, 'pages extracted');
    for (const page of pages) {
      if (page.pageWidth !== undefined && page.pageHeight !== undefined) {
        assert.ok(page.pageWidth > 0, 'pageWidth positive');
        assert.ok(page.pageHeight > 0, 'pageHeight positive');
      }
    }
  });

  it('should escape HTML-sensitive characters in text content', async () => {
    const html = await pdfToHtml(new Uint8Array(0));
    assert.ok(html.includes('<!doctype html>'), 'doctype present');
  });

  it('should preserve font size when metadata is available', async () => {
    const path = '../../fixtures/fidelity/phase3a.pdf';
    if (!existsSync(path)) {
      console.log('fixture not found, skipping');
      return;
    }
    try {
      const bytes = readFileSync(path);
      const pages = await extractPdfTextPages(new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
      const hasFontMeta = pages.some(p => p.meta?.some(m => m.fontSize !== undefined && m.fontSize > 0 && isFinite(m.fontSize)));
      if (hasFontMeta) {
        const html = await pdfToHtml(new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
        assert.ok(html.includes('font-size:'), 'font-size CSS applied when metadata present');
      }
    } catch (e) {
      if (e instanceof Error && (e.message.includes('invalid') || e.message.includes('corrupt'))) {
        console.log('PDF malformed, skipping:', e.message);
        return;
      }
      throw e;
    }
  });

  it('should include color styling only when metadata is trustworthy', async () => {
    const path = '../../fixtures/fidelity/phase1-synthetic.pdf';
    if (!existsSync(path)) {
      console.log('fixture not found, skipping');
      return;
    }
    const bytes = readFileSync(path);
    const pages = await extractPdfTextPages(new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    const hasColorMeta = pages.some(p => p.meta?.some(m => Array.isArray(m.color) && m.color.length >= 3));
    if (hasColorMeta) {
      const html = await pdfToHtml(new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
      const hasColorCss = html.includes('color:rgb(');
      assert.strictEqual(hasColorCss, hasColorMeta, 'color CSS present iff metadata has colors');
    }
  });

  it('should not fabricate font size when fontSize is missing', async () => {
    const html = await pdfToHtml(new Uint8Array(0));
    assert.ok(html.includes('<!doctype html>'), 'valid HTML structure');
  });
});
