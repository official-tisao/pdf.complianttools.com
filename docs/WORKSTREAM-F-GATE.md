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

## Scan to PDF (P7-04 / T40)

- `packages/engine/src/scan-deskew.ts` implements rotation deskew from pixels: Otsu binarization, an
  ink projection, a variance sweep across ±15° at 0.1° steps, and a parabolic sub-step refinement.
  The angle that makes the profile sharpest is the skew. It is deterministic, dependency-free, and
  touches no DOM, so the same code runs in a module worker and in Node.
- `rotateGrayscale` samples bilinearly and crops to the largest axis-aligned rectangle that fits
  inside the rotated page, so a correction never leaves black wedges along two edges.
- `packages/engine/src/scan-deskew.worker.ts` runs the correction off the main thread, transferring
  the pixel buffer rather than copying it (README §8.4). Where no `Worker` exists, `deskewInWorker`
  falls back to the same synchronous code and returns `ranInWorker: false`, so a caller is never told
  a worker ran when it did not.
- `packages/engine/src/runtime/module-worker.ts` now carries typed `details` across the boundary. It
  previously reduced every worker failure to a bare string, which cost the user the remedy — the
  exact failure P8 exists to prevent. `inspect.worker.ts` and the other existing workers are
  unaffected: `details` is optional.
- **Two error branches were wrong and are now fixed rather than papered over.** A rejected
  `getUserMedia` used to become `permission-denied` unconditionally, so a device with **no camera**
  was told to "allow camera access" — advice that cannot succeed. Rejections are now classified by
  `DOMException` name into `permission-denied` versus a new `camera-unavailable`. Separately, a
  corrupt page reached the user as a blank status line: the decoders throw bare library errors, and
  for a truncated PNG a non-`Error` with no `message` at all. `assembleScans` now re-throws as
  `unsupported-format` naming the page position and format.
- The route requests camera permission only on the Start-camera gesture, never on load, and releases
  the stream on Stop and on unmount. The status line previously claimed permission "is only requested
  after an explicit capture action" while no such action existed; the claim is now literally true.
- `fixtures/p7-04/` is 8 pages at known rotations (−8, −4.5, −2, 0, +1.5, +3, +6, +11°) with the
  ground truth written by the generator, not derived from the estimator.
  `packages/engine/test/scan-fixtures.test.mjs` decodes them with a strict reader written for the
  test rather than with the generator's own inverse — validating a writer with its own decoder would
  only prove the two agree, and a bug that corrupted pixels identically in both directions would pass.
- Evidence: `docs/release-gate/P7-04-evidence.json`, regenerated by `pnpm measure:skew`
  (`scripts/measure-skew.mjs`). Worst residual after correction **0.05°** against a 0.5° tolerance;
  mean detection error 0.018°. The script runs the shipped estimator, so a regression surfaces as a
  larger residual rather than a stale "PASS". Method and scope: `P7-04-deskew-plan.txt`.
- `tests/e2e/phase-f.spec.ts` proves in a real browser that loading the route never calls
  `getUserMedia`, that a denied permission and an absent camera produce different remedies, and that
  the file-input path still assembles a PDF with no camera present.

## Deliberate limits

- **Scan corrects both rotation and perspective now, and is still `[/]`.** README §4.5 specifies
  "perspective deskew", and `packages/engine/src/scan-perspective.ts` implements it: flood-fill the
  bright page region, fit a line to each of the four edges, intersect them for the corners, and
  rectify through an 8-DOF homography solved as target-to-source so every output pixel knows where
  to read from. T40 is not `[x]` because of STCC, not because of the geometry — the route still has
  no Zod schema with generated controls, no preview-fidelity path, no i18n message layer, and no
  measured §19 latency budget for the capture path.

- **The perspective detector's assumptions are real limits, not hedges.** It assumes a page that is
  _brighter_ than its surroundings and that occupies enough of the frame. A page on a dark desk, or
  one filling the frame edge to edge, is declined with a stated `PerspectiveEstimate.reason` rather
  than guessed at, and the estimate carries `keystone` and `confidence` so a caller can decide not
  to trust it. No shadow removal, and no refinement against a torn or curled page edge.

- **The scan fixtures are drawn pages, not photographs.** They exercise the estimator, the rotation
  correction and the rectifier, not photograph-specific artefacts — lens distortion, uneven lighting,
  page curl, or sensor noise. The evidence is a claim about the geometry, not about the tool's
  behaviour on a real phone. Unlike P7-02, no physical device has photographed a page;
  `P7-04-deskew-plan.txt` says so.

- **Detection and correction are the only deskew-adjacent claims.** No page-boundary detection, no
  shadow removal, no background flattening, and no OCR — a corrected scan is still a scanned image
  until T63's runtime boundary is resolved.

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
pnpm measure:skew
```

`pnpm measure:skew` regenerates `docs/release-gate/P7-04-evidence.json` from the
`fixtures/p7-04/` set and exits non-zero if any fixture regresses. Run it after
changing `packages/engine/src/scan-deskew.ts`; the fixtures themselves are
regenerated with `pnpm fixtures:skew`, which should only be needed if the page model
changes.

The render tests require `pnpm exec playwright install --with-deps chromium`. Without it they report
as skipped, never as failed, so the unit job stays green.
