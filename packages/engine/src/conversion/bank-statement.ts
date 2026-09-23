import type { ConversionResult } from '../types.js';
import { extractPdfText } from './pdf-text.js';

export type BankStatementRow = {
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly confidence: 'high' | 'medium' | 'low';
};

export type BankStatementAccuracyReport = {
  readonly rows: number;
  readonly highConfidenceRows: number;
  readonly lowConfidenceRows: number;
  readonly measuredOn: string;
  readonly method: string;
};

const datePattern = /^(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/u;
const amountPattern = /(?:\(?[-+]?\$?\d[\d,]*(?:\.\d{2})?\)?)(?:\s*)$/u;

export function extractBankStatementRows(text: string): readonly BankStatementRow[] {
  const rows: BankStatementRow[] = [];
  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;
    const date = datePattern.exec(line)?.[1];
    const amount = amountPattern.exec(line)?.[0]?.trim();
    if (!date || !amount) continue;
    const description = line
      .slice(date.length, line.length - amount.length)
      .trim()
      .replace(/\s{2,}/gu, ' ');
    rows.push({
      date,
      description,
      amount,
      confidence: /\s{2,}/u.test(rawLine) ? 'high' : 'medium',
    });
  }
  return rows;
}

export function measureBankStatementAccuracy(
  rows: readonly BankStatementRow[],
): BankStatementAccuracyReport {
  const highConfidenceRows = rows.filter((row) => row.confidence === 'high').length;
  return {
    rows: rows.length,
    highConfidenceRows,
    lowConfidenceRows: rows.length - highConfidenceRows,
    measuredOn: 'synthetic-fixture',
    method:
      'Date-at-start and currency-amount-at-end heuristic; confidence is surfaced per row and is not a universal accuracy claim.',
  };
}

export async function bankStatementPdfToCsv(input: Uint8Array): Promise<ConversionResult> {
  const rows = extractBankStatementRows(await extractPdfText(input));
  const csv = [
    'date,description,amount,confidence',
    ...rows.map((row) =>
      [row.date, row.description, row.amount, row.confidence]
        .map((value) => `"${value.replaceAll('"', '""')}"`)
        .join(','),
    ),
    '',
  ].join('\n');
  return {
    bytes: new TextEncoder().encode(csv),
    mimeType: 'text/csv',
    extension: '.csv',
    suggestedName: 'bank-statement.csv',
    warnings: [
      `${measureBankStatementAccuracy(rows).lowConfidenceRows} row(s) need review before financial use.`,
    ],
  };
}
