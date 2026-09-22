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

| Workstream | Focus                                                | Tasks  | Done  | Gate |
| ---------- | ---------------------------------------------------- | :----: | :---: | :--: |
| 0          | Bootstrap, shared contracts, toolchain, IP clearance |   16   |  16   |  ✅  |
| A          | Core pipeline + organize/optimize/repair             |   20   |   0   |  ⬜  |
| B          | Conversion breadth and format fixtures               |   14   |   0   |  ⬜  |
| C          | Edit, annotate, forms, sign, protect, redact         |   12   |   0   |  ⬜  |
| D          | View, compare, inspect, metadata, OCR                |   5    |   0   |  ⬜  |
| E          | BYOK platform, AI escalation, document intelligence  |   11   |   0   |  ⬜  |
| F          | Create, Relay, batch/recipe/CLI/library              |   10   |   0   |  ⬜  |
| G          | Cross-workstream hardening and launch convergence    |   7    |   0   |  ⬜  |
| —          | **Total**                                            | **95** | **0** |      |

| Artefact                         | Target | Done |
| -------------------------------- | :----: | :--: |
| Tools (Appendix A)               |   72   |  0   |
| Formats & standards (Appendix B) |   34   |  0   |
| AI adapters (Appendix C)         |   8    |  0   |
| Clearance items (Appendix D)     |   18   |  0   |
| Prerendered pages                |  ~250  |  0   |

`pnpm progress` (mirrors `image.complianttools.com`'s `scripts/plan-progress.mjs`) derives the Tools
and Formats counts from the actual Appendix A/B checkboxes.

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

- [ ] `compile(recipe, inputMeta) → Plan`; `run()` with progress + cancellation; `preview()`
- **Spec:** README §8.2, §10 · **Done when:** a 3-step recipe runs in a worker with typed progress

#### P1-02 · Single-graph mutation discipline

- [ ] One `PDFDocument` handle per pipeline run; all mutations applied before the single final
      serialization
- [ ] Property test: order-independent ops (e.g. rotate then watermark vs. watermark then rotate on
      disjoint pages) produce equivalent results
- **Spec:** README §8.3 · **Done when:** the property test passes over 200 generated recipes

#### P1-03 · Memory governor

- [ ] Peak-byte projection from page count × average page complexity; degrade order: reduce
      concurrency → stream page-by-page → refuse with a specific message naming the largest workable
      document size
- **Spec:** README §8.4, §19 · **Done when:** a 2,000-page synthetic PDF either completes or refuses
  with a useful message, never OOMs silently

#### P1-04 · Proxy / preview split

- [ ] Proxy renders current page only, at screen resolution, via pdfium
- [ ] Property test: exported page downscaled matches proxy preview within tolerance
- **Spec:** README §8.5 · **Done when:** the fidelity property test passes

#### P1-05 · Merge op (T01)

- [ ] File reordering, per-file page-range selection, bookmark-preserve/flatten/none strategy
- [ ] Property test: merging a file with itself twice produces double the page count, byte-valid
- **Spec:** README §6.1 · **Done when:** the property test passes and STCC is met

#### P1-06 · Split op (T02)

- [ ] By ranges, by fixed count, by bookmark level, by max output size
- [ ] Property test: split-then-merge round-trips to the original page count
- **Spec:** README §4.1 · **Done when:** the round-trip property test passes

#### P1-07 · Compress op (T14)

- [ ] 3 presets + custom slider; image re-encode, font subsetting, unused-object removal
- [ ] Live predicted output size within 250 ms of a slider change
- **Spec:** README §6.2, §19 · **Done when:** measured update latency ≤ 250 ms on a 20 MB fixture

#### P1-08 · Export options surface

- [ ] Every §6 option for these three tools implemented and schema-validated
- [ ] **All defaults are no-ops** — property test on a re-save with default options asserts the page
      content is unchanged (metadata/xref bytes may differ; rendered content must not)
- **Spec:** README §6, P9 · **Done when:** the no-op property test passes

#### P1-09 · Recipe serialization + migration

- [ ] `serializeRecipe`/`parseRecipe` — URL-fragment, deflate, base64url, `r1.` version prefix
- [ ] Documents are **never** encoded into the link — only step parameters
- **Spec:** README §18 · **Done when:** round-trip property passes for arbitrary valid recipes

#### P1-10 · Generated option controls

- [ ] Generator implementing every §11/§10.2 rule; `advanced` options behind disclosure
- **Spec:** README §10.2, §11 · **Done when:** all A.1 options render with zero hand-written controls

#### P1-11 · Page-thumbnail grid component

- [ ] Virtualized, drag-reorder, multi-select, keyboard-navigable
- **Spec:** README §11.2 · **Done when:** scroll stays at 60 fps on a 500-page synthetic fixture

#### P1-12 · First three tools shipped

- [ ] **T01** Merge PDF `/merge` — STCC
- [ ] **T02** Split PDF `/split` — STCC
- [ ] **T14** Compress PDF `/compress-pdf` — STCC
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

- [ ] Shared thumbnail-grid host for all four; range/pattern selectors (`odd`/`even`/`blank`)
- **Spec:** README §4.1 · **Done when:** STCC for each

#### P2-02 · Rotate, N-up, halve (T07–T09)

- [ ] Rotate: per-page/all, auto-rotate-from-content-orientation (text-baseline heuristic)
- [ ] N-up imposition math (**ours**) — 2/4/6/9-up with booklet-aware ordering
- [ ] Halve — oversized-page-split, tested against A3→2×A4 fixtures
- **Spec:** README §4.1 · **Done when:** STCC for each; N-up output validated against a hand-checked
  fixture layout

#### P2-03 · Crop, resize pages, bookmarks (T10–T12)

- [ ] Crop: visual handles + numeric margins, per-page or uniform
- [ ] Change page size: scale-to-fit vs. crop-to-fit modes
- [ ] Bookmark editor: add/edit/remove/nest, page-target picker
- **Spec:** README §4.1 · **Done when:** STCC for each

#### P2-04 · Bates numbering (T13)

- [ ] Prefix/suffix, zero-padding, starting number, position — **ours**, no external dependency
- **Spec:** README §6 · **Done when:** STCC; a 500-page batch numbers correctly and sequentially

#### P2-05 · Web-optimize, repair, rasterize, flatten (T15–T18)

- [ ] Web-optimize: linearize + progressive image re-encode + font subsetting
- [ ] Repair: rebuild xref/object streams from a truncated/corrupt fixture set
- [ ] Rasterize: full-page-to-image flatten, DPI selectable
- [ ] Flatten: bake form fields and/or annotations into content, non-reversible and labelled as such
- **Spec:** README §4.2 · **Done when:** STCC for each; repair recovers ≥ 90% of pages from a
  20-file corrupted corpus

#### P2-06 · PDF → PDF/A with conformance report (T19)

- [ ] Conformance rules engine (**ours**) — font-embed check, colour-profile check, transparency
      check, per PDF/A-1b/2b/3b
- [ ] Report lists every check performed and its result, not a single pass/fail badge (P8)
- **Spec:** README §5.1, §6.8 · **Done when:** the report correctly flags a fixture with an
  unembedded font and correctly passes a fully-compliant fixture

#### P2-07 · Adversarial corpus, Workstream A additions

- [ ] Add page-tree-cycle fixtures, negative page counts, mismatched `/MediaBox`/`/CropBox`
- **Spec:** README §22 · **Done when:** zero crashes, every case typed with a remedy

#### P2-08 · Format & metadata tools shipped

- [ ] T62 Metadata Editor, T64 Structure Inspector — STCC
- **Spec:** README §4.8 · **Done when:** Appendix A rows checked

### 🚦 Gate A — core document runtime

- [ ] Every Workstream-A tool passes STCC
- [ ] Repair recovery rate measured and documented on the corrupted corpus
- [ ] PDF/A conformance report verified against at least one known-good and one known-bad fixture
- [ ] `verify:licenses` still green

---

## 4. Workstream B — Conversion breadth and format fixtures

**Entry:** Gate 0 plus engine types, worker pool, and the format-registry seam. This workstream starts
in parallel with A, C, D, E, and F; it does not wait for A's tool pages.
**Goal:** every format pair in README §5.2–§5.5 either works or is honestly reported unavailable, with
zero copyleft dependency introduced.
**Spec:** README §5, §7.3, §7.5.

#### P3-01 · Office format registry + lazy loading

- [ ] Registry of per-format read/write capability with lazy module loading; download cost disclosed
      before any lazy fetch > 2 MB
- **Spec:** README §7.3 · **Done when:** the UI never offers an unavailable conversion target

#### P3-02 · DOCX/DOC ↔ PDF (T20)

- [ ] `docx` (MIT) for write; `mammoth`-based structure read for DOCX; **our own** OLE2/CFB binary
      reader for legacy `.doc`
- [ ] Layout-preserving reconstruction: columns, tables, headers/footers, footnotes
- **Spec:** README §7.3 · **Done when:** a 5-fixture corpus (simple, multi-column, table-heavy,
  footnoted, header/footer) round-trips with a human-reviewed layout-fidelity pass

#### P3-03 · XLSX/XLS ↔ PDF (T21)

- [ ] `exceljs`; per-sheet page range, fit-to-width, formula-results-only by default
- **Spec:** README §7.3 · **Done when:** STCC; a 20-sheet fixture converts with correct page breaks

#### P3-04 · PPTX/PPT ↔ PDF (T22)

- [ ] `pptxgenjs` for write; **our own** OOXML slide-XML reader for PPTX read
- **Spec:** README §7.3 · **Done when:** STCC; slide order and text content verified on a 10-slide
  fixture

#### P3-05 · Text/RTF/Markdown ↔ PDF (T23)

- [ ] Markdown: headings, lists, tables (GFM), code blocks, round-trip
- **Spec:** README §5.3 · **Done when:** STCC; a Markdown fixture with all four constructs round-trips

#### P3-06 · HTML ↔ PDF, pasted-only (T24)

- [ ] Pasted HTML/CSS → PDF via a sandboxed local render (no live URL fetch — that is T36/Relay)
- **Spec:** README §5.3, §15 · **Done when:** STCC; the route clearly separates "paste HTML" from
  "enter a URL" with the URL path explicitly requiring the Relay

#### P3-07 · ODF suite ↔ PDF (T25)

- [ ] **Our own** ODF-XML reader/writer over `jszip`
- **Spec:** README §7.3 · **Done when:** STCC for ODT/ODS/ODP/ODG

#### P3-08 · EPUB ↔ PDF, CSV ↔ PDF (T26–T27)

- [ ] EPUB: reflow ↔ fixed-layout, TOC-aware
- [ ] CSV: table rendering with column-width heuristics; PDF table → CSV extraction
- **Spec:** README §4.3 · **Done when:** STCC for each

#### P3-09 · Bank-statement → Excel (T28)

- [ ] Table-structure heuristics (**ours**) tuned for ruled and ruleless statement layouts; per-column
      type inference (date/amount/description)
- [ ] Measured against a labelled corpus of anonymized/synthetic statement fixtures; accuracy reported
      honestly, not claimed as universal
- **Spec:** README §4.3 · **Done when:** the accuracy measurement exists and is linked from the route

#### P3-10 · PDF → Markdown, local + escalation (T29)

- [ ] Tier 0–1: structure inference from font size/indentation/ruled lines
- [ ] Tier 3 escalation entry added to the AI Justification Register (README §13.1.3) before any
      adapter code is written
- **Spec:** README §4.3, §13.1.3 · **Done when:** STCC for the local path; escalation gated behind an
  explicit user gesture

#### P3-11 · Legacy/niche formats to PDF (T30a)

- [ ] ZIP/CBZ, Publisher, HWP — best-effort read paths, honest "unsupported" messaging where a
      feature genuinely cannot be built (e.g. PUB write)
- **Spec:** README §5.2 · **Done when:** each has a fixture test or a documented, specific
  unavailable-reason page

#### P3-12 · Image ↔ PDF (T31–T32)

- [ ] JPG/PNG/BMP/GIF/TIFF/WEBP/HEIC (decode-only)/SVG (vector-preserving write) both directions
- [ ] Multi-page TIFF ↔ multi-page PDF
- **Spec:** README §5.4 · **Done when:** STCC for both; SVG write verified vector (not rasterized) on
  a zoom-in visual check

#### P3-13 · Design-file flatten + image extraction (T33–T34)

- [ ] PSD/AI/INDD flattened-composite extraction (no layer re-export claimed)
- [ ] Extract embedded images at original resolution from content streams
- **Spec:** README §5.4 · **Done when:** STCC for each

#### P3-14 · Fixture + golden coverage

- [ ] Every row in README §5.2–§5.5 has an SFCC-passing fixture test or an honest unavailable page
- **Spec:** README §22 · **Done when:** Appendix B fully checked for Workstream B's rows

### 🚦 Gate B — conversion breadth

- [ ] Every §5.2–§5.5 row: passing fixture test, or unavailable with a specific reason surfaced in the UI
- [ ] `verify:licenses` still green — no copyleft dependency introduced
- [ ] DOCX/XLSX/PPTX layout-fidelity fixtures human-reviewed and passing
- [ ] Bank-statement accuracy measurement published

---

## 5. Workstream C — Edit, annotate, forms, sign, protect, and redact

**Entry:** Gate 0 plus the mutation graph, read/render workers, and UI primitives. Form filling and
signature verification use the shared security boundaries but do not wait for conversion breadth.
**Goal:** the full modification surface (README §4.6/§4.7).
**Spec:** README §4.6, §4.7, §6, §16.

#### P4-01 · Editor host + direct text edit (T42)

- [ ] Object model for text runs, embedded-font detection, subsettable-font check before allowing
      in-place edit
- [ ] Falls back to "add a new text box over this" when the font is not embedded/subsettable, with a
      clear explanation (P8) rather than a silent failure
- **Spec:** README §4.6 · **Done when:** STCC; editing text in an embedded-Latin-font fixture
  preserves surrounding layout

#### P4-02 · Annotate (T43)

- [ ] Highlight, underline, strikeout, freehand, sticky note, shapes, arrows, callouts — standard PDF
      annotation objects, not rasterized overlays
- **Spec:** README §4.6 · **Done when:** STCC; annotations open correctly in a third-party reader
  (cross-check with pdf.js AND a manual Acrobat-Reader open)

#### P4-03 · Add text, add image, headers/footers, page numbers (T46–T49)

- [ ] Shared token system (`{page}`, `{total}`, `{date}`) for headers/footers/page-numbers
- **Spec:** README §4.6, §6.3 · **Done when:** STCC for each

#### P4-04 · Watermark, PDF Overlay (T50–T51)

- [ ] Watermark: text/image, opacity, rotation, tiling, page-range scope, behind/in-front-of content
- [ ] PDF Overlay: composite one document's pages onto another's as a stamp layer
- **Spec:** README §6.5 · **Done when:** STCC for each

#### P4-05 · Fillable form creation + filling (T44–T45)

- [ ] AcroForm field types: text, checkbox, radio group, dropdown, date, signature field
- [ ] Fill: detect existing AcroForm fields and render an input overlay
- [ ] Escalation entry for flat/scanned-form field-guessing added to the register **before** any
      adapter code
- **Spec:** README §4.6, §13.1.3 · **Done when:** STCC for the local path on a real AcroForm fixture

#### P4-06 · Alt-text & tagging assistant, local path (T52)

- [ ] Structure-tag audit: heading order, reading order, untagged-image detection
- [ ] AI-authored-description escalation entry added to the register **before** any adapter code
- **Spec:** README §4.6, §13.1.3 · **Done when:** STCC for the audit path

#### P4-07 · Sign PDF + remove signature background (T53–T54)

- [ ] Draw (canvas), type (webfont), upload signature; place/resize/date-stamp
- [ ] Background removal: threshold + flood-fill on an uploaded signature photo → transparent PNG
- **Spec:** README §4.7 · **Done when:** STCC for each

#### P4-08 · Request signature, BYOK (T55)

- [ ] Generates a signable package/link for the user's own email or signing-API key; no signing
      backend operated by us
- **Spec:** README §4.7, §15 · **Done when:** STCC; the route states plainly it requires the user's
  own delivery channel and never claims to send anything itself without one configured

#### P4-09 · Protect, unlock, password generator (T56–T58)

- [ ] AES-256/128, RC4-128-compat; permission flags; **unlock only removes a known password**, never
      brute-forces
- **Spec:** README §5.6, §6.4 · **Done when:** STCC; a test confirms unlock refuses (rather than
  attempts to crack) an unknown password with a clear message

#### P4-10 · Redact PDF, local path + verification (T59)

- [ ] Manual box/text redaction with genuine content-stream removal (not overlay)
- [ ] Verification pass: redacted text is provably absent from `/Contents`, `/StructTree`, and XMP
      after export
- [ ] Regex/preset PII pattern flagging (SSN/email/phone/credit-card) — Tier 0, always runs first
- [ ] AI PII-classification escalation entry added to the register **before** any adapter code
- **Spec:** README §6.6, §13.1.3, §16 · **Done when:** the verification test proves redacted content
  is unrecoverable via text extraction, treated with `credential-leak`-level severity

#### P4-11 · Digital signature verification (read path)

- [ ] PKCS#7/CAdES signature verification against certificates the browser/OS trusts, or a
      user-supplied CA bundle
- [ ] **No root-certificate program bundled** — verified by the trademark/legal grep gate
- **Spec:** README §5.6, §25.3 · **Done when:** a signed fixture verifies correctly and a tampered
  fixture is correctly flagged as invalid

#### P4-12 · Adversarial corpus, Workstream C additions

- [ ] Malformed AcroForm field trees, self-referential annotation objects, oversized signature images
- **Spec:** README §22 · **Done when:** zero crashes, every case typed with a remedy

### 🚦 Gate C — editing and document security

- [ ] Every Workstream-C tool passes STCC
- [ ] Redaction verification test proves unrecoverability
- [ ] Signature verification correctly distinguishes a valid and a tampered fixture
- [ ] No AI adapter code exists yet without a corresponding register entry (checked by grep)

---

## 6. Workstream D — View, compare, inspect, metadata, and OCR

**Entry:** Gate 0 plus read/render workers and text extraction. Viewer, inspection, and OCR can proceed
while A–C build mutation and conversion tools; compare consumes only the read-side diff contract.
**Spec:** README §4.8, §6.7.

#### P5-01 · PDF viewer (T60)

- [ ] Continuous/single-page, zoom, in-document search, outline navigation, print
- **Spec:** README §4.8 · **Done when:** STCC; search correctly highlights matches across a
  100-page fixture

#### P5-02 · Compare PDFs, local path (T61)

- [ ] Text-diff (added/removed/moved) and pixel-diff overlay via pdfium
- [ ] Semantic-diff-summary escalation entry added to the register **before** any adapter code
- **Spec:** README §4.8, §13.1.3 · **Done when:** STCC for the text/pixel-diff path on a fixture pair
  with known, injected changes

#### P5-03 · Metadata editor + structure inspector (T62, T64)

- [ ] Read/write Title/Author/Subject/Keywords/dates/custom XMP; strip-all preset
- [ ] Inspector: page count, size, version, encryption state, font list + embedding status, tag tree
- **Spec:** README §4.8 · **Done when:** STCC for each

#### P5-04 · OCR (T63)

- [ ] Tesseract.js in a worker; pinned model list, disclosed size before download, per-language
- [ ] Output modes: invisible-text-layer, searchable-PDF, plain-text export
- **Spec:** README §6.7, §7.4 · **Done when:** STCC; accuracy measured on a labelled OCR fixture set
  and reported (not claimed universally accurate)

#### P5-05 · Adversarial corpus, Workstream D additions

- [ ] OCR on a blank page, on a rotated scan, on a multi-column scan
- **Spec:** README §22 · **Done when:** each yields a sensible result or a typed, honest limitation

### 🚦 Gate D — read-side document intelligence

- [ ] Every Workstream-D tool passes STCC
- [ ] OCR accuracy measurement published and linked from `/ocr-pdf`
- [ ] Compare correctly detects a known, injected change set

---

## 7. Workstream E — BYOK platform and document intelligence

**Entry:** Gate 0 plus the provider, key-storage, and consent seams. P6-01–P6-05 can start immediately;
P6-06–P6-10 integrate as soon as the local extraction/fallback contracts from B and D exist.
**The most important workstream for keeping the AI Justification Register honest.** Nothing here ships
before its register entry exists (README §13.1.3).
**Spec:** README §13, §14, §15, §16, §17.

#### P6-01 · AI Justification Register finalized

- [ ] All entries from README §13.1.3 (T29, T44, T52, T59, T61 escalations, plus T65–T68) reviewed
      and confirmed necessary — no entry added retroactively to justify code already written
- **Spec:** README §13.1.3 · **Done when:** the register is complete and each row names the specific
  local fallback shown first

#### P6-02 · Provider adapter interface

- [ ] `ProviderAdapter` with `chat`/`summarize`/`translate`/`generate` capabilities
- [ ] OpenAI-compatible, Anthropic-compatible, generic-HTTP-template implementations
- [ ] ⚠ VERIFY each provider's live request/response schema before hardcoding
- **Spec:** README §14 · **Done when:** a mock provider round-trips all four capabilities in tests

#### P6-03 · Key storage

- [ ] `IndexedDB` only, never `localStorage`; never logged; excluded from diagnostic bundles
- [ ] `credential-leak` harness extended to cover every new AI code path
- **Spec:** README §16 · **Done when:** the harness passes on all four AI tools

#### P6-04 · Cost estimation + confirmation gate

- [ ] Token/character estimate shown before every AI call; explicit confirm required
- [ ] UI test asserts no AI request fires without an explicit user gesture (P12)
- **Spec:** README §13 · **Done when:** the gesture-gate test passes for every AI tool

#### P6-05 · "Connect your AI" teaching page

- [ ] `/connect-ai` with provider-specific setup guides
- **Spec:** README §17 · **Done when:** the page covers at least two provider families with concrete
  steps

#### P6-06 · T65 Chat with PDF

- [ ] Extracted-text context assembly with a size/page-count cap and a clear message when a document
      exceeds it
- [ ] Local fallback: full-text search + jump-to-section, always available without a key
- **Spec:** README §4.9 · **Done when:** STCC; the fallback works with zero configured provider

#### P6-07 · T66 Summarize / Quiz / Flashcards / Mind map

- [ ] Five prompt presets over one adapter; local extractive-summary fallback (TF-IDF + heading weight)
- **Spec:** README §4.9, §3.3 · **Done when:** STCC; the extractive fallback produces a non-trivial
  summary on a 10-page fixture with zero configured provider

#### P6-08 · T67 Translate PDF

- [ ] Layout-preserving re-flow after translation; explicit "no local fallback" messaging when unkeyed
- **Spec:** README §4.9 · **Done when:** STCC for the keyed path; the unkeyed state is honest and
  clear, never a broken partial translation

#### P6-09 · T68 Generate PDF from prompt

- [ ] Generated content assembled through the existing PDF-write engine (T35/T38 primitives), not a
      raw HTML dump
- **Spec:** README §4.9 · **Done when:** STCC for the keyed path

#### P6-10 · Escalation wiring for T29/T44/T52/T59/T61

- [ ] Each Tier-0/1 tool gets its optional Tier-3 escalation button, visibly labelled and costed,
      never pre-selected
- **Spec:** README §13.1.3 · **Done when:** a UI test confirms the local result renders before any
  escalation control is even enabled

#### P6-11 · AI adapters shipped

- [ ] Appendix C fully checked (all 8 adapter/capability combinations)
- **Spec:** README §14 · **Done when:** Appendix C rows checked

### 🚦 Gate E — BYOK and AI integrity

- [ ] Every AI tool's local fallback (or honest "no fallback" message) works with zero configured
      provider
- [ ] No AI request ever fires without an explicit user gesture — verified in CI
- [ ] `credential-leak` harness passes across all four AI tools and every escalation
- [ ] Register (README §13.1.3) matches the shipped code exactly — no orphaned entries, no
      unregistered AI code paths

---

## 8. Workstream F — Create, Relay, batch, recipe, folder watching, and CLI/library

**Entry:** Gate 0 plus the engine API and recipe schema. Creation, batch, Relay, and developer tools
start in parallel with A–E; only their shared engine calls and recipe contracts are gated.
**Spec:** README §4.5, §4.10, §15.

#### P7-01 · Create PDF, templates (T35)

- [ ] Page size/orientation presets, grid/lined/dot templates
- **Spec:** README §4.5 · **Done when:** STCC

#### P7-02 · QR code generator (T37)

- [ ] URL/text/vCard encoding (**ours** — QR generation is a deterministic algorithm, not a
      third-party API call); export as PDF/PNG/SVG
- **Spec:** README §4.5 · **Done when:** STCC; generated codes scan correctly on ≥ 3 physical devices

#### P7-03 · Invoice creator + e-invoice (T38–T39)

- [ ] Visual builder, saved templates in IndexedDB
- [ ] PDF ↔ structured XML (UBL/ZUGFeRD-style) embedding, validated against the schema
- **Spec:** README §4.5, §5.3 · **Done when:** STCC for each; e-invoice XML validates against its
  published schema

#### P7-04 · Scan to PDF, local (T40)

- [ ] `getUserMedia` capture, perspective deskew (**ours** — classical CV, Tier 1), multi-page assembly
- **Spec:** README §4.5 · **Done when:** STCC; deskew measurably improves a deliberately-skewed
  fixture set

#### P7-05 · Document pack builder (T41)

- [ ] Merge ordered attachments with a generated table of contents
- **Spec:** README §4.5 · **Done when:** STCC

#### P7-06 · Relay: webpage → PDF (T36)

- [ ] `apps/relay` — stateless, self-hostable, headless-browser render; explicit opt-in from the
      main app, never bundled/called by default
- [ ] Clear "requires the Relay" messaging when unconfigured (P8)
- **Spec:** README §15 · **Done when:** a self-run Relay instance renders a real URL to PDF, and the
  main app functions fully (with an honest message) when none is configured

#### P7-07 · Batch runner (T69)

- [ ] Concurrency control, per-file status/retry, partial ZIP download, memory governor
- **Spec:** README §11.5 · **Done when:** a 50-file batch completes within budget and a
  200-file batch never OOMs

#### P7-08 · Recipe builder + sharing (T70)

- [ ] Visual pipeline editor, IndexedDB save, JSON export, URL-fragment sharing
- [ ] Plain-language description rendered before anything runs; AI steps flagged
- **Spec:** README §11.4, §18 · **Done when:** a shared 4-step recipe link reproduces exactly, with no
  server round-trip and no document data in the link

#### P7-09 · Folder watcher (T71)

- [ ] File System Access API — auto-process new files into an output folder
- **Spec:** README §4.10 · **Done when:** STCC

#### P7-10 · CLI & library (T72)

- [ ] `packages/cli` wrapping `packages/engine`; a recipe JSON runs identically in Node and browser
- **Spec:** README §4.10 · **Done when:** the same recipe JSON produces byte-equivalent output in
  both environments

### 🚦 Gate F — creation and workflow surfaces

- [ ] T35–T41 and T69–T72 pass their applicable STCCs
- [ ] Recipe JSON and engine outputs are consistent between browser and Node
- [ ] Relay is opt-in, self-hostable, and never required for local tools

## 9. Workstream G — Cross-workstream hardening and launch convergence

**Entry:** Gate 0 plus the first prerendered route and design primitives. These tasks start early on
small slices and expand continuously; the final gate is the only point that waits for A–F.
**Goal:** make the independent workstreams shippable as one accessible, performant, legally clear,
SEO-ready product using the physical design references in `design.md` and `saas-template/`.

### G.1 · Hardening and launch

#### P7-11 · Internationalization

- [ ] All strings as i18n messages with translator comments; `en-XA` and `ar` pass with no layout
      overflow
- **Spec:** README §21 · **Done when:** both pseudo-locale passes are green in CI

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

- [ ] `docs/ADR/ip-clearance.md` reviewed end to end; every ⚠ VERIFY item in the README resolved or
      explicitly deferred with a fallback shipping
- **Spec:** README §25 · **Done when:** zero unresolved ⚠ VERIFY items block launch

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

| Date       | Entry                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —          | Plan created from `image.complianttools.com` template, adapted to the PDF domain and the seven reference competitors (Smallpdf, iLovePDF, PDF24, OpenPDF, pdf.net, Drawboard PDF, Adobe Acrobat online).                          |
| 2026-09-22 | Reconciled with `comprehensive.md`, `design.md`, and `saas-template/`: expanded README capability/output/privacy coverage, corrected the 72-tool accounting, and reorganized execution into Gate 0 plus parallel Workstreams A–G. |
| 2026-09-22 | Completed Phase 0: shipped the monorepo/toolchain, compliance gates, PDF read/write engine seams, worker scheduler, adversarial corpus, UI primitives, static delivery shell, and Gate 0 verification.                            |

---

## Appendix A — Tool tracker (72 tools)

Mirrors README §4. Checked only when STCC (§0.4) fully holds.

| #    | Tool                         | Route                          | Workstream | Status |
| ---- | ---------------------------- | ------------------------------ | ---------- | :----: |
| T01  | Merge PDF                    | `/merge`                       | A          |  [ ]   |
| T02  | Split PDF                    | `/split`                       | A          |  [ ]   |
| T03  | Extract Pages                | `/extract-pages`               | A          |  [ ]   |
| T04  | Remove Pages                 | `/remove-pages`                | A          |  [ ]   |
| T05  | Insert Pages                 | `/insert-pages`                | A          |  [ ]   |
| T06  | Organize Pages               | `/organize`                    | A          |  [ ]   |
| T07  | Rotate Pages                 | `/rotate-pdf`                  | A          |  [ ]   |
| T08  | Pages Per Sheet              | `/pages-per-sheet`             | A          |  [ ]   |
| T09  | Halve Pages                  | `/halve-pages`                 | A          |  [ ]   |
| T10  | Crop PDF                     | `/crop-pdf`                    | A          |  [ ]   |
| T11  | Change Page Size             | `/resize-pdf-pages`            | A          |  [ ]   |
| T12  | Bookmark Editor              | `/bookmarks`                   | A          |  [ ]   |
| T13  | Bates Numbering              | `/bates-numbering`             | A          |  [ ]   |
| T14  | Compress PDF                 | `/compress-pdf`                | A          |  [ ]   |
| T15  | Web-Optimize PDF             | `/optimize-for-web`            | A          |  [ ]   |
| T16  | Repair PDF                   | `/repair-pdf`                  | A          |  [ ]   |
| T17  | Rasterize PDF                | `/rasterize-pdf`               | A          |  [ ]   |
| T18  | Flatten PDF                  | `/flatten-pdf`                 | A          |  [ ]   |
| T19  | PDF → PDF/A                  | `/pdf-to-pdfa`                 | A          |  [ ]   |
| T20  | Word ↔ PDF                   | `/word-pdf`                    | B          |  [ ]   |
| T21  | Excel ↔ PDF                  | `/excel-pdf`                   | B          |  [ ]   |
| T22  | PowerPoint ↔ PDF             | `/ppt-pdf`                     | B          |  [ ]   |
| T23  | Text/RTF/Markdown ↔ PDF      | `/text-pdf`                    | B          |  [ ]   |
| T24  | HTML ↔ PDF                   | `/html-pdf`                    | B          |  [ ]   |
| T25  | ODF ↔ PDF                    | `/odf-pdf`                     | B          |  [ ]   |
| T26  | EPUB ↔ PDF                   | `/epub-pdf`                    | B          |  [ ]   |
| T27  | CSV ↔ PDF                    | `/csv-pdf`                     | B          |  [ ]   |
| T28  | Bank Statement → Excel       | `/bank-statement-to-excel`     | B          |  [ ]   |
| T29  | PDF → Markdown               | `/pdf-to-markdown`             | B          |  [ ]   |
| T30a | Legacy Formats → PDF         | `/other-formats-to-pdf`        | B          |  [ ]   |
| T31  | Image → PDF                  | `/image-to-pdf`                | B          |  [ ]   |
| T32  | PDF → Image                  | `/pdf-to-image`                | B          |  [ ]   |
| T33  | Design File → PDF            | `/design-file-to-pdf`          | B          |  [ ]   |
| T34  | Extract Embedded Images      | `/extract-images`              | B          |  [ ]   |
| T35  | Create PDF                   | `/create-pdf`                  | F          |  [ ]   |
| T36  | Webpage → PDF                | `/webpage-to-pdf`              | F          |  [ ]   |
| T37  | QR Code Generator            | `/qr-code`                     | F          |  [ ]   |
| T38  | Invoice Creator              | `/invoice-creator`             | F          |  [ ]   |
| T39  | Electronic Invoice           | `/e-invoice`                   | F          |  [ ]   |
| T40  | Scan to PDF                  | `/scan-to-pdf`                 | F          |  [ ]   |
| T41  | Document Pack Builder        | `/document-pack-builder`       | F          |  [ ]   |
| T42  | PDF Editor (host)            | `/editor`                      | C          |  [ ]   |
| T43  | Annotator                    | `/annotate`                    | C          |  [ ]   |
| T44  | Fill Out Form                | `/fill-form`                   | C          |  [ ]   |
| T45  | Create Fillable Form         | `/create-form`                 | C          |  [ ]   |
| T46  | Add Text                     | `/add-text`                    | C          |  [ ]   |
| T47  | Add Image                    | `/add-image`                   | C          |  [ ]   |
| T48  | Headers & Footers            | `/headers-footers`             | C          |  [ ]   |
| T49  | Page Numbers                 | `/page-numbers`                | C          |  [ ]   |
| T50  | Watermark                    | `/watermark-pdf`               | C          |  [ ]   |
| T51  | PDF Overlay                  | `/pdf-overlay`                 | C          |  [ ]   |
| T52  | Alt-Text & Tagging           | `/pdf-accessibility`           | C          |  [ ]   |
| T53  | Sign PDF                     | `/sign-pdf`                    | C          |  [ ]   |
| T54  | Remove Signature Background  | `/remove-signature-background` | C          |  [ ]   |
| T55  | Request Signature            | `/request-signature`           | C          |  [ ]   |
| T56  | Protect PDF                  | `/protect-pdf`                 | C          |  [ ]   |
| T57  | Unlock PDF                   | `/unlock-pdf`                  | C          |  [ ]   |
| T58  | Password Generator           | `/password-generator`          | C          |  [ ]   |
| T59  | Redact PDF                   | `/redact-pdf`                  | C          |  [ ]   |
| T60  | PDF Viewer                   | `/view-pdf`                    | D          |  [ ]   |
| T61  | Compare PDFs                 | `/compare-pdf`                 | D          |  [ ]   |
| T62  | Metadata Editor              | `/pdf-metadata`                | D          |  [ ]   |
| T63  | OCR PDF                      | `/ocr-pdf`                     | D          |  [ ]   |
| T64  | Structure Inspector          | `/pdf-inspector`               | D          |  [ ]   |
| T65  | Chat with PDF                | `/ai/chat-with-pdf`            | E          |  [ ]   |
| T66  | AI Summarize/Quiz/Flashcards | `/ai/summarize`                | E          |  [ ]   |
| T67  | Translate PDF                | `/ai/translate`                | E          |  [ ]   |
| T68  | Generate PDF from Prompt     | `/ai/generate-pdf`             | E          |  [ ]   |
| T69  | Batch Runner                 | `/batch`                       | F          |  [ ]   |
| T70  | Recipe Builder               | `/recipe`                      | F          |  [ ]   |
| T71  | Folder Watcher               | `/watch`                       | F          |  [ ]   |
| T72  | CLI & Library                | `packages/cli`                 | F          |  [ ]   |

## Appendix B — Format & standard tracker (34 rows)

Mirrors README §5. Checked only when SFCC (§0.4) holds.

| Format / standard                   | Direction  | Workstream          | Status |
| ----------------------------------- | ---------- | ------------------- | :----: |
| PDF 1.0–2.0                         | D/E        | 0                   |  [ ]   |
| PDF/A 1b/2b/3b                      | D/E        | A                   |  [ ]   |
| PDF/X                               | D          | — (⚠ VERIFY demand) |  [ ]   |
| AcroForm/XFA                        | D/E        | C                   |  [ ]   |
| DOCX/DOC                            | D/E        | B                   |  [ ]   |
| XLSX/XLS                            | D/E        | B                   |  [ ]   |
| PPTX/PPT                            | D/E        | B                   |  [ ]   |
| RTF                                 | D/E        | B                   |  [ ]   |
| ODT/ODS/ODP/ODG                     | D/E        | B                   |  [ ]   |
| Publisher (PUB)                     | D          | B                   |  [ ]   |
| HWP                                 | D          | B                   |  [ ]   |
| TXT                                 | D/E        | B                   |  [ ]   |
| Markdown                            | D/E        | B                   |  [ ]   |
| HTML/CSS (pasted)                   | D/E        | B                   |  [ ]   |
| EPUB                                | D/E        | B                   |  [ ]   |
| CSV                                 | D/E        | B                   |  [ ]   |
| e-invoice XML (UBL/ZUGFeRD)         | D/E        | F                   |  [ ]   |
| JPG/JPEG                            | D/E        | B                   |  [ ]   |
| PNG                                 | D/E        | B                   |  [ ]   |
| BMP                                 | D/E        | B                   |  [ ]   |
| GIF                                 | D/E        | B                   |  [ ]   |
| TIFF (multi-page)                   | D/E        | B                   |  [ ]   |
| WEBP                                | D/E        | B                   |  [ ]   |
| HEIC/HEIF                           | D          | B                   |  [ ]   |
| SVG                                 | D/E        | B                   |  [ ]   |
| PSD                                 | D          | B                   |  [ ]   |
| AI (Illustrator)                    | D          | B                   |  [ ]   |
| INDD                                | D          | B                   |  [ ]   |
| ZIP (of pages/images)               | D/E        | B                   |  [ ]   |
| CBZ/CBR                             | D/E        | B                   |  [ ]   |
| Standard security handler (RC4/AES) | D/E        | C                   |  [ ]   |
| PKCS#7/CAdES signature              | D (verify) | C                   |  [ ]   |
| Visible signature appearance        | D/E        | C                   |  [ ]   |
| PDF/UA tagging                      | D (audit)  | C                   |  [ ]   |

## Appendix C — AI adapter tracker (8 rows)

Mirrors README §14. One row per capability × provider-family pairing shipped at launch.

| #   | Adapter                          | Capability  | Provider family       | Workstream | Status |
| --- | -------------------------------- | ----------- | --------------------- | ---------- | :----: |
| A1  | OpenAI-compatible / chat         | `chat`      | OpenAI-compatible     | E          |  [ ]   |
| A2  | OpenAI-compatible / summarize    | `summarize` | OpenAI-compatible     | E          |  [ ]   |
| A3  | OpenAI-compatible / translate    | `translate` | OpenAI-compatible     | E          |  [ ]   |
| A4  | OpenAI-compatible / generate     | `generate`  | OpenAI-compatible     | E          |  [ ]   |
| A5  | Anthropic-compatible / chat      | `chat`      | Anthropic-compatible  | E          |  [ ]   |
| A6  | Anthropic-compatible / summarize | `summarize` | Anthropic-compatible  | E          |  [ ]   |
| A7  | Generic-HTTP-template / chat     | `chat`      | User-defined endpoint | E          |  [ ]   |
| A8  | Generic-HTTP-template / generate | `generate`  | User-defined endpoint | E          |  [ ]   |

## Appendix D — Clearance register (18 items)

Mirrors README §25. "No decision = excluded" is the standing rule.

| #   | Item                                        | Concern                               | Decision                                                 | Status |
| --- | ------------------------------------------- | ------------------------------------- | -------------------------------------------------------- | :----: |
| D01 | MuPDF / mupdf.js                            | AGPL-3.0                              | Excluded from default build                              |  [ ]   |
| D02 | Ghostscript                                 | AGPL-3.0                              | Excluded from default build                              |  [ ]   |
| D03 | LibreOffice headless                        | GPL/server-side                       | Excluded from default build                              |  [ ]   |
| D04 | pdf.js                                      | Apache-2.0                            | Adopted                                                  |  [ ]   |
| D05 | pdfium WASM wrapper (specific pinned build) | Wrapper licence varies                | ⚠ VERIFY before pinning                                  |  [ ]   |
| D06 | pdf-lib (or fork)                           | MIT, maintenance status               | ⚠ VERIFY maintenance at implementation time              |  [ ]   |
| D07 | jsPDF                                       | MIT                                   | Adopted                                                  |  [ ]   |
| D08 | docx                                        | MIT                                   | Adopted                                                  |  [ ]   |
| D09 | mammoth                                     | MIT                                   | Adopted                                                  |  [ ]   |
| D10 | exceljs                                     | MIT                                   | Adopted                                                  |  [ ]   |
| D11 | pptxgenjs                                   | MIT                                   | Adopted                                                  |  [ ]   |
| D12 | jszip                                       | MIT                                   | Adopted                                                  |  [ ]   |
| D13 | fflate                                      | MIT                                   | Adopted                                                  |  [ ]   |
| D14 | Tesseract.js                                | Apache-2.0                            | Adopted; models registered as static assets              |  [ ]   |
| D15 | Legacy `.doc`/`.xls`/`.ppt` binary readers  | Build vs. buy                         | Build ourselves (OLE2/CFB is publicly documented)        |  [ ]   |
| D16 | Root-certificate trust program              | Cannot bundle/claim authority         | Verify against browser/OS trust or user-supplied CA only |  [ ]   |
| D17 | E-signature request flow naming             | Trademark risk                        | Generic naming; no vendor-specific verb                  |  [ ]   |
| D18 | Relay headless-browser runtime              | Self-hosted, not a service we operate | User-run only; never bundled as a default network call   |  [ ]   |

## Appendix E — SEO landing-page checklist (SPCC)

Every prerendered page in Workstream G must satisfy all ten rules from README §7.6 before being counted in
the ~250-page target: static H1/description/FAQ, real file input in served HTML, drag/paste layered
on at hydration, zero-JS reference-page archetype where applicable, shared long-cached engine chunk,
per-route size-limit budget, correct canonical/hreflang tags, structured data (SoftwareApplication or
HowTo schema, factually accurate — no fabricated review counts or ratings), internal links to the
recipe/batch tools, and a Lighthouse mobile score ≥ 95.
