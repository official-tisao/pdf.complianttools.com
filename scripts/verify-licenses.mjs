import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  // Reviewed additions found in the shipped graph; see REVIEWED_LICENSES.
  'BlueOak-1.0.0',
  'BSD',
  'MIT/X11',
]);

export const FORBIDDEN_PACKAGES = [
  'mupdf.js',
  'mupdf-wasm',
  'ghostscript-wasm',
  'ghostscript',
  'libreoffice',
];

/**
 * Permissive licences found in the shipped graph that are not on the base
 * allowlist. Each was reviewed rather than pattern-matched:
 *
 *   - `0BSD`, `Unlicense`, `BlueOak-1.0.0` are permissive OSI licences.
 *   - `BSD` (duck) is the ambiguous short form; upstream Duck is BSD-2-Clause,
 *     which is already allowlisted, so it is accepted under that reading.
 *   - `MIT/X11` (chainsaw, traverse) is MIT, already allowlisted.
 *   - `(MPL-2.0 OR Apache-2.0)` (dompurify) resolves to Apache-2.0, allowlisted.
 *   - `(MIT AND Zlib)` (pako) requires both branches; both are allowlisted.
 *
 * `(MIT OR GPL-3.0-or-later)` (jszip) resolves to the MIT branch, which is why
 * an `OR` expression must not be rejected merely for mentioning GPL.
 */
export const REVIEWED_LICENSES = new Map([
  ['0BSD', '0BSD is an OSI-permissive licence.'],
  ['Unlicense', 'Unlicense is a public-domain dedication.'],
  ['BlueOak-1.0.0', 'BlueOak-1.0.0 is a permissive licence with a patent grant.'],
  ['BSD', 'The short "BSD" form; treated as BSD-2-Clause, which is allowlisted.'],
  ['MIT/X11', 'MIT/X11 is the MIT licence with the X11 disclaimer.'],
]);

/** Resolves one SPDX expression to the set of licences actually required. */
export function resolveExpression(expression) {
  const text = String(expression ?? '').trim();
  if (text === '' || /^unknown$/iu.test(text)) return { unknown: true, required: [] };

  // An `OR` is satisfied by any single branch, so resolution picks the first
  // allowlisted branch rather than requiring them all. `AND` requires every
  // branch.
  const orParts = text.split(/\s+OR\s+|\s+or\s+/u).map((part) => part.trim());
  if (orParts.length > 1) {
    const branches = orParts.map((part) => resolveExpression(part));
    if (branches.some((branch) => branch.unknown)) return { unknown: true, required: [] };
    const usable = branches.filter((branch) =>
      branch.required.every((license) => ALLOWED_LICENSES.has(license)),
    );
    return usable.length > 0 ? { unknown: false, required: usable[0].required } : branches[0];
  }

  const andParts = text.split(/\s+AND\s+|\s+and\s+|\s+WITH\s+|\s+with\s+/u);
  const required = [];
  for (const part of andParts) {
    // Strip the grouping parentheses an `AND` inside `OR` leaves behind.
    // Grouping parentheses are stripped rather than split on, so
    // `(MIT OR GPL-3.0-or-later)` reduces to its two branches.
    const license = part.replaceAll(/[()]/gu, '').trim();
    // `MIT/X11` is a deprecated SPDX identifier for MIT with the X11
    // disclaimer. It is matched whole rather than split on `/`, because
    // splitting would demand a licence literally named `X11` — not a real
    // SPDX id — and so would reject a package that ships plainly as MIT.
    if (license !== '') required.push(license);
  }
  return required.length === 0 ? { unknown: true, required: [] } : { unknown: false, required };
}

/** True when an SPDX expression can be satisfied entirely by allowlisted terms. */
export function isAllowlisted(expression) {
  const { unknown, required } = resolveExpression(expression);
  if (unknown) return false;
  return required.every((license) => ALLOWED_LICENSES.has(license));
}

export function validateLicenseEntries(entries) {
  const violations = [];
  for (const [packageName, entry] of Object.entries(entries)) {
    if (entry?.workspace) continue;
    if (packageName.startsWith('pdf.complianttools.com@')) continue;
    if (FORBIDDEN_PACKAGES.some((name) => packageName.toLowerCase().includes(name))) {
      violations.push(`${packageName}: explicitly forbidden copyleft/server-side dependency`);
      continue;
    }
    const expression = entry.licenses ?? 'UNKNOWN';
    if (!isAllowlisted(expression)) {
      const { unknown, required } = resolveExpression(expression);
      violations.push(
        unknown
          ? `${packageName}: ${expression} is not on the project allowlist`
          : `${packageName}: ${expression} resolves to ${required.join(' AND ')}, which is not all allowlisted`,
      );
    }
  }
  return violations;
}

export async function collectLicenses(root = process.cwd()) {
  const init = promisify(licenseChecker.init.bind(licenseChecker));
  return init({ start: root, production: false, json: true });
}

/**
 * The production dependency names declared by each workspace importer, read
 * from the lockfile's `importers:` block.
 *
 * Only `dependencies` and `optionalDependencies` are read — `devDependencies`
 * never ship, so including them is what made the old gate check 40 dev-only
 * packages and zero runtime ones.
 *
 * @param {string} lockfile pnpm-lock.yaml contents
 * @returns {ReadonlySet<string>} bare package names, e.g. `pdfjs-dist`
 */
export function parseProductionDependencies(lockfile) {
  const names = new Set();
  const importersStart = lockfile.indexOf('\nimporters:');
  const packagesStart = lockfile.indexOf('\npackages:');
  if (importersStart === -1 || packagesStart === -1) return names;
  const block = lockfile.slice(importersStart, packagesStart);

  // Walk the block tracking which section each entry is in, so that a
  // `devDependencies:` section is skipped and only production entries are
  // collected. In the lockfile an importer key sits at 2 spaces, its
  // `dependencies:`/`devDependencies:` header at 4, and each package name at 6.
  // Lines are stripped of a trailing CR first, because git checks the lockfile
  // out with CRLF on Windows and a `$` anchor would never match.
  let section = null;
  for (const raw of block.split(/\r?\n/u)) {
    const line = raw.replace(/\r$/u, '');
    const header = /^ {4}([A-Za-z]+):\s*$/u.exec(line);
    if (header) {
      section = header[1];
      continue;
    }
    if (section !== 'dependencies' && section !== 'optionalDependencies') continue;
    // `      'name':` or `      name:` — the key is the package name.
    const key = /^ {6}['"]?([^'":]+)['"]?:\s*$/u.exec(line);
    if (key) names.add(key[1].trim());
  }
  return names;
}

/** The importer directories declared in the lockfile, e.g. `apps/web`. */
export function parseImporterDirectories(lockfile) {
  const start = lockfile.indexOf('\nimporters:');
  const end = lockfile.indexOf('\npackages:');
  if (start === -1 || end === -1) return [];
  const lines = lockfile
    .slice(start, end)
    .split(/\r?\n/u)
    .map((line) => line.replace(/\r$/u, ''));
  const directories = [];
  for (let index = 0; index < lines.length; index += 1) {
    const key = /^ {2}['"]?([^'":]+)['"]?:\s*$/u.exec(lines[index]);
    if (!key) continue;
    // An importer block is a 2-space path key whose next non-blank line is
    // indented 4 spaces. A 6-space package key inside a dependency list would
    // otherwise be mistaken for an importer, which is what made an earlier
    // version of this collect `pdfjs-dist` as if it were a directory.
    const next = lines.slice(index + 1).find((line) => line.trim() !== '');
    if (!next || !/^ {4}\S/u.test(next)) continue;
    directories.push(key[1].trim());
  }
  return directories;
}

/**
 * Locates an installed package's real directory.
 *
 * pnpm's isolated layout links only a package's *direct* dependencies into an
 * importer's `node_modules`. Everything transitive lives in the content store
 * as `node_modules/.pnpm/<name>@<version>/node_modules/<name>`, which is where
 * `cookie` and `pako` — both shipped — actually live. So the importers are
 * searched first, then the store, which is keyed by name@version and can hold
 * several versions of the same package.
 */
export async function locatePackage(packageName, importerDirs, root, aliases = new Map()) {
  // pnpm/npm aliases (`string-width-cjs: string-width@4.2.3`) are stored under
  // the real package name, so an alias must be followed to its target before
  // the filesystem is searched — otherwise the alias reads as Unknown even
  // though the package it points at ships with a licence.
  const target = aliases.get(packageName);
  const realName = target ? target.slice(0, Math.max(target.lastIndexOf('@'), 1)) : packageName;

  for (const importer of importerDirs) {
    const linked = resolve(root, importer, 'node_modules', realName);
    if (existsSync(join(linked, 'package.json'))) {
      return (await realpath(linked).catch(() => linked)) || linked;
    }
  }
  const store = resolve(root, 'node_modules/.pnpm');
  if (!existsSync(store)) return undefined;
  const prefix = `${realName.replace('/', '+')}@`;
  for (const entry of await readdir(store, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith(prefix)) continue;
    const candidate = join(store, entry.name, 'node_modules', realName);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  return undefined;
}

/**
 * Package aliases declared in a package's own dependencies, written as
 * `npm:<real-name>@<range>` (e.g. `string-width-cjs: npm:string-width@^4.2.0`).
 * These are not separate packages and do not exist on disk under the alias
 * name — only the target does, so an alias that is not followed reads as
 * Unknown even though the package it points at ships with a licence.
 */
export function collectAliases(manifest) {
  const aliases = new Map();
  for (const [name, range] of Object.entries(manifest?.dependencies ?? {})) {
    if (typeof range !== 'string' || !range.startsWith('npm:')) continue;
    aliases.set(name, range.slice('npm:'.length));
  }
  return aliases;
}

/**
 * Reads the `license`/`licenses` field from an installed package, resolved
 * through pnpm's store for transitive dependencies.
 */
export async function readPackageLicense(packageName, importerDirs, root, aliases = new Map()) {
  const directory = await locatePackage(packageName, importerDirs, root, aliases);
  if (!directory) return undefined;
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  if (typeof manifest.license === 'string') return manifest.license;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((entry) => entry.type ?? entry).join(' OR ');
  }
  if (manifest.license && typeof manifest.license === 'object') return manifest.license.type;
  return undefined;
}

/**
 * The set of packages that ships to a browser, with their licences.
 *
 * This exists because `collectLicenses` walks the *root* `node_modules`, which
 * under pnpm's isolated layout contains only root devDependencies — every
 * runtime dependency was unchecked, including `@embedpdf/pdfium`, the one
 * package Appendix D flags as needing explicit clearance.
 *
 * The lockfile cannot be the source: pnpm entries carry only
 * `resolution.integrity`, no licence metadata. It determines *what* is
 * installed; `node_modules` supplies the licence strings. CI runs
 * `pnpm install --frozen-lockfile` first, so the installed tree is a pure
 * function of the frozen lockfile.
 *
 * The declared production dependencies are collected from the lockfile's
 * importers, then walked transitively through each package's own
 * `dependencies`, because a shipped package's own dependencies ship too.
 */
export async function collectShippedLicenses(root = process.cwd()) {
  const lockfile = await readFile(resolve(root, 'pnpm-lock.yaml'), 'utf8');
  const declared = parseProductionDependencies(lockfile);
  if (declared.size === 0) {
    throw new Error('no production dependencies were found in pnpm-lock.yaml');
  }

  // Every workspace importer, searched in declaration order. The root is last
  // so an importer-local copy always wins over a root devDependency of the
  // same name — they are different resolutions of the same package.
  const importerDirs = parseImporterDirectories(lockfile);
  importerDirs.push('.');

  const entries = {};
  const queue = [...declared].map((name) => ({ name, aliases: new Map() }));
  const seen = new Set();
  while (queue.length > 0) {
    const { name, aliases } = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    // Workspace packages are this repository's own source, published under the
    // root's private licence. They are covered by the workspace, not by a
    // third-party licence, so they are recorded but not licence-checked —
    // matching how the existing gate skips `pdf.complianttools.com@`.
    if (name.startsWith('pdf.complianttools.com') || name.startsWith('@pdf-complianttools/')) {
      entries[name] = { licenses: 'UNLICENSED (workspace package)', workspace: true };
      continue;
    }
    entries[name] = {
      licenses: (await readPackageLicense(name, importerDirs, root, aliases)) ?? 'Unknown',
    };

    // Walk this package's own production dependencies — they ship too.
    const directory = await locatePackage(name, importerDirs, root, aliases);
    if (!directory) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const childAliases = collectAliases(manifest);
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (seen.has(dependency)) continue;
      queue.push({ name: dependency, aliases: childAliases });
    }
  }
  return entries;
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

/**
 * The shipped-only manifest: the production dependency graph that reaches a
 * user's browser, kept separate from the full graph so a reader can audit the
 * thing that actually matters without wading through 200 devDependencies.
 */
export function renderShippedManifest(entries) {
  const output = Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, data]) => `- ${name} — ${data.licenses ?? 'UNKNOWN'}`)
    .join('\n');
  return (
    '# Shipped third-party licenses\n\n' +
    'Production dependencies of every workspace importer — the graph that reaches a\n' +
    "user's browser. Generated from `pnpm licenses list --prod`, which reads the\n" +
    'installed tree; CI runs `pnpm install --frozen-lockfile` first, so this is a\n' +
    'function of the frozen lockfile. The lockfile itself carries no licence\n' +
    'metadata, so it cannot be the source.\n\n' +
    `${output}\n`
  );
}

async function main() {
  const fixtureIndex = process.argv.indexOf('--fixture');
  const fixturePath = fixtureIndex !== -1 ? process.argv[fixtureIndex + 1] : undefined;
  const write = process.argv.includes('--write');
  // Git checks text files out with CRLF on Windows (core.autocrlf) while the
  // generators emit LF, so comparing raw strings reported a correctly
  // committed manifest as stale. Compare on content, not line endings.
  const normalize = (value) => value.replace(/\r\n/gu, '\n');

  const entries = fixturePath
    ? JSON.parse(await readFile(resolve(fixturePath), 'utf8'))
    : await collectLicenses();

  const violations = validateLicenseEntries(entries);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
    return;
  }

  // The shipped set is checked separately and strictly: it is the graph that
  // reaches a user's browser, and an unlabelled package in it is a licence
  // question the project has not answered yet. P0-04's rule is "deny on
  // unknown/missing", so `buffers@0.1.1` — which declares no licence field and
  // ships no LICENSE file — fails until a decision is recorded.
  if (!fixturePath) {
    let shipped;
    try {
      shipped = await collectShippedLicenses();
    } catch (error) {
      console.error(
        `could not resolve the shipped dependency set: ${error instanceof Error ? error.message : error}`,
      );
      process.exitCode = 1;
      return;
    }
    const shippedViolations = validateLicenseEntries(shipped);
    if (shippedViolations.length > 0) {
      console.error(
        'shipped (production) dependency licence violations:\n' + shippedViolations.join('\n'),
      );
      process.exitCode = 1;
      return;
    }
    console.log(`shipped dependency set: ${Object.keys(shipped).length} packages, all allowlisted`);

    const shippedPath = resolve('docs/THIRD-PARTY-LICENSES-SHIPPED.md');
    const shippedMarkdown = renderShippedManifest(shipped);
    const existingShipped = await readFile(shippedPath, 'utf8').catch(() => undefined);
    if (
      existingShipped !== undefined &&
      normalize(existingShipped) !== normalize(shippedMarkdown)
    ) {
      if (!write) {
        console.error(
          'docs/THIRD-PARTY-LICENSES-SHIPPED.md is stale; run node scripts/verify-licenses.mjs --write to update it.',
        );
        process.exitCode = 1;
        return;
      }
      await writeFile(shippedPath, shippedMarkdown);
    } else if (existingShipped === undefined) {
      await writeFile(shippedPath, shippedMarkdown);
    }
  }

  if (!fixturePath) {
    const manifestPath = resolve('docs/THIRD-PARTY-LICENSES.md');
    const generated = renderLicenseManifest(entries);
    const existing = await readFile(manifestPath, 'utf8').catch(() => undefined);
    // Git checks this file out with CRLF on Windows (core.autocrlf) while the
    // generator emits LF, so comparing raw strings reported a correctly
    // committed manifest as stale. Compare on content, not line endings.
    if (existing !== undefined && normalize(existing) !== normalize(generated) && !write) {
      console.error(
        'docs/THIRD-PARTY-LICENSES.md is stale; run node scripts/verify-licenses.mjs --write to update it.',
      );
      process.exitCode = 1;
      return;
    }
    if (existing === undefined || write) await writeFile(manifestPath, generated);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
