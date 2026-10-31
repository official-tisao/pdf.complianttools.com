import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'fs';

// Reproduce the pdfToCsv splitting logic independently
function splitLine(line) {
  return line.includes('|') ? line.split('|').map((c) => c.trim()) : [line];
}

describe('Phase 4 — CSV column reconstruction (evidence check)', () => {
  it('should show that space-separated lines collapse columns without |', () => {
    // A synthetic 3-column table line without explicit pipe delimiters
    const line = 'Header Blue  Header Blue  Header Blue';
    const split = splitLine(line);
    assert.strictEqual(split.length, 1, 'single cell because no | present');
    assert.strictEqual(split[0], line, 'entire line treated as one column');
  });

  it('should verify table-styled fixture provides no PDF for column-boundary reproduction', () => {
    try {
      readFileSync('fixtures/fidelity/table-styled.pdf');
      assert.fail('fixture PDF unexpectedly exists');
    } catch (e) {
      assert.ok(e.code === 'ENOENT', 'fixture PDF does not exist');
    }
  });

  it('should demonstrate that current split heuristic cannot reconstruct 3 columns from whitespace only', () => {
    // Even with 2+ spaces, split logic doesn't split (only | or whitespace to [line] array entry, not cell split)
    const lines = ['Header Blue   Header Blue   Header Blue', 'Cell gray   Cell gray   Cell gray'];
    const rows = lines.map((line) =>
      line.includes('|') ? line.split('|').map((c) => c.trim()) : [line],
    );
    for (const row of rows) {
      assert.strictEqual(row.length, 1, `expected ambiguous single-column row, got ${row.length}`);
    }
  });
});
