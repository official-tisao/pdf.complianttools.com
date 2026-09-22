# Workstream B gate evidence

Status: implemented on `phase-b`, based on `dd0cf98`.

The Phase B conversion surface is local-first and registry-driven. `getAvailableFormats()` filters
targets by direction and status; the web conversion route renders only those targets. Unsupported
formats remain visible in the honest-capability list with a specific remedy and the original bytes
are never replaced.

Evidence:

- `packages/engine/test/phaseb.test.mjs` covers registry filtering, Markdown/CSV golden fixtures,
  PDF-to-Markdown review warnings, statement extraction confidence, and typed Publisher failure.
- `fixtures/conversion/` contains synthetic Markdown, CSV, HTML, and bank-statement inputs with
  provenance recorded in `PROVENANCE.md`.
- DOCX, XLSX, and PPTX use permissive lazy adapters and emit structural/layout-fidelity warnings;
  PDF export and PDF text export paths are deterministic. Legacy DOC/XLS/PPT and PUB/HWP are not
  silently fabricated: binary readers are best-effort where readable streams exist, otherwise the
  registry surfaces a typed unavailable remedy.
- ODF, EPUB, CSV, ZIP/CBZ, pasted HTML, PDF text formats, bank statements, PSD composites, PDF-backed
  AI files, and basic SVG vector shapes have local engine seams. TIFF multi-page decode, INDD, CBR,
  and browser-dependent PDF raster export stay explicitly unavailable unless the required clean
  decoder/renderer is injected.
- T29 escalation is registered in README §13.1.3 and `PDF_MARKDOWN_ESCALATION`; the UI runs local
  extraction first and requires an explicit gesture before any future BYOK adapter can be invoked.

Verification run for this worktree:

| Check                       | Result                                                  |
| --------------------------- | ------------------------------------------------------- |
| `pnpm typecheck`            | pass                                                    |
| `pnpm test:unit`            | 22 pass                                                 |
| `pnpm lint`                 | pass                                                    |
| `pnpm build`                | pass; bundler reports size/dynamic-import warnings only |
| `pnpm test:e2e`             | 3 pass in Chromium                                      |
| `pnpm verify:licenses`      | pass; allowlist manifest regenerated                    |
| `pnpm verify:source-safety` | pass                                                    |
| `pnpm verify:assets`        | pass                                                    |
| `pnpm verify:trademarks`    | pass                                                    |

The repository-wide formatter check still reports pre-existing formatting differences in untouched
Phase 0 files; only Phase B files and the Phase B-related registry/clearance files were formatted to
avoid unrelated churn. No MuPDF, Ghostscript, LibreOffice, GPL, LGPL, or AGPL dependency was added.
