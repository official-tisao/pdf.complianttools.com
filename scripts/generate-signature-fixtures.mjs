import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname.replace(/^\//u, '').replaceAll('/', '\\');
const output = join(root, 'fixtures', 'pdfs');
const temp = mkdtempSync(join(tmpdir(), 'pdf-complianttools-signature-'));

function run(args) {
  execFileSync('openssl', args, { stdio: 'ignore' });
}

try {
  const key = join(temp, 'fixture.key');
  const cert = join(temp, 'fixture.crt');
  const signedData = join(temp, 'signed-data.bin');
  const cms = join(temp, 'signature.der');
  const publicCertificate = join(output, 'signed-one-page.trust.der');

  run([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-subj',
    '/CN=pdf-complianttools-public-fixture',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '3650',
    '-sha256',
  ]);
  writeFileSync(
    publicCertificate,
    readFileSync(cert)
      .toString()
      .replaceAll(/-----[^\n]+-----|\s+/gu, '')
      ? Buffer.from(
          readFileSync(cert)
            .toString()
            .replaceAll(/-----[^\n]+-----|\s+/gu, ''),
          'base64',
        )
      : readFileSync(cert),
  );

  const placeholder = '0'.repeat(16384);
  const template =
    `%PDF-1.4\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R] >> >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n` +
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Annots [5 0 R] >>\nendobj\n` +
    `4 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 72 720 Td (Phase C signed fixture) Tj ET\nendstream\nendobj\n` +
    `5 0 obj\n<< /Type /Annot /Subtype /Widget /FT /Sig /T (Signature1) /V 6 0 R /Rect [0 0 0 0] >>\nendobj\n` +
    `6 0 obj\n<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /ByteRange [0000000000 0000000000 0000000000 0000000000] /Contents <${placeholder}> >>\nendobj\n` +
    `trailer\n<< /Root 1 0 R >>\n%%EOF\n`;
  const templateBytes = Buffer.from(template, 'latin1');
  const contentsMarker = Buffer.from(`/Contents <${placeholder}>`, 'latin1');
  const contentsMarkerOffset = templateBytes.indexOf(contentsMarker);
  const contentsStart = contentsMarkerOffset + Buffer.byteLength('/Contents <', 'latin1');
  const contentsEnd = contentsStart + placeholder.length;
  const rangeText = `[${String(0).padStart(10, '0')} ${String(contentsStart).padStart(10, '0')} ${String(contentsEnd).padStart(10, '0')} ${String(templateBytes.length - contentsEnd).padStart(10, '0')}]`;
  const rangeMarker = '[0000000000 0000000000 0000000000 0000000000]';
  const signedTemplate = Buffer.from(template.replace(rangeMarker, rangeText), 'latin1');
  const firstRangeEnd = contentsStart;
  const secondRangeStart = contentsEnd;
  writeFileSync(
    signedData,
    Buffer.concat([
      signedTemplate.subarray(0, firstRangeEnd),
      signedTemplate.subarray(secondRangeStart),
    ]),
  );
  run([
    'cms',
    '-sign',
    '-binary',
    '-in',
    signedData,
    '-signer',
    cert,
    '-inkey',
    key,
    '-outform',
    'DER',
    '-out',
    cms,
    '-nosmimecap',
  ]);

  const cmsBytes = readFileSync(cms);
  if (cmsBytes.length * 2 > placeholder.length) throw new Error('CMS fixture exceeds placeholder');
  const cmsHex = cmsBytes.toString('hex').padEnd(placeholder.length, '0');
  const signedPdf = Buffer.from(
    signedTemplate.toString('latin1').replace(placeholder, cmsHex),
    'latin1',
  );
  writeFileSync(join(output, 'signed-one-page.pdf'), signedPdf);

  const tampered = Buffer.from(signedPdf);
  const originalText = Buffer.from('Phase C signed fixture', 'latin1');
  const tamperedText = Buffer.from('Phase C tampered fixture', 'latin1');
  const textOffset = tampered.indexOf(originalText);
  if (textOffset < 0) throw new Error('Signed fixture text not found');
  tampered.set(tamperedText, textOffset);
  writeFileSync(join(output, 'signed-one-page-tampered.pdf'), tampered);

  const unsupported = Buffer.from(signedPdf);
  const cmsHexOffset = unsupported.indexOf(Buffer.from(cmsBytes.toString('hex'), 'latin1'));
  if (cmsHexOffset < 0) throw new Error('CMS fixture hex not found');
  unsupported.fill(0, cmsHexOffset, cmsHexOffset + cmsBytes.length * 2);
  unsupported[cmsHexOffset] = 0x30;
  unsupported[cmsHexOffset + 1] = 0x01;
  unsupported[cmsHexOffset + 2] = 0x00;
  writeFileSync(join(output, 'signed-one-page-unsupported.pdf'), unsupported);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
