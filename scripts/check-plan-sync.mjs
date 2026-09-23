import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ZERO_SHA = /^0{40}$/u;

export function assertPlanSync(changedFiles) {
  const names = new Set(changedFiles);
  if (names.has('README.md') && !names.has('PLAN.md')) {
    throw new Error('README.md changed without PLAN.md; update both in the same commit.');
  }
}

function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).split(/\r?\n/u).filter(Boolean);
}

function rootCommit() {
  const root = gitLines(['rev-list', '--max-parents=0', 'HEAD'])[0];
  if (!root) throw new Error('Unable to find the repository root commit for plan-sync.');
  return root;
}

export function resolveComparisonBase(base) {
  if (!base || ZERO_SHA.test(base)) return rootCommit();
  try {
    return execFileSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return rootCommit();
  }
}

function changedFiles(base) {
  if (!base) return gitLines(['diff', '--name-only']);
  return gitLines(['diff', '--name-only', `${resolveComparisonBase(base)}...HEAD`]);
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
