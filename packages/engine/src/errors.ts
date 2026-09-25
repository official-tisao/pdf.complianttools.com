export type EngineError =
  | { kind: 'encrypted-unknown-password'; remedy: string }
  | { kind: 'corrupt-structure'; remedy: string; repairable: boolean }
  | { kind: 'unsupported-feature'; feature: string; remedy: string }
  | { kind: 'font-not-embedded-cannot-edit-text'; remedy: string }
  | { kind: 'target-size-unreachable'; achieved: number; remedy: string }
  | { kind: 'ai-provider-unreachable'; providerId: string; remedy: string }
  | { kind: 'renderer-unavailable'; feature: string; remedy: string }
  | {
      kind: 'ocr-model-unavailable';
      language: string;
      modelBytes?: number;
      remedy: string;
    }
  | { kind: 'ocr-runtime-unavailable'; remedy: string }
  | {
      kind: 'unsupported-format';
      format: string;
      direction: 'to-pdf' | 'from-pdf';
      remedy: string;
    }
  | {
      kind: 'conversion-failed';
      format: string;
      direction: 'to-pdf' | 'from-pdf';
      cause: string;
      remedy: string;
    }
  | { kind: 'memory-limit-exceeded'; projectedBytes: number; maxBytes: number; remedy: string }
  | { kind: 'cancelled'; remedy: string }
  | { kind: 'invalid-operation'; operation: string; remedy: string }
  | { kind: 'redaction-verification-failed'; findings: readonly string[]; remedy: string }
  | { kind: 'credential-required'; channel: string; remedy: string }
  | { kind: 'signature-unverified'; reason: string; remedy: string };

export class PdfEngineError extends Error {
  readonly details: EngineError;

  constructor(details: EngineError) {
    super(details.remedy);
    this.name = 'PdfEngineError';
    this.details = details;
  }
}

export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
