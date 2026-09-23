import type { AiCapability } from './types.js';

export type EscalationId = 'T29' | 'T44' | 'T52' | 'T59' | 'T61';

export type AiEscalation = Readonly<{
  tool: EscalationId;
  capability: AiCapability;
  label: string;
  reason: string;
  localFallback: string;
  requiresGesture: true;
}>;

export const AI_ESCALATIONS: Readonly<Record<EscalationId, AiEscalation>> = Object.freeze({
  T29: {
    tool: 'T29',
    capability: 'summarize',
    label: 'Improve Markdown structure with AI',
    reason:
      'Inferring structure with no visual cues requires judgement beyond deterministic extraction.',
    localFallback: 'Best-effort Markdown with a structure-review warning.',
    requiresGesture: true,
  },
  T44: {
    tool: 'T44',
    capability: 'chat',
    label: 'Suggest fields with AI',
    reason: 'Messy flat forms need judgement about intended field boundaries.',
    localFallback: 'Manual field placement remains available.',
    requiresGesture: true,
  },
  T52: {
    tool: 'T52',
    capability: 'generate',
    label: 'Draft alt text with AI',
    reason:
      'Describing image content requires captioning judgement unavailable in the local audit.',
    localFallback: 'Structural tagging audit plus a manual alt-text field.',
    requiresGesture: true,
  },
  T59: {
    tool: 'T59',
    capability: 'chat',
    label: 'Classify possible PII with AI',
    reason: 'Free-text PII in messy scans needs context beyond deterministic pattern flags.',
    localFallback: 'Regex and preset pattern flags run first.',
    requiresGesture: true,
  },
  T61: {
    tool: 'T61',
    capability: 'summarize',
    label: 'Summarize semantic changes with AI',
    reason: 'Meaning-level synthesis is generative while exact text and pixel diffs are local.',
    localFallback: 'Exact text diff and visual comparison run first.',
    requiresGesture: true,
  },
});
