# IP and licence clearance decisions

Status: Phase 0 baseline, reviewed 2026-09-22.

The default build is permissively licensed, client-side, and self-hosted only where the user opts into
the Relay. `verify:licenses` enforces the allowlist in CI. No decision means excluded from the default
build.

| ID  | Item                                   | Decision                         | Evidence / fallback                                                            |
| --- | -------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| D01 | MuPDF / mupdf.js                       | Excluded                         | AGPL-3.0; use pdf.js + pdfium seam + pdf-lib                                   |
| D02 | Ghostscript                            | Excluded                         | AGPL-3.0; no server conversion path                                            |
| D03 | LibreOffice headless                   | Excluded                         | Copyleft/linkage concerns and violates local-only architecture                 |
| D04 | pdf.js                                 | Adopted                          | Apache-2.0, pinned in `packages/engine`                                        |
| D05 | `@embedpdf/pdfium` 2.15.1              | Adopted with verification record | npm metadata reports MIT; wrapper package remains isolated behind an adapter   |
| D06 | pdf-lib 1.17.1                         | Adopted                          | MIT; pinned and used for write-path Phase 0 proof                              |
| D07 | jsPDF 4.2.1                            | Adopted                          | MIT; pinned for future from-scratch document creation                          |
| D08 | docx                                   | Adopted                          | MIT; lazy-loaded for DOCX writing                                              |
| D09 | mammoth                                | Adopted                          | MIT; lazy-loaded for DOCX structure reading                                    |
| D10 | exceljs                                | Adopted                          | MIT; lazy-loaded for XLSX read/write                                           |
| D11 | pptxgenjs                              | Adopted                          | MIT; lazy-loaded for PPTX writing                                              |
| D12 | jszip                                  | Adopted                          | MIT-compatible archive seam; conversion uses local ZIP parsing                 |
| D13 | fflate                                 | Adopted                          | MIT; local ZIP/ODF/EPUB/PNG helpers                                            |
| D14 | Tesseract.js and models                | Reserved                         | Apache-2.0 library; models must be separately registered before shipping       |
| D15 | Legacy Office readers                  | Build ourselves                  | OLE2/CFB is publicly documented; no copyleft reader dependency                 |
| D16 | Root-certificate trust lists           | Excluded from bundle             | Verify against browser/OS trust or a user-supplied CA bundle                   |
| D17 | Signature-request naming               | Generic language only            | Use “send for signature via your own email” and avoid vendor-specific verbs    |
| D18 | Relay headless-browser runtime         | User-run only                    | Separate optional service; never a default network call from the static app    |
| D19 | `qrcode` 1.5.4 + `@types/qrcode` 1.5.5 | MIT / MIT                        | Pinned deterministic local QR matrix encoder; no network/API call              |
| D20 | Playwright 1.63.0 in Relay             | Apache-2.0                       | User-run optional capture runtime; browser binaries are not bundled by the app |

## Verification procedure

1. Run `pnpm verify:licenses`. It checks two sets, both in CI:
   - **All dependencies**, from the installed tree, into `docs/THIRD-PARTY-LICENSES.md`.
   - **The shipped set** — every workspace importer's `dependencies`, walked transitively — into
     `docs/THIRD-PARTY-LICENSES-SHIPPED.md`. This is the graph that reaches a user's browser, and it
     is the set the AGPL-free claim actually depends on.
2. Run `pnpm verify:assets` for every model, font, ICC profile, schema, and static web asset.
3. Run `pnpm verify:trademarks` before publishing a build.
4. If a dependency changes, update this ADR and the corresponding plan clearance row before merging.

### What the gate reads, precisely

The **lockfile does not carry licence metadata** — pnpm entries hold only `resolution.integrity` — so
no licence can be read from `pnpm-lock.yaml`. An earlier version of this ADR said the gate ran
"against the frozen lockfile", which was not true of any implementation.

What actually happens: the lockfile's `importers:` block determines _which_ packages are declared as
production dependencies, and the installed `node_modules` supplies the licence strings. Because CI
runs `pnpm install --frozen-lockfile` before the gate, the installed tree is a pure function of the
frozen lockfile, which is the guarantee the original wording was reaching for.

The shipped walk must resolve through pnpm's content store (`node_modules/.pnpm/<name>@<version>/`),
because pnpm links only _direct_ dependencies into an importer's `node_modules`; transitives exist
only in the store. It also follows `npm:` aliases — `string-width-cjs: npm:string-width@^4.2.0` —
which exist on disk only under their target name.

### Reviewed licence expressions

`splitLicenses` was replaced with an SPDX-expression parser, because the shipped graph contains
expressions the old parser mishandled:

| Expression                  | Package                | Resolution                                                                                                                                             |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `(MIT OR GPL-3.0-or-later)` | `jszip@3.10.1`         | MIT branch is taken; the GPL branch is an alternative the user may decline. Rejecting the package for merely _mentioning_ GPL would be wrong.          |
| `(MIT AND Zlib)`            | `pako@1.0.11`          | Both required; both allowlisted.                                                                                                                       |
| `(MPL-2.0 OR Apache-2.0)`   | `dompurify@3.4.15`     | Apache-2.0 branch; MPL-2.0 is also allowlisted.                                                                                                        |
| `MIT/X11`                   | `chainsaw`, `traverse` | Deprecated SPDX form for MIT with the X11 disclaimer. Matched whole; splitting on `/` would demand a licence named `X11`, which is not a real SPDX id. |
| `BSD`                       | `duck@0.1.12`          | The ambiguous short form, read as BSD-2-Clause.                                                                                                        |
| `BlueOak-1.0.0`             | `sax@1.6.1`            | Permissive, with a patent grant.                                                                                                                       |

An `OR` is satisfied by any single allowlisted branch; an `AND` requires every branch.

## Open item — `buffers@0.1.1` (blocks the licence gate)

The corrected gate **fails**, and the failure is real rather than a bug in the check.

`buffers@0.1.1` declares no `license` field and ships no `LICENSE` file. It reaches the shipped graph
through `exceljs@4.4.0 → unzipper@0.10.14 → big-integer@1.6.52 → buffers@0.1.1`, and `exceljs` is a
production dependency of `packages/engine`.

P0-04's rule is "deny on … unknown/missing", so an unlabelled package in the shipped graph is a
licence question the project has not answered. Two ways to close it, both requiring an owner's
decision rather than an implementation:

1. **Override** — add a pnpm `overrides` entry or a patch that removes `unzipper` from exceljs's
   tree, so the unlicensed package is never bundled.
2. **Record** — add an Appendix D row stating that `buffers@0.1.1` ships unlabelled, why the risk is
   accepted, and what fallback applies.

What is _not_ an acceptable resolution is weakening the gate to let the failure through silently.

### A limitation no script can close

Reading `package.json.license` is not sufficient evidence for a vendored **binary**. D05
(`@embedpdf/pdfium`, pinned 2.15.1) ships a WASM blob; npm metadata reporting "MIT" is a claim about
the wrapper package, not about the binary inside it. That item needs a human to read the pinned
build's licence text and record its URL and sha256 in Appendix D. The gate can confirm the package is
present and its wrapper is allowlisted; it cannot read the licence of a compiled artifact.
