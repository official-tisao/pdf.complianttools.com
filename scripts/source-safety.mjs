import { glob, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const extensions = new Set(['.js', '.mjs', '.ts', '.svelte']);
const sourceRoots = ['apps', 'packages'];

export async function findUnsafeSource(root = process.cwd()) {
  const violations = [];
  for (const sourceRoot of sourceRoots) {
    for await (const path of glob(`${sourceRoot}/**/*`, {
      cwd: root,
      exclude: (name) =>
        name.includes('node_modules') || /[\\/](?:build|dist|\.svelte-kit)[\\/]/u.test(name),
    })) {
      const normalizedPath = path.replaceAll('\\', '/');
      if (
        !extensions.has(path.slice(path.lastIndexOf('.'))) ||
        /\/(?:build|dist|\.svelte-kit)\//u.test(normalizedPath)
      )
        continue;
      const text = await readFile(`${root}/${path}`, 'utf8');
      if (text.includes('safe-html-reviewed')) continue;
      if (/\beval\s*\(/u.test(text)) violations.push(`${path}: eval()`);
      if (/\binnerHTML\b/u.test(text)) violations.push(`${path}: innerHTML`);
      if (/\{@html\s/u.test(text)) violations.push(`${path}: {@html}`);
    }
  }
  return violations;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const violations = await findUnsafeSource();
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  }
}
