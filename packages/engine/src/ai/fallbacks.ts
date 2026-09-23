import { AiError } from './errors.js';
import type { AiCapability, AiDocumentContext, AiTextPage, LocalAiResult } from './types.js';

type Sentence = Readonly<{
  text: string;
  pageNumber: number;
  score: number;
  heading: boolean;
}>;

export function searchDocument(
  pages: readonly AiTextPage[],
  query: string,
): Readonly<{
  matches: readonly Readonly<{ pageNumber: number; excerpt: string }>[];
  text: string;
}> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle)
    return { matches: [], text: 'Enter a search question to search the document locally.' };
  const matches = pages.flatMap((page) => {
    const lower = page.text.toLocaleLowerCase();
    const index = lower.indexOf(needle);
    if (index < 0) return [];
    const start = Math.max(0, index - 100);
    return [
      { pageNumber: page.pageNumber, excerpt: page.text.slice(start, index + needle.length + 140) },
    ];
  });
  return {
    matches,
    text: matches.length
      ? matches.map((match) => `Page ${match.pageNumber}: ${match.excerpt}`).join('\n\n')
      : 'No exact local match found. Review the extracted pages or connect a provider for open-ended questions.',
  };
}

export function extractiveSummary(context: AiDocumentContext, limit = 8): string {
  const sentences = rankSentences(context.pages);
  if (!sentences.length) return 'No extractable text was found in this document.';
  const chosen = sentences
    .slice(0, limit)
    .sort((a, b) => a.pageNumber - b.pageNumber || a.text.localeCompare(b.text));
  return chosen.map((sentence) => `- ${sentence.text}`).join('\n');
}

export function runLocalFallback(
  capability: AiCapability,
  context: AiDocumentContext,
  prompt: string,
): LocalAiResult {
  switch (capability) {
    case 'chat': {
      const result = searchDocument(context.pages, prompt);
      return {
        capability,
        mode: 'local-fallback',
        title: 'Local document search',
        text: result.text,
        matches: result.matches,
      };
    }
    case 'summarize':
      return {
        capability,
        mode: 'local-fallback',
        title: 'Extractive summary',
        text: extractiveSummary(context),
      };
    case 'translate':
      throw new AiError({
        kind: 'ai-no-local-fallback',
        capability,
        remedy:
          'Translation requires a connected provider. The original document remains unchanged.',
      });
    case 'generate':
      throw new AiError({
        kind: 'ai-no-local-fallback',
        capability,
        remedy:
          'Prompt generation requires a connected provider. Use a deterministic document builder for structured output.',
      });
  }
}

export function runLearningFallback(
  mode: 'summary' | 'quiz' | 'flashcards' | 'mind-map',
  context: AiDocumentContext,
): LocalAiResult {
  const sentences = rankSentences(context.pages).slice(0, 8);
  if (mode === 'summary') return runLocalFallback('summarize', context, '');
  if (!sentences.length)
    return {
      capability: 'summarize',
      mode: 'local-fallback',
      title: 'Local learning aid',
      text: 'No extractable text was found.',
    };
  if (mode === 'flashcards')
    return {
      capability: 'summarize',
      mode: 'local-fallback',
      title: 'Local flashcards',
      text: sentences
        .map(
          (sentence, index) =>
            `**Card ${index + 1} — Page ${sentence.pageNumber}**\n${sentence.text}`,
        )
        .join('\n\n'),
    };
  if (mode === 'mind-map')
    return {
      capability: 'summarize',
      mode: 'local-fallback',
      title: 'Local mind map',
      text: sentences
        .map((sentence) => `- Page ${sentence.pageNumber}\n  - ${sentence.text}`)
        .join('\n'),
    };
  return {
    capability: 'summarize',
    mode: 'local-fallback',
    title: 'Local practice questions',
    text: sentences
      .map(
        (sentence, index) =>
          `${index + 1}. Which idea is expressed by: “${sentence.text}”\n   Review page ${sentence.pageNumber}.`,
      )
      .join('\n\n'),
  };
}

function rankSentences(pages: readonly AiTextPage[]): Sentence[] {
  const raw = pages.flatMap((page) =>
    page.text
      .split(/(?<=[.!?])\s+|\n+/u)
      .map((text) => text.trim())
      .filter((text) => text.length >= 25)
      .map((text) => ({ text, pageNumber: page.pageNumber })),
  );
  const documents = raw.map((item) => new Set(tokens(item.text)));
  const frequencies = new Map<string, number>();
  for (const document of documents)
    for (const token of document) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return raw
    .map((item) => {
      const words = tokens(item.text);
      const tfidf =
        words.reduce(
          (sum, word) => sum + Math.log((raw.length + 1) / (frequencies.get(word) ?? 1)),
          0,
        ) / Math.max(words.length, 1);
      const heading = /^\d+(?:\.\d+)*\s|^[A-Z][A-Z\s]{4,}:$/u.test(item.text);
      return { ...item, score: tfidf + (heading ? 1 : 0), heading };
    })
    .sort(
      (a, b) => b.score - a.score || a.pageNumber - b.pageNumber || a.text.localeCompare(b.text),
    );
}

function tokens(value: string): string[] {
  return value.toLocaleLowerCase().match(/[a-z0-9]{3,}/gu) ?? [];
}
