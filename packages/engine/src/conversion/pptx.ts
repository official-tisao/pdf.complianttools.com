/**
 * The PPTX renderer: a PowerPoint deck becomes a PDF that looks like the deck.
 *
 * The previous implementation extracted `<a:t>` runs with a regex and wrote
 * them onto portrait Letter pages. Everything that makes a slide a slide — the
 * shapes, their positions, the colours, the background, the deck's own page
 * size — was lost, and `textPagesToPdf` paginated, so one slide could become
 * two or three PDF pages.
 *
 * This module reads the OOXML parts directly and draws them. The two
 * properties it guarantees:
 *
 *   1. **The page is the slide.** The deck's `p:sldSz` becomes the PDF
 *      MediaBox, so a 16:9 deck produces 960 x 540 pt landscape pages.
 *   2. **One slide is one page.** There is no pagination path at all: one
 *      `addPage()` per slide, and text that does not fit is shrunk and then
 *      clipped rather than spilling onto another page.
 */

import {
  PDFDocument,
  StandardFonts,
  clip,
  concatTransformationMatrix,
  degrees,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  rotateRadians,
  translate,
  type PDFFont,
  type PDFPage,
  type Rotation,
} from 'pdf-lib';
import { unzipSync } from 'fflate';
import { PdfEngineError } from '../errors.js';
import type { ConversionOptions } from '../types.js';
import {
  boolAttr,
  child,
  children,
  descendant,
  numberAttr,
  parseXml,
  type XmlNode,
} from './pptx-xml.js';
import {
  hasNoFill,
  parseColorMap,
  parseTheme,
  readBackgroundReference,
  readFillColor,
  readGradientColor,
  readStyleRefFill,
  readStyleRefLine,
  slideColorMap,
  type PptxColorMap,
  type PptxTheme,
  type Rgb,
} from './pptx-theme.js';
import {
  DEFAULT_INSETS,
  layoutTextBody,
  levelRunProperties,
  placeholderOf,
  placeholderStyle,
  presentationDefaults,
  type Insets,
  type TextContext,
  type TextLine,
} from './pptx-text.js';
import { sanitizeForWinAnsi } from './pptx-fonts.js';

/** The result of rendering a deck. */
export type PptxPdfResult = {
  readonly bytes: Uint8Array;
  readonly warnings: readonly string[];
};

/** 914400 EMU is exactly one inch, and an inch is 72 points. */
const EMU_PER_POINT = 914400 / 72;

/** The default slide size when a deck does not declare one: 10in x 7.5in. */
const DEFAULT_SLIDE_POINTS: readonly [number, number] = [720, 540];

/** A rectangle in slide coordinates (EMU). */
type Box = Readonly<{ x: number; y: number; width: number; height: number }>;

/**
 * A 2x3 affine transform, mapping slide coordinates to page coordinates.
 */
type Transform = {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
};

/** Everything the renderer needs to draw one deck. */
type RenderContext = {
  readonly document: PDFDocument;
  readonly files: Record<string, Uint8Array>;
  /** `ppt/presentation.xml`, the root of the presentation-level defaults. */
  readonly presentation?: XmlNode;
  readonly theme: PptxTheme;
  readonly colorMap: PptxColorMap;
  readonly fonts: Map<string, PDFFont>;
  readonly substitutedTypefaces: Set<string>;
  readonly replacedCharacters: Set<string>;
  readonly skippedFeatures: Set<string>;
  readonly textContext: TextContext;
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly scale: number;
};

/**
 * Render a PPTX deck to a PDF, one page per slide.
 *
 * The page size is the deck's own slide size, so a 16:9 deck produces 16:9
 * pages. Text is shrunk and then clipped to its box rather than allowed to
 * spill, so a slide can never occupy more than one page.
 */
export async function pptxToPdf(
  bytes: Uint8Array,
  options: ConversionOptions = {},
): Promise<PptxPdfResult> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new PdfEngineError({
      kind: 'conversion-failed',
      format: 'pptx',
      direction: 'to-pdf',
      cause: 'The file is not a readable PPTX container.',
      remedy: 'Check that the file is a .pptx, and export it again from PowerPoint.',
    });
  }

  const deck = readDeck(files);
  if (deck.slides.length === 0) {
    throw new PdfEngineError({
      kind: 'conversion-failed',
      format: 'pptx',
      direction: 'to-pdf',
      cause: 'The PPTX container holds no slides.',
      remedy: 'Export the presentation again, or convert the slides to images first.',
    });
  }

  const warnings: string[] = [];
  if (!deck.declaredSlideSize) {
    warnings.push('This deck does not declare a slide size, so the PDF pages use the 4:3 default.');
  }
  if (options.pageSize || options.margin !== undefined || options.backgroundColor) {
    warnings.push(
      'The requested page size, margins, and background were ignored; PPTX pages use the deck itself.',
    );
  }

  const document = await PDFDocument.create({ updateMetadata: false });
  const fonts = new Map<string, PDFFont>();
  for (const name of [
    StandardFonts.Helvetica,
    StandardFonts.HelveticaBold,
    StandardFonts.HelveticaOblique,
    StandardFonts.HelveticaBoldOblique,
    StandardFonts.TimesRoman,
    StandardFonts.TimesRomanBold,
    StandardFonts.TimesRomanItalic,
    StandardFonts.TimesRomanBoldItalic,
    StandardFonts.Courier,
    StandardFonts.CourierBold,
    StandardFonts.CourierOblique,
    StandardFonts.CourierBoldOblique,
  ]) {
    fonts.set(name, await document.embedFont(name));
  }

  const substitutedTypefaces = new Set<string>();
  const replacedCharacters = new Set<string>();
  const context: RenderContext = {
    document,
    files,
    ...(deck.presentation ? { presentation: deck.presentation } : {}),
    theme: deck.theme,
    colorMap: deck.colorMap,
    fonts,
    substitutedTypefaces,
    replacedCharacters,
    skippedFeatures: new Set(),
    textContext: {
      theme: deck.theme,
      colorMap: deck.colorMap,
      fonts,
      substitutedTypefaces,
      replacedCharacters,
      resolveThemeFont: (reference) =>
        reference === '+mj-lt' ? deck.theme.majorFont : deck.theme.minorFont,
    },
    pageWidth: deck.slideSizePoints[0],
    pageHeight: deck.slideSizePoints[1],
    scale: deck.slideSizePoints[0] / deck.slideWidthEmu,
  };

  const slides = selectSlides(deck.slides, options.pageRange);
  if (slides.length === 0) {
    // A range that selects nothing would otherwise produce a blank PDF with
    // no explanation, which reads as a broken conversion rather than as a
    // request for slides the deck does not have.
    throw new PdfEngineError({
      kind: 'conversion-failed',
      format: 'pptx',
      direction: 'to-pdf',
      cause: 'The requested slide range does not match any slide in the deck.',
      remedy: 'Choose a slide range within the deck, or convert every slide.',
    });
  }
  for (const [index, slide] of slides.entries()) {
    const page = document.addPage([context.pageWidth, context.pageHeight]);
    // A slide may override the master's colour map, so the map is resolved
    // per slide rather than once for the deck.
    const slideContext: RenderContext = {
      ...context,
      colorMap: slide.colorMap,
      textContext: { ...context.textContext, colorMap: slide.colorMap },
    };
    try {
      await renderSlide(page, slide, slideContext);
    } catch {
      // One unreadable slide must not lose the rest of the deck.
      context.skippedFeatures.add('one unreadable slide');
      warnings.push(
        `Slide ${index + 1} could not be rendered and was left blank. The other slides were converted.`,
      );
    }
  }

  warnings.push(...summarise(context));
  return { bytes: await document.save(), warnings };
}

/**
 * The text of each slide, in presentation order.
 *
 * @deprecated The renderer is the supported way to read a deck. This remains
 * for callers that want the text and nothing else, and it now reads through
 * the same OOXML scanner, so it understands the slide order and the entity
 * references the old regex missed.
 */
export async function readPptxSlides(bytes: Uint8Array): Promise<readonly (readonly string[])[]> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    // The renderer reports a bad container as a typed error, and this reader
    // must not be the one place that answers with a bare `Error`.
    throw new PdfEngineError({
      kind: 'conversion-failed',
      format: 'pptx',
      direction: 'to-pdf',
      cause: 'The file is not a readable PPTX container.',
      remedy: 'Check that the file is a .pptx, and export it again from PowerPoint.',
    });
  }
  const deck = readDeck(files);
  return deck.slides.map((slide) => slideText(slide));
}

/** The text of a slide, one entry per run, in document order. */
function slideText(slide: PptxSlide): readonly string[] {
  return collectSlideText(slide.root);
}

/**
 * Every `a:t` in a part, in document order.
 */
function collectSlideText(root: XmlNode): readonly string[] {
  const output: string[] = [];
  const visit = (node: XmlNode): void => {
    if (node.name === 'a:t') {
      if (node.text) output.push(node.text);
      return;
    }
    for (const candidate of node.children) visit(candidate);
  };
  visit(root);
  return output;
}

/**
 * The slides to include, honouring an explicit page range.
 *
 * The range is 1-based and refers to slide numbers. A slide that is filtered
 * out is simply not rendered, so the one-slide-one-page invariant holds over
 * the slides that are included.
 */
function selectSlides(
  slides: readonly PptxSlide[],
  range: readonly number[] | undefined,
): readonly PptxSlide[] {
  if (!range || range.length === 0) return slides;
  const wanted = new Set(range);
  return slides.filter((_, index) => wanted.has(index + 1));
}

/**
 * One warning per category of loss, rather than one per occurrence.
 *
 * The UI joins the warnings into a single status line, so a warning per
 * character or per shape would bury the message that matters.
 */
function summarise(context: RenderContext): readonly string[] {
  const warnings: string[] = [
    'Slides are rendered with their shapes, colours, and text positions; fonts are substituted with the PDF standard fonts, so exact PowerPoint typography is not reproduced.',
  ];
  if (context.substitutedTypefaces.size > 0) {
    const names = [...context.substitutedTypefaces].slice(0, 6).join(', ');
    const more =
      context.substitutedTypefaces.size > 6
        ? ` and ${context.substitutedTypefaces.size - 6} more`
        : '';
    warnings.push(`These typefaces were substituted with standard PDF fonts: ${names}${more}.`);
  }
  if (context.replacedCharacters.size > 0) {
    const names = [...context.replacedCharacters].slice(0, 8).join(' ');
    warnings.push(
      `These characters are not in the PDF standard fonts and were replaced: ${names}.`,
    );
  }
  if (context.skippedFeatures.size > 0) {
    warnings.push(
      `These slide objects are not rendered: ${[...context.skippedFeatures].join(', ')}.`,
    );
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Reading the deck
// ---------------------------------------------------------------------------

type PptxDeck = {
  readonly slides: readonly PptxSlide[];
  /** `ppt/presentation.xml`, the root of the presentation-level defaults. */
  readonly presentation?: XmlNode;
  readonly theme: PptxTheme;
  readonly colorMap: PptxColorMap;
  readonly slideWidthEmu: number;
  readonly slideHeightEmu: number;
  readonly slideSizePoints: readonly [number, number];
  readonly declaredSlideSize: boolean;
};

type PptxSlide = {
  readonly path: string;
  readonly root: XmlNode;
  readonly shapes: readonly XmlNode[];
  /**
   * The colour map this slide resolves its scheme colours through.
   *
   * A slide may override the master's map with
   * `<p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr>`, in which case the
   * override wins for that slide alone.
   */
  readonly colorMap: PptxColorMap;
  /**
   * The slide's text, gathered only when the slide has no shape tree.
   *
   * A slide that has no `p:spTree` is not valid OOXML, but a stripped-down
   * deck can still carry readable text. Rather than lose it, the text is
   * collected and drawn as a plain block.
   */
  readonly fallbackText: readonly string[];
  readonly layout?: PptxLayout;
};

/** The layout and master a slide inherits from. */
type PptxLayout = {
  readonly root: XmlNode;
  readonly master?: XmlNode;
  readonly placeholders: ReadonlyMap<string, XmlNode>;
  /**
   * The master's own placeholders.
   *
   * A layout's placeholder frequently carries no geometry of its own — it
   * defers to the master's — so a slide's title would have no position at
   * all without this. The master's placeholders are also where the
   * inherited text style and body properties come from.
   */
  readonly masterPlaceholders: ReadonlyMap<string, XmlNode>;
};

/** Read the deck: its slides, in order, with the theme they resolve against. */
function readDeck(files: Record<string, Uint8Array>): PptxDeck {
  const presentation = parsePart(files, 'ppt/presentation.xml');
  // The colour scheme and the font scheme live in the *theme* part, not in
  // `presentation.xml`. Reading them from the presentation would leave every
  // scheme colour resolving to the built-in Office default, so a deck with a
  // red `accent1` would render blue-grey.
  const themePath = findFirst(files, /^ppt\/theme\/theme\d+\.xml$/u);
  const themeRoot = themePath ? parsePart(files, themePath) : undefined;
  const theme = parseTheme(themeRoot);
  const masterPath = findFirst(files, /^ppt\/slideMasters\/slideMaster\d+\.xml$/u);
  const masterRoot = masterPath ? parsePart(files, masterPath) : undefined;
  const colorMap = parseColorMap(masterRoot);

  const slideSize = presentation ? child(presentation, 'p:sldSz') : undefined;
  const widthEmu = numberAttr(slideSize, 'cx');
  const heightEmu = numberAttr(slideSize, 'cy');
  const declared =
    widthEmu !== undefined &&
    heightEmu !== undefined &&
    widthEmu > 0 &&
    heightEmu > 0 &&
    // A slide larger than 200 inches is a corrupt value, not a real deck.
    widthEmu < 200 * 914400 &&
    heightEmu < 200 * 914400;
  const slideWidthEmu = declared ? (widthEmu as number) : DEFAULT_SLIDE_POINTS[0] * EMU_PER_POINT;
  const slideHeightEmu = declared ? (heightEmu as number) : DEFAULT_SLIDE_POINTS[1] * EMU_PER_POINT;

  const slidePaths = resolveSlideOrder(files, presentation);
  const slides = slidePaths.map((path) => {
    const root = parsePart(files, path);
    const tree = root ? descendant(root, 'p:spTree') : undefined;
    const layout = resolveLayout(files, path);
    return {
      path,
      root: root ?? { name: 'p:sld', attrs: {}, children: [], text: '' },
      shapes: tree ? shapeChildren(tree) : [],
      colorMap: root ? slideColorMap(root, colorMap) : colorMap,
      fallbackText: tree || !root ? [] : collectSlideText(root),
      ...(layout ? { layout } : {}),
    };
  });

  return {
    slides,
    ...(presentation ? { presentation } : {}),
    theme,
    colorMap,
    slideWidthEmu,
    slideHeightEmu,
    slideSizePoints: [slideWidthEmu / EMU_PER_POINT, slideHeightEmu / EMU_PER_POINT],
    declaredSlideSize: declared,
  };
}

/**
 * The shape-bearing children of a shape tree, in document order.
 *
 * `p:spTree` interleaves shapes, pictures, groups, connectors and graphic
 * frames, and their order is the z-order. Filtering by element name would
 * lose that, so the children are read in the order they appear.
 */
function shapeChildren(tree: XmlNode): readonly XmlNode[] {
  const drawing = ['p:sp', 'p:pic', 'p:grpSp', 'p:cxnSp', 'p:graphicFrame'];
  const output: XmlNode[] = [];
  for (const node of tree.children) {
    if (node.name === 'mc:AlternateContent') {
      // PowerPoint writes an alternate-content block when a shape uses a
      // 2010-era extension. The block holds a modern `mc:Choice` and a
      // legacy `mc:Fallback`; the fallback is the DrawingML vocabulary this
      // renderer understands, so it is preferred.
      const alternative = child(node, 'mc:Fallback') ?? child(node, 'mc:Choice') ?? undefined;
      if (!alternative) continue;
      const inner = alternative.children.find((candidate) => drawing.includes(candidate.name));
      if (inner) output.push(inner);
      continue;
    }
    if (drawing.includes(node.name)) output.push(node);
  }
  return output;
}

/**
 * The slides of a deck, in the order the presentation lists them.
 *
 * `p:sldIdLst` is the authority for slide order; the file names are not. A
 * deck whose slides are numbered out of order still presents them in the
 * order its `sldIdLst` gives. When that list is missing — a deck stripped
 * down to its slides — the file names are used instead.
 */
function resolveSlideOrder(
  files: Record<string, Uint8Array>,
  presentation: XmlNode | undefined,
): readonly string[] {
  const byName = Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort(
      (left, right) =>
        (Number.parseInt(left.match(/\d+/u)?.[0] ?? '0', 10) || 0) -
        (Number.parseInt(right.match(/\d+/u)?.[0] ?? '0', 10) || 0),
    );
  if (!presentation) return byName;

  const list = child(presentation, 'p:sldIdLst');
  if (!list) return byName;
  const rels = readRelationships(files, 'ppt/_rels/presentation.xml.rels');
  const ordered: string[] = [];
  for (const entry of children(list, 'p:sldId')) {
    const id = entry.attrs['r:id'];
    if (!id) continue;
    const target = rels.get(id);
    if (!target) continue;
    const path = resolvePartPath('ppt', target);
    if (files[path]) ordered.push(path);
  }
  return ordered.length > 0 ? ordered : byName;
}

/**
 * A part's relationships, as `rId` → target path.
 */
function readRelationships(
  files: Record<string, Uint8Array>,
  path: string,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const content = files[path];
  if (!content) return map;
  const root = parseXml(new TextDecoder().decode(content));
  for (const relationship of children(root, 'Relationship')) {
    const id = relationship.attrs.Id;
    const target = relationship.attrs.Target;
    if (id && target) map.set(id, target);
  }
  return map;
}

/**
 * Resolve a relationship target to a path inside the package.
 *
 * A target is relative to the directory of the part that declares it, and may
 * walk up with `..`.
 */
function resolvePartPath(baseDir: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const segments = baseDir ? baseDir.split('/') : [];
  for (const segment of target.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

/** Parse a part, or `undefined` when it is absent or unreadable. */
function parsePart(files: Record<string, Uint8Array>, path: string): XmlNode | undefined {
  const content = files[path];
  if (!content) return undefined;
  try {
    return parseXml(new TextDecoder().decode(content));
  } catch {
    return undefined;
  }
}

/** The first non-empty file whose name matches, in a stable order. */
function findFirst(files: Record<string, Uint8Array>, pattern: RegExp): string | undefined {
  return Object.keys(files)
    .filter((name) => pattern.test(name))
    .sort()
    .find((name) => (files[name]?.byteLength ?? 0) > 0);
}

/**
 * The layout a slide inherits from, and the placeholders that layout carries.
 *
 * A slide's title often has no geometry of its own: it takes the position
 * from the layout's placeholder, matched by type and index.
 */
function resolveLayout(
  files: Record<string, Uint8Array>,
  slidePath: string,
): PptxLayout | undefined {
  const slideName = slidePath.slice(slidePath.lastIndexOf('/') + 1);
  const slideDirectory = slidePath.slice(0, slidePath.lastIndexOf('/'));
  const rels = readRelationships(files, `${slideDirectory}/_rels/${slideName}.rels`);
  const layoutTarget = [...rels.values()].find((target) => target.includes('slideLayout'));
  if (!layoutTarget) return undefined;
  const layoutPath = resolvePartPath(slideDirectory, layoutTarget);
  const layoutRoot = parsePart(files, layoutPath);
  if (!layoutRoot) return undefined;

  const layoutName = layoutPath.slice(layoutPath.lastIndexOf('/') + 1);
  const layoutDirectory = layoutPath.slice(0, layoutPath.lastIndexOf('/'));
  const layoutRels = readRelationships(files, `${layoutDirectory}/_rels/${layoutName}.rels`);
  const masterTarget = [...layoutRels.values()].find((target) => target.includes('slideMaster'));
  const masterRoot = masterTarget
    ? parsePart(files, resolvePartPath(layoutDirectory, masterTarget))
    : undefined;

  const placeholders = new Map<string, XmlNode>();
  const layoutTree = descendant(layoutRoot, 'p:spTree');
  for (const shape of layoutTree ? children(layoutTree, 'p:sp') : []) {
    const placeholder = descendant(shape, 'p:ph');
    if (!placeholder) continue;
    const type = placeholder.attrs.type ?? 'body';
    const index = placeholder.attrs.idx ?? '0';
    placeholders.set(`${type}:${index}`, shape);
  }

  // The master's placeholders are collected the same way. A layout's
  // placeholder often has no `a:xfrm` of its own, so the geometry — and the
  // text body properties — come from the master.
  const masterPlaceholders = new Map<string, XmlNode>();
  const masterTree = masterRoot ? descendant(masterRoot, 'p:spTree') : undefined;
  for (const shape of masterTree ? children(masterTree, 'p:sp') : []) {
    const placeholder = descendant(shape, 'p:ph');
    if (!placeholder) continue;
    const type = placeholder.attrs.type ?? 'body';
    const index = placeholder.attrs.idx ?? '0';
    masterPlaceholders.set(`${type}:${index}`, shape);
  }

  return {
    root: layoutRoot,
    ...(masterRoot ? { master: masterRoot } : {}),
    placeholders,
    masterPlaceholders,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Draw one slide onto one page. */
async function renderSlide(page: PDFPage, slide: PptxSlide, context: RenderContext): Promise<void> {
  // The page is clipped to its own MediaBox, so a shape with a negative
  // offset cannot paint off the page.
  //
  // The graphics state has to stay open for the whole slide: a clip belongs
  // to the graphics state, so popping the state straight away discarded it
  // and a shape hanging off the edge painted outside the page. The state is
  // popped once the slide is finished.
  page.pushOperators(
    pushGraphicsState(),
    rectangle(0, 0, context.pageWidth, context.pageHeight),
    clip(),
  );

  try {
    const background = resolveBackground(slide, context);
    if (background) {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: context.pageWidth,
        height: context.pageHeight,
        color: rgb(background.color.r, background.color.g, background.color.b),
        ...(background.alpha !== undefined ? { opacity: background.alpha } : {}),
      });
    }

    for (const shape of slide.shapes) {
      await renderShape(page, shape, context, identityTransform(), slide);
    }

    // A slide with no shape tree at all still has text, and losing it would be
    // worse than drawing it without the layout the deck asked for.
    if (slide.shapes.length === 0 && slide.fallbackText.length > 0) {
      renderFallbackText(page, slide, context);
    }
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

/**
 * Draw a slide's text without its layout.
 *
 * This is the last resort for a slide whose shape tree could not be read. The
 * text is drawn as a plain block in the slide's top-left corner, which keeps
 * it visible and extractable rather than dropping it.
 */
function renderFallbackText(page: PDFPage, slide: PptxSlide, context: RenderContext): void {
  const font = context.fonts.get('Helvetica');
  if (!font) return;
  const margin = 48;
  let y = context.pageHeight - margin;
  for (const line of slide.fallbackText) {
    const sanitized = sanitizeForWinAnsi(line);
    for (const character of sanitized.replaced) context.replacedCharacters.add(character);
    if (!sanitized.text) continue;
    page.drawText(sanitized.text, {
      x: margin,
      y,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
    y -= 22;
    if (y < margin) break;
  }
}

/** The identity transform. */
function identityTransform(): Transform {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/**
 * The background of a slide, following the inheritance chain.
 *
 * A slide's own background wins; then its layout's; then the master's.
 *
 * A background is written in one of two ways. `p:bgPr` names a fill directly,
 * and `p:bgRef` points at the theme's background style list. A `bgRef` is the
 * common case — PowerPoint writes one on the master and the layout, and the
 * colour comes from the theme — so resolving it through
 * `a:bgFillStyleLst` is what stops a themed deck from falling back to plain
 * white.
 *
 * A gradient is flattened to its first stop: pdf-lib has no shading builder,
 * and a real gradient would mean hand-writing PDF objects.
 */
function resolveBackground(
  slide: PptxSlide,
  context: RenderContext,
): { color: Rgb; alpha?: number } | undefined {
  const candidates = [
    descendant(slide.root, 'p:bg'),
    slide.layout ? descendant(slide.layout.root, 'p:bg') : undefined,
    slide.layout?.master ? descendant(slide.layout.master, 'p:bg') : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const properties = child(candidate, 'p:bgPr');
    if (properties) {
      const solid = readFillColor(properties, context.colorMap, context.theme);
      if (solid) return solid;
      const gradient = readGradientColor(properties, context.colorMap, context.theme);
      if (gradient) {
        context.skippedFeatures.add('gradient backgrounds (drawn as a flat colour)');
        return gradient;
      }
    }
    const reference = child(candidate, 'p:bgRef');
    if (reference) {
      // A `bgRef` points at the theme's background styles, with the
      // reference's own colour replacing the entry's `phClr` placeholder.
      const themed = readBackgroundReference(reference, context.colorMap, context.theme);
      if (themed) return themed;
    }
  }
  return undefined;
}

/** Draw one shape. */
async function renderShape(
  page: PDFPage,
  shape: XmlNode,
  context: RenderContext,
  transform: Transform,
  slide: PptxSlide,
): Promise<void> {
  switch (shape.name) {
    case 'p:sp':
    case 'p:cxnSp':
      renderTextShape(page, shape, context, transform, slide);
      break;
    case 'p:pic':
      await renderPicture(page, shape, context, transform, slide);
      break;
    case 'p:grpSp':
      await renderGroup(page, shape, context, transform, slide);
      break;
    case 'p:graphicFrame':
      renderGraphicFrame(page, shape, context, transform, slide);
      break;
    default:
      break;
  }
}

/** The shape's own geometry, in slide EMU. */
function shapeBox(shape: XmlNode): Box | undefined {
  // A `p:sp` and a `p:grpSp` carry their transform inside `p:spPr` /
  // `p:grpSpPr` as an `a:xfrm`, but a `p:graphicFrame` — a table or a chart —
  // puts `a:off` and `a:ext` *directly* under its own `p:xfrm`, with no inner
  // `a:xfrm`. Looking for one in both places is what makes a table's geometry
  // findable at all.
  const properties =
    child(shape, 'p:spPr') ??
    child(shape, 'p:grpSpPr') ??
    child(shape, 'p:xfrm') ??
    child(shape, 'a:xfrm');
  if (!properties) return undefined;
  const transformNode = descendant(properties, 'a:xfrm') ?? properties;
  const offset = child(transformNode, 'a:off');
  const extent = child(transformNode, 'a:ext');
  const x = numberAttr(offset, 'x');
  const y = numberAttr(offset, 'y');
  const width = numberAttr(extent, 'cx');
  const height = numberAttr(extent, 'cy');
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width, height };
}

/**
 * Draw a shape that may carry text: its geometry, then its text.
 */
function renderTextShape(
  page: PDFPage,
  shape: XmlNode,
  context: RenderContext,
  transform: Transform,
  slide: PptxSlide,
): void {
  const properties = child(shape, 'p:spPr');
  const own = shapeBox(shape);
  // A placeholder with no geometry of its own takes the layout's, and the
  // layout takes the master's.
  const box = own ?? inheritedBox(shape, slide);
  if (properties && box) {
    drawShapeGeometry(page, shape, properties, box, context, transform);
  } else if (!properties && box) {
    // A placeholder with no properties of its own inherits the layout's, and
    // the layout's the master's. Without this a coloured layout placeholder
    // renders with no fill on every slide that uses it.
    const inherited = inheritedProperties(shape, slide);
    if (inherited) {
      drawShapeGeometry(page, shape, inherited, box, context, transform);
    }
  }
  const body = child(shape, 'p:txBody');
  if (body && box) {
    renderTextBody(page, body, shape, box, context, transform, slide);
  }
}

/**
 * The geometry a placeholder inherits.
 *
 * A placeholder takes its position from the layout's matching placeholder,
 * and the layout in turn takes it from the master's when the layout declares
 * no geometry of its own. Without the second step a slide's title has no
 * position at all, and its text is not drawn.
 */
function inheritedBox(shape: XmlNode, slide: PptxSlide): Box | undefined {
  const placeholder = placeholderOf(shape);
  if (!placeholder) return undefined;
  const key = `${placeholder.type}:${placeholder.index}`;
  const layoutShape = slide.layout?.placeholders.get(key);
  const layoutBox = layoutShape ? shapeBox(layoutShape) : undefined;
  if (layoutBox) return layoutBox;
  const masterShape = slide.layout?.masterPlaceholders.get(key);
  return masterShape ? shapeBox(masterShape) : undefined;
}

/**
 * The shape properties a placeholder inherits.
 *
 * A slide placeholder that declares no fill of its own takes the layout's,
 * and the layout takes the master's. The inherited properties are used only
 * for the properties the slide does not declare.
 */
function inheritedProperties(shape: XmlNode, slide: PptxSlide): XmlNode | undefined {
  const placeholder = placeholderOf(shape);
  if (!placeholder) return undefined;
  const key = `${placeholder.type}:${placeholder.index}`;
  const layoutShape = slide.layout?.placeholders.get(key);
  if (layoutShape) {
    const properties = child(layoutShape, 'p:spPr');
    if (properties) return properties;
  }
  const masterShape = slide.layout?.masterPlaceholders.get(key);
  return masterShape ? child(masterShape, 'p:spPr') : undefined;
}

/**
 * The chain of text body properties a placeholder inherits.
 *
 * `a:bodyPr` carries the text box's insets and its vertical anchor, and
 * OOXML inherits it **attribute by attribute**: a slide that writes
 * `<a:bodyPr/>` inherits every attribute it does not set, rather than
 * resetting the whole element. So the chain is the slide's own `a:bodyPr`,
 * then the layout placeholder's, then the master's — and each attribute is
 * taken from the first that declares it.
 */
function bodyPropsChain(body: XmlNode, shape: XmlNode, slide: PptxSlide): readonly XmlNode[] {
  const chain: XmlNode[] = [];
  const own = child(body, 'a:bodyPr');
  if (own) chain.push(own);
  const placeholder = placeholderOf(shape);
  if (!placeholder) return chain;
  const key = `${placeholder.type}:${placeholder.index}`;
  for (const source of [
    slide.layout?.placeholders.get(key),
    slide.layout?.masterPlaceholders.get(key),
  ]) {
    if (!source) continue;
    const textBody = child(source, 'p:txBody');
    if (!textBody) continue;
    const bodyProps = child(textBody, 'a:bodyPr');
    if (bodyProps) chain.push(bodyProps);
  }
  return chain;
}

/** Draw a shape's fill and outline. */
function drawShapeGeometry(
  page: PDFPage,
  shape: XmlNode,
  properties: XmlNode,
  box: Box,
  context: RenderContext,
  transform: Transform,
): void {
  const fill = readFillColor(properties, context.colorMap, context.theme);
  const gradient = readGradientColor(properties, context.colorMap, context.theme);
  if (gradient) context.skippedFeatures.add('gradient fills (drawn as a flat colour)');
  const line = child(properties, 'a:ln');
  const lineFill = readFillColor(line, context.colorMap, context.theme);
  const lineWidthEmu = numberAttr(line, 'w');
  const custom = child(properties, 'a:custGeom');
  const preset = child(properties, 'a:prstGeom')?.attrs.prst ?? 'rect';

  // A shape may carry no fill of its own and point at the theme's instead:
  // `<p:style><a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef></p:style>`.
  // The reference is only consulted when the shape declares no fill of its
  // own — an explicit fill always wins.
  const style = child(shape, 'p:style');
  const styleFill = fill
    ? undefined
    : readStyleRefFill(
        style ? child(style, 'a:fillRef') : undefined,
        context.colorMap,
        context.theme,
      );
  const styleLine = style
    ? readStyleRefLine(child(style, 'a:lnRef'), context.colorMap, context.theme)
    : undefined;

  // A text box with neither a fill nor an outline is not a shape at all.
  if (!fill && !gradient && !styleFill && !lineFill && !styleLine && !custom) return;
  if (hasNoFill(properties) && !lineFill && !styleLine && !custom) return;

  const points = toPagePoints(box, transform, context);
  const width = points.width;
  const height = points.height;
  if (width <= 0 || height <= 0) return;

  const color = fill ?? gradient ?? styleFill;
  const border = lineFill ?? styleLine;
  const borderWidthEmu = lineWidthEmu ?? styleLine?.width;
  const borderWidth = borderWidthEmu === undefined ? 0 : borderWidthEmu * context.scale;
  const rotation = shapeRotation(shape);

  if (custom) {
    drawCustomGeometry(page, shape, custom, points, context, color, border, borderWidth, rotation);
    return;
  }

  if (preset === 'ellipse') {
    page.drawEllipse({
      x: points.x + width / 2,
      y: points.y + height / 2,
      xScale: width / 2,
      yScale: height / 2,
      // `drawEllipse` rotates about the ellipse's own centre, which is the
      // pivot OOXML specifies, so the rotation needs no extra graphics state.
      ...(rotation ? { rotate: rotation } : {}),
      ...(color ? { color: rgb(color.color.r, color.color.g, color.color.b) } : {}),
      ...(color?.alpha !== undefined ? { opacity: color.alpha } : {}),
      ...(border
        ? {
            borderColor: rgb(border.color.r, border.color.g, border.color.b),
            borderWidth: Math.max(borderWidth, 0.5),
          }
        : {}),
    });
    return;
  }

  if (preset === 'line' || preset === 'straightConnector1') {
    // A line runs from the box's *top-left* to its *bottom-right* in slide
    // space, which — because the slide's y axis points down and the page's
    // points up — is from the box's *top* to its *bottom* in page space.
    //
    // The renderer drew it from the bottom-left to the top-right, which is
    // the other diagonal: a connector in a deck came out mirrored.
    page.drawLine({
      start: { x: points.x, y: points.y + height },
      end: { x: points.x + width, y: points.y },
      thickness: Math.max(borderWidth, 0.5),
      ...(border
        ? { color: rgb(border.color.r, border.color.g, border.color.b) }
        : { color: rgb(0, 0, 0) }),
    });
    return;
  }

  const path = presetPath(preset, width, height);
  if (!path) {
    context.skippedFeatures.add(`${preset} shapes`);
    return;
  }
  // `drawSvgPath` rotates about the path's *origin*, which is the shape's
  // top-left corner. OOXML rotates about the shape's *centre*, so the shape is
  // drawn inside a graphics state that moves the origin to the centre first:
  // translate to the centre, rotate, translate back.
  //
  // A mirrored shape is handled the same way: the flip is a reflection about
  // the shape's centre, so it belongs in the same graphics state.
  const centreX = points.x + width / 2;
  const centreY = points.y + height / 2;
  const flips = shapeFlips(shape);
  const needsState = rotation !== undefined || flips.horizontal || flips.vertical;
  if (needsState) {
    page.pushOperators(pushGraphicsState(), translate(centreX, centreY));
    if (flips.horizontal) {
      page.pushOperators(concatTransformationMatrix(-1, 0, 0, 1, 0, 0));
    }
    if (flips.vertical) {
      page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
    }
    if (rotation) {
      page.pushOperators(rotateRadians(rotationInRadians(rotation)));
    }
    page.pushOperators(translate(-centreX, -centreY));
  }
  page.drawSvgPath(path, {
    x: points.x,
    y: points.y + height,
    scale: 1,
    ...(color ? { color: rgb(color.color.r, color.color.g, color.color.b) } : {}),
    ...(color?.alpha !== undefined ? { opacity: color.alpha } : {}),
    ...(border
      ? {
          borderColor: rgb(border.color.r, border.color.g, border.color.b),
          borderWidth: Math.max(borderWidth, 0.5),
        }
      : {}),
  });
  if (needsState) page.pushOperators(popGraphicsState());
}

/**
 * A shape's rotation, in PDF terms.
 *
 * OOXML's `a:xfrm/@rot` is in 60000ths of a degree and positive *clockwise*,
 * because the slide's y axis points down. PDF's rotation is counter-clockwise,
 * so the sign flips.
 */
function shapeRotation(shape: XmlNode): Rotation | undefined {
  const properties = child(shape, 'p:spPr');
  const transformNode = properties ? descendant(properties, 'a:xfrm') : undefined;
  const raw = numberAttr(transformNode, 'rot');
  if (raw === undefined || raw === 0) return undefined;
  return degrees(-(raw / 60000));
}

/**
 * Whether a shape is mirrored, and in which direction.
 *
 * `a:xfrm/@flipH` and `@flipV` mirror the shape about its own centre. A
 * mirrored shape is not a different shape — it is the same path drawn the
 * other way round — so the flip is applied as a graphics state about the
 * shape's centre, alongside the rotation.
 */
function shapeFlips(shape: XmlNode): { horizontal: boolean; vertical: boolean } {
  const properties = child(shape, 'p:spPr');
  const transformNode = properties ? descendant(properties, 'a:xfrm') : undefined;
  return {
    horizontal: transformNode ? boolAttr(transformNode, 'flipH') === true : false,
    vertical: transformNode ? boolAttr(transformNode, 'flipV') === true : false,
  };
}

/**
 * A turn, in radians, ready for pdf-lib's `rotateRadians`.
 *
 * pdf-lib's `Rotation` carries an angle in *degrees*, and its
 * `rotateRadians` operator wants *radians*. Handing one to the other
 * silently turns the shape by the wrong amount: a 45° turn became a turn of
 * 45 radians, which is about 302°.
 *
 * The conversion lives in one place so the two units cannot be confused
 * again.
 */
function rotationInRadians(rotation: Rotation): number {
  return (rotation.angle * Math.PI) / 180;
}

/**
 * The SVG path for a preset geometry, in a box of the given size.
 *
 * The preset vocabulary is around 180 shapes. The ones that appear in real
 * decks are implemented; the rest are reported rather than approximated with
 * a rectangle, which would misstate what the slide contains.
 */
function presetPath(preset: string, width: number, height: number): string | undefined {
  const w = width;
  const h = height;
  switch (preset) {
    case 'rect':
    case 'flowChartProcess':
      return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
    case 'roundRect':
      return `M ${r(w)} 0 L ${w - r(w)} 0 Q ${w} 0 ${w} ${r(h)} L ${w} ${h - r(h)} Q ${w} ${h} ${w - r(w)} ${h} L ${r(w)} ${h} Q 0 ${h} 0 ${h - r(h)} L 0 ${r(h)} Q 0 0 ${r(w)} 0 Z`;
    case 'ellipse':
    case 'flowChartConnector':
      return `M 0 ${h / 2} A ${w / 2} ${h / 2} 0 1 1 ${w} ${h / 2} A ${w / 2} ${h / 2} 0 1 1 0 ${h / 2} Z`;
    case 'triangle':
      return `M ${w / 2} 0 L ${w} ${h} L 0 ${h} Z`;
    case 'rtTriangle':
      return `M 0 0 L ${w} 0 L ${w} ${h} Z`;
    case 'diamond':
      return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
    case 'parallelogram':
      return `M ${w * 0.25} 0 L ${w} 0 L ${w * 0.75} ${h} L 0 ${h} Z`;
    case 'trapezoid':
      return `M ${w * 0.25} 0 L ${w * 0.75} 0 L ${w} ${h} L 0 ${h} Z`;
    case 'homePlate':
      return `M 0 0 L ${w * 0.75} 0 L ${w} ${h / 2} L ${w * 0.75} ${h} L 0 ${h} Z`;
    case 'chevron':
      return `M 0 0 L ${w * 0.75} 0 L ${w} ${h / 2} L ${w * 0.75} ${h} L 0 ${h} L ${w * 0.25} ${h / 2} Z`;
    case 'pentagon':
      return `M ${w * 0.5} 0 L ${w} ${h * 0.38} L ${w * 0.82} ${h} L ${w * 0.18} ${h} L 0 ${h * 0.38} Z`;
    case 'hexagon':
      return `M ${w * 0.25} 0 L ${w * 0.75} 0 L ${w} ${h / 2} L ${w * 0.75} ${h} L ${w * 0.25} ${h} L 0 ${h / 2} Z`;
    case 'octagon':
      return `M ${w * 0.25} 0 L ${w * 0.75} 0 L ${w} ${h * 0.25} L ${w} ${h * 0.75} L ${w * 0.75} ${h} L ${w * 0.25} ${h} L 0 ${h * 0.75} L 0 ${h * 0.25} Z`;
    case 'star5':
      return starPath(w, h, 5);
    case 'star4':
      return starPath(w, h, 4);
    default:
      return undefined;
  }
}

/** The corner radius of a rounded rectangle. */
function r(size: number): number {
  return Math.min(size / 5, 12);
}

/** A star with the given number of points. */
function starPath(width: number, height: number, points: number): string {
  const outer = Math.min(width, height) / 2;
  const inner = outer * 0.382;
  const centreX = width / 2;
  const centreY = height / 2;
  const commands: string[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const radius = index % 2 === 0 ? outer : inner;
    const angle = (Math.PI / points) * index - Math.PI / 2;
    const x = centreX + radius * Math.cos(angle);
    const y = centreY + radius * Math.sin(angle);
    commands.push(`${index === 0 ? 'M' : 'L'} ${x.toFixed(3)} ${y.toFixed(3)}`);
  }
  return `${commands.join(' ')} Z`;
}

/**
 * Draw a custom geometry.
 *
 * `a:custGeom` holds a path in DrawingML's own vocabulary, and those commands
 * map directly onto PDF's path operators. This is how decks draw logos and
 * arrows, so it is worth supporting rather than skipping.
 */
function drawCustomGeometry(
  page: PDFPage,
  shape: XmlNode,
  custom: XmlNode,
  points: { x: number; y: number; width: number; height: number },
  context: RenderContext,
  fillColor: { color: Rgb; alpha?: number } | undefined,
  lineFill: { color: Rgb; alpha?: number } | undefined,
  borderWidth: number,
  rotation: Rotation | undefined,
): void {
  const list = child(custom, 'a:pathLst');
  const path = list ? child(list, 'a:path') : undefined;
  if (!path) return;
  const pathWidth = numberAttr(path, 'w') ?? points.width;
  const pathHeight = numberAttr(path, 'h') ?? points.height;
  if (pathWidth <= 0 || pathHeight <= 0) return;
  const scaleX = points.width / pathWidth;
  const scaleY = points.height / pathHeight;

  const commands: string[] = [];
  for (const node of path.children) {
    if (node.name === 'a:moveTo') {
      const point = child(node, 'a:pt');
      const x = (numberAttr(point, 'x') ?? 0) * scaleX;
      const y = (numberAttr(point, 'y') ?? 0) * scaleY;
      commands.push(`M ${x.toFixed(3)} ${y.toFixed(3)}`);
    } else if (node.name === 'a:lnTo') {
      const point = child(node, 'a:pt');
      const x = (numberAttr(point, 'x') ?? 0) * scaleX;
      const y = (numberAttr(point, 'y') ?? 0) * scaleY;
      commands.push(`L ${x.toFixed(3)} ${y.toFixed(3)}`);
    } else if (node.name === 'a:cubicBezTo') {
      const coordinates = children(node, 'a:pt').map(
        (point) =>
          `${((numberAttr(point, 'x') ?? 0) * scaleX).toFixed(3)} ${(
            (numberAttr(point, 'y') ?? 0) * scaleY
          ).toFixed(3)}`,
      );
      if (coordinates.length >= 3) commands.push(`C ${coordinates.join(' ')}`);
    } else if (node.name === 'a:close') {
      commands.push('Z');
    }
  }
  if (commands.length === 0) return;

  // As with the preset geometry, the rotation pivots about the shape's
  // centre rather than the path's origin.
  const centreX = points.x + points.width / 2;
  const centreY = points.y + points.height / 2;
  // A custom geometry is mirrored and rotated the same way a preset one is:
  // both are reflections and turns about the shape's own centre.
  const flips = shapeFlips(shape);
  const needsState = rotation !== undefined || flips.horizontal || flips.vertical;
  if (needsState) {
    page.pushOperators(pushGraphicsState(), translate(centreX, centreY));
    if (flips.horizontal) {
      page.pushOperators(concatTransformationMatrix(-1, 0, 0, 1, 0, 0));
    }
    if (flips.vertical) {
      page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
    }
    if (rotation) {
      page.pushOperators(rotateRadians(rotationInRadians(rotation)));
    }
    page.pushOperators(translate(-centreX, -centreY));
  }
  page.drawSvgPath(commands.join(' '), {
    x: points.x,
    y: points.y + points.height,
    scale: 1,
    ...(fillColor ? { color: rgb(fillColor.color.r, fillColor.color.g, fillColor.color.b) } : {}),
    ...(fillColor?.alpha !== undefined ? { opacity: fillColor.alpha } : {}),
    ...(lineFill
      ? {
          borderColor: rgb(lineFill.color.r, lineFill.color.g, lineFill.color.b),
          borderWidth: Math.max(borderWidth, 0.5),
        }
      : {}),
  });
  if (needsState) page.pushOperators(popGraphicsState());
}

/** Draw a picture. */
async function renderPicture(
  page: PDFPage,
  shape: XmlNode,
  context: RenderContext,
  transform: Transform,
  slide: PptxSlide,
): Promise<void> {
  const box = shapeBox(shape);
  if (!box) return;
  const blipFill = child(shape, 'p:blipFill');
  const blip = blipFill ? child(blipFill, 'a:blip') : undefined;
  const embed = blip?.attrs['r:embed'];
  if (!embed) {
    // A linked image is a URL. Fetching it would break the local-first
    // promise, so it is reported rather than retrieved.
    if (blip?.attrs['r:link']) context.skippedFeatures.add('linked (external) images');
    return;
  }
  const points = toPagePoints(box, transform, context);
  const width = points.width;
  const height = points.height;
  if (width <= 0 || height <= 0) return;

  const imagePath = resolveImagePath(context, embed, slide.path);
  if (!imagePath) return;
  const bytes = context.files[imagePath];
  if (!bytes) return;

  const kind = detectImageKind(bytes);
  if (!kind) {
    context.skippedFeatures.add('images in formats the PDF writer cannot embed');
    return;
  }
  try {
    const image =
      kind === 'png'
        ? await context.document.embedPng(bytes)
        : await context.document.embedJpg(bytes);
    // A picture may be rotated or mirrored, and pdf-lib's `drawImage` has no
    // option for either — so the turn and the reflection are applied as a
    // graphics state about the picture's own centre, the same way a shape's
    // are.
    const rotation = shapeRotation(shape);
    const flips = shapeFlips(shape);
    const needsState = rotation !== undefined || flips.horizontal || flips.vertical;
    if (needsState) {
      const centreX = points.x + width / 2;
      const centreY = points.y + height / 2;
      page.pushOperators(pushGraphicsState(), translate(centreX, centreY));
      if (flips.horizontal) {
        page.pushOperators(concatTransformationMatrix(-1, 0, 0, 1, 0, 0));
      }
      if (flips.vertical) {
        page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
      }
      if (rotation) {
        page.pushOperators(rotateRadians(rotationInRadians(rotation)));
      }
      page.pushOperators(translate(-centreX, -centreY));
    }
    page.drawImage(image, { x: points.x, y: points.y, width, height });
    if (needsState) page.pushOperators(popGraphicsState());
  } catch {
    // A progressive JPEG, or a PNG pdf-lib cannot parse, is reported rather
    // than allowed to fail the slide.
    context.skippedFeatures.add(`${kind} images that could not be decoded`);
  }
}

/** The image a picture references, resolved through the slide's relationships. */
function resolveImagePath(
  context: RenderContext,
  embed: string,
  slidePath: string,
): string | undefined {
  const directory = slidePath.slice(0, slidePath.lastIndexOf('/'));
  const name = slidePath.slice(slidePath.lastIndexOf('/') + 1);
  const rels = readRelationships(context.files, `${directory}/_rels/${name}.rels`).get(embed);
  if (!rels) return undefined;
  return resolvePartPath(directory, rels);
}

/** Whether a byte string is a PNG, a JPEG, or something else. */
function detectImageKind(bytes: Uint8Array): 'png' | 'jpg' | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  return undefined;
}

/**
 * Draw a group, mapping its children from the group's child space.
 *
 * A group's `a:xfrm` names the group's own box, the child coordinate space
 * it maps from, and a rotation about the group's centre. The scale and the
 * offset go into the children's transform, because they move the children
 * within the group. The rotation is applied as a *graphics state* around
 * the whole group, because a rotation is not a change of position — it
 * turns the group's box and everything in it, text included.
 */
async function renderGroup(
  page: PDFPage,
  group: XmlNode,
  context: RenderContext,
  transform: Transform,
  slide: PptxSlide,
): Promise<void> {
  const properties = child(group, 'p:grpSpPr');
  const transformNode = properties ? descendant(properties, 'a:xfrm') : undefined;
  if (!transformNode) {
    for (const childShape of shapeChildren(group)) {
      await renderShape(page, childShape, context, transform, slide);
    }
    return;
  }
  const offset = child(transformNode, 'a:off');
  const extent = child(transformNode, 'a:ext');
  const childOffset = child(transformNode, 'a:chOff');
  const childExtent = child(transformNode, 'a:chExt');
  const offX = numberAttr(offset, 'x') ?? 0;
  const offY = numberAttr(offset, 'y') ?? 0;
  const extX = numberAttr(extent, 'cx') ?? 0;
  const extY = numberAttr(extent, 'cy') ?? 0;
  const chOffX = numberAttr(childOffset, 'x') ?? 0;
  const chOffY = numberAttr(childOffset, 'y') ?? 0;
  const chExtX = numberAttr(childExtent, 'cx') || extX || 1;
  const chExtY = numberAttr(childExtent, 'cy') || extY || 1;

  // The child space maps onto the group's own space.
  const scaleX = extX / chExtX;
  const scaleY = extY / chExtY;
  const groupTransform: Transform = {
    a: scaleX,
    b: 0,
    c: 0,
    d: scaleY,
    e: offX - chOffX * scaleX,
    f: offY - chOffY * scaleY,
  };

  // The group's rotation, applied about the centre of its own box.
  const raw = numberAttr(transformNode, 'rot') ?? 0;
  if (raw !== 0) {
    // The centre of the group's box, in page points. The slide's y axis
    // points down and the page's points up, so the centre is measured from
    // the top of the slide.
    const centreX = (offX + extX / 2) * context.scale;
    const centreY = context.pageHeight - (offY + extY / 2) * context.scale;
    page.pushOperators(
      pushGraphicsState(),
      translate(centreX, centreY),
      // OOXML's rotation is positive *clockwise* on the slide, and PDF's is
      // counter-clockwise, so the sign flips.
      rotateRadians((-raw / 60000) * (Math.PI / 180)),
      translate(-centreX, -centreY),
    );
  }

  for (const childShape of shapeChildren(group)) {
    await renderShape(
      page,
      childShape,
      context,
      composeTransform(transform, groupTransform),
      slide,
    );
  }

  if (raw !== 0) page.pushOperators(popGraphicsState());
}

/** Compose two transforms: `outer` applied after `inner`. */
function composeTransform(outer: Transform, inner: Transform): Transform {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

/** Draw a graphic frame: a table, or a chart this renderer cannot draw. */
function renderGraphicFrame(
  page: PDFPage,
  frame: XmlNode,
  context: RenderContext,
  transform: Transform,
  slide: PptxSlide,
): void {
  const table = descendant(frame, 'a:tbl');
  if (!table) {
    context.skippedFeatures.add('charts and SmartArt');
    return;
  }
  const box = shapeBox(frame);
  if (!box) return;
  renderTable(page, table, box, context, transform, slide);
}

/**
 * Draw a table as a ruled grid.
 *
 * A table is more than a grid of equal cells. Three things vary and all
 * three change the drawing:
 *
 *   - **Cell margins.** `a:tcPr/@marL,@marR,@marT,@marB` set the padding
 *     inside a cell. The text sits inside them.
 *   - **Spans.** `a:tc/@gridSpan` and `a:tc/@rowSpan` make a cell cover
 *     more than one column or row. The spanned cells are covered by it and
 *     are not drawn again.
 *   - **Row heights.** A row's declared height is a *minimum*. A row whose
 *     text needs more room grows, because clipping a data row loses the
 *     data — which is the one thing a table must not do.
 */
function renderTable(
  page: PDFPage,
  table: XmlNode,
  box: Box,
  context: RenderContext,
  transform: Transform,
  slide: PptxSlide,
): void {
  const points = toPagePoints(box, transform, context);
  const grid = child(table, 'a:tblGrid');
  const columnWidths = (grid ? children(grid, 'a:gridCol') : []).map(
    (column) => numberAttr(column, 'w') ?? 0,
  );
  const rows = children(table, 'a:tr');
  if (rows.length === 0) return;

  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0) || box.width;
  const widths =
    columnWidths.length > 0 ? columnWidths.map((width) => (width / totalWidth) * box.width) : [];

  const scale = context.scale;
  const lineColor = rgb(0.6, 0.6, 0.6);

  // The row heights are settled before anything is drawn, because a row that
  // grows pushes every row below it down.
  const heights = rowHeights(rows, box, widths, context);

  // The table's cells are laid out in page points, but the text inside them
  // is laid out from a box in slide EMU. Both are tracked here so the cell
  // rectangle and the text inside it always agree.
  let y = points.y + points.height;
  // The slide-space y of the top edge of the current row, in EMU.
  let rowTopEmu = box.y;

  for (const [rowIndex, row] of rows.entries()) {
    const rowHeightEmu = heights[rowIndex] ?? 0;
    const height = rowHeightEmu * scale;
    let x = points.x;
    let columnEmu = box.x;
    const cells = children(row, 'a:tc');
    // The column a cell starts at, tracked so a spanning cell can be
    // positioned and the cells it covers can be skipped.
    let columnIndex = 0;
    for (const cell of cells) {
      const span = Math.max(1, numberAttr(cell, 'gridSpan') ?? 1);
      const rowSpan = Math.max(1, numberAttr(cell, 'rowSpan') ?? 1);
      // A cell that covers several columns is as wide as all of them.
      const columnWidthEmu = sumColumns(widths, columnIndex, span, box, cells.length);
      const width = columnWidthEmu * scale;
      // A cell that covers several rows is as tall as all of them.
      const cellHeightEmu = sumRows(heights, rowIndex, rowSpan);
      const cellHeight = cellHeightEmu * scale;

      const properties = child(cell, 'a:tcPr');
      const fill = readFillColor(properties, context.colorMap, context.theme);
      if (fill) {
        page.drawRectangle({
          x,
          y: y - cellHeight,
          width,
          height: cellHeight,
          color: rgb(fill.color.r, fill.color.g, fill.color.b),
          ...(fill.alpha !== undefined ? { opacity: fill.alpha } : {}),
        });
      }
      drawCellBorder(page, properties, x, y - cellHeight, width, cellHeight, context, lineColor);
      const body = child(cell, 'a:txBody');
      if (body) {
        const insets = readCellInsets(properties);
        renderTextBody(
          page,
          body,
          cell,
          {
            x: columnEmu,
            y: rowTopEmu,
            width: columnWidthEmu,
            height: cellHeightEmu,
          },
          context,
          identityTransform(),
          slide,
          insets,
        );
      }
      x += width;
      columnEmu += columnWidthEmu;
      columnIndex += span;
    }
    y -= height;
    // The next row starts below this one, in slide space.
    rowTopEmu += rowHeightEmu;
  }
}

/**
 * The height of each row of a table, in slide EMU.
 *
 * A row's declared height is a minimum. When the text in the row needs more
 * room than that, the row grows — the alternative is to clip the data, and
 * a table that silently loses a row is worse than one that is a little
 * taller than the deck asked for.
 */
function rowHeights(
  rows: readonly XmlNode[],
  box: Box,
  widths: readonly number[],
  context: RenderContext,
): readonly number[] {
  const fallback = box.height / Math.max(rows.length, 1);
  return rows.map((row) => {
    const declared = numberAttr(row, 'h') ?? 0;
    const height = declared > 0 ? declared : fallback;
    const needed = rowContentHeight(row, widths, context);
    return needed > height ? needed : height;
  });
}

/**
 * The height the text of one row needs, in slide EMU.
 *
 * The row's cells are measured with the same layout the renderer uses, so
 * the height is the height the text will actually occupy rather than an
 * estimate.
 */
function rowContentHeight(row: XmlNode, widths: readonly number[], context: RenderContext): number {
  let tallest = 0;
  let columnIndex = 0;
  for (const cell of children(row, 'a:tc')) {
    const span = Math.max(1, numberAttr(cell, 'gridSpan') ?? 1);
    const width = sumColumns(widths, columnIndex, span, undefined, 0);
    columnIndex += span;
    const body = child(cell, 'a:txBody');
    if (!body) continue;
    const insets = readCellInsets(child(cell, 'a:tcPr'));
    const laid = layoutTextBody(
      body,
      { width, height: Number.MAX_SAFE_INTEGER },
      context.textContext,
      {},
      { insets, scale: context.scale },
    );
    // The layout is in points; the row is in EMU.
    const needed = laid.height / context.scale + insets.top + insets.bottom;
    if (needed > tallest) tallest = needed;
  }
  return tallest;
}

/**
 * The width of a run of columns, in slide EMU.
 */
function sumColumns(
  widths: readonly number[],
  start: number,
  count: number,
  box: Box | undefined,
  cellCount: number,
): number {
  if (widths.length === 0) {
    // A table with no grid divides its box evenly between its cells.
    return box ? box.width / Math.max(cellCount, 1) : 0;
  }
  let total = 0;
  for (let index = start; index < start + count; index += 1) {
    total += widths[index] ?? 0;
  }
  return total;
}

/**
 * The height of a run of rows, in slide EMU.
 */
function sumRows(heights: readonly number[], start: number, count: number): number {
  let total = 0;
  for (let index = start; index < start + count; index += 1) {
    total += heights[index] ?? 0;
  }
  return total;
}

/**
 * The padding inside a table cell, in slide EMU.
 *
 * `a:tcPr/@marL,@marR,@marT,@marB` are the cell's own margins, and they
 * default to the same 0.1in / 0.05in a text body uses.
 */
function readCellInsets(properties: XmlNode | undefined): Insets {
  if (!properties) return DEFAULT_INSETS;
  return {
    left: numberAttr(properties, 'marL') ?? DEFAULT_INSETS.left,
    top: numberAttr(properties, 'marT') ?? DEFAULT_INSETS.top,
    right: numberAttr(properties, 'marR') ?? DEFAULT_INSETS.right,
    bottom: numberAttr(properties, 'marB') ?? DEFAULT_INSETS.bottom,
  };
}

/**
 * Draw a table cell's border.
 *
 * A cell names its four borders separately, and each may be absent, have a
 * width of zero, or say `a:noFill`. A cell that declares no borders at all
 * gets none — drawing a default grid on it would put a box on a slide that
 * asked for none.
 */
function drawCellBorder(
  page: PDFPage,
  properties: XmlNode | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  context: RenderContext,
  lineColor: ReturnType<typeof rgb>,
): void {
  const sides = [
    { name: 'a:lnL', from: { x, y }, to: { x, y: y + height } },
    { name: 'a:lnR', from: { x: x + width, y }, to: { x: x + width, y: y + height } },
    { name: 'a:lnT', from: { x, y: y + height }, to: { x: x + width, y: y + height } },
    { name: 'a:lnB', from: { x, y }, to: { x: x + width, y } },
  ] as const;

  let drewAny = false;
  // A cell that says nothing about its borders inherits the table's style —
  // a plain grid. A cell that says "no border" gets none, so the two cases
  // have to be told apart: only the first falls back to the grid.
  let declaresBorders = false;
  for (const side of sides) {
    const line = properties ? child(properties, side.name) : undefined;
    if (!line) continue;
    declaresBorders = true;
    // A zero width or an explicit "no fill" means this side has no border.
    const lineWidth = numberAttr(line, 'w') ?? 0;
    if (lineWidth <= 0) continue;
    if (hasNoFill(line)) continue;
    const fill = readFillColor(line, context.colorMap, context.theme);
    drewAny = true;
    page.drawLine({
      start: side.from,
      end: side.to,
      thickness: Math.max(lineWidth / 12700, 0.5),
      color: fill ? rgb(fill.color.r, fill.color.g, fill.color.b) : lineColor,
    });
  }
  if (drewAny || declaresBorders) return;
  page.drawRectangle({ x, y, width, height, borderColor: lineColor, borderWidth: 0.5 });
}

/**
 * Convert a slide-space box to page points.
 *
 * The slide's y axis points down and the page's points up, so the box's top
 * edge in slide space is its *bottom* edge in page space. The result is in
 * points — the caller must not scale it again.
 *
 * All four corners are transformed, not three. A transform that rotates or
 * shears the box moves a corner that the three-corner version never looked
 * at, and the bounding box it computes is then the wrong size — which
 * misplaces the shape's text and clips it at the wrong edge.
 */
function toPagePoints(
  box: Box,
  transform: Transform,
  context: RenderContext,
): { x: number; y: number; width: number; height: number } {
  // Slide EMU to page points, flipping the y axis.
  const flip = (point: { x: number; y: number }): { x: number; y: number } => ({
    x: point.x * context.scale,
    y: context.pageHeight - point.y * context.scale,
  });
  const corners = [
    flip(applyTransform(transform, box.x, box.y)),
    flip(applyTransform(transform, box.x + box.width, box.y)),
    flip(applyTransform(transform, box.x, box.y + box.height)),
    flip(applyTransform(transform, box.x + box.width, box.y + box.height)),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Apply a transform to a point. */
function applyTransform(transform: Transform, x: number, y: number): { x: number; y: number } {
  return {
    x: transform.a * x + transform.c * y + transform.e,
    y: transform.b * x + transform.d * y + transform.f,
  };
}

/**
 * The scale a transform applies to text.
 *
 * Text is laid out horizontally, so it is the *horizontal* scale that
 * matters: a group scaled to half width holds half-size text, and its
 * insets are half as wide. The horizontal scale is the length of the image
 * of the unit x-vector, which is the only definition that stays correct when
 * the transform also rotates.
 */
function transformTextScale(transform: Transform): number {
  return Math.hypot(transform.a, transform.b);
}

/**
 * The vertical scale a transform applies.
 *
 * The counterpart to [[transformTextScale]]: the height a box occupies once
 * the transform has been applied. It is the length of the image of the unit
 * y-vector, so it stays correct when the transform also rotates.
 */
function transformHeightScale(transform: Transform): number {
  return Math.hypot(transform.c, transform.d);
}

/**
 * Draw a text body inside a shape.
 *
 * The text is clipped to its box, so it can never paint outside the shape —
 * and, because there is no pagination anywhere, can never reach another
 * page.
 */
function renderTextBody(
  page: PDFPage,
  body: XmlNode,
  shape: XmlNode,
  box: Box,
  context: RenderContext,
  transform: Transform,
  slide: PptxSlide,
  /**
   * Overrides the insets read from the text body.
   *
   * A table cell's padding comes from `a:tcPr`, not from the cell's
   * `a:bodyPr`, and the cell's own margins win.
   */
  overrideInsets?: Insets,
): void {
  const bodyProps = bodyPropsChain(body, shape, slide);
  const insets = overrideInsets ?? readInsets(bodyProps);
  const anchor = readAnchor(bodyProps);

  const placeholder = placeholderOf(shape);
  const master = slide.layout?.master;
  // The master's level node for this placeholder carries both the inherited
  // run properties and the paragraph properties — the alignment, the bullet
  // and the spacing — so it is passed down whole.
  const level = placeholder
    ? placeholderStyle(master, placeholder.type, placeholder.index)
    : undefined;
  const inherited = levelRunProperties(level);
  // The presentation's own default text style is the last level of the
  // inheritance chain, below the master's placeholder style.
  const presentationDefault = presentationDefaults(context.presentation, 0);

  // The text is laid out in the shape's *own* space, and the transform then
  // scales that layout. So the box the layout sees is the box in the
  // shape's space — but the width the text may use is the width the box
  // occupies *after* the transform.
  //
  // A group scaled to half width is the case that catches this: the shape's
  // own box is 8in wide, but it only occupies 4in of the slide. Laying the
  // text out against 8in and then scaling it puts an 8in-wide line into a
  // 4in box, and the group's own clip cuts it away.
  const insetScale = transformTextScale(transform);
  const laid = layoutTextBody(
    body,
    { width: box.width, height: box.height },
    context.textContext,
    {
      ...(inherited ? { placeholder: inherited } : {}),
      ...(level ? { level } : {}),
      ...(presentationDefault ? { presentationDefault } : {}),
    },
    {
      insets,
      scale: context.scale,
      textScale: insetScale,
      heightScale: transformHeightScale(transform),
    },
  );
  if (laid.clipped) context.skippedFeatures.add('text that did not fit its box');

  const points = toPagePoints(box, transform, context);
  // The insets are in the shape's own space, so they are transformed along
  // with it. A group scaled to half size has half-size insets, and using the
  // unscaled value would push the text out of its box.
  const left = points.x + insets.left * context.scale * insetScale;
  const availableWidth = Math.max(
    0,
    (box.width - insets.left - insets.right) * context.scale * insetScale,
  );

  // The text is placed relative to the shape's own page rectangle.
  const boxBottom = points.y;
  const boxTop = points.y + points.height;
  const textHeight = laid.height;
  // The cursor is the *top* of the next line, and it descends as the lines
  // are drawn. PDF's y axis points up, so descending means subtracting the
  // line height — adding it would draw the last paragraph above the first.
  let cursor: number;
  if (anchor === 'ctr') cursor = (boxTop + boxBottom + textHeight) / 2;
  else if (anchor === 'b') {
    cursor = boxBottom + insets.bottom * context.scale * insetScale + textHeight;
  } else cursor = boxTop - insets.top * context.scale * insetScale;

  // The text turns with its shape. A shape's rotation is on its own
  // transform, and the text lives inside the shape — so the text is turned
  // about the shape's centre as well, or a rotated label comes out level
  // while the shape around it is turned.
  //
  // The turn is applied *before* the clip, so the clip is the shape's own
  // box in its turned frame — which is the box the text must stay inside.
  // The text's own coordinates are the shape's unturned ones, and the
  // current transform carries them into place.
  const rotation = shapeRotation(shape);
  const flips = shapeFlips(shape);
  const needsState = rotation !== undefined || flips.horizontal || flips.vertical;
  page.pushOperators(pushGraphicsState());
  if (needsState) {
    const centreX = points.x + points.width / 2;
    const centreY = points.y + points.height / 2;
    page.pushOperators(translate(centreX, centreY));
    if (flips.horizontal) {
      page.pushOperators(concatTransformationMatrix(-1, 0, 0, 1, 0, 0));
    }
    if (flips.vertical) {
      page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
    }
    if (rotation) {
      page.pushOperators(rotateRadians(rotationInRadians(rotation)));
    }
    page.pushOperators(translate(-centreX, -centreY));
  }
  // The clip is in the shape's own space, so the shape's own rectangle
  // bounds the text.
  page.pushOperators(rectangle(points.x, boxBottom, points.width, points.height), clip());

  for (const line of laid.lines) {
    drawTextLine(
      page,
      line,
      left,
      cursor - line.ascent,
      availableWidth,
      context.scale * insetScale,
    );
    cursor -= line.height;
  }

  page.pushOperators(popGraphicsState());
}

/**
 * Draw one laid-out line of text.
 *
 * `baseline` is the y of the line's baseline, in page points.
 * `marginScale` converts the paragraph's EMU margins into page points.
 */
function drawTextLine(
  page: PDFPage,
  line: TextLine,
  left: number,
  baseline: number,
  availableWidth: number,
  marginScale: number,
): void {
  if (line.segments.length === 0) return;
  // The paragraph's left margin shifts the text, and a hanging indent pulls
  // the *first* line back out to the left — which is where the bullet goes.
  const margin = (line.marginLeft ?? 0) * marginScale;
  const hanging = line.indent !== undefined ? line.indent * marginScale : 0;
  const isFirstLine = line.bullet !== undefined;
  const offset = margin + (isFirstLine ? hanging : 0);
  // The indent narrows the space the text may use.
  const usable = Math.max(0, availableWidth - offset);

  let x = left + offset;
  if (line.alignment === 'ctr') x = left + offset + (usable - line.width) / 2;
  else if (line.alignment === 'r') x = left + offset + usable - line.width;

  if (line.bullet) {
    page.drawText(line.bullet.text, {
      // The bullet hangs to the left of the text, at the hanging indent.
      x: left + margin + hanging,
      y: baseline,
      size: line.bullet.size,
      font: line.bullet.font,
      color: rgb(0, 0, 0),
    });
  }

  for (const segment of line.segments) {
    const color = rgb(segment.style.color.r, segment.style.color.g, segment.style.color.b);
    page.drawText(segment.text, {
      x,
      y: baseline,
      size: segment.style.size,
      font: segment.font,
      color,
      ...(segment.style.alpha !== undefined ? { opacity: segment.style.alpha } : {}),
    });
    const width = segment.font.widthOfTextAtSize(segment.text, segment.style.size);
    if (segment.style.underline || segment.style.strike) {
      // pdf-lib's drawText has no underline, so it is drawn as a rule under
      // the run. The rule is outside the text object, which is correct.
      const thickness = Math.max(0.5, segment.style.size / 16);
      const ruleY = segment.style.strike
        ? baseline + segment.style.size * 0.3
        : baseline - segment.style.size * 0.12;
      page.drawLine({
        start: { x, y: ruleY },
        end: { x: x + width, y: ruleY },
        thickness,
        color,
      });
    }
    x += width;
  }
}

/**
 * The insets of a text body, in slide EMU.
 *
 * Each inset is taken from the first `a:bodyPr` in the chain that declares
 * it, so a slide can override one inset without losing the other three.
 */
function readInsets(chain: readonly XmlNode[]): Insets {
  const first = (name: string): number | undefined => {
    for (const node of chain) {
      const value = numberAttr(node, name);
      if (value !== undefined) return value;
    }
    return undefined;
  };
  return {
    left: first('lIns') ?? DEFAULT_INSETS.left,
    top: first('tIns') ?? DEFAULT_INSETS.top,
    right: first('rIns') ?? DEFAULT_INSETS.right,
    bottom: first('bIns') ?? DEFAULT_INSETS.bottom,
  };
}

/** The vertical anchor of a text body. */
function readAnchor(chain: readonly XmlNode[]): 't' | 'ctr' | 'b' {
  for (const node of chain) {
    const anchor = node.attrs.anchor;
    if (anchor === 'ctr') return 'ctr';
    if (anchor === 'b') return 'b';
    if (anchor === 't') return 't';
  }
  return 't';
}
