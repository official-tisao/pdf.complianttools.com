# Phase C–E Agent Coordination Plan

This document defines the long-horizon execution plan for the three parallel workstreams
requested on 2026-09-28. The coordinating agent owns integration, `PLAN.md`, and
`docs/OPEN-QUESTIONS.md` so status and decisions remain consistent.

## Operating rules

- Base: `master` at the current `origin/master` revision.
- Agents work only in their assigned implementation and test areas. They do not switch branches,
  push, or edit `PLAN.md` or `docs/OPEN-QUESTIONS.md` directly.
- An agent may use a safe, reversible industry-standard default when repository requirements and
  existing defaults make the answer clear. The agent must report that assumption.
- A question is escalated when it changes security/trust semantics, licensing, external data flow,
  public product claims, or an irreversible format contract. The agent reports the exact question,
  options, recommendation, and blocking impact.
- The coordinator de-duplicates each question against `docs/OPEN-QUESTIONS.md`. Existing answered
  questions are not re-added. New unresolved questions are recorded there before implementation
  continues; a material user decision is surfaced to the user.
- A task is complete only with implementation evidence, tests, and an honest limitation statement.
  Agents must not check plan boxes themselves.

## Agent D — OCR and remaining Workstream D

### Objective

Implement the real local OCR path for T63 using the proven `image.complianttools.com` pattern,
then audit Workstream D for any remaining unrecorded gap and produce Gate D evidence.

### Execution order

1. Read the current PDF OCR seam, README §6.7/§7.4, `PLAN.md` P5-04/P5-05, the clearance ADR,
   and the public image implementation (`ocr.ts`, model catalogue, asset register, scripts, and
   OCR E2E tests).
2. Preserve the current PDF engine boundary: render a page locally, pass RGBA pixels to a worker,
   and keep plain-text, invisible-layer, and searchable-PDF output modes typed.
3. Add a version-pinned Tesseract.js worker/core bridge and a generated or verified model catalogue
   with exact source, size, SHA-256, and licence metadata. Models must load only after an explicit
   user action and must never receive PDF/image pixels on a model host.
4. Choose the narrowest delivery policy compatible with the PDF repository defaults: either
   locally bundled approved language models or explicit browser-direct retrieval from exact pinned
   sources with cache/removal/error disclosure. Do not introduce an implicit CDN dependency.
5. Add worker lifecycle, unsupported-language, missing-model, download/hash failure, offline, and
   recognition-error handling with useful typed remedies.
6. Add labelled OCR fixtures and browser/engine tests covering actual recognition, blank pages,
   rotated pages, multi-column text, output modes, explicit model loading, and the documented
   offline boundary. Measure accuracy without claiming universal accuracy.
7. Re-audit viewer, compare, metadata, inspector, and adversarial D coverage; report any discrepancy
   without reopening completed work unnecessarily.

### Completion evidence

- T63 runs real recognition through the local worker on a labelled fixture.
- Model/runtime assets pass the licence, static-asset, source-safety, and hash/size checks.
- No model is fetched during route load; the user action and model size are visible.
- Unit and route E2E tests pass, including typed failure paths and the declared offline boundary.
- The coordinator can change P5-04, T63, and Gate D only after reviewing this evidence.

## Agent C — remaining Workstream C security

### Objective

Close or precisely resolve the remaining cryptographic signature-verification gap without weakening
the repository's trust model.

### Execution order

1. Audit P4-11, Gate C, README signature requirements, `docs/ADR/ip-clearance.md`, current
   signature parsing/verification code, and all C fixtures/tests.
2. Select a permissively licensed CMS/PKCS#7/CAdES verification approach that works in the browser
   or document why the existing platform APIs are insufficient. Do not bundle a root-certificate
   program and do not infer trust from certificate names.
3. Implement verification for a signed fixture and tamper detection using browser/OS trust anchors
   or an explicitly supplied CA bundle, preserving typed states for unsigned, malformed ByteRange,
   unsupported CMS, invalid signature, and untrusted signer.
4. Add deterministic fixtures and tests for valid, tampered, unsupported, and trust-anchor cases.
   Keep private keys and certificate material out of logs, recipes, diagnostics, and committed test
   data unless it is deliberately public fixture material.
5. Re-audit form signatures, protection/unlock, redaction, and C adversarial fixtures for accidental
   overclaims or unsafe fallbacks.

### Completion evidence

- A valid signed fixture verifies cryptographically.
- A tampered fixture fails verification.
- Trust-anchor behavior is explicit and tested; no bundled root authority is claimed.
- Licence/clearance evidence exists for every new dependency or algorithm.
- The coordinator can change P4-11 and Gate C only after reviewing the security evidence.

## Agent E — remaining Workstream E intelligence and escalation

### Objective

Complete the partial translation and escalation work while preserving BYOK, gesture, cost, and
credential-leak invariants.

### Execution order

1. Audit P6-01–P6-11, README §§13–17, the AI justification register, provider adapters, local
   fallbacks, escalation registry, and existing E tests.
2. Finish T67's keyed translation path: preserve page boundaries, validate the provider response
   shape, reflow through the local PDF writer, and report unsupported/malformed/unkeyed states
   without claiming exact visual-layout preservation.
3. Finish P6-10 integration seams for T29/T44/T52/T59/T61. The local result must render first;
   escalation must remain optional, disabled until explicitly enabled, cost-estimated, and
   user-gesture gated.
4. Add route/unit tests for provider absence, malformed responses, local fallback, escalation
   visibility, no-prefetch/no-request behavior, cost confirmation, and credential-leak protection.
5. Re-audit adapter/register parity and every E gate condition. Report any task that is already
   objectively complete but whose plan status is stale.

### Completion evidence

- T67 has a tested keyed path and an honest unkeyed path.
- Each escalation host shows the local result before enabling the optional AI action.
- No provider request occurs without explicit user action and confirmation.
- No credential reaches recipes, logs, URLs, diagnostics, or local engine inputs.
- The coordinator can change P6-08/P6-10 and Gate E only after reviewing the evidence.

## Coordinator integration loop

1. Receive each agent's implementation summary, changed-file list, tests, assumptions, and questions.
2. Surface material questions to the user. If the user is unavailable and the decision is safe and
   reversible, apply the repository's existing default and record it in `docs/OPEN-QUESTIONS.md`.
3. Review disjoint changes, resolve shared-file conflicts, and run the relevant phase tests.
4. Update `PLAN.md` and `docs/OPEN-QUESTIONS.md` in the integration change; never claim completion
   from a code stub or from a test that does not exercise the real path.
5. Run the full verification/build/E2E suite, then report remaining limitations and branch/push
   status to the user.
