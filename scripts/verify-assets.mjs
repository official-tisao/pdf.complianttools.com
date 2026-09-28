import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

async function filesIn(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await filesIn(path)));
    else output.push(path);
  }
  return output;
}

export async function verifyAssets(root = process.cwd()) {
  const staticRoot = resolve(root, 'apps/web/static');
  const registerPath = resolve(root, 'docs/static-asset-register.json');
  const registered = JSON.parse(await readFile(registerPath, 'utf8'));
  const files = await filesIn(staticRoot);
  const violations = [];
  for (const path of files) {
    const relativePath = relative(root, path).replaceAll('\\', '/');
    const entry = registered[relativePath];
    if (!entry) {
      violations.push(`${relativePath}: missing static-asset-register entry`);
      continue;
    }
    // Git checks text assets out with CRLF on Windows (core.autocrlf) while the
    // register records the LF bytes as committed, so hashing the raw file
    // reported unmodified assets as changed. Accept either form: the match is
    // still exact, it just does not treat a line-ending rewrite as a content
    // change. Binary assets are unaffected because normalisation is a no-op
    // unless the file actually contains CRLF.
    const contents = await readFile(path);
    const normalised = Buffer.from(contents.toString('utf8').replaceAll('\r\n', '\n'));
    const matches =
      createHash('sha256').update(contents).digest('hex') === entry.sha256 ||
      createHash('sha256').update(normalised).digest('hex') === entry.sha256;
    if (!matches) violations.push(`${relativePath}: sha256 mismatch`);
    for (const field of ['source', 'license', 'licenseUrl', 'checked']) {
      if (!entry[field]) violations.push(`${relativePath}: missing ${field}`);
    }
  }
  for (const path of Object.keys(registered)) {
    if (!files.some((file) => relative(root, file).replaceAll('\\', '/') === path)) {
      violations.push(`${path}: register entry points to a missing file`);
    }
  }
  return violations;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = await verifyAssets();
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  }
}
