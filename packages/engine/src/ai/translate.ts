import type { AiTextPage } from './types.js';
import { textPagesToPdf } from '../conversion/pdf-text.js';

const PAGE_MARKER = /^---PAGE\s+([1-9]\d*)---[ \t]*$/gm;

export type TranslationParseStatus = 'ok' | 'unkeyed' | 'malformed' | 'page-mismatch';

export type TranslationParseResult = Readonly<
  | { status: 'ok'; pages: readonly AiTextPage[] }
  | { status: Exclude<TranslationParseStatus, 'ok'>; observedPages: readonly number[] }
>;

/**
 * Validate the provider contract before any translated output is handed to the PDF writer.
 *
 * The provider must return exactly one marker per source page, in source order, with no prose
 * outside the keyed sections. This intentionally rejects otherwise plausible but ambiguous output
 * so a partial translation can never be mistaken for a complete document.
 */
export function validatePageDelimitedTranslation(
  value: string,
  expectedPages: readonly number[],
): TranslationParseResult {
  const source = value.replace(/\r\n?/gu, '\n').trim();
  const markers = [...source.matchAll(PAGE_MARKER)];
  if (!markers.length)
    return {
      status: 'unkeyed',
      observedPages: [],
    };

  const observedPages = markers.map((marker) => Number(marker[1]));
  if (markers[0]?.index !== 0 || !markers.every((marker) => marker.index !== undefined))
    return { status: 'malformed', observedPages };

  const firstMarker = markers[0];
  const lastMarker = markers[markers.length - 1];
  if (!firstMarker || !lastMarker) return { status: 'malformed', observedPages };

  // Text after the final marker is the final page body, not prose outside the keyed sections.
  // It is validated in the page loop below alongside every other page body.
  if (markers.length !== expectedPages.length) return { status: 'page-mismatch', observedPages };

  const pages: AiTextPage[] = [];
  for (const [index, marker] of markers.entries()) {
    const rawPageNumber = marker[1];
    const expectedPage = expectedPages[index];
    const start = (marker.index ?? 0) + marker[0].length;
    const nextMarker = markers[index + 1];
    const end = nextMarker === undefined ? source.length : (nextMarker.index ?? source.length);
    const text = source.slice(start, end).trim();
    const pageNumber = Number(rawPageNumber);
    if (!rawPageNumber || !text) return { status: 'malformed', observedPages };
    if (pageNumber !== expectedPage) return { status: 'page-mismatch', observedPages };
    pages.push({ pageNumber, text });
  }

  return { status: 'ok', pages };
}

/** Accept only structured output that can be reflowed page-by-page safely. */
export function parsePageDelimitedTranslation(
  value: string,
  expectedPages: readonly number[],
): readonly AiTextPage[] | undefined {
  const result = validatePageDelimitedTranslation(value, expectedPages);
  return result.status === 'ok' ? result.pages : undefined;
}

/** Reflow validated translated pages through the local PDF writer, one output page per source page. */
export async function reflowTranslatedPages(pages: readonly AiTextPage[]): Promise<Uint8Array> {
  if (!pages.length) throw new Error('At least one translated page is required.');
  return textPagesToPdf(
    pages.map((page) => page.text.split('\n')),
    { pageSize: 'letter' },
  );
}
