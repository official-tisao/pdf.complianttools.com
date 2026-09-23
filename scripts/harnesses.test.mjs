import test from 'node:test';
import assert from 'node:assert/strict';
import { assertNoCredentialLeak } from './credential-leak-harness.mjs';
import { runNoNetworkCheck } from './no-network-harness.mjs';

test('no-network harness passes a local operation', async () => {
  await runNoNetworkCheck(async () => 'local result');
});

test('credential-leak harness rejects a leaked key', () => {
  assert.throws(() => assertNoCredentialLeak({ message: 'sk-live-secret' }, 'sk-live-secret'));
  assert.doesNotThrow(() =>
    assertNoCredentialLeak({ message: 'provider unavailable' }, 'sk-live-secret'),
  );
});
