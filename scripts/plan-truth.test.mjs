import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareAppendixBToRegistry,
  compareDashboardToAppendices,
  compareGateGlyphs,
  parseFormatRegistry,
  tallySection,
} from './plan-truth.mjs';

/**
 * PLAN.md's dashboard and appendices are hand-maintained, so they drift from
 * the repository in ways a reader cannot check. These assertions are written
 * against fixtures: each one seeds a known drift and asserts the checker names
 * it, so the check itself is proven to work rather than merely present.
 */

test('an appendix tally counts each status mark', () => {
  const markdown = `## Appendix A — Tool tracker

| # | Tool | Status |
| --- | --- | --- |
| T01 | One |  [x]   |
| T02 | Two |  [/]   |
| T03 | Three |  [ ]   |
| T04 | Four |  [~]   |
`;
  const tally = tallySection(markdown, '## Appendix A');
  assert.deepEqual(tally, { done: 1, inProgress: 1, open: 1, deferred: 1, rows: 4 });
});

test('a dashboard that disagrees with its appendix is reported', () => {
  const markdown = `## 1. Progress dashboard

| Artefact | Target | Done |
| --- | :----: | :--: |
| Tools (Appendix A) | 72 | 61 |

## Appendix A — Tool tracker

| T01 | One |  [x]   |
| T02 | Two |  [x]   |
`;
  const findings = compareDashboardToAppendices(markdown);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /61 tools done; Appendix A has 2 checked/u);
});

test('a dashboard that agrees with its appendix is silent', () => {
  const markdown = `## 1. Progress dashboard

| Artefact | Target | Done |
| --- | :----: | :--: |
| Tools (Appendix A) | 72 | 2 |

## Appendix A — Tool tracker

| T01 | One |  [x]   |
| T02 | Two |  [x]   |
`;
  assert.deepEqual(compareDashboardToAppendices(markdown), []);
});

test('a gate glyph that claims green while its own boxes are open is reported', () => {
  // This is the drift found in the repo: §1 shows Workstream A as ✅ while
  // Gate A is `[/]` with two open boxes.
  const markdown = `## 1. Progress dashboard

| Workstream | Focus | Tasks | Done | Gate |
| --- | --- | :-: | :-: | :-: |
| A | Core | 20 | 20 | ✅ |

### 🚦 Gate A — core document runtime

- [x] done thing
- [/] unfinished thing
- [ ] not started thing
`;
  const findings = compareGateGlyphs(markdown);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /Workstream A as ✅, but Gate A has 2 open box/u);
});

test('a gate whose glyph is already honest is not reported', () => {
  const markdown = `## 1. Progress dashboard

| Workstream | Focus | Tasks | Done | Gate |
| --- | --- | :-: | :-: | :-: |
| C | Edit | 12 | 12 | ◐ |

### 🚦 Gate C — editing

- [/] unfinished thing
`;
  assert.deepEqual(compareGateGlyphs(markdown), []);
});

test('the format registry parse reads ids and statuses from source', () => {
  const source = `
const FORMAT_REGISTRY: readonly FormatCapability[] = [
  supported(
    'docx',
    'Word (DOCX)',
  ),
  unavailable(
    'doc',
    'Legacy Word (DOC)',
  ),
];
`;
  assert.deepEqual(parseFormatRegistry(source), [
    { id: 'docx', status: 'supported' },
    { id: 'doc', status: 'unavailable' },
  ]);
});

test('an appendix row marked done for an unavailable format is reported', () => {
  const markdown = `## Appendix B — Format tracker

| Format | Status |
| --- | --- |
| DOCX/DOC | B |  [x]   |
| TXT | B |  [x]   |

## Appendix C — AI adapters
`;
  const findings = compareAppendixBToRegistry(markdown, [
    { id: 'doc', status: 'unavailable' },
    { id: 'txt', status: 'supported' },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /marks doc as \[x\].*unavailable/u);
});

test('an appendix row left unchecked for a supported format is reported', () => {
  const markdown = `## Appendix B — Format tracker

| Format | Status |
| --- | --- |
| CSV | B |  [ ]   |

## Appendix C — AI adapters
`;
  const findings = compareAppendixBToRegistry(markdown, [{ id: 'csv', status: 'supported' }]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /leaves csv unchecked.*supports it/u);
});

test('a format id that is only a substring of another row is not matched', () => {
  // `pdf` must not be matched against "PDF/A" or "PDF/X" rows; the checker
  // matches that one by whole cell, otherwise every PDF row would be reported.
  const markdown = `## Appendix B — Format tracker

| Format | Status |
| --- | --- |
| PDF/A 1b/2b/3b | A |  [ ]   |

## Appendix C — AI adapters
`;
  assert.deepEqual(compareAppendixBToRegistry(markdown, [{ id: 'pdf', status: 'supported' }]), []);
});
