/**
 * Reproduction: @puppeteer/browsers@1.9.1 `downloadFile()` has no timeout.
 *
 * Chain under test: `pnpm install --frozen-lockfile` runs puppeteer@21.11.0's
 * postinstall (`node install.mjs` -> `downloadBrowser()`), which calls
 * `@puppeteer/browsers`'s `install()` -> `downloadFile()`. Neither
 * `downloadFile()` nor `headHttpRequest()` (lib/esm/httpUtil.js) sets any
 * timeout: a connection that sends headers and then stalls — no bytes, no
 * close, no error — leaves the promise pending forever. In CI the postinstall
 * waits like this until GitHub Actions kills the job at its 6-hour default
 * timeout (the observed 361-minute cancelled jobs).
 *
 * This harness never touches storage.googleapis.com: a local HTTP server sends
 * response headers and then falls silent (the stall), and the REAL installed
 * `downloadFile()` is pointed at it.
 *
 * Usage: node repro-install-hang.mjs  -> prints a verdict within ~20 s
 */
import http from 'node:http';
import { downloadFile } from './node_modules/.pnpm/@puppeteer+browsers@1.9.1/node_modules/@puppeteer/browsers/lib/esm/httpUtil.js';

// Simulates a stalled CDN: sends response headers, then never sends the body
// and never closes the socket. The client is left waiting for 1 MB of bytes
// that never arrive.
const server = http.createServer((_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(1 << 20),
  });
  // Intentionally no res.end(): the stall is the condition under test.
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
console.log(`stalled CDN simulator listening on 127.0.0.1:${port}`);

const url = `http://127.0.0.1:${port}/chrome.zip`;
const destination = 'repro-download-target.bin';

console.log('calling downloadFile() against the stalled connection ...');
const pending = downloadFile(new URL(url), destination, () => {});

setTimeout(() => {
  console.log(
    'VERDICT: downloadFile() still pending after 20 s against a stalled connection ' +
      '— no timeout exists, the promise never settles. In CI the postinstall waits ' +
      'exactly like this until the 6-hour job timeout. Hang reproduced.'
  );
  server.close();
  process.exit(1);
}, 20_000);

try {
  await pending;
  console.log('downloadFile() settled (unexpected for this repro).');
  server.close();
  process.exit(0);
} catch (error) {
  console.log('downloadFile() rejected: ' + error.message);
  server.close();
  process.exit(0);
}
