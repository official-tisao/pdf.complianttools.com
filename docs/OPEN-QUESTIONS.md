# Open questions and working defaults

This note records decisions that could reasonably require product-owner input while Phases A–F are
implemented. None of these questions blocks the current work. The defaults below follow
the repository specification, local-first browser constraints, permissive licensing requirements, and
the existing `design.md` / `saas-template/` references.

The decision updates dated 2026-09-28 below record the product-owner answers to the previously open
items. They are implementation commitments unless a later decision explicitly supersedes them.

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

## Product-owner decisions recorded 2026-09-28

| Question                                                  | Confirmed decision                                                                                                                                                                             | Implementation consequence                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q6: Should v1 support password protection/encryption?     | Yes. Use AES-256 as the preferred profile, AES-128 as a compatibility fallback, and never use RC4.                                                                                             | Password generation, encryption, and decryption remain local. Passwords are never logged, uploaded, or stored by default. Unknown-password cracking is out of scope. The PDF writer must use a permissively licensed encryption adapter where its base API is insufficient.                                         |
| Q10–11: How should OCR models and languages work?         | English is the initial page language. Show every registered Tesseract language alphabetically with search, let the user select a language per file, and download the selected model on demand. | A model is fetched only after a visible Download/Enable action. Before that action, disclose language, model size, version, license, provenance, and known accuracy limitations. Models are cached locally for reuse and can be removed. The catalog is limited to models cleared in the asset/provenance manifest. |
| Q12: What level of conversion fidelity is expected?       | Structural fidelity is the initial guarantee.                                                                                                                                                  | Preserve document meaning and organization—headings, paragraphs, tables, lists, reading order, headers, footers, and page structure—while clearly warning that complex fonts, charts, columns, and spacing may change. Pixel-perfect fidelity is not claimed unless a format-specific fixture proves it.            |
| Q13: How should all legacy formats be supported?          | Use the layered adapter plan: native browser adapters where possible, optional user-installed external converters through Relay/CLI, and an honest capability matrix.                          | Support claims must be fixture-backed. Copyleft or commercially restricted engines are not bundled silently into the static browser build. Unsupported or best-effort formats retain the original and return a typed remedy.                                                                                        |
| Q14: Should PDF/X recognition and production be included? | Yes, both recognition and production are in scope. Start with PDF/X-1a and PDF/X-4, then expand when profile fixtures and validators are available.                                            | Conformance requires profile-specific validation of output intents, ICC profiles, fonts, color spaces, transparency/flattening, metadata, and required fields. No automatic PDF/X pass claim without validator evidence.                                                                                            |
| Q20: How should Relay be deployed?                        | Support both hosted and self-hosted Relay, disabled until explicitly configured. End users do not need Docker, Node, or superuser access.                                                      | Docker/Node are operator deployment choices. Local browser tools remain functional without Relay. Self-hosting supports privacy and enterprise deployments; a hosted HTTPS endpoint supports ordinary users.                                                                                                        |
| Q22: What does Relay authentication mean?                 | Authentication identifies an approved client and prevents open-proxy abuse, SSRF, unauthorized rendering, and unexpected cost. It is separate from PDF password protection.                    | Localhost development may use no auth; remote self-hosted Relay uses a bearer token/API key; managed Relay uses account/session authentication with short-lived tokens.                                                                                                                                             |
| Q24: How should global tax regimes work?                  | Use a versioned, curated registry based on official sources, with periodic review and no mandatory commercial provider.                                                                        | Select country and subnational jurisdiction where applicable; record effective dates, source, and provenance; allow manual tax fields when no verified profile exists; generate country pages from the same registry and label them informational, not tax advice.                                                  |
| Q25: Who chooses the e-invoice standard?                  | The product defines supported adapters; the user chooses country/jurisdiction and receives the most popular or acceptable compatible standard by default.                                      | Use a canonical invoice model, then implement UBL 2.1/EN 16931/Peppol BIS Billing 3.0 first, followed by Factur-X/ZUGFeRD and country-specific adapters. Show schema version, jurisdiction, effective date, and validation status. Users may change the compatible standard when multiple valid options exist.      |
| Q31: Should recipe sharing be server-backed?              | No by default. Recipe sharing remains document-free and serverless.                                                                                                                            | Share URL fragments for short recipes and JSON export/import for larger recipes. Recipes exclude document bytes, credentials, passwords, API keys, and sensitive metadata. Server-backed short links, if added later, require separate expiry/deletion controls.                                                    |

## Relay boundary: concrete tasks and features

Relay is an explicit opt-in execution boundary for operations that need a remote browser, a user-installed
converter, or another operator-managed runtime. It is not a general document-processing backend and it
must not receive local document bytes unless a future feature makes that transfer explicit.

### Relay-required or Relay-eligible features

| Feature                                           | Why Relay is needed                                                                                                                                             | Default behavior                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Webpage URL → PDF                                 | A browser-rendering runtime is needed to fetch the URL, execute page JavaScript, apply print CSS, and render the page.                                          | Relay feature is unavailable until an endpoint is configured. Local-file tools remain available.                           |
| Authenticated or JavaScript-heavy webpage capture | The remote page may require cookies, a headless browser, network access, or controlled session handling that cannot be provided by a static browser page alone. | User explicitly starts the capture and reviews the destination/permissions. Credentials are not placed in recipes or logs. |
| User-installed external conversion adapters       | Legacy formats such as compound Office files or specialized design/archive formats may require a converter the user separately installs and licenses.           | The adapter runs on the user’s Relay/CLI host; no copyleft or commercial converter is bundled in the browser build.        |
| Operator-managed high-fidelity rendering          | Some formats need a native or server-side renderer that is not safe or practical to ship in the static browser bundle.                                          | Capability is exposed only when the configured Relay advertises the adapter and its license/runtime checks pass.           |

### Features that do not require Relay

- Local merge, split, reorder, metadata editing, redaction, signing preparation, and PDF/A/PDF/X validation.
- Local OCR after the user downloads an approved language model.
- AI provider calls made directly through the user’s configured BYOK provider integration.
- Batch recipes, folder watching, CLI/library execution, invoice generation, and e-invoice validation.
- Recipe sharing, because recipes contain no document bytes and are processed locally.
- Downloads of approved OCR models and other explicitly selected local assets.

Any future feature that needs Relay must declare the data sent, the reason it cannot remain local, the
authentication mode, retention behavior, and whether a local fallback exists before it is exposed in the UI.

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
