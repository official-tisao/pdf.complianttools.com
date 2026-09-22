import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = ['apps', 'packages', 'scripts'];
const extensions = new Set(['.js', '.mjs', '.ts', '.svelte', '.json', '.css', '.html', '.txt']);

export async function findTrademarkViolations(root = process.cwd(), denylist = []) {
  const violations = [];
  for (const sourceRoot of roots) {
    for await (const path of glob(`${sourceRoot}/**/*`, {
      cwd: root,
      exclude: (name) => name.includes('node_modules'),
    })) {
      if (
        path.endsWith('trademark-denylist.txt') ||
        !extensions.has(path.slice(path.lastIndexOf('.')))
      )
        continue;
      const text = await readFile(resolve(root, path), 'utf8');
      for (const term of denylist)
        if (text.toLowerCase().includes(term.toLowerCase())) violations.push(`${path}: ${term}`);
    }
  }
  return violations;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const denylist = (await readFile(resolve('scripts/trademark-denylist.txt'), 'utf8'))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  const violations = await findTrademarkViolations(process.cwd(), denylist);
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  }
}
