import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function assertPlanSync(changedFiles) {
  const names = new Set(changedFiles);
  if (names.has('README.md') && !names.has('PLAN.md')) {
    throw new Error('README.md changed without PLAN.md; update both in the same commit.');
  }
}

function changedFiles(base) {
  if (!base)
    return execFileSync('git', ['diff', '--name-only'], { encoding: 'utf8' })
      .split(/\r?\n/u)
      .filter(Boolean);
  return execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], { encoding: 'utf8' })
    .split(/\r?\n/u)
    .filter(Boolean);
}

const baseArgument = process.argv.find((argument) => argument.startsWith('--base='));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    assertPlanSync(changedFiles(baseArgument?.slice('--base='.length)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
