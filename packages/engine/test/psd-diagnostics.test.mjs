import assert from 'node:assert/strict';
import test from 'node:test';
import { psdConversionDiagnostics } from '../dist/index.js';

test('psdConversionDiagnostics reports compression values correctly', () => {
  assert.strictEqual(
    psdConversionDiagnostics({ bytesLength: 56, headerBytes: '8BPS', compression: 0 })
      .compressionClaimed,
    'raw (0)',
  );
  assert.strictEqual(
    psdConversionDiagnostics({ bytesLength: 56, headerBytes: '8BPS', compression: 1 })
      .compressionClaimed,
    'PackBits (1)',
  );
  assert.strictEqual(
    psdConversionDiagnostics({ bytesLength: 56, headerBytes: '8BPS', compression: 2 })
      .compressionClaimed,
    'ZIP (2) unsupported by this decoder',
  );
  assert.strictEqual(
    psdConversionDiagnostics({ bytesLength: 56, headerBytes: '8BPS', compression: 99 })
      .compressionClaimed,
    'unknown (99)',
  );
  assert.strictEqual(
    psdConversionDiagnostics({ bytesLength: 56, headerBytes: '8BPS' }).compressionClaimed,
    'unknown (needs section parse)',
  );
});
