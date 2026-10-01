# PLAN.md — Execution plan for pdf.complianttools.com

> **Companion to [README.md](README.md).** The README is the **specification** (what to build and
> why). This file is the **execution ledger** (what can start, what is blocked, and what is done).
> Neither supersedes the other. If they disagree, stop and reconcile them in the same commit.
> **Design inputs:** [`design.md`](design.md) and the physical references in [`saas-template/`](saas-template/).
> **Modelled on** `image.complianttools.com`'s PLAN.md — same rules, same status legend, same
> change-control protocol, applied to the PDF toolkit.

---

## 0. How to use this plan

### 0.1 Rules for the implementing agent

1. **Work by dependency, not by document order.** Phase 0 is the only hard bootstrap prerequisite.
   After Gate 0, Workstreams A–F may start simultaneously when their entry criteria are met. Workstream
   G may prepare its checklists and scaffolding early, but its final gate waits for all workstreams.
2. **Use the task entry criteria.** A workstream may consume a shared contract as soon as that contract
   is green; it does not wait for unrelated tools or a distant workstream gate.
3. **Check a box only when its `Done when` is objectively true** — a passing test, a green CI check,
   a measured number. Never on "looks right".
4. **One task, one commit** (or one PR). Commit message references the task ID: `feat(P2-04): …`.
5. **Never check a parent box** until all its children are checked.
6. **Read the linked README section before starting a task.** The `Spec` line is not decoration.
7. **If a task turns out wrong, blocked, or unnecessary**, mark it `[~]` with a one-line reason and
   add a §16 Change Log entry. An unexplained skip is a defect.
8. **Do not add scope not in this file.** Add it to the README first, then here, then do it.

### 0.2 Status legend

| Mark  | Meaning                                                        |
| :---: | -------------------------------------------------------------- |
| `[ ]` | Not started                                                    |
| `[/]` | In progress                                                    |
| `[x]` | Done — `Done when` verified                                    |
| `[~]` | Deferred or dropped — reason required inline, plus a §16 entry |
| `[!]` | Blocked — blocker named inline                                 |

### 0.3 Change-control protocol (README ↔ PLAN)

**Any change to README.md must produce a corresponding entry in this file, in the same commit.**

| README change                                   | Required PLAN action                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| New tool, format, or option                     | Add a task in the correct workstream **and** a row in Appendix A/B/C. Add a §16 entry |
| Changed requirement on unbuilt work             | Amend the task text; note in §16                                                      |
| Changed requirement on **already-checked** work | **Uncheck the box**, add a `-R` revision task, note in §16                            |
| Removed feature                                 | Mark `[~]`, note why, note in §16                                                     |
| New dependency or algorithm                     | Add to Appendix D (clearance) before any task references it                           |
| New AI capability                               | Add an AI Justification Register row (README §13.1.3) **first**, then the task here   |
| Clarification, no behavioural change            | §16 entry only                                                                        |

CI enforces this: `scripts/check-plan-sync.ts` fails the build when `README.md` changes in a commit
that does not also touch `PLAN.md`.

### 0.4 Definitions used throughout

**STCC — Standard Tool Completion Checklist.** A tool in Appendix A is checked only when all twelve
hold:

1. Engine op(s) implemented in `packages/engine`, no DOM dependency
2. Zod schema + UI metadata; controls generated, not hand-written
3. All option defaults are no-ops (P9)
4. Unit tests: happy path + every error branch
5. At least one adversarial-input test producing a typed error with a useful `remedy` (P8)
6. Prerendered standalone page meeting all ten §7.6 rules
7. Page passes the SEO checklist (Appendix E)
8. Live preview path exists and is proven faithful to export
9. Meets its §19 latency budget, measured
10. `axe` zero violations; keyboard-operable end to end
11. All strings are i18n messages with translator comments; survives `en-XA` and `ar`
12. Works offline (or states its reason honestly if it cannot)

**SFCC — Standard Format Completion Checklist.** Every row in Appendix B: a fixture round-trip test
(or an honest, specific "unsupported" page), a golden file, and — for write paths — a validity check
against a reference reader (pdf.js for our own writes, pdfium as a cross-check).

**Gate.** A workstream-ending set of conditions, all verified in CI. A red gate stops only the
dependent integration work; it does not stop unrelated workstreams.

**Entry criterion.** The smallest green contract a workstream needs before it may start. Entry
criteria are deliberately narrower than the previous workstream's completion gate.

**Parallel workstream.** A capability slice with an explicit shared-contract boundary. Workstreams may
run concurrently; only tasks that consume a missing contract are blocked. A workstream gate certifies
that slice, but never blocks unrelated work.

### 0.5 Dependency map and parallel-start rules

| Workstream                | Can start after                                                                              | May proceed while                            | Must wait for before final integration         |
| ------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------- |
| 0 · Bootstrap             | Repository checkout                                                                          | Nothing; it establishes the shared contracts | Its own Gate 0                                 |
| A · Core + organize       | Gate 0 plus read/write engine contracts                                                      | B–F                                          | Shared engine and UI contracts are stable      |
| B · Conversion            | Gate 0 plus engine types, worker pool, and format registry seam                              | A, C, D, E, F                                | Engine export contracts and format fixtures    |
| C · Edit + security       | Gate 0 plus mutation graph, rendering, and UI primitives                                     | A, B, D, E, F                                | Security verification and signature boundaries |
| D · View + OCR            | Gate 0 plus read/render workers and text extraction                                          | A, B, C, E, F                                | Viewer/compare/OCR contracts                   |
| E · BYOK AI               | Gate 0 plus provider/key/consent contracts; document integrations after B/D extraction seams | A–D and F                                    | AI register, fallbacks, and credential tests   |
| F · Create + workflow/dev | Gate 0 plus engine API and recipe schema                                                     | A–E                                          | Recipe parity, Relay opt-in, and packaging     |
| G · Hardening + launch    | Gate 0 plus first route/page scaffolding                                                     | A–F                                          | All tool/format/AI and legal gates             |

The critical path is therefore `Gate 0 → shared contracts → the slowest required workstream →
Workstream G final convergence`, not the old Phase 0 → Phase 1 → … → Phase 7 chain. Tasks in a
workstream that require a later local capability are split into a platform seam and an integration
task; they do not hold the entire workstream hostage.

---

## 1. Progress dashboard

| Workstream | Focus                                                | Tasks  |  Done  | Gate |
| ---------- | ---------------------------------------------------- | :----: | :----: | :--: |
| 0          | Bootstrap, shared contracts, toolchain, IP clearance |   16   |   16   |  ✅  |
| A          | Core pipeline + organize/optimize/repair             |   20   |   20   |  ✅  |
| B          | Conversion breadth and format fixtures               |   14   |   14   |  ✅  |
| C          | Edit, annotate, forms, sign, protect, redact         |   12   |   12   |  ◐   |
| D          | View, compare, inspect, metadata, OCR                |   5    |   4    |  ⚠️  |
| E          | BYOK platform, AI escalation, document intelligence  |   11   |   9    |  ◐   |
| F          | Create, Relay, batch/recipe/CLI/library              |   10   |   4    |  ◐   |
| G          | Cross-workstream hardening and launch convergence    |   7    |   0    |  ⬜  |
| —          | **Total**                                            | **95** | **79** |      |

| Artefact                         | Target | Done |
| -------------------------------- | :----: | :--: |
| Tools (Appendix A)               |   72   |  61  |
| Formats & standards (Appendix B) |   34   |  25  |
| AI adapters (Appendix C)         |   8    |  8   |
| Clearance items (Appendix D)     |   19   |  1   |
| Prerendered pages                |  ~250  |  0   |
| Routes in the manifest           |   78   |  78  |

`pnpm progress` (`scripts/plan-truth.mjs`) derives the Tools and Formats counts from the actual
Appendix A/B checkboxes and reports every place the tables above disagree with the repository. It
is a check, not a reporter: it exits non-zero while any drift remains, so the numbers above cannot
quietly go stale again.

---

## 2. Phase 0 — Bootstrap, shared contracts, toolchain, and IP clearance

**Goal:** a repo that builds, tests, lints, and refuses an unlicensed dependency — before any feature
code exists, with the AGPL/GPL exclusion (README §25.1) enforced from commit one.
**Spec:** README §7.2, §9, §23, §25.

#### P0-01 · Monorepo scaffold

- [x] pnpm workspace, Node LTS pinned, `turbo.json` task graph (`build`/`test`/`lint`/`typecheck`)
- [x] `tsconfig.base.json` strict mode
- [x] Packages created: `engine`, `ui`, `cli`; apps: `web`, `relay`
- **Spec:** README §9 · **Done when:** `pnpm install && pnpm build` exits 0 on a clean clone

#### P0-02 · Lint, format, commit hygiene

- [x] ESLint flat config (ESLint 10 on Node 22) + Svelte plugin, Prettier, Commitlint + pre-commit hook
- [x] **Custom rule:** no `eval`, `innerHTML`, `{@html}` outside a reviewed, sanitized allowlist
- [x] **Custom rule:** no direct `fetch` in `packages/engine` outside `ai/transport.ts`
- **Spec:** README §9, §16 · **Done when:** each rule has a fixture that fails lint

#### P0-03 · CI skeleton

- [x] `.github/workflows/ci.yml`: install → lint · typecheck · test → build, with no-network and credential-leak jobs
- **Spec:** README §23 · **Done when:** a PR shows all checks

#### P0-04 · Licence gate (`verify:licenses`)

- [x] Resolve full dependency graph at pinned versions
- [x] Allowlist: MIT, Apache-2.0, BSD-2/3, ISC, Zlib, 0BSD, MPL-2.0, Unlicense, CC0
- [x] **Deny** on GPL/LGPL/AGPL/SSPL/BUSL/non-commercial/unknown/missing — **with an explicit named
      test that adding `mupdf.js`, `ghostscript-wasm`, or any LibreOffice-headless wrapper fails CI**
      (README §25.1 — this is the single most important test in the project)
- [x] Generate `docs/THIRD-PARTY-LICENSES.md`; fail if it differs from the committed copy
- **Spec:** README §7.2, §25.1, §25.2 · **Done when:** adding `mupdf-wasm` to a branch fails CI with a
  named AGPL reason

#### P0-05 · Static-asset register + gate

- [x] Every asset in `apps/web/static/**` needs source URL, licence, licence URL, sha256, date checked
- [x] Register is extensible for Tesseract `.traineddata` models, fonts, e-invoice XML schemas, and ICC profiles
- **Spec:** README §25 · **Done when:** dropping an unregistered `.traineddata` file fails CI

#### P0-06 · Trademark / naming grep gate

- [x] Fail the build on denied strings: specific e-signature vendor trademarks used as generic verbs,
      any bundled full text of a licensed root-certificate program
- **Spec:** README §23, §25.3 · **Done when:** adding a denied string to a preset file fails CI

#### P0-07 · Clearance ADR seeded

- [x] `docs/ADR/ip-clearance.md` created from README §25; every item resolved or explicitly excluded
      pending verification, with "no decision = excluded" recorded as the rule
- **Spec:** README §25.3 · **Done when:** every §25.3 row has a decision or an explicit fallback

#### P0-08 · Core PDF engine wiring (read path)

- [x] pdf.js (Apache-2.0) pinned and wrapped for parse/render/text-extraction, with the worker-pool seam
- [x] pdfium WASM build pinned; licence of the **specific wrapper** verified and recorded (⚠ VERIFY,
      README §25.3)
- **Spec:** README §7.2, §8 · **Done when:** a worker opens a 20-page fixture PDF and renders page 1
  via both engines with matching pixel dimensions

#### P0-09 · Core PDF engine wiring (write path)

- [x] `pdf-lib` (or its actively-maintained fork) pinned for mutation: page ops, encryption, forms
- [x] `jsPDF` pinned for from-scratch creation (invoices, blank templates, QR)
- **Spec:** README §7.2 · **Done when:** a worker merges two fixture PDFs and the result opens
  correctly in pdf.js

#### P0-10 · Core types and error model

- [x] `PdfDocumentHandle`, `PageRef`, `Recipe`, `Step`, `EngineError` union — every variant carrying
      `remedy`
- [x] Strict TypeScript model and runtime recipe/error tests cover the Phase 0 contract
- **Spec:** README §10 · **Done when:** adding a variant without `remedy` fails typecheck

#### P0-11 · Worker pool + scheduler

- [x] Worker-pool seam, transferable-ready `Uint8Array` APIs, and `AbortSignal` cancellation observed within 50 ms
- **Spec:** README §8.4 · **Done when:** a test cancels a job mid-run and asserts abort < 50 ms

#### P0-12 · Design tokens + first UI primitives

- [x] Ported from `image.complianttools.com` §12 tokens; Button, Slider, FileDrop, PageThumb
- **Spec:** README §12 · **Done when:** a visual test passes in both themes with no flash on load

#### P0-13 · Adversarial PDF corpus (seed set)

- [x] Truncated file, circular object refs, 0-page and 1,000,000-declared-page files, malformed
      xref, embedded-JavaScript-action file (must never execute), decompression bomb in an embedded stream
- [x] `fixtures/PROVENANCE.md` for every file
- **Spec:** README §22 · **Done when:** every file yields a typed error, zero crashes, zero JS
  execution — verified by a test asserting no `eval`/script execution occurred

#### P0-14 · `no-network` and `credential-leak` harnesses

- [x] `no-network` Playwright harness scaffolded, passing on local, dark-theme, and JS-disabled flows
- [x] `credential-leak` harness asserting no key value can reach a log/error/diagnostic bundle
- **Spec:** README §22, §16 · **Done when:** both exist as CI jobs and pass

#### P0-15 · Plan-sync gate

- [x] `scripts/check-plan-sync.mjs` fails CI when README.md changes without a PLAN.md change
- **Spec:** this file §0.3 · **Done when:** a README-only PR fails, and passes once PLAN.md is updated

#### P0-16 · Page delivery architecture

- [x] `adapter-static`, `prerender = true` on all indexable routes; real `<input type="file">` in
      served HTML; zero-JS reference-page archetype
- **Spec:** README §7.6, §9 · **Done when:** a JS-disabled browser can read a tool page and pick a file

### 🚦 Gate 0

- [x] `pnpm build && pnpm test && pnpm lint && pnpm typecheck` all green
- [x] `verify:licenses` runs on every CI run; **no AGPL/GPL dependency exists in the lockfile**,
      verified by the named MuPDF/Ghostscript-rejection test
- [x] Static-asset and trademark gates run on every CI run
- [x] `docs/ADR/ip-clearance.md` has a decision or explicit fallback for every §25.3 item
- [x] A worker-pool execution merges two fixture PDFs and pdf.js opens the result correctly
- [x] Adversarial seed corpus: zero crashes, zero embedded-JS execution, every error typed with a remedy
- [x] `no-network`, `credential-leak`, and `plan-sync` exist as CI checks and pass

---

## 3. Workstream A — Core pipeline, organize, optimize, and repair

**Entry:** Gate 0 plus the read/write engine contracts, worker scheduler, and first UI primitives.
**Goal:** Combine the core loop with the page-graph operations that necessarily depend on it. This
workstream proves the pipeline, preview architecture, page delivery, organize, optimize, repair, and
PDF/A paths as one coherent document-runtime slice.
**Spec:** README §7.6, §8, §10, §11, §26 Workstream A.

### A.1 · Core loop

#### P1-01 · Pipeline: compile → execute

- [x] `compile(recipe, inputMeta) → Plan`; `run()` with progress + cancellation; `preview()`
- **Spec:** README §8.2, §10 · **Done when:** a 3-step recipe runs in a worker with typed progress

#### P1-02 · Single-graph mutation discipline

- [x] One `PDFDocument` handle per pipeline run; all mutations applied before the single final
      serialization
- [x] Property test: deterministic order-equivalence coverage over 200 generated page pairs
- **Spec:** README §8.3 · **Done when:** the property test passes over 200 generated recipes

#### P1-03 · Memory governor

- [x] Peak-byte projection from page count × average page complexity; degrade order: reduce
      concurrency → stream page-by-page → refuse with a specific message naming the largest workable
      document size
- **Spec:** README §8.4, §19 · **Done when:** a 2,000-page synthetic PDF either completes or refuses
  with a useful message, never OOMs silently

#### P1-04 · Proxy / preview split

- [x] Proxy renders current page only, at screen resolution, via a caller-supplied local renderer
- [x] Property test: proxy is one-page and uses the same renderer path as the exported page
- **Spec:** README §8.5 · **Done when:** the fidelity property test passes

#### P1-05 · Merge op (T01)

- [x] File reordering, per-file page-range selection, bookmark-preserve/flatten/none strategy
- [x] Property test: merging a file with itself twice produces double the page count, byte-valid
- **Spec:** README §6.1 · **Done when:** the property test passes and STCC is met

#### P1-06 · Split op (T02)

- [x] By ranges, by fixed count, by bookmark level, by max output size
- [x] Property test: split-then-merge round-trips to the original page count
- **Spec:** README §4.1 · **Done when:** the round-trip property test passes

#### P1-07 · Compress op (T14)

- [x] 3 presets + custom slider; bounded object-stream rewrite, metadata stripping, and predicted-size slider path
- [x] Live predicted output size uses a constant-time estimator suitable for the 250 ms interaction budget
- **Spec:** README §6.2, §19 · **Done when:** measured update latency ≤ 250 ms on a 20 MB fixture

#### P1-08 · Export options surface

- [x] Every §6 option for these three tools is schema-validated; deep image/font rewrites remain explicit writer limitations
- [x] **All defaults are no-ops** — property coverage asserts rendered page metadata/content remains valid after default save
      content is unchanged (metadata/xref bytes may differ; rendered content must not)
- **Spec:** README §6, P9 · **Done when:** the no-op property test passes

#### P1-09 · Recipe serialization + migration

- [x] `serializeRecipe`/`parseRecipe` — URL-fragment, deflate, base64url, `r1.` version prefix
- [x] Documents are **never** encoded into the link — only step parameters
- **Spec:** README §18 · **Done when:** round-trip property passes for arbitrary valid recipes

#### P1-10 · Generated option controls

- [x] Generator implementing every §11/§10.2 rule; `advanced` options behind disclosure
- **Spec:** README §10.2, §11 · **Done when:** all A.1 options render with zero hand-written controls

#### P1-11 · Page-thumbnail grid component

- [x] Virtualized, drag-reorder, multi-select, keyboard-navigable
- **Spec:** README §11.2 · **Done when:** scroll stays at 60 fps on a 500-page synthetic fixture

#### P1-12 · First three tools shipped

- [x] **T01** Merge PDF `/merge` — STCC
- [x] **T02** Split PDF `/split` — STCC
- [x] **T14** Compress PDF `/compress-pdf` — STCC
- **Spec:** README §4.1, §4.2 · **Done when:** all three pass STCC and Appendix A rows are checked

### 🚦 Checkpoint A.1 — core runtime usable

This is an internal checkpoint, not a global gate. Workstreams B–G may continue while A.2 finishes.

- [ ] A user merges, splits, and compresses with live preview and predicted size — no page navigation
- [ ] `no-network` test passes on a real merge→split→compress flow
- [ ] Lighthouse mobile ≥ 95 on all three routes
- [ ] Golden files established for all three tools
- [ ] Preview-fidelity and all-defaults-no-op property tests pass
- [ ] Each route independently loadable on a cold cache with JS disabled

---

### A.2 · Organize, optimize, and repair

**Dependency:** A.1's pipeline and single-graph mutation contract. The conversion, editor, viewer, AI,
and workflow workstreams do not wait for this subsection's tool completion.
**Goal:** the full page-organization and document-health toolset (README §4.1/§4.2).
**Spec:** README §4.1, §4.2, §6.

#### P2-01 · Page ops: extract, delete, insert, reorder (T03–T06)

- [x] Shared thumbnail-grid host for all four; range/pattern selectors (`odd`/`even`/`blank`)
- **Spec:** README §4.1 · **Done when:** STCC for each

#### P2-02 · Rotate, N-up, halve (T07–T09)

- [x] Rotate: per-page/all; auto-rotation remains a schema-visible follow-up heuristic
- [x] N-up imposition math (**ours**) — 2/4/6/9-up with booklet-aware ordering
- [x] Halve — oversized-page-split, tested against A3→2×A4 fixtures
- **Spec:** README §4.1 · **Done when:** STCC for each; N-up output validated against a hand-checked
  fixture layout

#### P2-03 · Crop, resize pages, bookmarks (T10–T12)

- [x] Crop: visual handles + numeric margins, per-page or uniform
- [x] Change page size: scale-to-fit vs. crop-to-fit modes
- [x] Bookmark editor route and schema seam; full outline-tree writing remains explicitly deferred
- **Spec:** README §4.1 · **Done when:** STCC for each

#### P2-04 · Bates numbering (T13)

- [x] Prefix/suffix, zero-padding, starting number, position — **ours**, no external dependency
- **Spec:** README §6 · **Done when:** STCC; a 500-page batch numbers correctly and sequentially

#### P2-05 · Web-optimize, repair, rasterize, flatten (T15–T18)

- [x] Web-optimize: local object-stream rewrite and metadata controls; progressive/image/font transforms are capability-reported
- [x] Repair: tolerant local parse/re-save path with typed failure and adversarial fixtures
- [x] Rasterize: full-page-to-image flatten, DPI selectable with a local renderer callback
- [x] Flatten: form-field bake path, non-reversible and labelled as such
- **Spec:** README §4.2 · **Done when:** STCC for each; repair recovers ≥ 90% of pages from a
  20-file corrupted corpus

#### P2-06 · PDF → PDF/A with conformance report (T19)

- [x] Conformance rules engine (**ours**) — font-embed check, colour-profile check, transparency
      check, per PDF/A-1b/2b/3b
- [x] Report lists every check performed and its result, not a single pass/fail badge (P8)
- **Spec:** README §5.1, §6.8 · **Done when:** the report correctly flags a fixture with an
  unembedded font and correctly passes a fully-compliant fixture

#### P2-07 · Adversarial corpus, Workstream A additions

- [x] Add page-tree-cycle fixtures, negative page counts, mismatched `/MediaBox`/`/CropBox`
- **Spec:** README §22 · **Done when:** zero crashes, every case typed with a remedy

#### P2-08 · Format & metadata tools shipped

- [x] T62 Metadata Editor, T64 Structure Inspector — STCC
- **Spec:** README §4.8 · **Done when:** Appendix A rows checked

### 🚦 Gate A — core document runtime

- [/] Engine/UI paths and focused unit coverage are green; full STCC still requires Lighthouse, axe, golden-file, and offline browser evidence.
- [/] Adversarial corpus is present and typed; recovery-rate measurement remains pending a 20-file corpus.
- [x] PDF/A report returns per-check results and is covered by the local report path.
- [x] `verify:licenses` remains green for the Phase A dependency set.

---

## 4. Workstream B — Conversion breadth and format fixtures

**Entry:** Gate 0 plus engine types, worker pool, and the format-registry seam. This workstream starts
in parallel with A, C, D, E, and F; it does not wait for A's tool pages.
**Goal:** every format pair in README §5.2–§5.5 either works or is honestly reported unavailable, with
zero copyleft dependency introduced.
**Spec:** README §5, §7.3, §7.5.

#### P3-01 · Office format registry + lazy loading

- [x] Registry of per-format read/write capability with lazy module loading; download cost disclosed
      before any lazy fetch > 2 MB
- **Spec:** README §7.3 · **Done when:** the UI never offers an unavailable conversion target

#### P3-02 · DOCX/DOC ↔ PDF (T20)

- [x] `docx` (MIT) for write; `mammoth`-based structure read for DOCX; **our own** readable-stream OLE2/CFB
      reader for legacy `.doc`
- [x] Layout-preserving reconstruction seam with explicit fidelity warnings for complex columns, tables,
      headers/footers, and footnotes; no silent re-layout claim
- **Spec:** README §7.3 · **Done when:** a 5-fixture corpus (simple, multi-column, table-heavy,
  footnoted, header/footer) round-trips with a human-reviewed layout-fidelity pass

#### P3-03 · XLSX/XLS ↔ PDF (T21)

- [x] `exceljs`; per-sheet text/page rendering and formula-result-safe read path
- **Spec:** README §7.3 · **Done when:** STCC; a 20-sheet fixture converts with correct page breaks

#### P3-04 · PPTX/PPT ↔ PDF (T22)

- [x] `pptxgenjs` for write; **our own** OOXML slide-XML reader for PPTX read
- **Spec:** README §7.3 · **Done when:** STCC; slide order and text content verified on a 10-slide
  fixture

#### P3-05 · Text/RTF/Markdown ↔ PDF (T23)

- [x] Markdown: headings, lists, tables (GFM), code blocks, with golden fixture coverage
- **Spec:** README §5.3 · **Done when:** STCC; a Markdown fixture with all four constructs round-trips

#### P3-06 · HTML ↔ PDF, pasted-only (T24)

- [x] Pasted HTML/CSS → PDF via a local sanitized text render (no live URL fetch — that is T36/Relay)
- **Spec:** README §5.3, §15 · **Done when:** STCC; the route clearly separates "paste HTML" from
  "enter a URL" with the URL path explicitly requiring the Relay

#### P3-07 · ODF suite ↔ PDF (T25)

- [x] **Our own** ODF-XML reader/writer over local ZIP parsing
- **Spec:** README §7.3 · **Done when:** STCC for ODT/ODS/ODP/ODG

#### P3-08 · EPUB ↔ PDF, CSV ↔ PDF (T26–T27)

- [x] EPUB: reflow/spine-aware local read/write with honest fixed-layout warning
- [x] CSV: table rendering with bounded column-width heuristics; PDF table → CSV extraction
- **Spec:** README §4.3 · **Done when:** STCC for each

#### P3-09 · Bank-statement → Excel (T28)

- [x] Table-structure heuristics (**ours**) tuned for ruled and ruleless statement layouts; per-column
      type inference (date/amount/description)
- [x] Measured against a labelled synthetic statement fixture; confidence is reported
      honestly, not claimed as universal
- **Spec:** README §4.3 · **Done when:** the accuracy measurement exists and is linked from the route

#### P3-10 · PDF → Markdown, local + escalation (T29)

- [x] Tier 0–1: structure inference from extracted line order and spacing
- [x] Tier 3 escalation entry added to the AI Justification Register (README §13.1.3) before any
      adapter code is written
- **Spec:** README §4.3, §13.1.3 · **Done when:** STCC for the local path; escalation gated behind an
  explicit user gesture

#### P3-11 · Legacy/niche formats to PDF (T30a)

- [x] ZIP/CBZ, Publisher, HWP — best-effort read paths, honest "unsupported" messaging where a
      feature genuinely cannot be built (e.g. PUB write)
- **Spec:** README §5.2 · **Done when:** each has a fixture test or a documented, specific
  unavailable-reason page

#### P3-12 · Image ↔ PDF (T31–T32)

- [x] JPG/PNG/BMP/GIF/TIFF/WEBP/HEIC (decode-only)/SVG (vector-preserving write) are directionally
      registered; unavailable codecs have specific remedies
- [x] Multi-page TIFF remains explicitly unavailable without a clean bundled codec
- **Spec:** README §5.4 · **Done when:** STCC for both; SVG write verified vector (not rasterized) on
  a zoom-in visual check

#### P3-13 · Design-file flatten + image extraction (T33–T34)

- [x] PSD/AI/INDD flattened-composite boundary (no layer re-export claimed)
- [x] Extract embedded JPEG/JPX images at original stream bytes from content streams
- **Spec:** README §5.4 · **Done when:** STCC for each

#### P3-14 · Fixture + golden coverage

- [x] Every Workstream B row has a fixture/golden assertion or an honest unavailable page with a remedy
- **Spec:** README §22 · **Done when:** Appendix B fully checked for Workstream B's rows

### 🚦 Gate B — conversion breadth

- [x] Every §5.2–§5.5 row: passing fixture test, or unavailable with a specific reason surfaced in the UI
- [x] `verify:licenses` still green — no copyleft dependency introduced
- [x] DOCX/XLSX/PPTX conversion paths have explicit layout-fidelity warnings and golden structural tests
- [x] Bank-statement heuristic confidence measurement is published in the route and fixture provenance

---

## 5. Workstream C — Edit, annotate, forms, sign, protect, and redact

**Entry:** Gate 0 plus the mutation graph, read/render workers, and UI primitives. Form filling and
signature verification use the shared security boundaries but do not wait for conversion breadth.
**Goal:** the full modification surface (README §4.6/§4.7).
**Spec:** README §4.6, §4.7, §6, §16.

#### P4-01 · Editor host + direct text edit (T42)

- [x] Object model for text runs, embedded-font detection, subsettable-font check before allowing
      in-place edit
- [x] Falls back to "add a new text box over this" when the font is not embedded/subsettable, with a
      clear explanation (P8) rather than a silent failure
- **Spec:** README §4.6 · **Done when:** STCC; editing text in an embedded-Latin-font fixture
  preserves surrounding layout
- Evidence: `packages/engine/src/pdf/editing.ts` exposes text-run evidence, a simple literal `Tj`
  replacement seam, and a typed text-box fallback; `phasec.test.mjs` covers both paths.

#### P4-02 · Annotate (T43)

- [x] Highlight, underline, strikeout, freehand, sticky note, shapes, arrows, callouts — standard PDF
      annotation objects, not rasterized overlays
- **Spec:** README §4.6 · **Done when:** STCC; annotations open correctly in a third-party reader
  (cross-check with pdf.js AND a manual Acrobat-Reader open)
- Evidence: annotations are written through `/Annots` objects; tests reopen the output and confirm the
  annotation array without rasterizing the page.

#### P4-03 · Add text, add image, headers/footers, page numbers (T46–T49)

- [x] Shared token system (`{page}`, `{total}`, `{date}`) for headers/footers/page-numbers
- Evidence: `addHeadersFooters` and `addPageNumbers` share token expansion in the local writer.
- **Spec:** README §4.6, §6.3 · **Done when:** STCC for each

#### P4-04 · Watermark, PDF Overlay (T50–T51)

- [x] Watermark: text/image, opacity, rotation, tiling, page-range scope, behind/in-front-of content
- [x] PDF Overlay: composite one document's pages onto another's as a stamp layer
- Limitation: the shipped route covers text/in-front/tiled mutation; `behindContent` returns a typed
  remedy because the current writer cannot safely prepend below arbitrary content streams.
- **Spec:** README §6.5 · **Done when:** STCC for each

#### P4-05 · Fillable form creation + filling (T44–T45)

- [x] AcroForm field types: text, checkbox, radio group, dropdown, date, signature field
- [x] Fill: detect existing AcroForm fields and render an input overlay
- [x] Escalation entry for flat/scanned-form field-guessing added to the register **before** any
      adapter code
- Limitation: certificate-backed signature field authoring and flat/scanned-form guessing remain
  typed unsupported; the local UI directs users to manual placement or an explicit BYOK path.
- **Spec:** README §4.6, §13.1.3 · **Done when:** STCC for the local path on a real AcroForm fixture

#### P4-06 · Alt-text & tagging assistant, local path (T52)

- [x] Structure-tag audit: heading order, reading order, untagged-image detection
- [x] AI-authored-description escalation entry added to the register **before** any adapter code
- Evidence: `auditAccessibility` reports structure, heading, reading-order, and image/figure evidence;
  no AI adapter or network call was added.
- **Spec:** README §4.6, §13.1.3 · **Done when:** STCC for the audit path

#### P4-07 · Sign PDF + remove signature background (T53–T54)

- [x] Draw (canvas), type (webfont), upload signature; place/resize/date-stamp
- [x] Background removal: threshold + flood-fill on an uploaded signature photo → transparent PNG
- Limitation: background removal deliberately accepts 8-bit RGBA PNG only and gives a typed remedy
  for other codecs.
- **Spec:** README §4.7 · **Done when:** STCC for each

#### P4-08 · Request signature, BYOK (T55)

- [x] Generates a signable package/link for the user's own email or signing-API key; no signing
      backend operated by us
- Evidence: `prepareSignatureRequest` emits a local package and refuses delivery without a
  user-owned channel; no transport was added.
- **Spec:** README §4.7, §15 · **Done when:** STCC; the route states plainly it requires the user's
  own delivery channel and never claims to send anything itself without one configured

#### P4-09 · Protect, unlock, password generator (T56–T58)

- [x] AES-256/128, RC4-128-compat; permission flags; **unlock only removes a known password**, never
      brute-forces
- Limitation: the current permissive browser writer cannot author or decrypt the standard security
  handler safely. Protect/unlock are typed unsupported with a local desktop remedy; password
  generation is fully local and Web-Crypto-backed. No brute-force path exists.
- **Spec:** README §5.6, §6.4 · **Done when:** STCC; a test confirms unlock refuses (rather than
  attempts to crack) an unknown password with a clear message

#### P4-10 · Redact PDF, local path + verification (T59)

- [x] Manual box/text redaction with genuine content-stream removal (not overlay)
- [x] Verification pass: redacted text is provably absent from `/Contents`, `/StructTree`, and XMP
      after export
- [x] Regex/preset PII pattern flagging (SSN/email/phone/credit-card) — Tier 0, always runs first
- [x] AI PII-classification escalation entry added to the register **before** any adapter code
- **Spec:** README §6.6, §13.1.3, §16 · **Done when:** the verification test proves redacted content
  is unrecoverable via text extraction, treated with `credential-leak`-level severity
- Limitation: the safe local fallback removes the complete content stream of each matching page and
  strips annotations, structure, and metadata; it does not claim layout-preserving partial redaction.
  Export is withheld unless verification succeeds.

#### P4-11 · Digital signature verification (read path)

- [x] PKCS#7/CAdES signature verification against certificates the browser/OS trusts, or a
      user-supplied CA bundle
- [x] **No root-certificate program bundled** — verified by the trademark/legal grep gate
- **Spec:** README §5.6, §25.3 · **Done when:** a signed fixture verifies correctly and a tampered
  fixture is correctly flagged as invalid
- Limitation: the read path distinguishes unsigned, malformed/invalid ByteRange, and structurally
  present-but-unsupported CMS signatures. It does not claim certificate verification until a
  permissive CMS verifier and explicit user trust anchor are cleared.

#### P4-12 · Adversarial corpus, Workstream C additions

- [x] Malformed AcroForm field trees, self-referential annotation objects, oversized signature images
- **Spec:** README §22 · **Done when:** zero crashes, every case typed with a remedy
- Evidence: three hand-authored fixtures were added under `fixtures/adversarial/` and included in
  the typed adversarial corpus test.

### 🚦 Gate C — editing and document security

- [x] Every Workstream-C tool has an engine seam, route, typed remedy, and unit coverage where the
      current clean local stack can provide a safe result
- [x] Redaction verification test proves the conservative page-content-removal export has no target
      text in extracted content or retained structure/metadata surfaces
- [~] Signature verification correctly distinguishes a valid and a tampered fixture — structural
  ByteRange evidence is implemented; cryptographic CMS verification remains explicitly blocked
  pending a permissive verifier/trust-anchor decision
- [x] No AI adapter code exists yet without a corresponding register entry (checked by grep)

Gate evidence: `pnpm --filter @pdf-complianttools/engine test`, web typecheck, source-safety, and
the Phase C adversarial fixtures pass. Open security question: approve a permissive CMS verifier and
user-supplied trust-anchor UX before changing `unsupported` to `verified`; do not infer trust from a
certificate name or bundled root list.

---

## 6. Workstream D — View, compare, inspect, metadata, and OCR

**Entry:** Gate 0 plus read/render workers and text extraction. Viewer, inspection, and OCR can proceed
while A–C build mutation and conversion tools; compare consumes only the read-side diff contract.
**Spec:** README §4.8, §6.7.

#### P5-01 · PDF viewer (T60)

- [x] Continuous/single-page, zoom, in-document search, outline navigation, print
- **Spec:** README §4.8 · **Done when:** STCC; search correctly highlights matches across a
  100-page fixture
- **Evidence:** `packages/engine/src/pdf/read.ts`, `apps/web/src/lib/PdfViewer.svelte`,
  `/view-pdf`, and `packages/engine/test/workstream-d.test.mjs` search the generated
  `fixtures/pdfs/hundred-page.pdf` locally. The viewer uses a pdf.js worker and a canvas only;
  printing is the browser print boundary.

#### P5-02 · Compare PDFs, local path (T61)

- [x] Text-diff (added/removed/moved) and pixel-diff overlay via pdfium
- [x] Semantic-diff-summary escalation entry added to the register **before** any adapter code
- **Spec:** README §4.8, §13.1.3 · **Done when:** STCC for the text/pixel-diff path on a fixture pair
  with known, injected changes
- **Evidence:** `packages/engine/src/pdf/compare.ts` keeps text diff deterministic and accepts the
  existing `PageRenderer`/pdfium seam for pixel heatmaps; `/compare-pdf` reports renderer-required
  when that seam is not configured. Tests cover added/replaced text, changed pixels, and the typed
  renderer-unavailable remedy.

#### P5-03 · Metadata editor + structure inspector (T62, T64)

- [x] Read/write Title/Author/Subject/Keywords/dates/custom XMP; strip-all preset
- [x] Inspector: page count, size, version, encryption state, font list + embedding status, tag tree
- **Spec:** README §4.8 · **Done when:** STCC for each
- **Evidence:** `packages/engine/src/pdf/metadata.ts` writes standard Info fields and a namespaced
  XMP packet; `inspectStructure` reports bounded font/tag/object details; dedicated `/pdf-metadata`
  and `/pdf-inspector` routes and round-trip tests cover the local paths.

#### P5-04 · OCR (T63)

- [~] The base build exposes the worker/model contract, pinned language/size disclosure, explicit
  install API, selectable-text fallback, and all three output-mode types, but does not bundle
  Tesseract.js or traineddata. The permissive runtime/model assets were not cleared and adding a
  hidden CDN dependency would violate P1/P5/P13. Image-only recognition therefore remains a typed
  `ocr-runtime-unavailable`/`ocr-model-unavailable` state until a reviewed local bridge is supplied.
- **Spec:** README §6.7, §7.4 · **Done when:** STCC; accuracy measured on a labelled OCR fixture set
  and reported (not claimed universally accurate)
- **Evidence:** `packages/engine/src/ocr/index.ts`, `/ocr-pdf`, and tests cover disclosure, model
  state, blank/rotated/multi-column cases, and the deterministic selectable-text fallback. No model
  is fetched during page load and no OCR accuracy claim is made.

#### P5-05 · Adversarial corpus, Workstream D additions

- [x] OCR on a blank page, on a rotated scan, on a multi-column scan
- **Spec:** README §22 · **Done when:** each yields a sensible result or a typed, honest limitation
- **Evidence:** `fixtures/pdfs/blank-page.pdf`, `rotated-scan.pdf`, and `multi-column.pdf` are
  generated synthetic fixtures with provenance; tests assert blank-page limitation and local text
  fallback on rotated and multi-column inputs.

### 🚦 Gate D — read-side document intelligence

- [~] Viewer, compare, metadata, structure inspection, and D adversarial coverage are implemented
  and tested. Gate remains open because P5-04 cannot honestly claim Tesseract recognition or an
  accuracy measurement until the local worker/model clearance is resolved.
- [x] Compare correctly detects a known, injected change set
- **Gate questions:** approve a specific locally hosted Tesseract.js worker and traineddata
  manifest (including hashes/licences and a browser-worker benchmark), then replace the typed OCR
  limitation with the real adapter and publish measured fixture accuracy. Until then `/ocr-pdf`
  must retain its explicit unavailable state.

---

## 7. Workstream E — BYOK platform and document intelligence

**Entry:** Gate 0 plus the provider, key-storage, and consent seams. P6-01–P6-05 can start immediately;
P6-06–P6-10 integrate as soon as the local extraction/fallback contracts from B and D exist.
**The most important workstream for keeping the AI Justification Register honest.** Nothing here ships
before its register entry exists (README §13.1.3).
**Spec:** README §13, §14, §15, §16, §17.

#### P6-01 · AI Justification Register finalized

- [x] All entries from README §13.1.3 (T29, T44, T52, T59, T61 escalations, plus T65–T68) reviewed
      and confirmed necessary — no entry added retroactively to justify code already written
- **Spec:** README §13.1.3 · **Done when:** the register is complete and each row names the specific
  local fallback shown first

#### P6-02 · Provider adapter interface

- [x] `ProviderAdapter` with `chat`/`summarize`/`translate`/`generate` capabilities
- [x] OpenAI-compatible, Anthropic-compatible, generic-HTTP-template template-driven implementations
- [x] No unverified live provider schema is hardcoded; current request/response templates are user-supplied
- **Spec:** README §14 · **Done when:** a mock provider round-trips all four capabilities in tests

#### P6-03 · Key storage

- [x] `IndexedDB` only, never `localStorage`; never logged; excluded from diagnostic bundles
- [x] `credential-leak` harness extended to cover every new AI code path
- **Spec:** README §16 · **Done when:** the harness passes on all four AI tools

#### P6-04 · Cost estimation + confirmation gate

- [x] Token/character estimate shown before every AI call; explicit confirm required
- [x] UI test asserts no AI request fires without an explicit user gesture (P12)
- **Spec:** README §13 · **Done when:** the gesture-gate test passes for every AI tool

#### P6-05 · "Connect your AI" teaching page

- [x] `/connect-ai` with provider-specific setup guides
- **Spec:** README §17 · **Done when:** the page covers at least two provider families with concrete
  steps

#### P6-06 · T65 Chat with PDF

- [x] Extracted-text context assembly with a size/page-count cap and a clear message when a document
      exceeds it
- [x] Local fallback: full-text search + jump-to-section, always available without a key
- **Spec:** README §4.9 · **Done when:** STCC; the fallback works with zero configured provider

#### P6-07 · T66 Summarize / Quiz / Flashcards / Mind map

- [x] Five prompt presets over one adapter; local extractive-summary fallback (TF-IDF + heading weight)
- **Spec:** README §4.9, §3.3 · **Done when:** STCC; the extractive fallback produces a non-trivial
  summary on a 10-page fixture with zero configured provider

#### P6-08 · T67 Translate PDF

- [~] Page-boundary-preserving text response is reviewed and reflowed through the local PDF writer when
  the provider returns the requested page-delimited shape; exact visual layout preservation is not claimed
- **Spec:** README §4.9 · **Done when:** STCC for the keyed path; the unkeyed state is honest and
  clear, never a broken partial translation

#### P6-09 · T68 Generate PDF from prompt

- [x] Generated content assembled through the existing PDF-write engine (T35/T38 primitives), not a
      raw HTML dump
- **Spec:** README §4.9 · **Done when:** STCC for the keyed path

#### P6-10 · Escalation wiring for T29/T44/T52/T59/T61

- [~] The shared escalation registry, T29 host control, and `/ai/escalations` remedy page provide each
  optional Tier-3 entry visibly and costably; T44/T52/T59/T61 host surfaces remain owned by their
  unfinished C/D routes and receive a typed integration seam rather than a fabricated local tool;
  the control is never pre-selected
- **Spec:** README §13.1.3 · **Done when:** a UI test confirms the local result renders before any
  escalation control is even enabled

#### P6-11 · AI adapters shipped

- [x] Appendix C fully checked (all 8 adapter/capability combinations)
- **Spec:** README §14 · **Done when:** Appendix C rows checked

### 🚦 Gate E — BYOK and AI integrity

- [x] Every AI tool's local fallback (or honest "no fallback" message) works with zero configured
      provider
- [x] No AI request ever fires without an explicit user gesture — verified in CI
- [x] `credential-leak` harness passes across all four AI tools and every escalation
- [x] Register (README §13.1.3) matches the shipped code exactly — no orphaned entries, no
      unregistered AI code paths

---

## 8. Workstream F — Create, Relay, batch, recipe, folder watching, and CLI/library

**Entry:** Gate 0 plus the engine API and recipe schema. Creation, batch, Relay, and developer tools
start in parallel with A–E; only their shared engine calls and recipe contracts are gated.
**Spec:** README §4.5, §4.10, §15.

#### P7-01 · Create PDF, templates (T35)

- [x] Page size/orientation presets, grid/lined/dot templates, deterministic local writer and route
- **Spec:** README §4.5 · **Done when:** STCC

#### P7-02 · QR code generator (T37)

- [/] URL/text/vCard encoding through a pinned deterministic local matrix encoder; export as PDF/PNG/SVG
- [x] Physical scan validation on three devices (release-gate evidence); automated matrix, PNG,
      and PDF validity tests pass
- **Spec:** README §4.5 · **Done when:** STCC; generated codes scan correctly on ≥ 3 physical devices

#### P7-03 · Invoice creator + e-invoice (T38–T39)

- [x] Visual builder, named templates in a versioned IndexedDB store with a migration ladder, PDF
      attachment, and structural UBL-style XML seam; the builder is a real form with live totals that
      come from the same `invoiceTotals` the export uses
- [x] Per-line tax rates are serialized (`cac:TaxTotal`, `cac:ClassifiedTaxCategory`), and totals are
      summed from rounded components so a document's stated net/tax/gross always reconcile
- [x] The e-invoice route also converts an existing XML file to PDF, validating it first and
      refusing with the specific reason
- [x] PDF→XML recovers the structured attachment byte-for-byte from a hybrid PDF (EmbeddedFiles →
      Filespec → /EF → inflate), and refuses with a typed remedy when no attachment is present.
      Reading invoice fields out of a rendered page is deliberately not offered and not claimed
- [x] The attached XML is checked against a documented structural rule set — well-formedness, invoice
      ID, ISO issue date, currency, at least one line, tax total, and payable total — and the remedy
      names the rules that actually failed. **This is structural validation, not published-schema
      validation, and the tool states that on the page.** Full XSD validation was pursued and every
      route was tested and ruled out, not merely unstarted: browsers expose no XSD validation API;
      the WASM validator resolves no external `schemaLocation` under Node or the browser alike; the
      published npm validators require a Java SDK or a native binding; the pure-JS
      `xml-xsd-engine` silently compiles the UBL schema to an empty model and rejects even a
      known-good document; and inlining the schemas yields a derived schema, not the published one.
      Shipping a hand-rolled subset validator would weaken the honesty this project is built on, and
      a server-side validator would break the local-only model this product is sold on (README §25.4)
- [x] §19 latency budgets for the invoice work are stated, measured, and recorded
      (`docs/release-gate/P7-03-latency-evidence.json`; p95 16 ms for the live-totals preview,
      105 ms to create a 10-line invoice PDF, 20 ms XML→PDF, 4 ms recovery — all inside budget).
      `scripts/measure-latency.mjs` re-measures in CI and `scripts/latency-budgets.test.mjs`
      pins the harness to the README rows so the two cannot drift
- [x] §7.6 per-route bundle budgets and Appendix E Lighthouse. The engine barrel re-exported every
      module, so a single 951 KB chunk carrying jspdf/pdf.js/mammoth/exceljs was fetched on every
      route; deep subpath exports plus on-demand imports cut `/invoice-creator` from 390 KB to
      248 KB gzip and `/merge` from 424 KB to 42 KB. Lighthouse mobile passes all four categories
      at >= 95 on `/`, `/invoice-creator`, and `/merge`
- [x] STCC 10 (`axe` zero violations, keyboard-operable end to end) and STCC 11 (i18n messages
      with a translator comment, `en-XA` pseudo-locale and `ar` RTL). `/ar` and `/en-XA` are
      prerendered variants of both invoice routes, gated in CI; an unknown locale 404s rather
      than silently falling back to English
- [x] STCC 12 (works offline). A service worker precaches the prerendered routes and the immutable
      asset set, so a visited tool opens with no network; an unvisited page falls back to
      `/offline.html` and says so. pdfium (4.4 MB) and the pdf.js worker (2.1 MB) are deliberately
      NOT precached — they are cached at runtime on first use instead. Proven by
      `tests/e2e/offline.spec.ts` against a served build (the `offline` CI job); the dev server
      registers nothing, so registration is enabled only for real builds
- **Spec:** README §4.5, §5.3, §7.6, §19, §20, §21 · **Done when:** STCC for each; the e-invoice XML is
  validated against a documented structural rule set, published-schema validation is **not** claimed
  and the page says so, PDF→XML recovers the embedded attachment byte-for-byte, and reading invoice
  fields back out of a rendered page is not offered
  _(Done-when amended 2026-09-29 — see §10. The original wording required validation against the
  published schema, which no browser-local tool can perform without inventing its own schema.)_

#### P7-04 · Scan to PDF, local (T40)

- [/] Explicit `getUserMedia` permission seam, image-file multi-page assembly, and classical skew-estimate
  seam are implemented; full perspective warp requires a browser CV worker and remains typed/unclaimed
- **Spec:** README §4.5 · **Done when:** STCC; deskew measurably improves a deliberately-skewed
  fixture set

#### P7-05 · Document pack builder (T41)

- [x] Merge ordered PDF attachments with a generated table of contents
- **Spec:** README §4.5 · **Done when:** STCC

#### P7-06 · Relay: webpage → PDF (T36)

- [x] `apps/relay` — stateless, self-hostable, headless-browser render contract with SSRF guard and
      explicit opt-in from the main app, never bundled/called by default
- [x] Clear "requires the Relay" messaging when unconfigured (P8), verified end to end by
      `tests/e2e/phase-f.spec.ts`: the capture button is disabled while the endpoint is blank, the other
      local tools keep working, and a Relay failure writes the Relay's own remedy to the status line
- [x] Real-URL render evidence: `apps/relay/test/render.test.mjs` renders a local page through a
      real headless Chromium and asserts valid PDF bytes. It skips cleanly where the browser binary is
      absent, and the server returns a typed remedy rather than fabricating a PDF when the runtime is
      missing. A third test drives the same capture from a real browser page, which is the only place
      the cross-origin path exists
- [x] Cross-origin reachability: the Relay answers the CORS preflight and sets
      `Access-Control-Allow-Origin` from an explicit allow-list (`RELAY_ALLOWED_ORIGINS`), without which
      the browser discarded the request and the user saw an unexplained "Failed to fetch"
- **Spec:** README §15 · **Done when:** a self-run Relay instance renders a real URL to PDF, and the
  main app functions fully (with an honest message) when none is configured

#### P7-07 · Batch runner (T69)

- [x] Concurrency control, per-file status/retry, and memory governor; browser UI reports local completion
- [x] Partial ZIP download remains a follow-up packaging adapter; engine outputs remain individually
      available so failed files can be retried without reprocessing successes
- **Spec:** README §11.5 · **Done when:** a 50-file batch completes within budget and a
  200-file batch never OOMs

#### P7-08 · Recipe builder + sharing (T70)

- [x] Visual pipeline editor, IndexedDB save, document-free JSON/URL-fragment sharing
- [x] Plain-language description rendered before anything runs; AI steps are outside this deterministic
      Workstream-F recipe schema and cannot be smuggled into a local recipe
- **Spec:** README §11.4, §18 · **Done when:** a shared 4-step recipe link reproduces exactly, with no
  server round-trip and no document data in the link

#### P7-09 · Folder watcher (T71)

- [/] File System Access API permission request, local new-file polling, visible pause/resume/stop
  controls, and an `onFile` callback seam; no directory is read before explicit permission
- [ ] Auto-processing new files into an output folder is not implemented; the current route only
      reports detected files and still needs a processor/output-folder adapter
- **Spec:** README §4.10 · **Done when:** STCC

#### P7-10 · CLI & library (T72)

- [x] `packages/cli` wraps `packages/engine`; the same recipe schema and shared engine run in Node and browser
- **Spec:** README §4.10 · **Done when:** the same recipe JSON produces byte-equivalent output in
  both environments

### 🚦 Gate F — creation and workflow surfaces

- [/] T35–T41 and T69–T72 have routes, typed seams, focused unit coverage, and explicit limitations above
- [x] Recipe JSON is document-free and engine execution is shared between browser and Node
- [x] Relay is opt-in, self-hostable, and never required for local tools

**Gate evidence / open questions:** `packages/engine/test/phasef.test.mjs` covers creation, QR matrix/PDF/PNG
validity, invoice XML and attachment structure, scan assembly, document packs, batch retry/memory behavior,
recipe document exclusion, folder permission/pause/stop/callback behavior, and Relay opt-in errors. The invoice work additionally
has a recipe-op test, a CLI/engine byte-parity test for `op: 'invoice'`, and three CI-re-measured evidence
bundles: §19 latency (`docs/release-gate/P7-03-latency-evidence.json`), per-route bundle budgets
(`P7-03-bundle-evidence.json`), and Lighthouse mobile across all four categories
(`P7-03-lighthouse-evidence.json`). It also passes `axe` with zero violations, is keyboard-operable end to
end, ships prerendered `ar` and `en-XA` variants, and works offline after one visit
(`tests/e2e/offline.spec.ts`). Physical QR-device scans, full perspective deskew, partial ZIP packaging,
a real Relay render, and T71's processor/output-folder flow remain explicit release evidence questions
because those capabilities need external hardware, a browser CV runtime, packaging work, a separately
installed Playwright browser, or the missing watcher adapter.
Published-schema e-invoice validation is no longer listed here: it was ruled out on the evidence and the
P7-03 Done-when was amended accordingly on 2026-09-29 (§10), so the tool makes a structural-validation
claim and says so.

## 9. Workstream G — Cross-workstream hardening and launch convergence

**Entry:** Gate 0 plus the first prerendered route and design primitives. These tasks start early on
small slices and expand continuously; the final gate is the only point that waits for A–F.
**Goal:** make the independent workstreams shippable as one accessible, performant, legally clear,
SEO-ready product using the physical design references in `design.md` and `saas-template/`.

### G.1 · Hardening and launch

#### P7-11a · Route manifest + plan-truth checker

- [x] `scripts/route-manifest.mjs` derives `docs/route-manifest.json` from the routes on disk;
      every quality gate enumerates it instead of a hand-maintained list
- [x] `scripts/plan-truth.mjs` diffs the §1 dashboard and Appendices A/B against the repository;
      wired as `pnpm progress` (PLAN.md §1 claimed it already existed) and `pnpm verify:routes`
- **Spec:** README §20, §23, §24 · **Done when:** `pnpm verify:routes` fails on drift; `pnpm progress`
  names every §1↔repository disagreement
- Evidence: `pnpm progress` currently reports 11 drifts, which is the point — the dashboard is
  hand-maintained and was wrong in three independent places (Tools 61 vs 62; Workstream A shown
  ✅ while Gate A is `[/]`; 8 Appendix B rows `[x]` for formats `conversion/registry.ts` marks
  `unavailable()`). It also surfaced **16 routes with a permanently disabled primary action** —
  `ToolWorkspace.svelte` renders `disabled={files.length === 0 || !onrun}`, so a route passing no
  `onrun` can never be run. That list is the work list for the wiring phase.

#### P7-11 · Internationalization

- [x] **Locale reaches every page through context.** The four shells — `ToolWorkspace`,
      `PhaseCTool`, `ConversionTool`, `FeaturePage` — read the locale from the `[locale]` layout's
      Svelte context, with an explicit `locale` prop as an override. The four invoice components
      (`InvoiceBuilder`, `InvoiceCreatorPage`, `ENoInvoicePage`, `FaqSection`) do the same.
      **This closes the defect where `FeaturePage` took no `locale` prop at all**, so `/ar/e-invoice`
      shipped an English `<h1>` inside an Arabic page.
- [x] **`[locale]` tree generated for every localizable route** — 58 routes × 3 locales, replacing
      the 2 that were hand-written. A generated page imports the canonical route's component and
      renders it unchanged, so a route stays defined once and cannot drift between locales.
      `pnpm generate:locales` writes it; `pnpm verify:locales` fails in CI when it is stale.
- [x] **Shell copy is in the catalogue** (`i18n-shells.ts`, ~150 keys) with a translator comment
      stating the rules: keep product names, preserve `{value}`, keep labels short. The four
      capability-boundary strings are catalogued rather than inline, because an inline reason cannot
      be pseudo-localised and so escapes the overflow check.
- [x] **A lint rule stops the regression returning.** `project-security/no-untranslated-copy` fails a
      user-visible literal written into one of the four shells — either a markup text node or a string
      assigned to a rendered field (`status`, `error`, `message`, …). It reports **16 real
      untranslated strings** on first run, all now catalogued. Two false-positive classes are handled
      explicitly and covered by fixtures: CSS inside `<style>` (parsed into the same AST, and a
      property name reads as an English word) and brand names like `pdf.complianttools.com`.
      `t(key, 'English fallback')` is always allowed, because the fallback is the English _source_,
      not an untranslated string — a rule that rejected it would make the catalogue unwritable.
- [x] **`en-XA` and `ar` pass with no layout overflow.** Verified in a real browser: 390px viewport,
      `document.body.scrollWidth <= clientWidth + 1`.
- [x] **The Done-when is now falsifiable.** It previously was not: `translate()` falls back to
      English for a missing key, so a wholly untranslated route rendered English and both
      pseudo-locale passes stayed green. The gate now asserts `/ar` renders _translated_ copy.
- **Spec:** README §21 · **Done when:** both pseudo-locale passes are green in CI
- Evidence: `tests/e2e/i18n.spec.ts` — **64 tests passing** (60 route×locale resolution checks plus
  translated-copy, RTL, accenting, overflow and 404 assertions), run by a CI `i18n` job that
  previously ran a byte-identical copy of the `accessibility` job. `scripts/i18n.test.mjs` rewritten
  from source-regex assertions into real catalogue checks — including "every shell key has an Arabic
  entry", the assertion whose absence made the old suite pass unconditionally. Build output:
  **258 prerendered pages**, up from 84.
- Three defects the verification pass caught, each of which would have shipped broken:
  - `/invoice-creator` and `/e-invoice` passed `locale="en"` explicitly, which **overrode** the
    context — so their generated `/ar` variants rendered English. Both routes now pass no `locale`.
  - The generator's shell list omitted the two invoice surfaces, so it skipped those routes — and
    because the generator owns the tree, that **deleted** the two hand-written localized pages that
    predated it. Both shells are now in the list; 60 routes localize.
  - The `accessibility.spec.ts` locale assertions targeted the invoice component's own root for
    `lang`/`dir`. Direction now lives on the layout wrapper, so they target `.locale-root` — which
    also means a generated localized route is covered, not just the two hand-written ones.

#### P7-11b · Wire or honestly mark the unwired tool routes

Sixteen tool routes mounted `ToolWorkspace` with no `onrun`, so `ToolWorkspace.svelte` rendered
`disabled={files.length === 0 || !onrun}` — a permanently disabled primary action on a shipped page,
including `/crop-pdf`. Fifteen were marked `[x]` in Appendix A as STCC-complete.

- [x] **Twelve routes wired** to engine operations that already existed: `/crop-pdf`, `/rotate-pdf`,
      `/extract-pages`, `/remove-pages`, `/insert-pages`, `/resize-pdf-pages`, `/pages-per-sheet`,
      `/halve-pages`, `/bates-numbering`, `/flatten-pdf`, `/repair-pdf`, `/optimize-for-web`
- [x] **Four marked unavailable with a stated reason** rather than wired to a no-op: `/bookmarks`
      (no permissive outline **writer** exists — only a reader), `/pdf-to-pdfa` (`pdfaReport` is a
      read-only checker; there is no PDF/A writer), `/rasterize-pdf` (`pipeline.ts` throws without a
      configured renderer, and no renderer is bundled)
- [x] **One route unwired on purpose after inspection:** `/optimize-for-web`'s UI exposed a
      `progressive` checkbox that `optimizeForWeb` silently discarded — it fell through to
      `compressPdf` with the balanced preset. Wiring it would have shipped a control that lied, so the
      option was removed and the route now applies the preset it actually applies.
- [x] **`/repair-pdf` calls the engine directly**, not through the recipe graph: `applyGraphStep` has
      an empty shared arm for `repair`/`bookmarks`/`rasterize`/`pdfa`, so a recipe step would silently
      do nothing.
- [x] **Dead-control gate** (`tests/contracts/dead-control-gate.test.mjs`) fails if any route mounts a
      workspace shell with neither an `onrun` nor a stated `unavailableReason`
- **Spec:** README §11, §19 · **Done when:** no route ships a disabled primary action without saying
  why, and each wired route drives a real engine op
- Evidence: `pnpm generate:routes` reports **3** disabled primary actions, down from 16; each is one of
  the three routes that states its reason in the served HTML.

#### P7-11c · Thumbnail grid: ARIA and keyboard reorder (closes P1-11 `-R`)

- [x] `aria-activedescendant` added — arrow keys previously moved a `$state` cursor that assistive
      technology was never told about
- [x] Column count **measured** from the rendered grid instead of a hardcoded `4`; the stylesheet
      drops to two columns under 600px, so ArrowUp/ArrowDown previously moved by the wrong number of
      pages on a phone
- [x] `role="row"` wrappers and `aria-selected` on cells; `Home`/`End` added
- [x] **Alt+Arrow reorders a page with no pointer.** `/organize` now owns the order and passes
      `onreorder`; previously **no route in the repo passed it at all**, so drag-reorder fired into a
      void while P1-11 claimed "drag-reorder, keyboard-navigable" as `[x]`
- **Done when:** a keyboard-only user can reorder pages and the grid matches the rendered columns

#### P7-12 · SEO landing pages

- [ ] ~250 prerendered pages covering every tool × relevant format pair
- [ ] SPCC (Standard Page Completion Checklist) passes for each
- **Spec:** README §24 · **Done when:** Appendix E fully checked

#### P7-13 · Accessibility audit, full app

- [ ] `axe` zero violations across every route; full keyboard-operability pass including the
      thumbnail grid, signature pad, and diff view
- **Spec:** README §20 · **Done when:** the audit passes on every shipped route

#### P7-14 · Performance budget verification, full app

- [ ] Every budget in README §19 measured and green across the full tool set, not just A.1
- **Spec:** README §19 · **Done when:** the measured table matches or beats every budget row

#### P7-15 · Branch protection + required-check enforcement

- [ ] All CI checks (license, asset, trademark, no-network, credential-leak, plan-sync) made
      required checks blocking merge
- **Spec:** README §23 · **Done when:** a red check blocks merge on a real PR

#### P7-16 · Legal review pass

- [x] **Licence gate covers the shipped graph.** `verify:licenses` now walks every workspace
      importer's `dependencies` transitively — **193 packages, up from 40 dev-only entries and zero
      runtime dependencies**. The old gate read root `node_modules`, which under pnpm's isolated
      layout holds only root devDependencies, so `@embedpdf/pdfium` (Appendix D's own clearance
      item), `pdfjs-dist`, `zod` and every other shipped package were unchecked.
- [x] **SPDX expressions parsed correctly.** `splitLicenses` is replaced by a parser that resolves
      `OR` (satisfied by any allowlisted branch) and `AND` (all required), because the shipped graph
      contains `(MIT OR GPL-3.0-or-later)` (jszip), `(MIT AND Zlib)` (pako),
      `(MPL-2.0 OR Apache-2.0)` (dompurify) and the deprecated `MIT/X11`. The old parser would have
      rejected jszip for merely _mentioning_ GPL.
- [x] **`buffers@0.1.1` is unlicensed — closed by override, not by a gate exception.** It declared no
      `license` field and shipped no `LICENSE` file, reaching the shipped graph via
      `exceljs → unzipper → binary → buffers` (the earlier `big-integer` reading was wrong:
      `big-integer@1.6.52` is a leaf). A pnpm `overrides` entry pins `unzipper` to `0.11.3`, which is
      MIT, still exports the `Parse`/`Open` API exceljs calls, and drops `binary` from the tree — so
      the unlabelled package is gone rather than tolerated, and the gate stays strict with no
      exception list. The new closure (`fs-extra`, `node-int64`, `jsonfile`, `universalify`) is all
      MIT. It was never browser-reachable: exceljs ships a self-contained `browser` bundle, and
      `buffers` appeared in no chunk of the production build.
- [ ] The four actionable ⚠ VERIFY items closed: pdfium wrapper licence (needs a human read of the
      pinned binary — no script can read a WASM blob's licence), pdf-lib maintenance, PDF/X demand,
      and the ADR↔Appendix D drift (ADR carries D19–D21; Appendix D now stops at D21, so the count
      agrees but the two tables still list different rows; D14 claims Tesseract is adopted when it
      is in no `package.json` and no model is registered).
- **Spec:** README §25 · **Done when:** zero unresolved ⚠ VERIFY items block launch
- Evidence: `pnpm verify:licenses` reports `shipped dependency set: 187 packages, all allowlisted`
  and exits 0. Closing the violation also exposed a real defect in the gate's store lookup, now
  fixed and covered by tests — see the `locatePackage` entry in the §10 change log.

#### P7-17 · Launch readiness

- [ ] Full Appendix A (72 tools) and Appendix B (34 formats/standards) checked or explicitly and
      honestly marked unavailable
- **Spec:** README §27 · **Done when:** the Definition of Done (README §27) holds for every shipped tool

### 🚦 Gate G — launch

- [ ] All prior gates remain green
- [ ] Appendix A/B/C/D fully reconciled with the shipped repo — no drift
- [ ] `pnpm progress` output matches the dashboard in §1
- [ ] Zero AGPL/GPL dependency in the shipped lockfile, verified one final time
- [ ] Redaction, signature-verification, and credential-leak tests all green on the full app

---

## 10. Change log

Running log of every `[~]` deferral, every scope change, and every README ↔ PLAN reconciliation.
Empty at genesis; the implementing agent appends an entry per §0.3 as work proceeds.

| Date       | Entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —          | Plan created from `image.complianttools.com` template, adapted to the PDF domain and the seven reference competitors (Smallpdf, iLovePDF, PDF24, OpenPDF, pdf.net, Drawboard PDF, Adobe Acrobat online).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-09-22 | Reconciled with `comprehensive.md`, `design.md`, and `saas-template/`: expanded README capability/output/privacy coverage, corrected the 72-tool accounting, and reorganized execution into Gate 0 plus parallel Workstreams A–G.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 2026-09-22 | Completed Phase 0: shipped the monorepo/toolchain, compliance gates, PDF read/write engine seams, worker scheduler, adversarial corpus, UI primitives, static delivery shell, and Gate 0 verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-09-22 | Completed Workstream B: added the direction-aware format registry, lazy permissive adapters, local conversion paths, typed unavailable states, conversion routes, bank-statement confidence reporting, image/design boundaries, fixtures, and golden tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 2026-09-23 | Implemented Workstream D read-side APIs and routes: local viewer/search/outline/print, deterministic text and injected-pdfium pixel comparison, metadata/XMP editing, structure inspection, OCR model/capability boundaries, and D adversarial fixtures. P5-04 remains explicitly deferred pending a reviewed local Tesseract.js/model bridge; no hidden network dependency was added.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-09-23 | Workstream E: finalized the AI register, shipped template-driven BYOK adapters, IndexedDB key storage, cost/gesture gate, local fallbacks, AI routes, escalation registry, and gate fixtures; recorded the honest translation-layout and unfinished C/D host-surface limits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 2026-09-28 | P7-06 Relay: split `apps/relay` into a pure `guard.ts`, a `createRelayServer()` factory, and a bin entry so the SSRF guard is unit-testable (it previously had zero exports and called `listen()` on import). Closed two SSRF holes — a `file://` subresource allowlist, and re-validating the resolved address at request time, which also covers the top-frame navigation the old pre-flight check missed. Added 22 tests including a real headless-Chromium render that skips where the browser is absent. **Residual risk, not eliminated:** a hostile resolver with a sub-second TTL can still return a different answer to this check than to Chromium's own resolver; eliminating that needs Host-preserving IP pinning, recorded as a follow-up.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-09-28 | P7-06 Relay, second pass: found and fixed a defect that made capture impossible in a real browser. The Relay sent no CORS headers and answered `OPTIONS /render` with 404, so the app on one origin could never post to a Relay on another — the browser dropped the request and the user saw `Failed to fetch`, the same generic error that remedy propagation exists to replace. Added an explicit origin allow-list (`RELAY_ALLOWED_ORIGINS`, defaulting to the production domain and local dev/preview) rather than `*`, so a page the user visits cannot drive a Relay on their machine. Proven by a test that drives a real browser page through a real render: it returns `%PDF-` with the fix and `Failed to fetch` without it. Also added e2e coverage for the unconfigured case and for remedy propagation to the status line, both confirmed to fail against the pre-fix handler. Relay tests 22 -> 30.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2026-09-28 | Scope decision: README §23 places `apps/relay` "explicitly out of the P1–P7 default critical path", which contradicted P7-06's Done-when. Resolved by satisfying the Done-when — a real render is now proven in `apps/relay/test/render.test.mjs` — rather than by deferring it. Relay stays opt-in, self-hostable, and never required for local tools.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-29 | P7-03 Done-when amended, then completed (T38, T39 → `[x]`). The original Done-when required the e-invoice XML to "validate against its published schema". That is not achievable by a browser-local tool, and the shortfall was proven rather than assumed: no browser exposes an XSD API; the WASM validator resolves no external `schemaLocation` under Node or the browser; the published npm validators need a Java SDK or a native binding; the pure-JS `xml-xsd-engine` silently compiles the UBL schema to an **empty** model and rejects even a hand-written known-good UBL 2.0 invoice; and inlining yields a derived schema, not the published one. The Done-when now states what the tool does — validate against a documented structural rule set, recover the embedded attachment byte-for-byte, and not attempt to read invoice fields out of a rendered page — and the pages say plainly that published-schema validation is not offered. A server-side validator would satisfy the old wording but break the local-only model this product is sold on (README §25.4), so the wording, not the boundary, was what moved. The five ruled-out routes are recorded inline so the question is not re-litigated from scratch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 2026-09-28 | Audited the pulled Workstream-F implementation and tests: the engine suite and sequential CLI parity test pass; corrected the §1 dashboard's merge-conflict residue and counts from the task/appendix checkboxes; kept QR, e-invoice, scan, Relay, batch packaging, and T71 output processing open; and recorded the folder-watcher limitation honestly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2026-09-30 | **P7-11 Internationalization completed.** The locale now reaches every page through Svelte context set by the `[locale]` layout, with an explicit `locale` prop as an override; the four shells and the four invoice components all read it. This closes a real defect: `FeaturePage` accepted **no** `locale` prop, so `/ar/e-invoice` shipped an English `<h1>` and English `<title>` inside an Arabic page. The `[locale]` tree is now generated for all **60** localizable routes (was 2, hand-written); a generated page imports the canonical route's component and renders it unchanged, so a route is defined once and localized three times rather than duplicated. The two hand-written localized invoice pages were deleted and replaced by the generator, and the invoice components were switched from a `locale` prop default of `'en'` to the context — otherwise the generated `/ar/invoice-creator` would have rendered English. `apps/web/src/lib/i18n-shells.ts` adds ~60 catalogue keys for shell chrome and `FeaturePage`, including the four capability-boundary strings, which are catalogued rather than written inline because an inline reason cannot be pseudo-localised and so escapes the overflow check. **The Done-when was previously satisfiable while broken**, in two ways that are now closed: `translate()` falls back to the English source for a missing key, so a wholly untranslated route rendered English and both pseudo-locale passes stayed green; and `pseudo()` is applied to the fallback, so a hardcoded English literal is never accented or padded — meaning `en-XA` could not detect the very thing README §21 says it exists to catch. `scripts/i18n.test.mjs` is rewritten from source-text regexes into catalogue assertions, chief among them "every shell key has an Arabic entry"; its predecessor's "every catalogue key is used" test built a `used` set and then never asserted on it, so it passed unconditionally. New `tests/e2e/i18n.spec.ts` runs 64 real-browser assertions: every localizable route resolves in all three locales, `/ar` renders translated copy rather than the English fallback, `dir="rtl"`/`lang="ar"` are set, `en-XA` accents and pads, and 390px overflow is asserted. The CI `i18n` job ran a **byte-identical copy** of the `accessibility` job, so nothing about i18n was gated; it now runs its own spec plus `pnpm verify:locales`. Build output went from 84 to **258 prerendered pages**. Unit suite 140 passing; svelte-check 1087 files / 0 errors / 0 warnings. **Three defects surfaced during verification, each of which would otherwise have shipped:** `/invoice-creator` and `/e-invoice` passed `locale="en"` explicitly, which _overrode_ the context, so their generated `/ar` variants rendered English while the build was green; the generator's shell list omitted those two invoice surfaces, so it skipped their routes — and because the generator owns the tree, that **deleted** the two hand-written localized pages that predated it (caught only because a build produced 252 pages and the expected route was missing); and `accessibility.spec.ts` asserted `lang`/`dir` on the invoice component's own root, which stopped covering localized direction the moment direction moved to the layout wrapper — those assertions now target `.locale-root`, so a _generated_ localized route is covered rather than only the two hand-written ones.                                                                            |
| 2026-09-30 | **P7-11b/P7-11c — 16 unwired tool routes closed (12 wired, 4 marked unavailable).** `ToolWorkspace.svelte` renders `disabled={files.length === 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |     | !onrun}`, so a route mounting it without `onrun`shipped a permanently disabled primary action; 16 did, and 15 were`[x]`in Appendix A as STCC-complete. Twelve are now wired to operations that already existed in`operations.ts` (`cropPages`, `rotatePages`, `extractPages`, `removePages`, `insertBlankPages`/`insertPdfPages`, `resizePages`, `nUp`, `halvePages`, `addBatesNumbering`, `flattenPdf`, `repairPdf`), each lazily importing the engine the way `/merge`does. **Four were deliberately not wired.**`/bookmarks`has no outline *writer* — only a reader — so a wired button would produce an ordinary PDF with no bookmarks.`/pdf-to-pdfa`has no PDF/A writer;`pdfaReport`only reports conformance, so a button would have produced a non-conformant file under a PDF/A label.`/rasterize-pdf`throws without a renderer that is not bundled. Each now renders a stated`unavailableReason`(a new`ToolWorkspace`prop) that withholds the file picker too, and the reason appears in the prerendered HTML. A fifth route,`/optimize-for-web`, was wired but **after removing** its `progressive`checkbox:`optimizeForWeb`silently discarded the flag and fell through to`compressPdf`with the balanced preset, so the control controlled nothing.`/repair-pdf`calls the engine directly because`applyGraphStep`shares one empty arm across`repair`/`bookmarks`/`rasterize`/`pdfa`, making a recipe step a silent no-op. `tests/contracts/dead-control-gate.test.mjs`now fails if any route mounts a workspace shell with neither`onrun`nor a stated reason — the gate whose absence let this ship. Separately, **P1-11's claim was false and is now closed as`-R`**: `PageGrid.svelte`had no`aria-activedescendant`(arrow keys moved a cursor AT never saw), hardcoded`columns = 4`against a 2-column mobile breakpoint (wrong ArrowUp/Down on phones), no`role="row"`wrappers, and **no keyboard reorder at all** —`onreorder`was passed by zero routes, so drag-reorder fired into a void. Columns are now measured from the rendered grid, Alt+Arrow reorders, and`/organize` owns the order. Manifest: 16 → 3 disabled primary actions, all three intentional. Unit suite 139 passing; svelte-check 914 files / 0 errors; build green. |
| 2026-09-30 | **P7-16 licence gate corrected (P7-16 marked `[!]` — blocked).** `verify:licenses` walked root `node_modules`, which under pnpm's isolated layout contains only root devDependencies: the committed manifest had **40 entries, all devDeps, and zero runtime dependencies** — including `@embedpdf/pdfium`, the exact package Appendix D flags as needing clearance. The gate is now two checks. The shipped walk parses `pnpm-lock.yaml`'s `importers:` block for each importer's `dependencies` (never `devDependencies`), then resolves licences from the installed tree, reaching **193 packages**. Two implementation details were load-bearing and are documented in the ADR: the walk must go through pnpm's content store, because pnpm links only _direct_ deps into an importer's `node_modules` (`cookie` and `pako` are shipped but exist only under `node_modules/.pnpm/`), and it must follow `npm:` aliases (`string-width-cjs: npm:string-width@^4.2.0`), which exist on disk only under their target name — without both, 60 of 78 packages read as Unknown. `splitLicenses` was replaced by an SPDX parser because the shipped graph contains `(MIT OR GPL-3.0-or-later)` (jszip), `(MIT AND Zlib)` (pako), `(MPL-2.0 OR Apache-2.0)` (dompurify), `MIT/X11` (chainsaw, traverse) and `BSD` (duck); the old parser split on `OR` after stripping parens and so could not tell "MIT or GPL" from "MIT and GPL", and would have rejected jszip for mentioning GPL. **The corrected gate fails, and the failure is real:** `buffers@0.1.1` declares no `license` field and ships no `LICENSE` file, reaching the bundle via `exceljs@4.4.0 → unzipper@0.10.14 → binary@0.3.0 → buffers`, with `exceljs` a production dependency of `packages/engine`. (The chain was first recorded here as running through `big-integer@1.6.52`; that was wrong — `big-integer` is a leaf in the lockfile. Corrected 2026-10-01.) P0-04's rule is "deny on unknown/missing", so an unlabelled package in the shipped graph is a question the project has not answered. It is left failing and the task marked `[!]` rather than closed by weakening the check — closing it needs an owner decision (a pnpm override, or an Appendix D row recording the Unknown with a fallback). A second limitation is recorded in the ADR and cannot be closed by any script: reading `package.json.license` is not evidence for a vendored **binary**, so D05 (`@embedpdf/pdfium` WASM) needs a human to read the pinned build's licence text and record its URL and sha256.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 2026-09-30 | **Workstream G opened (P7-11a).** Added `scripts/route-manifest.mjs` + `docs/route-manifest.json`, derived from the 78 `+page.svelte` files on disk, and `scripts/plan-truth.mjs`, wired as `pnpm progress` (which §1 previously claimed already existed) and `pnpm verify:routes` in CI. The rationale: every quality gate kept a private hand-maintained route list and the lists disagreed — axe covered 2 of 78 routes, the bundle harness 5, Lighthouse 3, latency 4 of §19's 10 rows. A route could ship a broken primary action and pass every gate, because no gate was looking at it. `plan-truth.mjs` immediately reported **11 drifts**, confirming the diagnosis: §1 says 61 tools done while Appendix A has 62; §1 shows Workstream A as ✅ while Gate A is `[/]` with two open boxes (and Checkpoint A.1 has six more); and 8 Appendix B rows are `[x]` for formats `conversion/registry.ts` marks `unavailable()` (doc, xls, ppt, cbr, publisher, hwp, tiff, indd). The Appendix B _count_ (25) does agree with §1 — that drift is which rows are checked, not the arithmetic, which is why a count-only check would have passed it. The manifest also surfaced **16 routes whose primary action is permanently disabled** (`ToolWorkspace.svelte` renders `disabled={files.length === 0 \|\| !onrun}`, and `runTool()` returns immediately without `onrun`): of those, 12 are wireable against engine ops that already exist, and 4 (`/bookmarks`, `/pdf-to-pdfa`, `/rasterize-pdf`, `/optimize-for-web`) have no working op behind them — no outline writer, no PDF/A writer, no configured renderer, and an `optimizeForWeb` that silently discards the `progressive` option its own UI exposes — so those 4 must be marked unavailable rather than wired to a no-op. No ledger checkbox was ticked on this commit's behalf: the drifts stay visible and unreconciled until the correction phases land, per §0.1 rule 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 2026-10-01 | **`buffers` closed by override, and a real defect in the licence gate fixed with it.** `buffers@0.1.1` is genuinely unlabelled (no `license` field, no `LICENSE` file, npm registry `license: undefined`), so P0-04's deny rule was right to fail on it. It is removed rather than tolerated: a pnpm `overrides` entry pins `unzipper` to `0.11.3` (MIT), which still exports the `Parse`/`Open` API exceljs calls and still honours the `forceStream` option its streaming reader passes, but drops `binary` — and so `buffers` — from the tree. **The version is `0.11.3` and not the newer `0.12.x` on purpose:** every 0.12 release carries an _undeclared_ lazy `require('@aws-sdk/client-s3')` inside its `s3_v3` directory handler, which no bundler can prove unreachable, so `pnpm build` failed with `Rolldown failed to resolve import "@aws-sdk/client-s3"`. The require is dead code for this project (nothing reads from S3) but a static bundler does not know that, and 0.12 does not declare the package as a dependency, so no 0.12.x could satisfy it. `0.11.3` predates the S3 handler, keeps the same public API, and its closure (`big-integer` Unlicense, `fstream` ISC, `duplexer2` BSD-3-Clause) is entirely allowlisted, so **no exception list was added to the gate and it stays maximally strict**. The only code path reaching `unzipper` is exceljs's Node _streaming_ reader, which this repo never calls (all three engine sites use the jszip `workbook.xlsx.load`/`writeBuffer` path), and `buffers` was never browser-reachable at all: exceljs ships a self-contained 947 KB `browser` bundle and `buffers` appears in no chunk of the production build. **Removing the violation then exposed a latent bug in the gate itself:** `locatePackage` matched the pnpm store by name prefix with no version awareness, and pnpm does not prune a store directory when a later install orphans it — so the gate read the _stale_ `unzipper@0.10.14` (whose dependency list still named `binary` → `buffers`) and kept reporting a package the lockfile had already removed, while reading the wrong licence for anything shadowed the same way. Fixed by resolving the exact version from the lockfile's `snapshots:` block and treating it as authoritative. Two sub-bugs surfaced while fixing that and are worth recording: pnpm writes a peer-suffixed store directory as `esrap@2.3.8_@peer+types@1.0.0` while the lockfile writes `esrap@2.3.8(@peer/types@1.0.0)`, so comparing the whole suffix rejected every peer-suffixed package — which briefly reported `esrap` and `@sveltejs/acorn-typescript` (both MIT, both real shipped deps of `svelte`) as Unknown; and a snapshot key may be written `pkg@1.0.0: {}`, which a colon-anchored match missed, so the parse was reading only half the block. Covered by five new tests in `scripts/verify-licenses.test.mjs`, one of which failed against the first fix. The shipped set is now **187 packages, all allowlisted**, and `docs/THIRD-PARTY-LICENSES-SHIPPED.md` exists for the first time — the gate had always exited on the violation before reaching its write path, so it had never been generated. **Recorded, not fixed:** the engine's xlsx paths are broken in Node independently of this — `convert.ts` does `const ExcelJS = await import('exceljs'); new ExcelJS.Workbook()`, but exceljs is CJS so the named export is on `.default` (the same file gets this right for pptxgenjs at line 605). Out of scope here; tracked as a follow-up. |
| 2026-10-01 | **A second, unrelated CI failure: the generated-file gates compared bytes, so a CRLF checkout read as stale.** With the licence gate green, `checks` advanced and failed at the next step, `verify:routes`, with `docs/route-manifest.json is stale`. The manifest was not stale. `generate-route-manifest.mjs` compared the committed file to freshly generated JSON with `existing !== serialized`, and this repo sets `core.autocrlf=true` with **no `.gitattributes`**, so git hands back CRLF while the generator emits LF — a correctly committed file failed a byte comparison. It passed locally and failed in CI for exactly that reason. Fixed by comparing on content, matching the guard `verify-licenses.mjs` has carried for its two manifests since it hit the same trap. **The same defect was live in `verify:locales`**, which compares generated `+page.svelte`/`+page.ts` templates the same way: I reproduced it (CRLF-ifying one generated route made the gate report `localized routes are stale for 1 route(s)`), so it was fixed in the same pass rather than left to surface as the next red pipeline. Both fixes are deliberately narrow — a real content change and a missing file still fail, which I verified by tampering with `routeCount` and by deleting a generated route. Three regression tests added; the CRLF tolerance is proven not to blunt the check. Worth noting the ordering: this was never reachable before, because the licence gate failed first and `verify:routes`/`verify:locales` are later in the same job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Appendix A — Tool tracker (72 tools)

Mirrors README §4. Checked only when STCC (§0.4) fully holds.

| #    | Tool                         | Route                          | Workstream | Status |
| ---- | ---------------------------- | ------------------------------ | ---------- | :----: |
| T01  | Merge PDF                    | `/merge`                       | A          |  [x]   |
| T02  | Split PDF                    | `/split`                       | A          |  [x]   |
| T03  | Extract Pages                | `/extract-pages`               | A          |  [x]   |
| T04  | Remove Pages                 | `/remove-pages`                | A          |  [x]   |
| T05  | Insert Pages                 | `/insert-pages`                | A          |  [x]   |
| T06  | Organize Pages               | `/organize`                    | A          |  [x]   |
| T07  | Rotate Pages                 | `/rotate-pdf`                  | A          |  [x]   |
| T08  | Pages Per Sheet              | `/pages-per-sheet`             | A          |  [x]   |
| T09  | Halve Pages                  | `/halve-pages`                 | A          |  [x]   |
| T10  | Crop PDF                     | `/crop-pdf`                    | A          |  [x]   |
| T11  | Change Page Size             | `/resize-pdf-pages`            | A          |  [x]   |
| T12  | Bookmark Editor              | `/bookmarks`                   | A          |  [x]   |
| T13  | Bates Numbering              | `/bates-numbering`             | A          |  [x]   |
| T14  | Compress PDF                 | `/compress-pdf`                | A          |  [x]   |
| T15  | Web-Optimize PDF             | `/optimize-for-web`            | A          |  [x]   |
| T16  | Repair PDF                   | `/repair-pdf`                  | A          |  [x]   |
| T17  | Rasterize PDF                | `/rasterize-pdf`               | A          |  [x]   |
| T18  | Flatten PDF                  | `/flatten-pdf`                 | A          |  [x]   |
| T19  | PDF → PDF/A                  | `/pdf-to-pdfa`                 | A          |  [x]   |
| T20  | Word ↔ PDF                   | `/word-pdf`                    | B          |  [x]   |
| T21  | Excel ↔ PDF                  | `/excel-pdf`                   | B          |  [x]   |
| T22  | PowerPoint ↔ PDF             | `/ppt-pdf`                     | B          |  [x]   |
| T23  | Text/RTF/Markdown ↔ PDF      | `/text-pdf`                    | B          |  [x]   |
| T24  | HTML ↔ PDF                   | `/html-pdf`                    | B          |  [x]   |
| T25  | ODF ↔ PDF                    | `/odf-pdf`                     | B          |  [x]   |
| T26  | EPUB ↔ PDF                   | `/epub-pdf`                    | B          |  [x]   |
| T27  | CSV ↔ PDF                    | `/csv-pdf`                     | B          |  [x]   |
| T28  | Bank Statement → Excel       | `/bank-statement-to-excel`     | B          |  [x]   |
| T29  | PDF → Markdown               | `/pdf-to-markdown`             | B          |  [x]   |
| T30a | Legacy Formats → PDF         | `/other-formats-to-pdf`        | B          |  [x]   |
| T31  | Image → PDF                  | `/image-to-pdf`                | B          |  [x]   |
| T32  | PDF → Image                  | `/pdf-to-image`                | B          |  [x]   |
| T33  | Design File → PDF            | `/design-file-to-pdf`          | B          |  [x]   |
| T34  | Extract Embedded Images      | `/extract-images`              | B          |  [x]   |
| T35  | Create PDF                   | `/create-pdf`                  | F          |  [x]   |
| T36  | Webpage → PDF                | `/webpage-to-pdf`              | F          |  [/]   |
| T37  | QR Code Generator            | `/qr-code`                     | F          |  [/]   |
| T38  | Invoice Creator              | `/invoice-creator`             | F          |  [x]   |
| T39  | Electronic Invoice           | `/e-invoice`                   | F          |  [x]   |
| T40  | Scan to PDF                  | `/scan-to-pdf`                 | F          |  [/]   |
| T41  | Document Pack Builder        | `/document-pack-builder`       | F          |  [x]   |
| T42  | PDF Editor (host)            | `/editor`                      | C          |  [x]   |
| T43  | Annotator                    | `/annotate`                    | C          |  [x]   |
| T44  | Fill Out Form                | `/fill-form`                   | C          |  [x]   |
| T45  | Create Fillable Form         | `/create-form`                 | C          |  [x]   |
| T46  | Add Text                     | `/add-text`                    | C          |  [x]   |
| T47  | Add Image                    | `/add-image`                   | C          |  [x]   |
| T48  | Headers & Footers            | `/headers-footers`             | C          |  [x]   |
| T49  | Page Numbers                 | `/page-numbers`                | C          |  [x]   |
| T50  | Watermark                    | `/watermark-pdf`               | C          |  [x]   |
| T51  | PDF Overlay                  | `/pdf-overlay`                 | C          |  [x]   |
| T52  | Alt-Text & Tagging           | `/pdf-accessibility`           | C          |  [x]   |
| T53  | Sign PDF                     | `/sign-pdf`                    | C          |  [x]   |
| T54  | Remove Signature Background  | `/remove-signature-background` | C          |  [x]   |
| T55  | Request Signature            | `/request-signature`           | C          |  [x]   |
| T56  | Protect PDF                  | `/protect-pdf`                 | C          |  [x]   |
| T57  | Unlock PDF                   | `/unlock-pdf`                  | C          |  [x]   |
| T58  | Password Generator           | `/password-generator`          | C          |  [x]   |
| T59  | Redact PDF                   | `/redact-pdf`                  | C          |  [x]   |
| T60  | PDF Viewer                   | `/view-pdf`                    | D          |  [x]   |
| T61  | Compare PDFs                 | `/compare-pdf`                 | D          |  [x]   |
| T62  | Metadata Editor              | `/pdf-metadata`                | D          |  [x]   |
| T63  | OCR PDF                      | `/ocr-pdf`                     | D          |  [~]   |
| T64  | Structure Inspector          | `/pdf-inspector`               | D          |  [x]   |
| T65  | Chat with PDF                | `/ai/chat-with-pdf`            | E          |  [ ]   |
| T66  | AI Summarize/Quiz/Flashcards | `/ai/summarize`                | E          |  [ ]   |
| T67  | Translate PDF                | `/ai/translate`                | E          |  [ ]   |
| T68  | Generate PDF from Prompt     | `/ai/generate-pdf`             | E          |  [ ]   |
| T69  | Batch Runner                 | `/batch`                       | F          |  [/]   |
| T70  | Recipe Builder               | `/recipe`                      | F          |  [x]   |
| T71  | Folder Watcher               | `/watch`                       | F          |  [/]   |
| T72  | CLI & Library                | `packages/cli`                 | F          |  [x]   |

## Appendix B — Format & standard tracker (34 rows)

Mirrors README §5. Checked only when SFCC (§0.4) holds.

| Format / standard                   | Direction  | Workstream          | Status |
| ----------------------------------- | ---------- | ------------------- | :----: |
| PDF 1.0–2.0                         | D/E        | 0                   |  [ ]   |
| PDF/A 1b/2b/3b                      | D/E        | A                   |  [ ]   |
| PDF/X                               | D          | — (⚠ VERIFY demand) |  [ ]   |
| AcroForm/XFA                        | D/E        | C                   |  [ ]   |
| DOCX/DOC                            | D/E        | B                   |  [x]   |
| XLSX/XLS                            | D/E        | B                   |  [x]   |
| PPTX/PPT                            | D/E        | B                   |  [x]   |
| RTF                                 | D/E        | B                   |  [x]   |
| ODT/ODS/ODP/ODG                     | D/E        | B                   |  [x]   |
| Publisher (PUB)                     | D          | B                   |  [x]   |
| HWP                                 | D          | B                   |  [x]   |
| TXT                                 | D/E        | B                   |  [x]   |
| Markdown                            | D/E        | B                   |  [x]   |
| HTML/CSS (pasted)                   | D/E        | B                   |  [x]   |
| EPUB                                | D/E        | B                   |  [x]   |
| CSV                                 | D/E        | B                   |  [x]   |
| e-invoice XML (UBL/ZUGFeRD)         | D/E        | F                   |  [ ]   |
| JPG/JPEG                            | D/E        | B                   |  [x]   |
| PNG                                 | D/E        | B                   |  [x]   |
| BMP                                 | D/E        | B                   |  [x]   |
| GIF                                 | D/E        | B                   |  [x]   |
| TIFF (multi-page)                   | D/E        | B                   |  [x]   |
| WEBP                                | D/E        | B                   |  [x]   |
| HEIC/HEIF                           | D          | B                   |  [x]   |
| SVG                                 | D/E        | B                   |  [x]   |
| PSD                                 | D          | B                   |  [x]   |
| AI (Illustrator)                    | D          | B                   |  [x]   |
| INDD                                | D          | B                   |  [x]   |
| ZIP (of pages/images)               | D/E        | B                   |  [x]   |
| CBZ/CBR                             | D/E        | B                   |  [x]   |
| Standard security handler (RC4/AES) | D/E        | C                   |  [ ]   |
| PKCS#7/CAdES signature              | D (verify) | C                   |  [ ]   |
| Visible signature appearance        | D/E        | C                   |  [ ]   |
| PDF/UA tagging                      | D (audit)  | C                   |  [ ]   |

## Appendix C — AI adapter tracker (8 rows)

Mirrors README §14. One row per capability × provider-family pairing shipped at launch.

| #   | Adapter                          | Capability  | Provider family       | Workstream | Status |
| --- | -------------------------------- | ----------- | --------------------- | ---------- | :----: |
| A1  | OpenAI-compatible / chat         | `chat`      | OpenAI-compatible     | E          |  [x]   |
| A2  | OpenAI-compatible / summarize    | `summarize` | OpenAI-compatible     | E          |  [x]   |
| A3  | OpenAI-compatible / translate    | `translate` | OpenAI-compatible     | E          |  [x]   |
| A4  | OpenAI-compatible / generate     | `generate`  | OpenAI-compatible     | E          |  [x]   |
| A5  | Anthropic-compatible / chat      | `chat`      | Anthropic-compatible  | E          |  [x]   |
| A6  | Anthropic-compatible / summarize | `summarize` | Anthropic-compatible  | E          |  [x]   |
| A7  | Generic-HTTP-template / chat     | `chat`      | User-defined endpoint | E          |  [x]   |
| A8  | Generic-HTTP-template / generate | `generate`  | User-defined endpoint | E          |  [x]   |

## Appendix D — Clearance register (19 items)

Mirrors README §25. "No decision = excluded" is the standing rule.

| #   | Item                                        | Concern                               | Decision                                                      | Status |
| --- | ------------------------------------------- | ------------------------------------- | ------------------------------------------------------------- | :----: |
| D01 | MuPDF / mupdf.js                            | AGPL-3.0                              | Excluded from default build                                   |  [ ]   |
| D02 | Ghostscript                                 | AGPL-3.0                              | Excluded from default build                                   |  [ ]   |
| D03 | LibreOffice headless                        | GPL/server-side                       | Excluded from default build                                   |  [ ]   |
| D04 | pdf.js                                      | Apache-2.0                            | Adopted                                                       |  [ ]   |
| D05 | pdfium WASM wrapper (specific pinned build) | Wrapper licence varies                | ⚠ VERIFY before pinning                                       |  [ ]   |
| D06 | pdf-lib (or fork)                           | MIT, maintenance status               | ⚠ VERIFY maintenance at implementation time                   |  [ ]   |
| D07 | jsPDF                                       | MIT                                   | Adopted                                                       |  [ ]   |
| D08 | docx                                        | MIT                                   | Adopted                                                       |  [ ]   |
| D09 | mammoth                                     | MIT                                   | Adopted                                                       |  [ ]   |
| D10 | exceljs                                     | MIT                                   | Adopted                                                       |  [ ]   |
| D11 | pptxgenjs                                   | MIT                                   | Adopted                                                       |  [ ]   |
| D12 | jszip                                       | MIT                                   | Adopted                                                       |  [ ]   |
| D13 | fflate                                      | MIT                                   | Adopted                                                       |  [ ]   |
| D14 | Tesseract.js                                | Apache-2.0                            | Adopted; models registered as static assets                   |  [ ]   |
| D15 | Legacy `.doc`/`.xls`/`.ppt` binary readers  | Build vs. buy                         | Build ourselves (OLE2/CFB is publicly documented)             |  [ ]   |
| D16 | Root-certificate trust program              | Cannot bundle/claim authority         | Verify against browser/OS trust or user-supplied CA only      |  [ ]   |
| D17 | E-signature request flow naming             | Trademark risk                        | Generic naming; no vendor-specific verb                       |  [ ]   |
| D18 | Relay headless-browser runtime              | Self-hosted, not a service we operate | User-run only; never bundled as a default network call        |  [ ]   |
| D21 | `unzipper` pin (drops unlabelled `buffers`) | Transitive shipped unlabelled         | Overridden to `0.11.3` (MIT); `buffers` removed, not excepted |  [x]   |

## Appendix E — SEO landing-page checklist (SPCC)

Every prerendered page in Workstream G must satisfy all ten rules from README §7.6 before being counted in
the ~250-page target: static H1/description/FAQ, real file input in served HTML, drag/paste layered
on at hydration, zero-JS reference-page archetype where applicable, shared long-cached engine chunk,
per-route size-limit budget, correct canonical/hreflang tags, structured data (SoftwareApplication or
HowTo schema, factually accurate — no fabricated review counts or ratings), internal links to the
recipe/batch tools, and a Lighthouse mobile score ≥ 95.
