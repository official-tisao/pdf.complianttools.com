import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedUrl, isPermittedRequest, isPrivateIp } from '../dist/guard.js';

const guarded = { allowPrivate: false };

test('private and reserved IPv4 literals are recognised', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '0.0.0.0',
  ]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test('public IPv4 literals are not treated as private', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '192.169.1.1', '11.0.0.1']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('private IPv6 literals are recognised', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
});

test('public IPv6 literals are not treated as private', () => {
  for (const ip of ['2606:4700:4700::1111', '2a00:1450:4001::200e']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('allowedUrl refuses loopback, metadata, and local-scheme capture targets', async () => {
  const refused = [
    'http://127.0.0.1:8787/x',
    'http://localhost/x',
    'http://app.localhost/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/x',
    'file:///etc/passwd',
    'ftp://example.com/x',
    'not-a-url',
  ];
  for (const target of refused) {
    assert.equal(await allowedUrl(target, guarded), undefined, target);
  }
});

test('allowedUrl honours the explicit private-network opt-in', async () => {
  const permitted = await allowedUrl('http://127.0.0.1:8787/x', { allowPrivate: true });
  assert.equal(permitted?.hostname, '127.0.0.1');
});

test('allowedUrl refuses a host that does not resolve', async () => {
  // .invalid is reserved by RFC 2606 and never resolves, so this exercises the
  // resolution-failure branch with no network dependency.
  assert.equal(await allowedUrl('http://relay-guard-probe.invalid/', guarded), undefined);
});

test('allowedUrl still refuses a non-http scheme under the private-network opt-in', async () => {
  // The opt-in is for private *hosts*, not for schemes that bypass the guard.
  assert.equal(await allowedUrl('file:///etc/passwd', { allowPrivate: true }), undefined);
});

test('isPermittedRequest blocks file, ftp, and websocket subresources', async () => {
  for (const target of [
    'file:///C:/Windows/win.ini',
    'ftp://example.com/x',
    'ws://example.com/socket',
    'javascript:alert(1)',
  ]) {
    assert.equal(await isPermittedRequest(target, guarded), false, target);
  }
});

test('isPermittedRequest blocks a private target that reached the browser as a hostname', async () => {
  // The rebinding shape: a public-looking hostname whose DNS answer is private.
  // localhost is checked literally so this holds without live DNS.
  for (const target of [
    'http://127.0.0.1:8787/x',
    'http://localhost/x',
    'http://app.localhost/x',
    'http://169.254.169.254/latest/meta-data/',
  ]) {
    assert.equal(await isPermittedRequest(target, guarded), false, target);
  }
});

test('isPermittedRequest allows networkless schemes needed for correct rendering', async () => {
  // Chromium resolves these internally and never routes them, but permitting
  // them costs nothing and blocks would emit confusing console noise.
  for (const target of ['data:image/svg+xml,%3Csvg/%3E', 'about:blank']) {
    assert.equal(await isPermittedRequest(target, guarded), true, target);
  }
});

test('isPermittedRequest refuses a hostname that does not resolve', async () => {
  assert.equal(await isPermittedRequest('http://relay-guard-probe.invalid/x', guarded), false);
});

test('isPermittedRequest permits private targets only under the opt-in', async () => {
  assert.equal(await isPermittedRequest('http://127.0.0.1:8787/x', { allowPrivate: true }), true);
});
