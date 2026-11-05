import assert from 'node:assert/strict';
import test from 'node:test';
import { generateQr, buildStyledQrOptions, qrPayloadText } from '../dist/index.js';

test('basic qr still produces valid PDF', async () => {
  const result = await generateQr({ kind: 'text', value: 'test' });
  assert.ok(result.pdf.length > 0);
  assert.ok(result.svg.includes('<svg'));
});

test('styled options structure contains customization keys', () => {
  const opts = buildStyledQrOptions('hello', {
    cornerSquare: 'rounded',
    cornerDot: 'dot',
    dotsType: 'dots',
    foreground: '#ff00ff',
    background: '#fff',
    logoUrl: 'logo.png',
    logoSize: 30,
    frame: true,
  });
  assert.equal(opts.data, 'hello');
  assert.equal(opts.dotsOptions.type, 'dots');
  assert.equal(opts.cornersSquareOptions.type, 'rounded');
  assert.equal(opts.backgroundOptions.color, '#fff');
  assert.equal(opts.imageOptions.imageSize, 0.3);
});

test('qrPayloadText validates vcard and plain text', () => {
  assert.ok(qrPayloadText({ kind: 'text', value: 'x' }).includes('x'));
  assert.ok(
    qrPayloadText({ kind: 'vcard', name: 'A', phone: '1', email: 'a@b.c' }).includes('BEGIN:VCARD'),
  );
});
