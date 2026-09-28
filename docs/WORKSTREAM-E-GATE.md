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
- `apps/web/src/lib/AiEscalationControl.svelte` is wired into the T29, T44, T52, T59, and T61 host
  surfaces. Its action is disabled until the local result exists, then prepares a costed plan only
  after an explicit click and still requires the existing confirmation control before sending.
- `packages/engine/test/workstream-e.test.mjs` covers the 10-page fallback fixture shape, all four
  capabilities through a mock transport, the gesture gate, URL/diagnostic credential controls, the
  eight registry rows, typed storage absence, strict translation response states, and local PDF
  reflow with one output page per validated source page.
- `tests/e2e/workstream-e.spec.ts` covers no-prefetch host controls, local-result-first unlocking
  for T29/T44/T52/T59/T61, provider absence, and the no-external-request boundary.
- `scripts/harnesses.test.mjs` covers URL credential leakage in addition to diagnostic leakage.

## Deliberate limits

- No provider's live request/response schema is hardcoded or verified by this repository. Connections
  are template-driven and must follow the provider's current documentation.
- A translated response is only safe to reflow when it preserves the requested page-delimited shape;
  unkeyed, malformed, out-of-order, duplicate, or incomplete output creates no PDF. The accepted
  text is reflowed through the local writer for review, one output page per source page, while exact
  visual layout fidelity is not claimed.
- The five host integrations send only the already-rendered local result as escalation context. They
  do not pretend to provide a missing C/D local implementation, and their optional provider result
  is review-only until the host tool applies it explicitly.

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
