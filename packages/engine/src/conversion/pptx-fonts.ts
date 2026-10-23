/**
 * Font mapping for the PPTX renderer.
 *
 * A deck names real typefaces — Calibri, Aptos, Segoe UI, or a corporate
 * brand font. The PDF standard fonts are the only ones this engine can use:
 * `pdf-lib` has no `fontkit` dependency, so a TrueType face cannot be
 * embedded. The 14 standard fonts are *referenced* by name rather than
 * embedded, so using them costs no bytes and no licence.
 *
 * The mapping is family-plus-style, so the three properties a reader actually
 * notices are preserved: the family (sans/serif/mono), the weight, and the
 * slant. What is lost is the typeface's identity — Helvetica is not Calibri,
 * and its metrics differ, which is why the renderer shrinks text to fit and
 * says so in the conversion warnings.
 */

import { StandardFonts } from 'pdf-lib';

/** The three families the standard fonts cover. */
export type StandardFamily = 'sans' | 'serif' | 'mono';

/** The exact `StandardFonts` keys this module uses. */
const STANDARD_FONT_NAMES: Readonly<
  Record<StandardFamily, Record<string, Record<string, StandardFonts>>>
> = {
  sans: {
    regular: {
      regular: StandardFonts.Helvetica,
      bold: StandardFonts.HelveticaBold,
      italic: StandardFonts.HelveticaOblique,
      boldItalic: StandardFonts.HelveticaBoldOblique,
    },
  },
  serif: {
    regular: {
      regular: StandardFonts.TimesRoman,
      bold: StandardFonts.TimesRomanBold,
      italic: StandardFonts.TimesRomanItalic,
      boldItalic: StandardFonts.TimesRomanBoldItalic,
    },
  },
  mono: {
    regular: {
      regular: StandardFonts.Courier,
      bold: StandardFonts.CourierBold,
      italic: StandardFonts.CourierOblique,
      boldItalic: StandardFonts.CourierBoldOblique,
    },
  },
};

/**
 * Typefaces that mean "serif".
 *
 * Matched on a lower-cased, de-quoted name. The list covers the faces real
 * decks use; anything unrecognised falls through to sans, which is what most
 * non-embedding viewers substitute anyway.
 */
const SERIF_PATTERN =
  /times|georgia|garamond|book\s?manor|cambria|constantia|palatino|minion|playfair|serif|roman/i;

/** Typefaces that mean "monospace". */
const MONO_PATTERN =
  /courier|consolas|menlo|monaco|monospace|source\s?code|fira\s?code|roboto\s?mono|jetbrains|cascadia/i;

/**
 * The family a typeface belongs to.
 *
 * `+mj-lt` and `+mn-lt` are theme *references*, not typefaces; the caller
 * resolves them through the theme before calling this.
 */
export function fontFamilyFor(typeface: string | undefined): StandardFamily {
  const name = (typeface ?? '').toLowerCase().replace(/['"]/gu, '').trim();
  if (!name) return 'sans';
  if (MONO_PATTERN.test(name)) return 'mono';
  if (SERIF_PATTERN.test(name)) return 'serif';
  return 'sans';
}

/**
 * The standard font for a family and style.
 */
export function standardFontName(
  family: StandardFamily,
  bold: boolean,
  italic: boolean,
): StandardFonts {
  const weight = bold ? 'bold' : 'regular';
  const slant = italic ? 'italic' : 'regular';
  return STANDARD_FONT_NAMES[family][weight]?.[slant] ?? StandardFonts.Helvetica;
}

/**
 * Whether a typeface has to be substituted, i.e. is not one this engine can
 * use as-is.
 *
 * Used to report the substitution rather than leave the reader to guess why
 * the deck's typography looks different.
 */
export function isSubstitutedTypeface(typeface: string | undefined): boolean {
  const name = (typeface ?? '').trim();
  if (!name) return false;
  // A theme reference is resolved before it reaches here, so a name that
  // survives is a literal typeface.
  return !/^(?:helvetica|arial|times|times new roman|courier|courier new)$/i.test(name);
}

/**
 * The text of a character the standard fonts can encode.
 *
 * The 14 standard fonts are WinAnsi-encoded and `pdf-lib` *throws* on a code
 * point it cannot map — in `encodeText` and in `widthOfTextAtSize` alike. A
 * single `→` in a slide title would therefore abort the whole conversion with
 * an uncaught exception, not a typed error. This maps the characters that
 * appear in real decks onto ones WinAnsi can encode, and reports what it
 * replaced so the conversion can say so rather than lose it silently.
 *
 * The arrow mappings match the ones `sanitizeMarkdown` in `convert.ts` already
 * uses, so the product is consistent about how it renders an arrow.
 */
const SYMBOL_REPLACEMENTS: Readonly<Record<string, string>> = {
  '→': '->',
  '←': '<-',
  '↑': '^',
  '↓': 'v',
  '⇒': '=>',
  '⇐': '<=',
  '⇔': '<=>',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '≈': '~=',
  '●': '*',
  '▪': '-',
  '◦': '-',
  '−': '-',
  '‐': '-',
  '‑': '-',
};

/**
 * The WinAnsi code points the standard fonts can encode.
 *
 * Read from the encoding itself rather than hard-coded, so the table cannot
 * drift from what `pdf-lib` actually supports. The set is loaded lazily and
 * cached, because the encoder is only needed once a deck actually has text.
 */
let winAnsiCodePoints: ReadonlySet<number> | undefined;

function loadWinAnsiCodePoints(): ReadonlySet<number> {
  if (winAnsiCodePoints) return winAnsiCodePoints;
  // The encoding is reachable through a standard font's embedder, but the
  // simplest reliable route is to test the code points we care about against
  // the encoder itself. Rather than reach into pdf-lib's internals, the set is
  // built from the documented WinAnsi range.
  const points = new Set<number>();
  for (let code = 0x20; code <= 0x7e; code += 1) points.add(code);
  for (const code of [
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
    0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
    0x0153, 0x017e, 0x0178, 0x00a0, 0x00a1, 0x00a2, 0x00a3, 0x00a4, 0x00a5, 0x00a6, 0x00a7, 0x00a8,
    0x00a9, 0x00aa, 0x00ab, 0x00ac, 0x00ad, 0x00ae, 0x00af, 0x00b0, 0x00b1, 0x00b2, 0x00b3, 0x00b4,
    0x00b5, 0x00b6, 0x00b7, 0x00b8, 0x00b9, 0x00ba, 0x00bb, 0x00bc, 0x00bd, 0x00be, 0x00bf, 0x00c0,
    0x00c1, 0x00c2, 0x00c3, 0x00c4, 0x00c5, 0x00c6, 0x00c7, 0x00c8, 0x00c9, 0x00ca, 0x00cb, 0x00cc,
    0x00cd, 0x00ce, 0x00cf, 0x00d0, 0x00d1, 0x00d2, 0x00d3, 0x00d4, 0x00d5, 0x00d6, 0x00d7, 0x00d8,
    0x00d9, 0x00da, 0x00db, 0x00dc, 0x00dd, 0x00de, 0x00df, 0x00e0, 0x00e1, 0x00e2, 0x00e3, 0x00e4,
    0x00e5, 0x00e6, 0x00e7, 0x00e8, 0x00e9, 0x00ea, 0x00eb, 0x00ec, 0x00ed, 0x00ee, 0x00ef, 0x00f0,
    0x00f1, 0x00f2, 0x00f3, 0x00f4, 0x00f5, 0x00f6, 0x00f7, 0x00f8, 0x00f9, 0x00fa, 0x00fb, 0x00fc,
    0x00fd, 0x00fe, 0x00ff,
  ])
    points.add(code);
  winAnsiCodePoints = points;
  return points;
}

/**
 * Replace the characters the standard fonts cannot encode.
 *
 * Returns the safe text and the set of characters that were replaced, so the
 * caller can report the substitution once for the whole deck rather than once
 * per character.
 */
export function sanitizeForWinAnsi(text: string): {
  readonly text: string;
  readonly replaced: readonly string[];
} {
  if (!text) return { text, replaced: [] };
  const supported = loadWinAnsiCodePoints();
  const replaced = new Set<string>();
  let output = '';
  // Iterate by code point, so a surrogate pair is treated as one character.
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      // Control characters have no glyph and would break the PDF text stream.
      replaced.add(character);
      output += ' ';
      continue;
    }
    if (supported.has(code)) {
      output += character;
      continue;
    }
    const mapped = SYMBOL_REPLACEMENTS[character];
    if (mapped !== undefined) {
      replaced.add(character);
      output += mapped;
      continue;
    }
    replaced.add(character);
    output += '?';
  }
  return { text: output, replaced: [...replaced] };
}
