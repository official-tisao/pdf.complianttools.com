/**
 * Text layout for the PPTX renderer.
 *
 * A PowerPoint text body is a stack of paragraphs, each a stack of runs, each
 * run with its own size, weight, colour and typeface. Laying that out means
 * resolving a style through an inheritance chain, wrapping words with the
 * *run's own* font, and placing the result inside a box that may be anchored
 * top, centre or bottom.
 *
 * The one rule the rest of the renderer depends on: **text never spills out of
 * its box.** A run of text that does not fit is shrunk, and then clipped.
 */

import type { PDFFont } from 'pdf-lib';
import { child, children, numberAttr, boolAttr, type XmlNode } from './pptx-xml.js';
import { readFillColor, type PptxColorMap, type PptxTheme, type Rgb } from './pptx-theme.js';
import {
  fontFamilyFor,
  isSubstitutedTypeface,
  sanitizeForWinAnsi,
  standardFontName,
  type StandardFamily,
} from './pptx-fonts.js';

/** The resolved style of a run of text. */
export type RunStyle = Readonly<{
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: Rgb;
  alpha?: number | undefined;
  typeface: string;
}>;

/** A piece of a paragraph: some text in one style. */
export type Segment = Readonly<{
  text: string;
  style: RunStyle;
  font: PDFFont;
}>;

/** A laid-out line of text. */
export type TextLine = Readonly<{
  segments: readonly Segment[];
  /** The width of the text, in points. */
  width: number;
  /** The height of the line box, in points. */
  height: number;
  /** The distance from the top of the line box to the baseline, in points. */
  ascent: number;
  /** The horizontal alignment of the paragraph this line belongs to. */
  alignment: 'l' | 'ctr' | 'r';
  /** The bullet that hangs to the left of this line, if the paragraph has one. */
  bullet?: { text: string; font: PDFFont; size: number; width: number };
  /**
   * The paragraph's left margin, in points.
   *
   * `a:pPr/@marL` is how far the paragraph's text is indented from the text
   * box's left edge. A bulleted paragraph's text is indented by this much
   * while its bullet hangs further left.
   */
  readonly marginLeft?: number;
  /**
   * The paragraph's hanging indent, in points.
   *
   * `a:pPr/@indent` is negative for a hanging indent: the first line starts
   * that far to the *left* of the margin, which is where the bullet goes.
   */
  readonly indent?: number;
}>;

/** The result of laying out a text body. */
export type LaidOutText = {
  readonly lines: readonly TextLine[];
  /** The total height of the text, in points. */
  readonly height: number;
  /** True when the text had to be shrunk to fit its box. */
  readonly shrunk: boolean;
  /** True when the text still does not fit after shrinking. */
  readonly clipped: boolean;
};

/** The insets of a text body, in slide EMU. */
export type Insets = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

/** The default insets, in slide EMU. */
export const DEFAULT_INSETS: Insets = {
  left: 91440,
  top: 45720,
  right: 91440,
  bottom: 45720,
};

/** The point size a run falls back to when nothing in the chain declares one. */
export const DEFAULT_FONT_SIZE = 18;

/** How far a line of text sits above its baseline, as a fraction of the size. */
export const ASCENT_RATIO = 0.8;

/** The line box height, as a multiple of the font size. */
export const LINE_HEIGHT_RATIO = 1.2;

/** The smallest a shrunk font may get, as a fraction of its size. */
export const MIN_SHRINK = 0.5;

/**
 * The styles a run can inherit from, in the order they are consulted.
 *
 * The chain is the OOXML one: the run's own properties, then the
 * paragraph's defaults, then the list style, then the placeholder style from
 * the master, then the presentation's default text style.
 */
export type StyleSources = {
  readonly runProps?: XmlNode | undefined;
  readonly paragraphDefaults?: XmlNode | undefined;
  readonly listStyle?: XmlNode | undefined;
  readonly placeholder?: XmlNode | undefined;
  readonly presentationDefault?: XmlNode | undefined;
  /**
   * The inherited level node — the master's `a:lvlNpPr` for a placeholder.
   *
   * It is kept separate from `placeholder` because it contributes two
   * different kinds of property: its `a:defRPr` is a run default, while the
   * node itself carries the paragraph's alignment, indent, bullet and
   * spacing.
   */
  readonly level?: XmlNode | undefined;
};

/** What the layout needs to know about the deck around it. */
export type TextContext = {
  readonly theme: PptxTheme;
  readonly colorMap: PptxColorMap;
  readonly fonts: ReadonlyMap<string, PDFFont>;
  readonly substitutedTypefaces: Set<string>;
  readonly replacedCharacters: Set<string>;
  /** Resolves a theme font reference (`+mj-lt`, `+mn-lt`) to a typeface. */
  readonly resolveThemeFont: (reference: string) => string;
};

/**
 * Resolve a run's effective style.
 *
 * Every property is taken from the first source that declares it, so an
 * explicit `b="0"` on a run wins over an inherited bold — which is not the
 * same as the property being absent.
 */
export function resolveRunStyle(sources: StyleSources, context: TextContext): RunStyle {
  const chain = [
    sources.runProps,
    sources.paragraphDefaults,
    sources.listStyle,
    sources.placeholder,
    // The level node's own run defaults, when the placeholder style is a
    // level node rather than a bare `a:defRPr`.
    levelRunProperties(sources.level),
    sources.presentationDefault,
  ].filter((node): node is XmlNode => node !== undefined);

  const size = firstNumber(chain, 'sz');
  const bold = firstBoolean(chain, 'b');
  const italic = firstBoolean(chain, 'i');
  const underline = firstUnderline(chain);
  const strike = firstBoolean(chain, 'strike');
  const typeface = firstTypeface(chain, context);
  const color = firstColor(chain, context);

  return {
    size: size === undefined ? DEFAULT_FONT_SIZE : size / 100,
    bold: bold ?? false,
    italic: italic ?? false,
    underline: underline ?? false,
    strike: strike ?? false,
    color: color.color,
    ...(color.alpha !== undefined ? { alpha: color.alpha } : {}),
    typeface,
  };
}

/** The first source that declares the attribute, as a number. */
function firstNumber(chain: readonly XmlNode[], name: string): number | undefined {
  for (const node of chain) {
    const value = numberAttr(node, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** The first source that declares the attribute, as a boolean. */
function firstBoolean(chain: readonly XmlNode[], name: string): boolean | undefined {
  for (const node of chain) {
    const value = boolAttr(node, name);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** The first source that declares an underline. */
function firstUnderline(chain: readonly XmlNode[]): boolean | undefined {
  for (const node of chain) {
    const value = node.attrs.u;
    if (value === undefined) continue;
    return value !== 'none' && value !== '0' && value !== 'false';
  }
  return undefined;
}

/** The first source that declares a typeface. */
function firstTypeface(chain: readonly XmlNode[], context: TextContext): string {
  for (const node of chain) {
    const typeface = child(node, 'a:latin')?.attrs.typeface;
    if (!typeface) continue;
    if (typeface === '+mj-lt') return context.resolveThemeFont('+mj-lt');
    if (typeface === '+mn-lt') return context.resolveThemeFont('+mn-lt');
    return typeface;
  }
  return context.theme.minorFont;
}

/** The first source that declares a colour. */
function firstColor(
  chain: readonly XmlNode[],
  context: TextContext,
): { color: Rgb; alpha?: number } {
  for (const node of chain) {
    const fill = readFillColor(node, context.colorMap, context.theme);
    if (fill) return fill;
  }
  return { color: { r: 0, g: 0, b: 0 } };
}

/**
 * The font for a style.
 */
export function fontForStyle(style: RunStyle, context: TextContext): PDFFont {
  const family: StandardFamily = fontFamilyFor(style.typeface);
  const name = standardFontName(family, style.bold, style.italic);
  const font = context.fonts.get(name);
  if (!font) throw new Error(`The font ${name} was not prepared for this document.`);
  if (isSubstitutedTypeface(style.typeface)) {
    context.substitutedTypefaces.add(style.typeface);
  }
  return font;
}

/**
 * Lay out a text body inside a box.
 *
 * `box` is in slide EMU; the returned lines are in points, measured from the
 * top of the text area.
 */
export function layoutTextBody(
  body: XmlNode,
  box: { width: number; height: number },
  context: TextContext,
  sources: StyleSources,
  options: {
    readonly insets: Insets;
    readonly scale: number;
    /**
     * A multiplier on the font size, for text inside a scaled group.
     *
     * A group scales its children's text along with their geometry, so a
     * title inside a group scaled to half size is drawn at half size. The
     * default of 1 leaves the size alone.
     */
    readonly textScale?: number;
    /**
     * A multiplier on the box's height, for text inside a scaled group.
     *
     * The box is the shape's own box, in the shape's own space. A group
     * scaled to half height gives its children a box twice as tall as the
     * space they end up in, so the text has to be measured against the
     * *occupied* height rather than the declared one.
     *
     * The default of 1 leaves the height alone.
     */
    readonly heightScale?: number;
  },
): LaidOutText {
  const paragraphs = children(body, 'a:p');
  const bodyProps = child(body, 'a:bodyPr');
  const autofit = bodyProps ? child(bodyProps, 'a:normAutofit') : undefined;
  const fontScale = (numberAttr(autofit, 'fontScale') ?? 100000) / 100000;
  const lineReduction = (numberAttr(autofit, 'lnSpcReduction') ?? 0) / 100000;
  // A group scales its children's text, so the whole layout is measured at
  // the scaled size rather than being scaled afterwards — a word that no
  // longer fits has to wrap differently, not merely be drawn smaller.
  const textScale = options.textScale ?? 1;
  // The width the text may use is the width the box *occupies* once the
  // group has scaled it, and the horizontal scale is the one that governs
  // it — the same scale that governs the font size. The height is measured
  // against the vertical scale for the same reason.
  const heightScale = options.heightScale ?? 1;

  const availableWidth = Math.max(
    0,
    (box.width - options.insets.left - options.insets.right) * options.scale * textScale,
  );
  const availableHeight = Math.max(
    0,
    (box.height - options.insets.top - options.insets.bottom) * options.scale * heightScale,
  );

  const build = (scaleFactor: number): { lines: TextLine[]; height: number } => {
    const lines: TextLine[] = [];
    let height = 0;
    let numberIndex = 0;
    for (const paragraph of paragraphs) {
      const laid = layoutParagraph(
        paragraph,
        availableWidth,
        scaleFactor * textScale,
        lineReduction,
        context,
        sources,
        numberIndex,
      );
      numberIndex = laid.nextNumberIndex;
      for (const line of laid.lines) {
        lines.push(line);
        height += line.height;
      }
    }
    return { lines, height };
  };

  let { lines, height } = build(fontScale);
  let shrunk = false;
  let clipped = false;

  if (height > availableHeight && availableHeight > 0 && height > 0) {
    // Shrink to fit, the way PowerPoint's own "shrink text on overflow" does.
    const shrink = Math.max(MIN_SHRINK, availableHeight / height);
    const shrunkLayout = build(fontScale * shrink);
    if (shrunkLayout.height < height) {
      lines = shrunkLayout.lines;
      height = shrunkLayout.height;
      shrunk = true;
    }
    if (height > availableHeight) clipped = true;
  }

  return { lines, height, shrunk, clipped };
}

/**
 * Lay out one paragraph into lines.
 */
function layoutParagraph(
  paragraph: XmlNode,
  availableWidth: number,
  scaleFactor: number,
  lineReduction: number,
  context: TextContext,
  sources: StyleSources,
  numberIndex: number,
): { lines: TextLine[]; nextNumberIndex: number } {
  const properties = child(paragraph, 'a:pPr');
  const paragraphDefaults = properties ? child(properties, 'a:defRPr') : undefined;
  // A paragraph that declares no alignment of its own takes the inherited
  // level's — the master's `a:lvlNpPr` says how its body text is aligned,
  // and that has to reach the slide.
  const alignment = readAlignment(properties) ?? readAlignment(sources.level) ?? 'l';
  const spacing = readSpacing(properties) ?? readSpacing(sources.level) ?? {};

  // A paragraph's own list style supplies the defaults for its outline
  // level, and sits between the paragraph's properties and the inherited
  // placeholder style in the chain.
  const level = numberAttr(properties, 'lvl') ?? 0;
  const listDefaults = listStyleDefaults(child(paragraph, 'a:lstStyle'), level);
  const effectiveSources: StyleSources = {
    ...sources,
    ...(listDefaults ? { listStyle: listDefaults } : {}),
  };

  // The paragraph's runs, in order. An explicit line break (`a:br`) is a *line*
  // boundary rather than a paragraph boundary, so it is recorded as a marker
  // between the runs rather than by splitting the paragraph: dropping it
  // would run two lines together, and splitting the paragraph would give the
  // second half a bullet of its own.
  const segments: Segment[] = [];
  const breaks: number[] = [];
  for (const run of paragraph.children) {
    if (run.name === 'a:br') {
      breaks.push(segments.length);
      continue;
    }
    if (run.name === 'a:r') {
      segments.push(
        ...segmentsForRun(
          run,
          'a:rPr',
          'a:t',
          context,
          effectiveSources,
          paragraphDefaults,
          scaleFactor,
        ),
      );
      continue;
    }
    // A field — a slide number, say — carries its own text.
    if (run.name === 'a:fld') {
      segments.push(
        ...segmentsForRun(
          run,
          'a:rPr',
          'a:t',
          context,
          effectiveSources,
          paragraphDefaults,
          scaleFactor,
        ),
      );
    }
  }

  const bullet = readBullet(paragraph, context, effectiveSources, paragraphDefaults, numberIndex);

  if (segments.length === 0) {
    // An empty paragraph still occupies a line, and its height comes from the
    // paragraph's end-run properties.
    const endProps = child(paragraph, 'a:endParaRPr');
    const style = resolveRunStyle(
      { ...sources, ...(endProps ? { runProps: endProps } : {}), paragraphDefaults },
      context,
    );
    const size = style.size * scaleFactor;
    return {
      lines: [
        {
          segments: [],
          width: 0,
          height: lineHeight(size, spacing, lineReduction),
          ascent: size * ASCENT_RATIO,
          alignment,
        },
      ],
      nextNumberIndex: numberIndex,
    };
  }

  const wrapped = wrapSegments(segments, availableWidth, breaks);
  // The paragraph's left margin and hanging indent. A bulleted paragraph's
  // text is indented by `marL` while its bullet hangs `indent` further left.
  const marginLeft = readMargin(properties, 'marL', sources.level);
  const indent = readMargin(properties, 'indent', sources.level);
  const built = wrapped.map((line, index) => {
    const size = Math.max(...line.segments.map((segment) => segment.style.size), 1);
    return {
      segments: line.segments,
      width: line.width,
      height: lineHeight(size, spacing, lineReduction),
      ascent: size * ASCENT_RATIO,
      alignment,
      ...(marginLeft !== undefined ? { marginLeft } : {}),
      ...(indent !== undefined ? { indent } : {}),
      // The bullet belongs to the *paragraph*, so only its first line carries
      // one. Repeating it on every wrapped line would draw one bullet per
      // line of a bulleted paragraph.
      ...(bullet && index === 0 ? { bullet } : {}),
    };
  });

  // The space above a paragraph is added to its first line's height, and the
  // space below to its last, so the gap appears between the paragraphs
  // rather than inside either of them.
  const lines = built.map((line, index) => {
    const before = index === 0 ? spacingBefore(spacing, line) : 0;
    const after = index === built.length - 1 ? spacingAfter(spacing, line) : 0;
    return before === 0 && after === 0 ? line : { ...line, height: line.height + before + after };
  });

  return { lines, nextNumberIndex: numberIndex + (bullet?.numbered ? 1 : 0) };
}

/**
 * The height of one line of a paragraph.
 *
 * `a:lnSpc` overrides the default line height. A percentage is relative to
 * the single-line height, and an exact point value replaces it outright.
 */
function lineHeight(size: number, spacing: Spacing, lineReduction: number): number {
  const single = size * LINE_HEIGHT_RATIO;
  const base =
    spacing.linePoints !== undefined
      ? spacing.linePoints
      : spacing.lineMultiple !== undefined
        ? single * spacing.lineMultiple
        : single;
  return base * (1 - lineReduction);
}

/**
 * The space above a paragraph, in points.
 */
function spacingBefore(spacing: Spacing, line: TextLine): number {
  if (spacing.beforePoints !== undefined) return spacing.beforePoints;
  if (spacing.beforeFraction !== undefined) {
    const size = Math.max(...line.segments.map((segment) => segment.style.size), 1);
    return size * spacing.beforeFraction * LINE_HEIGHT_RATIO;
  }
  return 0;
}

/**
 * The space below a paragraph, in points.
 */
function spacingAfter(spacing: Spacing, line: TextLine): number {
  if (spacing.afterPoints !== undefined) return spacing.afterPoints;
  if (spacing.afterFraction !== undefined) {
    const size = Math.max(...line.segments.map((segment) => segment.style.size), 1);
    return size * spacing.afterFraction * LINE_HEIGHT_RATIO;
  }
  return 0;
}

/**
 * The segments of one run, sanitized for the standard fonts.
 */
function segmentsForRun(
  run: XmlNode,
  propertiesName: string,
  textName: string,
  context: TextContext,
  sources: StyleSources,
  paragraphDefaults: XmlNode | undefined,
  scaleFactor: number,
): readonly Segment[] {
  const text = child(run, textName)?.text ?? '';
  if (!text) return [];
  const style = resolveRunStyle(
    { ...sources, runProps: child(run, propertiesName), paragraphDefaults },
    context,
  );
  const font = fontForStyle(style, context);
  const sanitized = sanitizeForWinAnsi(text);
  for (const character of sanitized.replaced) context.replacedCharacters.add(character);
  if (!sanitized.text) return [];
  return [
    {
      text: sanitized.text,
      style: { ...style, size: style.size * scaleFactor },
      font,
    },
  ];
}

/**
 * The horizontal alignment of a paragraph.
 *
 * `just` is a *distribution* of the line's words, not a different origin, and
 * pdf-lib's drawText cannot distribute a line's words across a width. It is
 * treated as left-aligned; the difference is visible only on a fully
 * justified paragraph.
 */
function readAlignment(properties: XmlNode | undefined): 'l' | 'ctr' | 'r' | undefined {
  const alignment = properties?.attrs.algn;
  if (alignment === 'ctr') return 'ctr';
  if (alignment === 'r') return 'r';
  if (alignment === 'l') return 'l';
  return undefined;
}

/**
 * A paragraph's spacing.
 *
 * `a:lnSpc` is the height of a line, `a:spcBef` the space above a
 * paragraph and `a:spcAft` the space below it. Each is written either as a
 * percentage (`a:spcPct`) or as an exact number of points (`a:spcPts`).
 *
 * The two forms are not interchangeable: a percentage is *relative to the
 * font size*, so it changes when the text is scaled, while an exact point
 * value does not. A deck that says "150% line spacing" is asking for a
 * proportional line, and one that says "24pt" is asking for a fixed one.
 *
 * A percentage is therefore kept as a fraction here and resolved against the
 * font size when the paragraph is laid out, where the size is known.
 */
export type Spacing = Readonly<{
  /** The line height as a multiple of the single-line height. */
  readonly lineMultiple?: number;
  /** The line height as an exact number of points. */
  readonly linePoints?: number;
  /** The space above the paragraph, as a fraction of the font size. */
  readonly beforeFraction?: number;
  /** The space above the paragraph, in points. */
  readonly beforePoints?: number;
  /** The space below the paragraph, as a fraction of the font size. */
  readonly afterFraction?: number;
  /** The space below the paragraph, in points. */
  readonly afterPoints?: number;
}>;

/**
 * Read a paragraph's spacing.
 *
 * `a:spcPct` is in 1000ths of a percent, so 150% is `150000`. `a:spcPts`
 * is in hundredths of a point, so 24pt is `2400`.
 */
function readSpacing(properties: XmlNode | undefined): Spacing | undefined {
  if (!properties) return undefined;
  const line = child(properties, 'a:lnSpc');
  const before = child(properties, 'a:spcBef');
  const after = child(properties, 'a:spcAft');
  if (!line && !before && !after) return undefined;

  const linePercent = line ? numberAttr(child(line, 'a:spcPct'), 'val') : undefined;
  const linePoints = line ? numberAttr(child(line, 'a:spcPts'), 'val') : undefined;
  const beforePercent = before ? numberAttr(child(before, 'a:spcPct'), 'val') : undefined;
  const beforePoints = before ? numberAttr(child(before, 'a:spcPts'), 'val') : undefined;
  const afterPercent = after ? numberAttr(child(after, 'a:spcPct'), 'val') : undefined;
  const afterPoints = after ? numberAttr(child(after, 'a:spcPts'), 'val') : undefined;

  return {
    ...(linePercent !== undefined ? { lineMultiple: linePercent / 100000 } : {}),
    ...(linePoints !== undefined ? { linePoints: linePoints / 100 } : {}),
    ...(beforePercent !== undefined ? { beforeFraction: beforePercent / 100000 } : {}),
    ...(beforePoints !== undefined ? { beforePoints: beforePoints / 100 } : {}),
    ...(afterPercent !== undefined ? { afterFraction: afterPercent / 100000 } : {}),
    ...(afterPoints !== undefined ? { afterPoints: afterPoints / 100 } : {}),
  };
}

/**
 * A paragraph's left margin or hanging indent, in slide EMU.
 *
 * A paragraph that declares no margin of its own takes the inherited level's
 * — the master's body style is where a deck's outline indents live.
 */
function readMargin(
  properties: XmlNode | undefined,
  name: 'marL' | 'indent',
  level: XmlNode | undefined,
): number | undefined {
  const own = numberAttr(properties, name);
  if (own !== undefined) return own;
  return numberAttr(level, name);
}

/**
 * The bullet of a paragraph, if it has one.
 *
 * A paragraph may declare its own bullet, or it may inherit the one the
 * master defines for its level — a master's body style usually says "level 1
 * is bulleted", and every slide that uses the layout then relies on that.
 * A paragraph that says `a:buNone` opts out of both.
 */
function readBullet(
  paragraph: XmlNode,
  context: TextContext,
  sources: StyleSources,
  paragraphDefaults: XmlNode | undefined,
  numberIndex: number,
): { text: string; font: PDFFont; size: number; width: number; numbered: boolean } | undefined {
  const properties = child(paragraph, 'a:pPr');
  // The paragraph's own properties take precedence; the inherited level node
  // is consulted only when the paragraph says nothing about bullets.
  const level = sources.level;
  const source = properties ?? level;
  if (!source) return undefined;
  if (child(source, 'a:buNone')) return undefined;
  // A paragraph with no bullet properties of its own, and no inherited level
  // that declares one, has no bullet.
  const declaresBullet =
    child(source, 'a:buChar') !== undefined ||
    child(source, 'a:buAutoNum') !== undefined ||
    child(source, 'a:buNone') !== undefined;
  if (!declaresBullet) return undefined;

  const style = resolveRunStyle(
    { ...sources, ...(paragraphDefaults ? { paragraphDefaults } : {}) },
    context,
  );
  const font = fontForStyle(style, context);

  const percent = numberAttr(child(source, 'a:buSzPct'), 'val');
  const points = numberAttr(child(source, 'a:buSzPts'), 'val');
  const size =
    percent !== undefined
      ? (style.size * percent) / 100000
      : points !== undefined
        ? points / 100
        : style.size;

  const autoNumber = child(source, 'a:buAutoNum');
  if (autoNumber) {
    const text = formatAutoNumber(autoNumber.attrs.type ?? 'arabicPeriod', numberIndex);
    return { text, font, size, width: font.widthOfTextAtSize(text, size), numbered: true };
  }

  const bulletChar = child(source, 'a:buChar');
  if (!bulletChar) return undefined;
  const sanitized = sanitizeForWinAnsi(bulletChar.attrs.char ?? '•');
  for (const character of sanitized.replaced) context.replacedCharacters.add(character);
  return {
    text: sanitized.text,
    font,
    size,
    width: font.widthOfTextAtSize(sanitized.text, size),
    numbered: false,
  };
}

/**
 * The text of a numbered bullet.
 *
 * The formats real decks use are supported; anything else falls back to the
 * plain "1." form rather than guessing.
 */
function formatAutoNumber(type: string, index: number): string {
  const value = index + 1;
  switch (type) {
    case 'arabicPeriod':
      return `${value}.`;
    case 'arabicParenR':
      return `${value})`;
    case 'arabicParenBoth':
      return `(${value})`;
    case 'alphaLcPeriod':
      return `${toAlpha(value).toLowerCase()}.`;
    case 'alphaUcPeriod':
      return `${toAlpha(value).toUpperCase()}.`;
    case 'alphaLcParenR':
      return `${toAlpha(value).toLowerCase()})`;
    case 'alphaUcParenR':
      return `${toAlpha(value).toUpperCase()})`;
    case 'romanLcPeriod':
      return `${toRoman(value).toLowerCase()}.`;
    case 'romanUcPeriod':
      return `${toRoman(value).toUpperCase()}.`;
    case 'romanLcParenR':
      return `${toRoman(value).toLowerCase()})`;
    case 'romanUcParenR':
      return `${toRoman(value).toUpperCase()})`;
    default:
      return `${value}.`;
  }
}

/** A number as spreadsheet-style letters: 1 → A, 27 → AA. */
function toAlpha(value: number): string {
  let result = '';
  let remaining = value;
  while (remaining > 0) {
    const digit = (remaining - 1) % 26;
    result = String.fromCharCode(65 + digit) + result;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return result || 'A';
}

/** A number as roman numerals. */
function toRoman(value: number): string {
  const table: readonly (readonly [number, string])[] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let remaining = value;
  let result = '';
  for (const [amount, numeral] of table) {
    while (remaining >= amount) {
      result += numeral;
      remaining -= amount;
    }
  }
  return result || 'I';
}

/**
 * Wrap a paragraph's segments into lines.
 *
 * Each word is measured with the font of the run it belongs to, so a
 * paragraph that mixes a bold word into regular text wraps at the right
 * place. A word too long for the line is broken at the character level rather
 * than allowed to overflow.
 *
 * `breaks` holds the segment indices where the author put an explicit line
 * break (`a:br`). Those are hard boundaries: the line ends there whether or
 * not the text would have fitted.
 */
function wrapSegments(
  segments: readonly Segment[],
  availableWidth: number,
  breaks: readonly number[] = [],
): readonly { segments: readonly Segment[]; width: number }[] {
  const lines: { segments: readonly Segment[]; width: number }[] = [];
  let current: Segment[] = [];
  let currentWidth = 0;
  let pendingSpace = '';

  const flush = (): void => {
    if (current.length === 0) return;
    lines.push({ segments: current, width: currentWidth });
    current = [];
    currentWidth = 0;
  };

  for (const [index, segment] of segments.entries()) {
    // An explicit break ends the line before this segment.
    if (breaks.includes(index)) {
      flush();
      pendingSpace = '';
    }
    // Split the run into words, keeping the spaces that separate them.
    const parts = segment.text.split(/(\s+)/u).filter((part) => part !== '');
    for (const part of parts) {
      if (/^\s+$/u.test(part)) {
        pendingSpace += part;
        continue;
      }
      const spaceWidth = pendingSpace
        ? segment.font.widthOfTextAtSize(pendingSpace, segment.style.size)
        : 0;
      const wordWidth = segment.font.widthOfTextAtSize(part, segment.style.size);
      if (currentWidth > 0 && currentWidth + spaceWidth + wordWidth > availableWidth) {
        flush();
        pendingSpace = '';
      }
      if (pendingSpace) {
        current.push({ text: pendingSpace, style: segment.style, font: segment.font });
        currentWidth += spaceWidth;
        pendingSpace = '';
      }
      if (wordWidth > availableWidth && current.length === 0) {
        // A single word wider than the line: break it by character so the text
        // stays inside the box.
        let chunk = '';
        let chunkWidth = 0;
        for (const character of part) {
          const characterWidth = segment.font.widthOfTextAtSize(character, segment.style.size);
          if (chunkWidth + characterWidth > availableWidth && chunk) {
            current.push({ text: chunk, style: segment.style, font: segment.font });
            flush();
            chunk = '';
            chunkWidth = 0;
          }
          chunk += character;
          chunkWidth += characterWidth;
        }
        if (chunk) {
          current.push({ text: chunk, style: segment.style, font: segment.font });
          currentWidth += chunkWidth;
        }
        continue;
      }
      current.push({ text: part, style: segment.style, font: segment.font });
      currentWidth += wordWidth;
    }
  }
  flush();
  if (lines.length === 0) lines.push({ segments: [], width: 0 });
  // Words that share a style are merged back together, so a line is drawn as
  // a few text objects rather than one per word. The words are already
  // measured, so merging changes neither the layout nor the widths.
  return lines.map((line) => ({ ...line, segments: mergeSegments(line.segments) }));
}

/**
 * Merge adjacent segments that share a style and a font.
 */
function mergeSegments(segments: readonly Segment[]): readonly Segment[] {
  const merged: Segment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.font === segment.font && sameStyle(previous.style, segment.style)) {
      merged[merged.length - 1] = { ...previous, text: previous.text + segment.text };
      continue;
    }
    merged.push(segment);
  }
  return merged;
}

/** Whether two run styles are the same. */
function sameStyle(left: RunStyle, right: RunStyle): boolean {
  return (
    left.size === right.size &&
    left.bold === right.bold &&
    left.italic === right.italic &&
    left.underline === right.underline &&
    left.strike === right.strike &&
    left.typeface === right.typeface &&
    left.alpha === right.alpha &&
    left.color.r === right.color.r &&
    left.color.g === right.color.g &&
    left.color.b === right.color.b
  );
}

/**
 * The placeholder properties of a shape: its type and index.
 */
export function placeholderOf(shape: XmlNode): { type: string; index: string } | undefined {
  const properties = child(shape, 'p:nvSpPr');
  const nonVisual = properties ? child(properties, 'p:nvPr') : undefined;
  const placeholder = nonVisual ? child(nonVisual, 'p:ph') : undefined;
  if (!placeholder) return undefined;
  return {
    type: placeholder.attrs.type ?? 'body',
    index: placeholder.attrs.idx ?? '0',
  };
}

/**
 * The style a placeholder inherits from the master.
 *
 * A title takes the master's title style, a body placeholder the body style
 * at its own outline level, and anything else the "other" style.
 *
 * The **whole level node** is returned, not just its `a:defRPr` child. The
 * level node is where the paragraph's own properties live — its alignment,
 * its indent, its bullet and its spacing — and returning only the run
 * properties would silently drop all of them. A master's bulleted body
 * would then render its slides with no bullets at all.
 */
export function placeholderStyle(
  master: XmlNode | undefined,
  type: string,
  index: string,
): XmlNode | undefined {
  if (!master) return undefined;
  const styles = child(master, 'p:txStyles');
  if (!styles) return undefined;
  const group =
    type === 'title' || type === 'ctrTitle'
      ? child(styles, 'p:titleStyle')
      : type === 'body' || type === 'subTitle' || type === 'obj'
        ? child(styles, 'p:bodyStyle')
        : child(styles, 'p:otherStyle');
  if (!group) return undefined;
  // `idx` names the outline level of a body placeholder; it is 1-based.
  const wanted =
    type === 'body' || type === 'subTitle' || type === 'obj'
      ? Math.max(1, Number.parseInt(index, 10) || 1)
      : 1;
  return child(group, `a:lvl${wanted}pPr`);
}

/**
 * The run properties a level node declares.
 *
 * A level node holds both the run defaults (`a:defRPr`) and the paragraph
 * properties. This picks out the former.
 */
export function levelRunProperties(level: XmlNode | undefined): XmlNode | undefined {
  return level ? child(level, 'a:defRPr') : undefined;
}

/**
 * The `a:defRPr` of a list-style level.
 */
export function listStyleDefaults(
  listStyle: XmlNode | undefined,
  level: number,
): XmlNode | undefined {
  if (!listStyle) return undefined;
  const levelNode = child(listStyle, `a:lvl${level + 1}pPr`);
  return levelNode ? child(levelNode, 'a:defRPr') : undefined;
}

/**
 * The `a:defRPr` of the presentation's default text style.
 */
export function presentationDefaults(
  presentation: XmlNode | undefined,
  level: number,
): XmlNode | undefined {
  if (!presentation) return undefined;
  const styles = child(presentation, 'p:defaultTextStyle');
  if (!styles) return undefined;
  const levelNode = child(styles, `a:lvl${level + 1}pPr`);
  return levelNode ? child(levelNode, 'a:defRPr') : undefined;
}
