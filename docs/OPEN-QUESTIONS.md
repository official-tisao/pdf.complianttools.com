# Open questions and working defaults

This note records decisions that could reasonably require product-owner input while Phases A–F are
implemented. None of these questions blocks the current work. The defaults below follow
the repository specification, local-first browser constraints, permissive licensing requirements, and
the existing `design.md` / `saas-template/` references.

| Question                                                     | Working default                                                                                                                                                                                                                      | Revisit when                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| What branch names should carry the parallel work?            | Use `phase-a` and `phase-b`, each forked from the pushed Phase 0 fix on `init-commit`.                                                                                                                                               | Before merging either phase branch.                              |
| What does “end to end” mean for a phase?                     | Every task in that workstream gets an implementation seam, a user-visible path where applicable, typed errors, tests, and an updated PLAN status; no placeholder claims count as complete.                                           | At the phase gate review.                                        |
| Which PDF engine is authoritative for export?                | `pdf-lib` remains the mutation/serialization engine; pdf.js validates authored output and pdfium cross-checks rendering.                                                                                                             | If a measured fidelity or performance test disproves the choice. |
| How should unsupported formats behave?                       | Explain the unsupported capability with a typed remedy and preserve the original file; never silently upload or invoke a copyleft/server dependency.                                                                                 | When a permissively licensed browser reader is cleared.          |
| Should remote conversion be enabled by default?              | No. Local browser processing is the default; Relay is explicit opt-in and never required for local tools.                                                                                                                            | When a user explicitly configures Relay.                         |
| Which AI/provider behavior is assumed in these phases?       | No AI calls are added to Phase A or B; any future escalation remains BYOK, gesture-gated, and outside the local engine.                                                                                                              | During Workstream E implementation.                              |
| What are the initial performance priorities?                 | Correctness and bounded memory first, then measured throughput; use the budgets in README §19 and fail with a remedy before an OOM-prone operation.                                                                                  | After representative fixture benchmarks exist.                   |
| How much localization is required before phase completion?   | All new user-facing strings use the existing message boundary; English is the source locale, with pseudo-locale and RTL checks added as the UI surface expands.                                                                      | Before Workstream G launch convergence.                          |
| Which visual details take precedence when references differ? | `design.md` is the written contract; physical files under `saas-template/` are the implementation reference for spacing, shell, and responsive behavior.                                                                             | When a design review explicitly supersedes either reference.     |
| Which Workstream A operations need a renderer at runtime?    | Mutation, organize, compression, metadata, structure inspection, and PDF/A reporting stay local in the engine; rasterize/preview accept a caller-supplied local pdfium-compatible renderer and never fall back to a network service. | When the browser worker renderer is wired into the final route.  |
| How are imported PDF outlines handled by the first writer?   | Page bytes and order are preserved; bookmark strategy is schema-visible, while full outline-tree authoring remains a follow-up until the permissive writer API is verified.                                                          | Before the final document-navigation workstream gate.            |
| How should editor mutations preserve document safety?        | Every edit runs through the existing single-graph pipeline, records a reversible recipe step where possible, and exports a fresh document; original input bytes remain immutable.                                                    | Before adding collaborative or cloud editing.                    |
| What should signature and redaction claim?                   | Local signing supports drawing/placement and package preparation only; redaction must remove underlying content and emit verification evidence. No “secure” claim is made without fixture proof.                                     | Before legal/security review of Workstream C.                    |
| How should OCR behave without a model download?              | Text extraction and searchable-PDF output remain local-first; OCR reports model size and language before download, requires an explicit gesture, and returns a typed unavailable state when no model is installed.                   | When the model catalog and accuracy corpus are approved.         |
| What is the viewer’s source of truth?                        | pdf.js supplies local parsing/text/search; pdfium is an injected rendering seam for pixel comparisons and raster output. Viewer state is URL/recipe-shareable but never includes document bytes.                                     | When a production renderer is bundled and benchmarked.           |
| Which AI operations may leave the browser?                   | Workstream E is BYOK and gesture-gated. Keys stay in IndexedDB, are never logged or sent to the local engine, and no provider is enabled until the user configures it.                                                               | During provider/security review.                                 |
| What happens when AI is not configured?                      | Every AI tool has a deterministic local fallback where feasible; otherwise the UI explains that no local fallback exists and does not issue a request.                                                                               | Before enabling each AI route.                                   |
| Should Relay be required for creation or batch tools?        | No. Creation, recipes, batch execution, folder watching, and CLI/library stay local; Relay is an explicit opt-in only for webpage rendering and other inherently remote inputs.                                                      | When deployment requirements are finalized.                      |
| What does “complete” mean for branch F tooling?              | Browser and Node paths share typed recipes and engine operations; folder watching is opt-in, bounded, and never uploads files implicitly.                                                                                            | Before publishing the CLI package.                               |

## Defaults applied without waiting

- Keep the public static app useful with JavaScript disabled and with no Relay configured.
- Keep all document bytes local unless a user explicitly starts a BYOK or Relay operation.
- Prefer deterministic, browser-compatible, permissively licensed dependencies and record each new
  dependency in the clearance register before use.
- Add fixtures and tests alongside each capability; update `PLAN.md` in the same commit as any plan
  or specification change.
- Preserve the existing branch and commit discipline: related changes are grouped, phase work is
  pushed only to its own phase branch, and the current branch receives only the shared fix/base work.

## Phase B assumptions recorded at implementation time

- Office and archive adapters are lazy-loaded; the UI never offers a registry entry whose direction
  is marked unavailable. Adapters over 2 MB require an explicit download confirmation.
- Legacy binary Office support is intentionally best-effort and text-stream based. No claim is made
  that DOC/XLS/PPT formatting round-trips; users are directed to DOCX/XLSX/PPTX exports when the
  compound file has no readable stream.
- HTML conversion accepts pasted/file bytes only. URL capture remains a Relay-gated operation and
  is never inferred from an HTML input.
- Multi-page TIFF decoding, INDD, CBR, and PDF raster export without an injected local pdfium
  renderer are typed unavailable capabilities rather than placeholder implementations.
- Bank-statement confidence is a synthetic-fixture measurement aid, not a financial accuracy
  guarantee; the route requires user verification before using the generated workbook.

## Phase C–F defaults applied without waiting

- Workstream C uses local, deterministic PDF mutation and typed capability boundaries. Unsupported
  writer operations surface a remedy instead of silently flattening or calling a remote service.
- Redaction is treated as content removal, not a visual overlay. A result is downloadable only after
  the verification path confirms the target text/objects are absent from the relevant content and
  metadata surfaces.
- Workstream D keeps viewer/search/metadata/OCR data local by default. OCR model downloads are
  disclosed, user-triggered, cacheable, and removable; no model is fetched during page load.
- Workstream E implements provider-neutral BYOK seams first. Provider adapters remain optional,
  consent-gated, cost-estimated, and excluded from local-only flows; credentials never enter recipes,
  logs, diagnostics, URLs, or document bytes.
- Workstream F treats Relay as opt-in and keeps create/batch/recipe/CLI operations deterministic and
  runnable without a server. File-system watching requires explicit directory permission and a
  visible pause/stop control.
- All four phase branches start from the updated `origin/master` merge, are pushed independently,
  and may be reviewed or merged in any order after their tests and gate evidence pass.
