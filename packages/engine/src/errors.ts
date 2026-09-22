export type EngineError =
  | { kind: 'encrypted-unknown-password'; remedy: string }
  | { kind: 'corrupt-structure'; remedy: string; repairable: boolean }
  | { kind: 'unsupported-feature'; feature: string; remedy: string }
  | { kind: 'font-not-embedded-cannot-edit-text'; remedy: string }
  | { kind: 'target-size-unreachable'; achieved: number; remedy: string }
  | { kind: 'ai-provider-unreachable'; providerId: string; remedy: string }
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
    };

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
