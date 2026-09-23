import type { AiTextPage } from './types.js';

const PAGE_MARKER = /^---PAGE\s+(\d+)---\s*$/gim;

/** Accept only structured output that can be reflowed page-by-page safely. */
export function parsePageDelimitedTranslation(
  value: string,
  expectedPages: readonly number[],
): readonly AiTextPage[] | undefined {
  const markers = [...value.matchAll(PAGE_MARKER)];
  if (markers.length !== expectedPages.length) return undefined;

  const pages: AiTextPage[] = [];
  markers.forEach((marker, index) => {
    const rawPageNumber = marker[1];
    if (!rawPageNumber) {
      pages.length = 0;
      return;
    }
    const rawMarker = marker[0];
    if (!rawMarker) {
      pages.length = 0;
      return;
    }
    const pageNumber = Number(rawPageNumber);
    const expectedPage = expectedPages[index];
    const start = (marker.index ?? 0) + rawMarker.length;
    const nextMarker = markers[index + 1];
    const end = nextMarker === undefined ? value.length : (nextMarker.index ?? value.length);
    const text = value.slice(start, end).trim();
    if (pageNumber !== expectedPage || !text) {
      pages.length = 0;
      return;
    }
    pages.push({ pageNumber, text });
  });
  return pages.length === expectedPages.length ? pages : undefined;
}
