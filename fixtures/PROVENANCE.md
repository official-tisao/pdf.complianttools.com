# Fixture provenance

Phase 0 fixtures are synthetic and contain no user data. They exist to exercise failure handling,
security boundaries, and parser behavior without importing copyrighted or sensitive documents.

| Fixture set                 | Origin                                                              | Purpose                                                              |
| --------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `adversarial/*.pdf`         | Hand-authored synthetic byte streams                                | Typed errors, no crashes, and no embedded JavaScript execution       |
| `pdfs/*.pdf`                | Generated locally by `scripts/generate-fixtures.mjs` with `pdf-lib` | Valid one-page/two-page/20-page write/read, worker, and merge proof  |
| `pdfs/hundred-page.pdf`     | Generated locally by `scripts/generate-fixtures.mjs` with `pdf-lib` | Viewer search coverage across 100 pages                              |
| `pdfs/blank-page.pdf`       | Generated locally by `scripts/generate-fixtures.mjs` with `pdf-lib` | OCR blank-page adversarial case; expected empty recognition/fallback |
| `pdfs/rotated-scan.pdf`     | Generated locally by `scripts/generate-fixtures.mjs` with `pdf-lib` | OCR rotation disclosure and page-orientation handling                |
| `pdfs/multi-column.pdf`     | Generated locally by `scripts/generate-fixtures.mjs` with `pdf-lib` | OCR/text-order adversarial case with two bounded columns             |
| `goldens/workstream-d.json` | Hand-authored expected outcomes for synthetic fixtures              | Stable viewer/compare/OCR acceptance expectations; not pixel bytes   |

Regenerate valid PDFs with `node scripts/generate-fixtures.mjs`. Never add a real customer document to
this directory.
