import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareAppendixBToRegistry,
  compareDashboardToAppendices,
  compareDeadControlsToManifest,
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

test('the format registry parse reads ids, statuses, and unavailable reasons', () => {
  const source = `
const FORMAT_REGISTRY: readonly FormatCapability[] = [
  supported(
    'docx',
    'Word (DOCX)',
    ['.docx'],
    ['application/vnd.openxmlformats'],
    ['to-pdf'],
    'Structure is read with mammoth.',
  ),
  unavailable(
    'doc',
    'Legacy Word (DOC)',
    ['.doc'],
    ['application/msword'],
    ['to-pdf'],
    'Legacy OLE2/CFB parsing is not yet complete.',
  ),
];
`;
  assert.deepEqual(parseFormatRegistry(source), [
    { id: 'docx', status: 'supported' },
    {
      id: 'doc',
      status: 'unavailable',
      // The reason is the FINAL argument, not the label. An earlier parse
      // stopped the match at the first argument, so this read back as `'doc'`
      // and the SFCC reason check passed vacuously on every entry.
      reason: 'Legacy OLE2/CFB parsing is not yet complete.',
    },
  ]);
});

test('an unavailable format checked in Appendix B is not drift when the reason is stated', () => {
  // SFCC admits an unavailable format when there is "an honest, specific
  // 'unsupported' page". DOC/XLS/PPT/TIFF/CBR/PUB/HWP/INDD are checked on that
  // clause, so reporting them as drift was a false positive on the project.
  const markdown = `## Appendix B — Format tracker

| Format | Status |
| --- | --- |
| DOCX/DOC | B |  [x]   |

## Appendix C — AI adapters
`;
  const findings = compareAppendixBToRegistry(markdown, [
    { id: 'doc', status: 'unavailable', reason: 'Legacy OLE2/CFB parsing is not yet complete.' },
  ]);
  assert.deepEqual(findings, []);
});

test('an unavailable format with no stated reason is drift', () => {
  // The other half of SFCC's clause: an unavailable format needs a SPECIFIC
  // reason. An empty one means there is no honest unsupported page to point at.
  const markdown = `## Appendix B — Format tracker

| Format | Status |
| --- | --- |
| DOCX/DOC | B |  [x]   |

## Appendix C — AI adapters
`;
  const findings = compareAppendixBToRegistry(markdown, [
    { id: 'doc', status: 'unavailable', reason: '   ' },
  ]);
  assert.equal(findings.length, 1);
  assert.match(findings[0], /marks doc unavailable with no stated reason/u);
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

test('disabled primary actions that state a reason are not drift', () => {
  // Three routes disable their Run button on purpose and say why in the served
  // HTML. An earlier version reported the raw count as an unconditional
  // finding, which made `pnpm progress` permanently red — a gate that can
  // never go green is a gate that gets ignored.
  const findings = compareDeadControlsToManifest({
    deadControls: ['/bookmarks', '/pdf-to-pdfa', '/rasterize-pdf'],
  });
  assert.deepEqual(findings, []);
});

test('a disabled primary action with no stated reason is drift', () => {
  const findings = compareDeadControlsToManifest({
    deadControls: ['/bookmarks', '/crop-pdf'],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0], /\/crop-pdf/u);
  assert.doesNotMatch(findings[0], /\/bookmarks/u);
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
