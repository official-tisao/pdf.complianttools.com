import type { AiCapability } from './types.js';

export type AiErrorDetails =
  | { kind: 'ai-key-not-configured'; providerId: string; remedy: string }
  | { kind: 'ai-key-storage-unavailable'; remedy: string }
  | { kind: 'ai-confirmation-required'; remedy: string }
  | { kind: 'ai-gesture-required'; remedy: string }
  | { kind: 'ai-confirmation-expired'; remedy: string }
  | { kind: 'ai-provider-unreachable'; providerId: string; remedy: string }
  | { kind: 'ai-provider-invalid-response'; providerId: string; remedy: string }
  | { kind: 'ai-provider-unsupported-capability'; capability: AiCapability; remedy: string }
  | { kind: 'ai-no-local-fallback'; capability: AiCapability; remedy: string }
  | { kind: 'ai-context-too-large'; characterCount: number; maxCharacters: number; remedy: string }
  | { kind: 'ai-invalid-connection'; field: string; remedy: string };

export class AiError extends Error {
  readonly details: AiErrorDetails;

  constructor(details: AiErrorDetails) {
    super(details.remedy);
    this.name = 'AiError';
    this.details = details;
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}
