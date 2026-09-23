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
    const hash = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    if (hash !== entry.sha256) violations.push(`${relativePath}: sha256 mismatch`);
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
