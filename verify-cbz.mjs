/* global console, document */

import { chromium } from '@playwright/test';

const WEB_URL = 'http://localhost:4321';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`);
});
page.on('pageerror', (err) => errors.push(`PAGE ERROR: ${err.message}`));
page.on('requestfailed', (req) =>
  errors.push(`REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`),
);

console.log('1. Navigating to /pdf-to-cbz.html...');
await page.goto(`${WEB_URL}/pdf-to-cbz.html`, { waitUntil: 'networkidle' });

// Wait for hydration to flip the availability state
console.log('2. Waiting for renderer to initialize...');
try {
  await page.waitForFunction(
    () => {
      const unavailable = document.querySelector('.unavailable');
      const fileDrop = document.querySelector(
        '[class*="FileDrop"], [class*="file-drop"], [class*="drop"]',
      );
      return !unavailable || fileDrop;
    },
    { timeout: 30000 },
  );
} catch {
  console.log('   Timeout waiting for availability change');
}

const unavailableCount = await page.locator('.unavailable').count();
const fileDropCount = await page.locator('[class*="FileDrop"], [class*="file-drop"]').count();
console.log(`   unavailable divs: ${unavailableCount}, file drop components: ${fileDropCount}`);

if (unavailableCount > 0) {
  const text = await page.locator('.unavailable').textContent();
  console.log(`   UNAVAILABLE TEXT: ${text?.slice(0, 200)}`);
}

// Check if pdfium.wasm was fetched
const wasmRequests = [];
page.on('request', (req) => {
  if (req.url().includes('pdfium.wasm')) wasmRequests.push(req.url());
});

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
console.log(`3. pdfium.wasm requests: ${wasmRequests.length}`);

await browser.close();
console.log(`4. Errors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log(`   ${e}`));
