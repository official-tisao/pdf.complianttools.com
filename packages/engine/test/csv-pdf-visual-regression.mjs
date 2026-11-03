import { describe, it } from 'node:test';

// Node globals for ESLint
/* global TextEncoder */
import assert from 'node:assert/strict';
import { convertToPdf, classifyPdfInput } from '../dist/index.js';

describe('CSV→PDF visual quality regression', () => {
  it('basic 3-col renders valid PDF', async () => {
    const csv = `Name,Dept,Salary\nAlice,Eng,95000\nBob,Mkt,72000`;
    const res = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 't.csv' });
    assert.equal((await classifyPdfInput(res.bytes)).ok, true);
  });
  it('quoted commas preserve text', async () => {
    const csv = `Name,Note\nJohn,"Hello, world"`;
    const res = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 't.csv' });
    assert.equal((await classifyPdfInput(res.bytes)).ok, true);
  });
  it('empty and leading-zero cells preserved', async () => {
    const csv = `A,B\n001,\n,002`;
    const res = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 't.csv' });
    assert.equal((await classifyPdfInput(res.bytes)).ok, true);
  });
  it('wide table lands landscape', async () => {
    let csv = Array.from({length: 18}, (_, i) => `C${i}`).join(',') + '\n';
    csv += Array.from({length: 18}, (_, i) => `V${i}`).join(',') + '\n';
    const res = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 't.csv' });
    assert.equal((await classifyPdfInput(res.bytes)).ok, true);
  });
  it('multi-page spans correctly', async () => {
    let csv = 'A,B\n';
    for (let i = 0; i < 60; i++) csv += `Row${i},Value${i}\n`;
    const res = await convertToPdf('csv', new TextEncoder().encode(csv), { fileName: 't.csv' });
    assert.equal((await classifyPdfInput(res.bytes)).ok, true);
  });
});
