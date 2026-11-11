#!/usr/bin/env node
/**
 * Copy PDFium WASM binary into the web public folder so the browser
 * worker can load it by URL at runtime. Per README §7.2 / PLAN P0-08.
 *
 * The pdfium package exposes pdfium.wasm at:
 *   node_modules/@embedpdf/pdfium/dist/pdfium.wasm
 * We copy it to apps/web/public/pdfium.wasm so the renderer init can
 * reference it as /pdfium.wasm without build-time bundling issues.
 */
import { cpSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const src = resolve(
  root,
  'node_modules/.pnpm/@embedpdf+pdfium@2.15.1/node_modules/@embedpdf/pdfium/dist/pdfium.wasm',
);
const destDir = resolve(root, 'apps/web/static');
const dest = resolve(destDir, 'pdfium.wasm');

mkdirSync(destDir, { recursive: true });
cpSync(src, dest, { force: true });
console.log('Copied pdfium.wasm -> apps/web/static/pdfium.wasm');
