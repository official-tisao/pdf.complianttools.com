import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const roots = ['apps', 'packages', 'scripts'];
const extensions = new Set(['.js', '.mjs', '.ts', '.svelte', '.json', '.css', '.html', '.txt']);

export async function findTrademarkViolations(root = process.cwd(), denylist = []) {
  const violations = [];
  for (const sourceRoot of roots) {
    for await (const entry of glob(`${sourceRoot}/**/*`, {
      cwd: root,
      withFileTypes: true,
      exclude: (item) => {
        if (typeof item === 'string') return item.includes('node_modules');
        return item.name.includes('node_modules');
      },
    })) {
      // Skip directories - we only want files
      if (typeof entry !== 'string' && !entry.isFile()) continue;

      const ext = entry.name.slice(entry.name.lastIndexOf('.'));
      if (!extensions.has(ext)) continue;
      if (entry.name.endsWith('trademark-denylist.txt')) continue;

      const fileDir = typeof entry === 'string' ? '' : entry.path || entry.parentPath || '';
      const filePath = typeof entry === 'string' ? entry : `${fileDir}/${entry.name}`;
      const text = await readFile(resolve(root, filePath), 'utf8');
      for (const term of denylist)
        if (text.toLowerCase().includes(term.toLowerCase()))
          violations.push(`${filePath}: ${term}`);
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
