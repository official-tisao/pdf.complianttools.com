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
| D21 | `unzipper` 0.11.3 override             | MIT                              | Removes unlabelled `buffers` from the shipped graph; no exception is added     |

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

The store is keyed by `name@version` and **retains a directory for every version ever installed** —
pnpm does not prune one that a later install orphaned. A name-prefix match therefore returns
whichever version the filesystem yields first, not the one the lockfile resolves to, which both
reports packages the lockfile has removed and reads the wrong licence for packages shadowed the same
way. The `snapshots:` block is consequently authoritative for which version is installed, and a
package it does not resolve is treated as not installed. One wrinkle: pnpm spells a peer-suffixed
store directory `esrap@2.3.8_@peer+types@1.0.0` where the lockfile writes
`esrap@2.3.8(@peer/types@1.0.0)`, so the two are compared on the version alone.

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

## Resolved — `buffers@0.1.1` (closed 2026-10-01 by override)

`buffers@0.1.1` declared no `license` field and shipped no `LICENSE` file (npm registry reports
`license: undefined`). It reached the shipped graph through
`exceljs@4.4.0 → unzipper@0.10.14 → binary@0.3.0 → buffers@0.1.1`, with `exceljs` a production
dependency of `packages/engine`. P0-04's rule is "deny on … unknown/missing", so the gate was right
to fail.

It is **removed rather than excepted**. A pnpm `overrides` entry in the root `package.json` pins
`unzipper` to `0.11.3`: that version is MIT, still exports the `Parse` and `Open` API exceljs calls,
and still honours the `forceStream` option its streaming reader passes, but it no longer depends on
`binary` — so the unlabelled package leaves the dependency graph entirely. Its closure
(`big-integer` Unlicense, `fstream` ISC, `duplexer2` BSD-3-Clause) is entirely allowlisted.

**The pin is `0.11.3` and not the newer `0.12.x` deliberately.** Every 0.12 release contains a lazy
`require('@aws-sdk/client-s3')` in its `s3_v3` directory handler. Nothing in this project reads from
S3, so the require is never executed — but it is not declared in `unzipper`'s `dependencies`
either, so it cannot be installed to satisfy the import, and a static bundler cannot prove the
branch unreachable. `pnpm build` failed with `Rolldown failed to resolve import
"@aws-sdk/client-s3"` against every 0.12.x tried. `0.11.3` predates the S3 handler and keeps the
same public API. **Revisit only if a future `unzipper` release drops that require or declares it
properly.**

**No exception was added to the allowlist.** The gate is as strict as it was before; the offending
package simply is not there any more. Recorded as Appendix D **D21**.

Two supporting facts, both verified rather than assumed:

- **It was never browser-reachable.** `exceljs` declares `"browser": "./dist/exceljs.min.js"`, a
  self-contained prebuilt bundle with no external `require()` calls, and `buffers` appears in no
  chunk of the production build. The exposure was to the Node/CLI shipped graph only.
- **The only code path reaching `unzipper` is unused here.** It is exceljs's Node _streaming_
  reader; all three engine call sites use the jszip `workbook.xlsx.load` / `writeBuffer` path.

> The chain was originally recorded in this ADR and in `PLAN.md` as running through
> `big-integer@1.6.52`. That was incorrect — `big-integer` is a leaf in the lockfile — and the chain
> is `unzipper → binary → buffers`. Corrected 2026-10-01.

### A defect this exposed in the gate

`locatePackage` resolved a package in pnpm's store by **name prefix with no version awareness**.
pnpm does not prune a store directory when a later install orphans it, so the gate read whichever
version the filesystem yielded first. After the override moved `unzipper` off `0.10.14`, the gate
still read the orphaned `unzipper@0.10.14` — whose dependency list still names `binary` — and kept
reporting `buffers` as a shipped violation, while reading the wrong licence for any package
shadowed the same way. The lockfile's `snapshots:` block is now authoritative for which version is
installed. Covered by tests in `scripts/verify-licenses.test.mjs`.

### A limitation no script can close

Reading `package.json.license` is not sufficient evidence for a vendored **binary**. D05
(`@embedpdf/pdfium`, pinned 2.15.1) ships a WASM blob; npm metadata reporting "MIT" is a claim about
the wrapper package, not about the binary inside it. That item needs a human to read the pinned
build's licence text and record its URL and sha256 in Appendix D. The gate can confirm the package is
present and its wrapper is allowlisted; it cannot read the licence of a compiled artifact.
