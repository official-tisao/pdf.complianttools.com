# Workstream E gate evidence

This file records the implementation boundary and the commands used for Gate E. It is intentionally
specific about what is and is not claimed.

## Shipped evidence

- `packages/engine/src/ai/` contains the provider-neutral contract, template-driven adapter families,
  registry, IndexedDB-only key store, redacted diagnostics, token/cost estimate, explicit gesture gate,
  local document search, TF-IDF/heading-weighted extraction, learning fallbacks, and five escalation
  records.
- `apps/web/src/routes/connect-ai/+page.svelte` is the teaching/configuration page. It does not embed
  live provider schemas; the user supplies the current request template and response path.
- `/ai/chat-with-pdf`, `/ai/summarize`, `/ai/translate`, `/ai/generate-pdf`, and `/ai/escalations` are
  visible routes. Local work is the first action; translation and prompt generation state the precise
  no-local-fallback remedy when unconfigured.
- `packages/engine/test/workstream-e.test.mjs` covers the 10-page fallback fixture shape, all four
  capabilities through a mock transport, the gate, URL/diagnostic credential controls, the eight
  registry rows, and typed storage absence.
- `scripts/harnesses.test.mjs` covers URL credential leakage in addition to diagnostic leakage.

## Deliberate limits

- No provider's live request/response schema is hardcoded or verified by this repository. Connections
  are template-driven and must follow the provider's current documentation.
- A translated response is only safe to reflow when it preserves the requested page-delimited shape;
  malformed or unstructured output creates no PDF. The accepted text is reflowed through the local
  writer for review, while exact visual layout fidelity is not claimed.
- The current branch does not contain the unfinished C/D host implementations for T44, T52, T59, and
  T61. Their shared typed escalation entries and remedy page are shipped; host-tool integration is
  left to those workstreams rather than fabricated here.

## Gate commands

Run from the repository root on `phase-e`:

```text
pnpm format:check
pnpm lint
pnpm verify:source-safety
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:licenses
pnpm verify:assets
pnpm verify:trademarks
pnpm verify:plan-sync
```
