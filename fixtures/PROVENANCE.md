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

## Workstream C additions

- `adversarial/malformed-acroform.pdf` — hand-authored malformed AcroForm field tree; expected
  behavior is a typed corrupt-structure outcome, never recursive traversal.
- `adversarial/self-referential-annotation.pdf` — hand-authored self-referential annotation/page
  objects; expected behavior is a typed corrupt-structure outcome.
- `adversarial/oversized-signature.pdf` — hand-authored signature widget with intentionally
  unreasonable coordinates; expected behavior is a typed unsupported/corrupt outcome with a remedy.

## Workstream F additions

- `p7-03/sample-invoice.xml` — UBL-style invoice generated locally by
  `createInvoicePdf` from synthetic data (fake supplier/customer, no real business). Used to prove the
  shipped XML round-trips through the structural validator and that its stated net, tax and gross
  reconcile to the cent. Regenerate with the same `InvoiceData` in
  `packages/engine/test/phasef.test.mjs`.
- `p7-04/skew-*.png` and `p7-04/skew-manifest.json` — pages of synthetic text rules drawn at known
  rotations (−8°, −4.5°, −2°, 0°, +1.5°, +3°, +6°, +11°) by
  `scripts/generate-skew-fixtures.mjs`. These are the "deliberately skewed fixture set" of P7-04's
  Done-when: the manifest records the angle each page was drawn at, so a measurement compares the
  shipped estimator's output against a ground truth held outside the code under test. `skew-upright.png`
  is the control — an already-straight page that must be left untouched. Regenerate with
  `node scripts/generate-skew-fixtures.mjs`; re-measure with `node scripts/measure-skew.mjs`.
  These are rendered text rules, not photographs of paper: they exercise the estimator and the
  correction, not lens distortion, uneven lighting, or page curl.
