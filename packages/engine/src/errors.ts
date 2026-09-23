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
    }
  | { kind: 'memory-limit-exceeded'; projectedBytes: number; maxBytes: number; remedy: string }
  | { kind: 'cancelled'; remedy: string }
  | { kind: 'invalid-operation'; operation: string; remedy: string }
  | { kind: 'permission-denied'; resource: string; remedy: string }
  | { kind: 'relay-not-configured'; remedy: string }
  | { kind: 'relay-failed'; endpoint: string; cause: string; remedy: string }
  | { kind: 'watcher-stopped'; remedy: string };

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
