import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import licenseChecker from 'license-checker-rseidelsohn';

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Zlib',
  '0BSD',
  'MPL-2.0',
  'Unlicense',
  'CC0-1.0',
  'CC0',
]);

export const FORBIDDEN_PACKAGES = [
  'mupdf.js',
  'mupdf-wasm',
  'ghostscript-wasm',
  'ghostscript',
  'libreoffice',
];

function splitLicenses(value) {
  return String(value)
    .replaceAll(/[()[\]]/gu, ' ')
    .split(/\s+(?:OR|AND|WITH|or|and|with)\s+|[,;|]/u)
    .map((license) => license.trim())
    .filter(Boolean);
}

export function validateLicenseEntries(entries) {
  const violations = [];
  for (const [packageName, entry] of Object.entries(entries)) {
    if (packageName.startsWith('pdf.complianttools.com@')) continue;
    if (FORBIDDEN_PACKAGES.some((name) => packageName.toLowerCase().includes(name))) {
      violations.push(`${packageName}: explicitly forbidden copyleft/server-side dependency`);
      continue;
    }
    const licenses = splitLicenses(entry.licenses ?? 'UNKNOWN');
    for (const license of licenses) {
      if (!ALLOWED_LICENSES.has(license)) {
        violations.push(`${packageName}: ${license} is not on the project allowlist`);
      }
    }
  }
  return violations;
}

export async function collectLicenses(root = process.cwd()) {
  const init = promisify(licenseChecker.init.bind(licenseChecker));
  return init({ start: root, production: false, json: true });
}

export function renderLicenseManifest(entries) {
  const output = Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, data]) =>
        `- ${name} — ${data.licenses ?? 'UNKNOWN'} — ${data.repository ?? 'registry metadata'}`,
    )
    .join('\n');
  return `# Third-party licenses\n\nGenerated from the locked dependency graph.\n\n${output}\n`;
}

async function main() {
  const fixtureIndex = process.argv.indexOf('--fixture');
  const fixturePath = fixtureIndex >= 0 ? process.argv[fixtureIndex + 1] : undefined;
  const entries = fixturePath
    ? JSON.parse(await readFile(resolve(fixturePath), 'utf8'))
    : await collectLicenses();
  const violations = validateLicenseEntries(entries);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
    return;
  }
  if (!fixturePath) {
    const manifestPath = resolve('docs/THIRD-PARTY-LICENSES.md');
    const generated = renderLicenseManifest(entries);
    const existing = await readFile(manifestPath, 'utf8').catch(() => undefined);
    if (existing !== undefined && existing !== generated && !process.argv.includes('--write')) {
      console.error(
        'docs/THIRD-PARTY-LICENSES.md is stale; run node scripts/verify-licenses.mjs --write to update it.',
      );
      process.exitCode = 1;
      return;
    }
    if (existing === undefined || process.argv.includes('--write'))
      await writeFile(manifestPath, generated);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
