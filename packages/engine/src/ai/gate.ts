import { AiError } from './errors.js';
import type { AiCallPlan, AiConfirmation, UserGesture } from './types.js';

const GESTURE_MAX_AGE_MS = 60_000;

export function confirmAiCall(
  plan: AiCallPlan,
  gesture: UserGesture,
  now = Date.now(),
): AiConfirmation {
  if (gesture.kind !== 'click' && gesture.kind !== 'keyboard')
    throw new AiError({
      kind: 'ai-gesture-required',
      remedy: 'Start the AI request from an explicit button or keyboard action.',
    });
  if (now < plan.createdAt || now > plan.expiresAt)
    throw new AiError({
      kind: 'ai-confirmation-expired',
      remedy: 'Review the fresh token estimate and confirm the request again.',
    });
  if (now - gesture.occurredAt > GESTURE_MAX_AGE_MS || gesture.occurredAt > now)
    throw new AiError({
      kind: 'ai-gesture-required',
      remedy: 'Use the visible confirmation control immediately before sending.',
    });
  return { planId: plan.planId, confirmedAt: now, gesture };
}

export function assertAiConfirmation(
  plan: AiCallPlan,
  confirmation: AiConfirmation | undefined,
  now = Date.now(),
): void {
  if (!confirmation || confirmation.planId !== plan.planId)
    throw new AiError({
      kind: 'ai-confirmation-required',
      remedy: 'Review the estimate and explicitly confirm before sending document text.',
    });
  confirmAiCall(plan, confirmation.gesture, now);
}
