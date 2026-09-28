import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import {
  ADAPTER_REGISTRY_ROWS,
  AiError,
  ALL_AI_CAPABILITIES,
  AI_ESCALATIONS,
  assertAiConfirmation,
  assertSafeEndpoint,
  confirmAiCall,
  createAdapterRegistry,
  createAiCallPlan,
  createDocumentContext,
  createFixtureConnection,
  createProviderAdapter,
  estimateAiCost,
  extractiveSummary,
  runLearningFallback,
  runLocalFallback,
  parseRecipe,
  parsePageDelimitedTranslation,
  reflowTranslatedPages,
  sanitizeAiDiagnostic,
  validatePageDelimitedTranslation,
} from '../dist/index.js';

const pages = Array.from({ length: 10 }, (_, index) => ({
  pageNumber: index + 1,
  lines: [
    `Section ${index + 1}: Document governance and review obligations.`,
    'This sentence contains enough distinct context to exercise deterministic ranking and local fallback behavior.',
  ],
}));

test('context assembly caps provider input and returns a token estimate', () => {
  const context = createDocumentContext(pages, 180);
  assert.equal(context.truncated, true);
  assert.ok(context.characterCount <= 180);
  assert.ok(context.tokenEstimate > 0);
});

test('local chat and learning fallbacks work without a provider', () => {
  const context = createDocumentContext(pages);
  const chat = runLocalFallback('chat', context, 'governance');
  assert.equal(chat.mode, 'local-fallback');
  assert.match(chat.text, /Page/u);
  assert.ok(extractiveSummary(context).length > 50);
  assert.match(runLearningFallback('flashcards', context).text, /Card 1/u);
  assert.match(runLearningFallback('mind-map', context).text, /Page 1/u);
  assert.throws(
    () => runLocalFallback('translate', context, ''),
    (error) => error.details.kind === 'ai-no-local-fallback',
  );
});

test('cost estimate and confirmation require an explicit, fresh gesture', () => {
  const request = {
    capability: 'chat',
    prompt: 'What changed?',
    context: createDocumentContext(pages),
  };
  const plan = createAiCallPlan(
    'provider-1',
    request,
    { inputPricePerMillionUsd: 1, outputPricePerMillionUsd: 2 },
    10_000,
  );
  assert.equal(plan.estimate.pricingBasis, 'provider-configured');
  assert.throws(
    () => assertAiConfirmation(plan, undefined, 10_001),
    (error) => error.details.kind === 'ai-confirmation-required',
  );
  const confirmation = confirmAiCall(plan, { kind: 'click', occurredAt: 10_001 }, 10_001);
  assert.doesNotThrow(() => assertAiConfirmation(plan, confirmation, 10_001));
  assert.throws(
    () => confirmAiCall(plan, { kind: 'click', occurredAt: -100_000 }, 10_001),
    (error) => error.details.kind === 'ai-gesture-required',
  );
  assert.ok(estimateAiCost(request).totalTokens > 0);
});

test('template adapter round-trips all capabilities without assuming a live schema', async () => {
  const connection = createFixtureConnection('generic-http-template');
  const seen = [];
  const adapter = createProviderAdapter(connection, async (request) => {
    seen.push(request);
    return { status: 200, body: { output: 'fixture response' } };
  });
  for (const capability of ALL_AI_CAPABILITIES) {
    const result = await adapter.invoke({
      request: { capability, prompt: 'hello' },
      connection,
      credential: 'secret-value',
    });
    assert.equal(result.text, 'fixture response');
  }
  assert.equal(seen.length, 4);
  assert.ok(seen.every((request) => !JSON.stringify(request.body).includes('secret-value')));
  assert.ok(seen.every((request) => request.headers.authorization.includes('secret-value')));
});

test('registry exposes the eight planned adapter rows and enforces capability declarations', () => {
  assert.equal(ADAPTER_REGISTRY_ROWS.length, 8);
  const registry = createAdapterRegistry();
  const connection = createFixtureConnection('generic-http-template', 'fixture');
  const adapter = createProviderAdapter(connection, async () => ({
    status: 200,
    body: { output: 'ok' },
  }));
  registry.register(adapter);
  assert.equal(registry.require('fixture', 'translate').id, 'fixture');
  assert.throws(
    () => registry.require('missing', 'chat'),
    (error) => error.details.kind === 'ai-provider-unsupported-capability',
  );
});

test('transport rejects credential-bearing URLs and diagnostics redact secret-shaped fields', () => {
  assert.throws(
    () => assertSafeEndpoint('https://example.test/ai?api_key=secret-value'),
    (error) => error.details.kind === 'ai-invalid-connection',
  );
  const diagnostic = sanitizeAiDiagnostic({
    endpoint: 'https://example.test',
    apiKey: 'secret-value',
    nested: { authorization: 'secret-value' },
  });
  assert.doesNotMatch(JSON.stringify(diagnostic), /secret-value/u);
  assert.equal(diagnostic.apiKey, '[redacted]');
});

test('recipe serialization rejects credentials instead of putting them in a share link', () => {
  assert.throws(
    () =>
      parseRecipe({ version: 'r1', steps: [{ op: 'merge', options: { apiKey: 'secret-value' } }] }),
    (error) =>
      error.details.kind === 'invalid-operation' && error.details.operation === 'recipe-credential',
  );
});

test('all escalation entries are explicit and name their local fallback', () => {
  for (const tool of ['T29', 'T44', 'T52', 'T59', 'T61']) {
    assert.equal(AI_ESCALATIONS[tool].requiresGesture, true);
    assert.ok(AI_ESCALATIONS[tool].localFallback.length > 10);
  }
});

test('translation accepts only ordered page-delimited output', () => {
  const translated = parsePageDelimitedTranslation(
    '---PAGE 1---\nBonjour\n---PAGE 2---\nAu revoir',
    [1, 2],
  );
  assert.deepEqual(
    translated?.map((page) => page.pageNumber),
    [1, 2],
  );
  assert.equal(parsePageDelimitedTranslation('unstructured output', [1, 2]), undefined);
  assert.equal(parsePageDelimitedTranslation('---PAGE 2---\nWrong order', [1]), undefined);
});

test('translation validation distinguishes unkeyed, malformed, and page-mismatch responses', () => {
  assert.equal(validatePageDelimitedTranslation('plain translation', [1]).status, 'unkeyed');
  assert.equal(
    validatePageDelimitedTranslation('Provider preamble\n---PAGE 1---\nBonjour', [1]).status,
    'malformed',
  );
  assert.equal(
    validatePageDelimitedTranslation('---PAGE 1---\nBonjour\n---PAGE 1---\nEncore', [1, 2]).status,
    'page-mismatch',
  );
  assert.equal(
    validatePageDelimitedTranslation('---PAGE 1---\nBonjour\n---PAGE 2---\nAu revoir', [1, 2])
      .status,
    'ok',
  );
});

test('validated translation pages reflow to one local writer page per source page', async () => {
  const bytes = await reflowTranslatedPages([
    { pageNumber: 1, text: 'Bonjour' },
    { pageNumber: 2, text: 'Au revoir\nÀ bientôt' },
  ]);
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 2);
});

test('storage absence is a typed unavailable state instead of a localStorage fallback', async () => {
  const { createIndexedDbKeyStore } = await import('../dist/index.js');
  const store = createIndexedDbKeyStore(undefined);
  await assert.rejects(
    store.listMetadata(),
    (error) => error instanceof AiError && error.details.kind === 'ai-key-storage-unavailable',
  );
});
