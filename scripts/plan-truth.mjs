/**
 * PLAN.md truth checker.
 *
 * PLAN.md's §1 dashboard and its Appendices are hand-maintained Markdown, and
 * they have drifted from the repository in ways a reader cannot check:
 *
 *   - §1 claims 61 tools done; Appendix A has 62 `[x]`.
 *   - §1 shows Workstream A as green (✅) while Gate A is `[/]` with two open
 *     boxes, and Checkpoint A.1 has six more.
 *   - Eight Appendix B rows are `[x]` for formats that `conversion/registry.ts`
 *     marks `unavailable()` — doc, xls, ppt, cbr, publisher, hwp, tiff, indd.
 *     The count itself (25) agrees with §1, so the drift is not in the
 *     arithmetic but in *which* rows are checked: B is wrong about content
 *     while looking correct about totals.
 *
 * That last point is why a count check alone would pass. Three drifts across
 * three tables is not three typos: the table is derived by hand, so it is wrong
 * in a way a reader cannot check. `scripts/check-plan-sync.mjs` does not help —
 * it only asserts that README.md and PLAN.md were touched in the same commit,
 * and never parses either file's contents.
 *
 * This module derives the counts from PLAN.md and the repo and reports the
 * differences. It becomes `pnpm progress` and Gate G's "no drift" criterion.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/** Counts `[x]` / `[/]` / `[ ]` / `[~]` boxes inside one PLAN.md section. */
export function tallySection(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start === -1) return null;
  const rest = markdown.slice(start + heading.length);
  // A section ends at the next `## ` heading at the same or higher level.
  const next = rest.search(/\n#{1,3} /u);
  const body = next === -1 ? rest : rest.slice(0, next);
  const count = (mark) =>
    (body.match(new RegExp(`\\|\\s*\\[${mark}\\]\\s*\\|`, 'gu')) ?? []).length;
  return {
    done: count('x'),
    inProgress: count('/'),
    open: count(' '),
    deferred: count('~'),
    rows: (body.match(/^\| T\d+[a-z]?\s*\|/gmu) ?? []).length,
  };
}

/** The §1 dashboard's hand-written counts, for comparison against derived ones. */
export function parseDashboard(markdown) {
  const row = (label) => {
    const match = new RegExp(`^\\|\\s*${label}\\s*\\|([^\\n]*)$`, 'mu').exec(markdown);
    if (!match) return null;
    const cells = match[1].split('|').map((cell) => cell.trim());
    return { tools: Number(cells[1]), done: Number(cells[2]), gate: cells[3] };
  };
  const artefact = (label) => {
    const match = new RegExp(`^\\|\\s*${label}[^|]*\\|([^\\n]*)$`, 'mu').exec(markdown);
    if (!match) return null;
    const cells = match[1].split('|').map((cell) => cell.trim());
    return { target: cells[0], done: Number(cells[1]) };
  };
  return {
    workstreams: { A: row('A'), B: row('B'), C: row('C'), D: row('D') },
    tools: artefact('Tools \\(Appendix A\\)'),
    formats: artefact('Formats & standards \\(Appendix B\\)'),
  };
}

/**
 * Compares the dashboard against what the appendices actually contain.
 * Pure: takes both strings so it can be tested against fixtures.
 */
export function compareDashboardToAppendices(markdown) {
  const dashboard = parseDashboard(markdown);
  const tools = tallySection(markdown, '## Appendix A');
  const formats = tallySection(markdown, '## Appendix B');
  const findings = [];

  if (dashboard.tools && tools && dashboard.tools.done !== tools.done) {
    findings.push(
      `§1 dashboard says ${dashboard.tools.done} tools done; Appendix A has ${tools.done} checked`,
    );
  }
  if (dashboard.formats && formats && dashboard.formats.done !== formats.done) {
    findings.push(
      `§1 dashboard says ${dashboard.formats.done} formats done; Appendix B has ${formats.done} checked`,
    );
  }
  return findings;
}

/**
 * Compares a gate's dashboard glyph against the gate's own boxes in PLAN.md.
 *
 * §1 renders Workstream A as ✅, but Gate A is `[/]` — two boxes are explicitly
 * open — and Checkpoint A.1 has six more. A gate that shows green while its own
 * section is unfinished is the exact drift this check exists to catch.
 */
export function compareGateGlyphs(markdown) {
  const findings = [];
  const section = (name) => {
    const heading = new RegExp(`### \\u{1F6A6} Gate ${name}\\b[^\\n]*`, 'u');
    const match = heading.exec(markdown);
    if (!match) return null;
    const rest = markdown.slice(match.index);
    const next = rest.slice(match[0].length).search(/\n#{1,3} /u);
    const body = next === -1 ? rest : rest.slice(0, match[0].length + next);
    const open = (body.match(/^- \[(?:\s|\/|!)\]/gmu) ?? []).length;
    const deferred = (body.match(/^- \[~\]/gmu) ?? []).length;
    return { open, deferred };
  };

  for (const name of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const gate = section(name);
    const glyph = parseDashboard(markdown).workstreams?.[name]?.gate;
    if (!gate || !glyph) continue;
    const claimsGreen = glyph === '✅';
    if (claimsGreen && gate.open > 0) {
      findings.push(
        `§1 shows Workstream ${name} as ${glyph}, but Gate ${name} has ${gate.open} open box(es)`,
      );
    }
  }
  return findings;
}

/**
 * Compares Appendix B against the engine's own format registry.
 *
 * The registry is the source of truth about capability, because it is what the
 * user actually hits — it supplies the typed `unavailableReason` a route
 * surfaces. But `status: 'unavailable'` does NOT mean a row must be left
 * unchecked, and an earlier version of this check reported exactly that,
 * producing eight false findings on formats the project ships honestly.
 *
 * SFCC (§0.4) admits an unavailable format: "a fixture round-trip test (or an
 * honest, specific 'unsupported' page)". P3-11 and P3-12 were built on that
 * clause — DOC/XLS/PPT/TIFF/CBR/PUB/HWP/INDD are best-effort or typed
 * unavailable by design, and `/convert` renders every registry entry's
 * `unavailableReason` as user-visible copy. So the honest question is not
 * "is it unavailable?" but "does it say so specifically?" — which is
 * checkable, and is what this compares instead.
 *
 * @param {string} markdown PLAN.md contents
 * @param {ReadonlyArray<{ id: string, status: string, reason: string }>} formats
 */
export function compareAppendixBToRegistry(markdown, formats) {
  const findings = [];
  const start = markdown.indexOf('## Appendix B');
  const end = markdown.indexOf('## Appendix C');
  if (start === -1 || end === -1) return findings;
  // Appendix B rows are human-written prose ("DOCX/DOC", "TIFF (multi-page)"),
  // so a registry id matches on a word-boundary substring of the row rather
  // than an exact cell value.
  const rows = markdown
    .slice(start, end)
    .split(/\r?\n/u)
    .filter((line) => /^\|/.test(line) && !/^\|\s*(Format|-)/u.test(line));

  for (const format of formats) {
    // `pdf` appears in many rows ("PDF/A", "PDF/X", "PDF 1.0-2.0") as a
    // substring of another format's name, so it is matched by whole cell only.
    const pattern =
      format.id === 'pdf'
        ? /\|\s*PDF\s*\(1\.0/u
        : // Appendix B rows are upper-case prose ("DOCX/DOC") while registry
          // ids are lower-case, so the match is case-insensitive on word
          // boundaries rather than an exact cell value.
          new RegExp(`\\b${format.id}\\b`, 'iu');
    for (const line of rows) {
      if (!pattern.test(line)) continue;
      const checked = /\|\s*\[x\]\s*\|/u.test(line);
      if (format.status === 'supported' && !checked) {
        findings.push(`Appendix B leaves ${format.id} unchecked, but the registry supports it`);
      }
      // SFCC's unavailable clause requires a *specific* reason. An entry with
      // an empty one is not an honest unsupported page, it is a silent gap.
      if (format.status === 'unavailable' && !format.reason?.trim()) {
        findings.push(
          `the registry marks ${format.id} unavailable with no stated reason, so no honest unsupported page can exist`,
        );
      }
    }
  }
  return [...new Set(findings)];
}

/**
 * Extracts `{ id, status, reason }` for every format from the engine registry.
 *
 * The registry is TypeScript and cannot be imported into `node --test` (the
 * same constraint that made `scripts/i18n.test.mjs` grep source text instead),
 * so its `supported(` / `unavailable(` calls are read directly. The format id
 * is always the first string argument and an unavailable entry's reason is its
 * LAST string argument, so this reads two known positions.
 *
 * `reason` is read for unavailable entries only. For `supported(` the trailing
 * string is the note and the one before it is the direction list, so reading a
 * "reason" there would pick up unrelated prose.
 */
export function parseFormatRegistry(source) {
  const formats = [];
  // The match must span the WHOLE call, not stop at the first argument: the
  // reason is the final string literal, so a lazy match that ends early reads
  // the id back as the reason and the SFCC reason check silently passes on
  // every entry. Entries are formatted one argument per line and closed by
  // `\n  ),`, which is an unambiguous terminator — labels contain parentheses
  // (`'Legacy Word (DOC)'`) but never a line-leading `  )`.
  const call = /\b(supported|unavailable)\(\s*\n?\s*'([a-z0-9-]+)'([\s\S]*?)\n\s*\)/gu;
  for (const match of source.matchAll(call)) {
    const entry = { id: match[2], status: match[1] === 'supported' ? 'supported' : 'unavailable' };
    if (entry.status === 'unavailable') {
      // The last string literal in an `unavailable(...)` call is the reason;
      // it is always the final argument.
      const literals = [...match[3].matchAll(/'([^']*)'/gu)].map((m) => m[1]);
      entry.reason = literals.at(-1) ?? '';
    }
    formats.push(entry);
  }
  return formats;
}

/**
 * Reports routes whose primary action is disabled **and** which do not say why.
 *
 * A disabled Run button is only a defect when nothing on the page explains it.
 * `/bookmarks`, `/pdf-to-pdfa`, and `/rasterize-pdf` render a stated
 * `unavailableReason` in the served HTML, which is the honest answer — the
 * dead-control contract test (`tests/contracts/dead-control-gate.test.mjs`)
 * keeps its own allow-list of exactly those, and this reads the same signal
 * rather than restating the count as drift.
 *
 * Reporting every disabled action as a finding — which an earlier version did,
 * as an unconditional line in the findings list — makes `pnpm progress`
 * permanently red on a repository whose three remaining disabled actions are
 * all intentional. A gate that can never go green gets ignored, which is worse
 * than the gate it was added to replace.
 */
export function compareDeadControlsToManifest(manifest, allowList = DEFAULT_UNAVAILABLE_ROUTES) {
  const silent = (manifest.deadControls ?? []).filter((path) => !allowList.has(path));
  if (silent.length === 0) return [];
  return [
    `${silent.length} route(s) have a disabled primary action and no stated reason: ${silent.join(', ')}`,
  ];
}

/**
 * Routes that disable their primary action on purpose.
 *
 * Kept here as well as in the contract test because the two are different
 * assertions: the contract test proves the routes still state a reason, and
 * this list is the drift gate. Both read the same three names so neither can
 * silently grow.
 */
export const DEFAULT_UNAVAILABLE_ROUTES = new Set(['/bookmarks', '/pdf-to-pdfa', '/rasterize-pdf']);

/** Reads PLAN.md and the registry, and reports every drift found. */
export async function checkTruth(root = process.cwd()) {
  const markdown = await readFile(`${root}/PLAN.md`, 'utf8');
  const registry = await readFile(`${root}/packages/engine/src/conversion/registry.ts`, 'utf8');
  const manifest = JSON.parse(await readFile(`${root}/docs/route-manifest.json`, 'utf8'));
  const formats = parseFormatRegistry(registry);

  const findings = [
    ...compareDashboardToAppendices(markdown),
    ...compareGateGlyphs(markdown),
    ...compareAppendixBToRegistry(markdown, formats),
    ...compareDeadControlsToManifest(manifest),
  ];
  return { findings, manifest, formats };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { findings } = await checkTruth();
  if (findings.length === 0) {
    console.log('PLAN.md matches the repository.');
  } else {
    console.error('PLAN.md has drifted from the repository:');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
  }
}
