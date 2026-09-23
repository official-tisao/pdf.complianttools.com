# Fixture provenance

Phase 0 fixtures are synthetic and contain no user data. They exist to exercise failure handling,
security boundaries, and parser behavior without importing copyrighted or sensitive documents.

| Fixture set         | Origin                                                              | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `adversarial/*.pdf` | Hand-authored synthetic byte streams                                | Typed errors, no crashes, and no embedded JavaScript execution      |
| `pdfs/*.pdf`        | Generated locally by `scripts/generate-fixtures.mjs` with `pdf-lib` | Valid one-page/two-page/20-page write/read, worker, and merge proof |

Regenerate valid PDFs with `node scripts/generate-fixtures.mjs`. Never add a real customer document to
this directory.

## Workstream C additions

- `adversarial/malformed-acroform.pdf` — hand-authored malformed AcroForm field tree; expected
  behavior is a typed corrupt-structure outcome, never recursive traversal.
- `adversarial/self-referential-annotation.pdf` — hand-authored self-referential annotation/page
  objects; expected behavior is a typed corrupt-structure outcome.
- `adversarial/oversized-signature.pdf` — hand-authored signature widget with intentionally
  unreasonable coordinates; expected behavior is a typed unsupported/corrupt outcome with a remedy.
