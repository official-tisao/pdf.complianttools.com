# Workstream F gate evidence

This file records the implementation boundary and the commands used for Gate F. It is intentionally
specific about what is and is not claimed.

## Shipped evidence

- `apps/relay/src/guard.ts` holds the SSRF guard as pure functions: `isPrivateIp`, `allowedUrl` for
  the pre-flight capture target, and `isPermittedRequest` for every request the browser is about to
  make. No module-level env reads, no server, no side effects.
- `apps/relay/src/server.ts` exposes `createRelayServer(options)`, which builds the HTTP surface
  without binding a port and accepts an injectable `launch`, so the contract is testable in an
  environment with no browser installed.
- `apps/relay/src/index.ts` is a thin bin entry. It binds only when executed directly, so importing
  it can never leave a listening socket open.
- `apps/relay/test/guard.test.mjs` covers the private/reserved IPv4 and IPv6 matrix, the loopback,
  `localhost`, `*.localhost`, and cloud-metadata targets, non-http schemes, the
  `RELAY_ALLOW_PRIVATE_NETWORK` opt-in, and unresolvable hosts via the reserved `.invalid` TLD —
  with no network dependency.
- `apps/relay/test/server.test.mjs` covers `/health` in both private-network modes, the typed 404,
  the 400 `invalid-url` path, and the 503 remedy emitted when the headless browser is missing.
- `apps/relay/test/render.test.mjs` renders a local synthetic page through a real headless Chromium
  and asserts `%PDF-` bytes, `application/pdf`, `cache-control: no-store`, and a two-page document.
  A second test proves a `file://` subresource is blocked and its contents absent from the output.
  A third drives the capture from a real browser page rather than from Node, which is the only place
  the cross-origin path exists. All three skip cleanly when the Playwright browser binary is absent,
  which is the state of the CI unit job.
- `apps/relay/src/server.ts` answers the CORS preflight and sets `Access-Control-Allow-Origin` from
  an explicit allow-list, so the app on one origin can reach a Relay on another. Without it the
  browser dropped the request and the user saw "Failed to fetch" — the exact generic error that
  remedy propagation exists to replace. The origin list is `RELAY_ALLOWED_ORIGINS`, defaulting to the
  production domain and the local dev/preview server; `*` is honoured only when set explicitly.
- `apps/web/src/lib/FeaturePage.svelte` — `webpage()` catches a failed capture and writes the error
  message to the status line, which for a `PdfEngineError` is the remedy. The button is disabled
  while the endpoint is blank, so an unconfigured app never pretends a Relay exists.
- `packages/engine/src/relay.ts` preserves the Relay's own `remedy` and `error` code instead of
  collapsing every failure into one message, so a blocked URL and a missing browser binary are
  distinguishable by the user.
- `packages/engine/test/phasef.test.mjs` covers the opt-in guard, remedy propagation, the
  non-JSON-error fallback, and the successful byte path through an injected fetcher.
- `tests/e2e/phase-f.spec.ts` covers the unconfigured case (the capture button is disabled, the other
  local tools still work) and two failure modes, asserting the Relay's own remedy reaches the status
  line rather than silence. Both were confirmed to fail against the pre-fix handler.

## Deliberate limits

- **The Relay is single-origin by default.** Only the production domain and the local dev/preview
  server may call it. A user self-hosting the Relay behind another host must set
  `RELAY_ALLOWED_ORIGINS`; this is deliberate, so that a page the user happens to visit cannot drive
  a Relay running on their machine.

- **The DNS rebinding window is narrowed, not closed.** `isPermittedRequest` re-resolves at request
  time and Playwright's catch-all route intercepts the top-frame document request, so the previous
  "check one address, navigate to another" gap is closed. A hostile resolver with a sub-second TTL
  can still return a different answer to this lookup than to Chromium's own resolver moments later.
  Eliminating that requires connecting Chromium to the exact address validated here via
  Host-preserving IP pinning, which was verified to work but rewrites resolution for every host in
  the page and is a larger change. It is recorded as a follow-up, not claimed as done.
- The guard blocks reserved ranges, not every non-global address. `100.64.0.0/10`, `198.18.0.0/15`,
  `240.0.0.0/4`, and the NAT64 prefix are not treated as private. Out of scope for P7-06.
- Each capture launches its own browser. There is no pool or queue, so concurrent requests multiply
  process count. Deliberately left alone here.
- Request bodies are read without a size cap, and a malformed body returns 503 rather than 400.
  Both predate this work and are unchanged.
- Relay responses are not size- or time-bounded beyond the 30s navigation timeout.

## Gate commands

Run from the repository root:

```text
pnpm format:check
pnpm lint
pnpm verify:source-safety
pnpm typecheck
pnpm --filter @pdf-complianttools/relay test
pnpm test
pnpm build
pnpm test:e2e
pnpm verify:licenses
pnpm verify:assets
pnpm verify:trademarks
pnpm verify:plan-sync
```

The render tests require `pnpm exec playwright install --with-deps chromium`. Without it they report
as skipped, never as failed, so the unit job stays green.
