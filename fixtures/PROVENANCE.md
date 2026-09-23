# Fixture provenance

Phase 0 fixtures are synthetic and contain no user data. They exist to exercise failure handling,
security boundaries, and parser behavior without importing copyrighted or sensitive documents.

| Fixture set         | Origin                                                              | Purpose                                                             |
| ------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `adversarial/*.pdf` | Hand-authored synthetic byte streams                                | Typed errors, no crashes, and no embedded JavaScript execution      |
| `pdfs/*.pdf`        | Generated locally by `scripts/generate-fixtures.mjs` with `pdf-lib` | Valid one-page/two-page/20-page write/read, worker, and merge proof |

Regenerate valid PDFs with `node scripts/generate-fixtures.mjs`. Never add a real customer document to
this directory.
