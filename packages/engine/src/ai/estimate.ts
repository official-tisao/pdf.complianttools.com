import type { AiCallPlan, AiCostEstimate, AiDocumentContext, AiOperationRequest } from './types.js';

const DEFAULT_OUTPUT_TOKENS = 512;
const PLAN_TTL_MS = 5 * 60 * 1000;

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

export function estimateAiCost(
  request: AiOperationRequest,
  pricing: Readonly<{
    inputPricePerMillionUsd?: number;
    outputPricePerMillionUsd?: number;
    outputTokens?: number;
  }> = {},
): AiCostEstimate {
  const inputCharacters = request.prompt.length + (request.context?.characterCount ?? 0);
  const inputTokens = estimateTokens(request.prompt) + (request.context?.tokenEstimate ?? 0);
  const outputTokens = pricing.outputTokens ?? DEFAULT_OUTPUT_TOKENS;
  const estimatedUsd =
    pricing.inputPricePerMillionUsd !== undefined && pricing.outputPricePerMillionUsd !== undefined
      ? (inputTokens * pricing.inputPricePerMillionUsd +
          outputTokens * pricing.outputPricePerMillionUsd) /
        1_000_000
      : undefined;
  return {
    inputCharacters,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(estimatedUsd === undefined ? {} : { estimatedUsd }),
    pricingBasis: estimatedUsd === undefined ? 'provider-pricing-unknown' : 'provider-configured',
  };
}

export function createAiCallPlan(
  providerId: string,
  request: AiOperationRequest,
  pricing?: Readonly<{
    inputPricePerMillionUsd?: number;
    outputPricePerMillionUsd?: number;
    outputTokens?: number;
  }>,
  now = Date.now(),
): AiCallPlan {
  const planId = makePlanId(now);
  return {
    planId,
    providerId,
    capability: request.capability,
    estimate: estimateAiCost(request, pricing),
    createdAt: now,
    expiresAt: now + PLAN_TTL_MS,
  };
}

export function createDocumentContext(
  pages: readonly Readonly<{ pageNumber: number; lines: readonly string[] }>[],
  maxCharacters = 120_000,
  maxPages = 100,
): AiDocumentContext {
  const selected: { pageNumber: number; text: string }[] = [];
  let text = '';
  let truncated = false;
  for (const [pageIndex, page] of pages.entries()) {
    if (pageIndex >= maxPages) {
      truncated = true;
      break;
    }
    const pageText = page.lines.join('\n').trim();
    if (!pageText) continue;
    const prefix = text ? '\n\n' : '';
    const remaining = maxCharacters - text.length - prefix.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const included = pageText.slice(0, remaining);
    text += prefix + included;
    selected.push({ pageNumber: page.pageNumber, text: included });
    if (included.length < pageText.length) {
      truncated = true;
      break;
    }
  }
  return {
    pages: selected,
    text,
    characterCount: text.length,
    tokenEstimate: estimateTokens(text),
    truncated,
  };
}

function makePlanId(now: number): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `ai-plan-${now}-${Math.random().toString(36).slice(2, 10)}`;
}
