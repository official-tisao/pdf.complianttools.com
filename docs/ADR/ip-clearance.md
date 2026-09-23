# IP and licence clearance decisions

Status: Phase 0 baseline, reviewed 2026-09-22.

The default build is permissively licensed, client-side, and self-hosted only where the user opts into
the Relay. `verify:licenses` enforces the allowlist in CI. No decision means excluded from the default
build.

| ID  | Item                           | Decision                         | Evidence / fallback                                                          |
| --- | ------------------------------ | -------------------------------- | ---------------------------------------------------------------------------- |
| D01 | MuPDF / mupdf.js               | Excluded                         | AGPL-3.0; use pdf.js + pdfium seam + pdf-lib                                 |
| D02 | Ghostscript                    | Excluded                         | AGPL-3.0; no server conversion path                                          |
| D03 | LibreOffice headless           | Excluded                         | Copyleft/linkage concerns and violates local-only architecture               |
| D04 | pdf.js                         | Adopted                          | Apache-2.0, pinned in `packages/engine`                                      |
| D05 | `@embedpdf/pdfium` 2.15.1      | Adopted with verification record | npm metadata reports MIT; wrapper package remains isolated behind an adapter |
| D06 | pdf-lib 1.17.1                 | Adopted                          | MIT; pinned and used for write-path Phase 0 proof                            |
| D07 | jsPDF 4.2.1                    | Adopted                          | MIT; pinned for future from-scratch document creation                        |
| D08 | docx                           | Adopted                          | MIT; lazy-loaded for DOCX writing                                            |
| D09 | mammoth                        | Adopted                          | MIT; lazy-loaded for DOCX structure reading                                  |
| D10 | exceljs                        | Adopted                          | MIT; lazy-loaded for XLSX read/write                                         |
| D11 | pptxgenjs                      | Adopted                          | MIT; lazy-loaded for PPTX writing                                            |
| D12 | jszip                          | Adopted                          | MIT-compatible archive seam; conversion uses local ZIP parsing               |
| D13 | fflate                         | Adopted                          | MIT; local ZIP/ODF/EPUB/PNG helpers                                          |
| D14 | Tesseract.js and models        | Reserved                         | Apache-2.0 library; models must be separately registered before shipping     |
| D15 | Legacy Office readers          | Build ourselves                  | OLE2/CFB is publicly documented; no copyleft reader dependency               |
| D16 | Root-certificate trust lists   | Excluded from bundle             | Verify against browser/OS trust or a user-supplied CA bundle                 |
| D17 | Signature-request naming       | Generic language only            | Use “send for signature via your own email” and avoid vendor-specific verbs  |
| D18 | Relay headless-browser runtime | User-run only                    | Separate optional service; never a default network call from the static app  |

## Verification procedure

1. Run `pnpm verify:licenses` against the frozen lockfile.
2. Run `pnpm verify:assets` for every model, font, ICC profile, schema, and static web asset.
3. Run `pnpm verify:trademarks` before publishing a build.
4. If a dependency changes, update this ADR and the corresponding plan clearance row before merging.
