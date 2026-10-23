/**
 * Theme colour and font resolution for the PPTX reader.
 *
 * A slide rarely names a colour directly. It says `<a:schemeClr val="accent1"/>`
 * and leaves the actual colour to the theme, reached through the master's
 * colour map. This module owns that indirection:
 *
 *   `accent1` → the master's `p:clrMap` → a theme slot → `a:clrScheme` → a colour
 *
 * The `clrMap` step is the one that is easy to miss. A slide's `bg1` means the
 * theme's `lt1`, not the theme's `bg1` — the map is what translates a
 * *semantic* name into a *slot*:
 *
 *   `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" .../>`
 *
 * A slide may also override the map with `<p:clrMapOvr><a:overrideClrMapping/>`,
 * and it may leave it alone with `<a:masterClrMapping/>`.
 */

import { child, children, descendant, numberAttr, type XmlNode } from './pptx-xml.js';

/** An sRGB colour, each channel 0–1. */
export type Rgb = Readonly<{ r: number; g: number; b: number }>;

/**
 * The theme's three style lists.
 *
 * A theme does not only carry colours and fonts. It carries the *styles* a
 * shape can point at: `a:fillStyleLst` (three fills), `a:lnStyleLst` (three
 * line weights) and `a:bgFillStyleLst` (three background fills). A shape
 * that carries no fill of its own says "use the theme's first fill" — and
 * the theme's first fill is a *template* whose colour is written `phClr`,
 * a placeholder for whatever colour the referring element supplies.
 */
export type PptxThemeStyleLists = {
  /** The entries of `a:fillStyleLst`, in document order. */
  readonly fillStyles: readonly XmlNode[];
  /** The entries of `a:lnStyleLst`, in document order. */
  readonly lineStyles: readonly XmlNode[];
  /** The entries of `a:bgFillStyleLst`, in document order. */
  readonly backgroundStyles: readonly XmlNode[];
};

/** The theme's colour slots, its two font references, and its style lists. */
export type PptxTheme = {
  /** Theme slot name → colour, e.g. `lt1` → white. */
  readonly colors: ReadonlyMap<string, Rgb>;
  /** The major (heading) typeface, e.g. `Calibri Light`. */
  readonly majorFont: string;
  /** The minor (body) typeface, e.g. `Calibri`. */
  readonly minorFont: string;
  /** The theme's fill, line and background style lists. */
  readonly styles: PptxThemeStyleLists;
};

/** The master's colour map: a semantic name → a theme slot. */
export type PptxColorMap = ReadonlyMap<string, string>;

const DEFAULT_THEME: PptxTheme = {
  colors: new Map<string, Rgb>([
    ['dk1', { r: 0, g: 0, b: 0 }],
    ['lt1', { r: 1, g: 1, b: 1 }],
    ['dk2', { r: 0.27, g: 0.33, b: 0.42 }],
    ['lt2', { r: 0.91, g: 0.9, b: 0.9 }],
    ['accent1', { r: 0.27, g: 0.45, b: 0.77 }],
    ['accent2', { r: 0.93, g: 0.49, b: 0.19 }],
    ['accent3', { r: 0.65, g: 0.65, b: 0.65 }],
    ['accent4', { r: 1, g: 0.75, b: 0 }],
    ['accent5', { r: 0.36, g: 0.61, b: 0.83 }],
    ['accent6', { r: 0.44, g: 0.68, b: 0.28 }],
    ['hlink', { r: 0.02, g: 0.39, b: 0.76 }],
    ['folHlink', { r: 0.58, g: 0.31, b: 0.45 }],
  ]),
  majorFont: 'Calibri',
  minorFont: 'Calibri',
  styles: { fillStyles: [], lineStyles: [], backgroundStyles: [] },
};

/**
 * Read the theme's colour scheme and font scheme.
 *
 * A deck with no theme part is legal — it inherits one — so a missing or
 * unreadable theme falls back to the Office defaults rather than failing.
 */
export function parseTheme(root: XmlNode | undefined): PptxTheme {
  if (!root) return DEFAULT_THEME;
  const scheme = descendant(root, 'a:clrScheme');
  const colors = new Map<string, Rgb>();
  if (scheme) {
    for (const slot of scheme.children) {
      const color = readSlotColor(slot);
      // The slot is written `a:accent1`, but it is *named* `accent1` — the
      // prefix is the DrawingML namespace, not part of the name. The colour
      // map and every `schemeClr` reference use the unprefixed name.
      if (color) colors.set(slot.name.replace(/^[^:]+:/u, ''), color);
    }
  }
  const majorFont =
    descendant(root, 'a:majorFont')?.children.find((node) => node.name === 'a:latin')?.attrs
      .typeface ?? DEFAULT_THEME.majorFont;
  const minorFont =
    descendant(root, 'a:minorFont')?.children.find((node) => node.name === 'a:latin')?.attrs
      .typeface ?? DEFAULT_THEME.minorFont;
  return {
    colors: colors.size > 0 ? colors : DEFAULT_THEME.colors,
    majorFont: majorFont || DEFAULT_THEME.majorFont,
    minorFont: minorFont || DEFAULT_THEME.minorFont,
    styles: readStyleLists(root),
  };
}

/**
 * Read the theme's three style lists.
 *
 * Each list is a container whose children are the entries, in the order a
 * referring element's `idx` counts them. The `idx` is **1-based**, so
 * `idx="1"` is the first entry and `idx="3"` the third.
 */
function readStyleLists(root: XmlNode): PptxThemeStyleLists {
  const formatScheme = descendant(root, 'a:fmtScheme');
  const read = (name: string): readonly XmlNode[] => {
    const list = formatScheme ? child(formatScheme, name) : undefined;
    return list ? list.children : [];
  };
  return {
    fillStyles: read('a:fillStyleLst'),
    lineStyles: read('a:lnStyleLst'),
    backgroundStyles: read('a:bgFillStyleLst'),
  };
}

/**
 * Read one colour slot — `<a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>`.
 */
function readSlotColor(slot: XmlNode): Rgb | undefined {
  const srgb = child(slot, 'a:srgbClr');
  if (srgb) return parseHexColor(srgb.attrs.val);
  // A system colour carries the value the producer resolved it to in
  // `lastClr`; `val` is only the symbolic name ("window", "windowText").
  const sys = child(slot, 'a:sysClr');
  if (sys) {
    if (sys.attrs.lastClr) return parseHexColor(sys.attrs.lastClr);
    return SYSTEM_COLORS[sys.attrs.val ?? ''];
  }
  const scheme = child(slot, 'a:schemeClr');
  if (scheme) return parseHexColor(scheme.attrs.val);
  return undefined;
}

/** The system colours OOXML can name, resolved to their usual values. */
const SYSTEM_COLORS: Readonly<Record<string, Rgb>> = {
  window: { r: 1, g: 1, b: 1 },
  windowText: { r: 0, g: 0, b: 0 },
  background: { r: 1, g: 1, b: 1 },
  text: { r: 0, g: 0, b: 0 },
};

/**
 * Parse a `RRGGBB` colour.
 *
 * OOXML colours are sRGB, so the channels divide straight into PDF's 0–1
 * range.
 */
export function parseHexColor(value: string | undefined): Rgb | undefined {
  if (!value) return undefined;
  const hex = value.trim().replace(/^#/u, '');
  if (!/^[0-9a-fA-F]{6}$/u.test(hex)) return undefined;
  return {
    r: Number.parseInt(hex.slice(0, 2), 16) / 255,
    g: Number.parseInt(hex.slice(2, 4), 16) / 255,
    b: Number.parseInt(hex.slice(4, 6), 16) / 255,
  };
}

/**
 * Read the master's colour map.
 *
 * The names are the *semantic* names a slide uses, and the values are the
 * theme slots they resolve to.
 */
export function parseColorMap(master: XmlNode | undefined): PptxColorMap {
  const map = new Map<string, string>();
  const node = master ? child(master, 'p:clrMap') : undefined;
  if (!node) return map;
  for (const [name, slot] of Object.entries(node.attrs)) {
    if (slot) map.set(name, slot);
  }
  return map;
}

/**
 * The colour map a slide uses.
 *
 * A slide that overrides the map replaces the master's entirely; a slide that
 * defers (`<a:masterClrMapping/>`, which is what pptxgenjs writes) keeps it.
 */
export function slideColorMap(slide: XmlNode | undefined, masterMap: PptxColorMap): PptxColorMap {
  const override = slide ? descendant(slide, 'a:overrideClrMapping') : undefined;
  if (!override) return masterMap;
  const map = new Map<string, string>();
  for (const [name, slot] of Object.entries(override.attrs)) {
    if (slot) map.set(name, slot);
  }
  // `<a:overrideClrMapping/>` is a flag saying "use my own map", and the map
  // itself is written as the element's *children*: one `a:clrMap` element per
  // overridden pair, each naming the semantic name and the slot it maps to.
  // Reading the override's own attributes therefore yields an empty map, and
  // every scheme colour on the slide would then fail to resolve and be
  // dropped. A slide that overrides without supplying a usable map keeps the
  // master's, which is a far better answer than rendering nothing.
  for (const entry of override.children) {
    if (entry.name !== 'a:clrMap') continue;
    const name = entry.attrs.name;
    const slot = entry.attrs.typeface ?? entry.attrs.slot;
    if (name && slot) map.set(name, slot);
  }
  return map.size > 0 ? map : masterMap;
}

/**
 * Resolve a scheme colour name to a colour.
 *
 * The name is first translated through the colour map (so `bg1` becomes
 * `lt1`), then looked up in the theme, then the theme's modifiers are applied.
 */
export function resolveSchemeColor(
  name: string,
  colorMap: PptxColorMap,
  theme: PptxTheme,
): Rgb | undefined {
  const slot = colorMap.get(name) ?? name;
  const base = theme.colors.get(slot);
  if (!base) return undefined;
  return base;
}

/**
 * Apply a colour's modifiers.
 *
 * `a:schemeClr` and `a:srgbClr` can carry `lumMod`, `lumOff`, `shade`,
 * `tint`, `satMod` and `alpha`. These appear in real decks — a theme accent
 * darkened with `lumMod 60000` is a common way to pick a hover or muted tone —
 * so they are implemented rather than ignored.
 *
 * A modifier this renderer does not know is ignored, never fatal: a colour
 * that is slightly wrong is better than a slide that fails to convert.
 */
export function applyColorModifiers(color: Rgb, node: XmlNode | undefined): Rgb {
  if (!node) return color;
  // The alpha channel is not applied here: PDF needs it as a graphics-state
  // opacity rather than blended into the colour, so `colorAlpha` reads it.
  const lumMod = child(node, 'a:lumMod');
  const lumOff = child(node, 'a:lumOff');
  const shade = child(node, 'a:shade');
  const tint = child(node, 'a:tint');
  const satMod = child(node, 'a:satMod');

  let result = color;
  const shadeValue = numberAttr(shade, 'val');
  if (shadeValue !== undefined) {
    const factor = shadeValue / 100000;
    result = { r: result.r * factor, g: result.g * factor, b: result.b * factor };
  }
  const tintValue = numberAttr(tint, 'val');
  if (tintValue !== undefined) {
    const factor = tintValue / 100000;
    // A tint moves the colour towards white.
    result = {
      r: result.r + (1 - result.r) * factor,
      g: result.g + (1 - result.g) * factor,
      b: result.b + (1 - result.b) * factor,
    };
  }
  const satValue = numberAttr(satMod, 'val');
  if (satValue !== undefined) {
    // A saturation modifier scales the colour's saturation about zero. The
    // theme's style lists use these heavily — every one of the Office
    // background styles carries a `satMod` — so ignoring it would visibly
    // change the deck's own accent colours.
    const { h, s, l } = rgbToHsl(result);
    result = hslToRgb(h, Math.min(1, Math.max(0, s * (satValue / 100000))), l);
  }
  const modValue = numberAttr(lumMod, 'val');
  const offValue = numberAttr(lumOff, 'val');
  if (modValue !== undefined || offValue !== undefined) {
    const { h, s, l } = rgbToHsl(result);
    const modulated =
      (modValue !== undefined ? l * (modValue / 100000) : l) +
      (offValue !== undefined ? offValue / 100000 : 0);
    result = hslToRgb(h, s, Math.min(1, Math.max(0, modulated)));
  }
  // Alpha is returned separately: PDF needs it as a graphics-state opacity,
  // not blended into the colour.
  return result;
}

/**
 * The alpha of a colour node, 0–1, or `undefined` when it is fully opaque.
 */
export function colorAlpha(node: XmlNode | undefined): number | undefined {
  if (!node) return undefined;
  const alpha = child(node, 'a:alpha');
  const value = numberAttr(alpha, 'val');
  if (value === undefined) return undefined;
  return Math.min(1, Math.max(0, value / 100000));
}

/**
 * Read the colour of a fill or line node — `a:solidFill`, `a:noFill` and the
 * scheme/sRGB forms under them.
 *
 * Returns `undefined` for "no fill", and `{ color, alpha }` for a real one.
 */
export function readFillColor(
  container: XmlNode | undefined,
  colorMap: PptxColorMap,
  theme: PptxTheme,
): { color: Rgb; alpha?: number } | undefined {
  if (!container) return undefined;
  const solid = child(container, 'a:solidFill');
  if (!solid) return undefined;
  return readColorNode(solid, colorMap, theme);
}

/**
 * Read the colour a node names, directly or through a scheme.
 *
 * The same node is used in two places: under an `a:solidFill`, and directly
 * under a gradient stop. A gradient stop holds `<a:gs pos="0"><a:srgbClr
 * val="FF0000"/></a:gs>` — the colour is *not* wrapped in an `a:solidFill`,
 * so reading the stops with the fill reader finds nothing and the whole
 * gradient renders as no fill at all.
 */
export function readColorNode(
  node: XmlNode,
  colorMap: PptxColorMap,
  theme: PptxTheme,
): { color: Rgb; alpha?: number } | undefined {
  const srgb = child(node, 'a:srgbClr');
  if (srgb) {
    const base = parseHexColor(srgb.attrs.val);
    if (!base) return undefined;
    // The modifiers apply to an explicit colour too, not only to a scheme
    // colour: `srgbClr FF0000` with `lumMod 50000` is a darker red, and
    // ignoring the modifier would draw the wrong shade.
    const color = applyColorModifiers(base, srgb);
    const alpha = colorAlpha(srgb);
    return alpha === undefined ? { color } : { color, alpha };
  }
  const scheme = child(node, 'a:schemeClr');
  if (scheme) {
    // `phClr` is the style-list placeholder, not a theme slot. It only ever
    // has a meaning when a referring element supplies the colour, so
    // resolving it as a slot would invent a colour out of nothing.
    if (scheme.attrs.val === 'phClr') return undefined;
    const base = resolveSchemeColor(scheme.attrs.val ?? '', colorMap, theme);
    if (!base) return undefined;
    const color = applyColorModifiers(base, scheme);
    const alpha = colorAlpha(scheme);
    return alpha === undefined ? { color } : { color, alpha };
  }
  const sys = child(node, 'a:sysClr');
  if (sys) {
    const color = parseHexColor(sys.attrs.lastClr) ?? SYSTEM_COLORS[sys.attrs.val ?? ''];
    if (!color) return undefined;
    return { color };
  }
  return undefined;
}

/**
 * The first stop of a gradient fill.
 *
 * pdf-lib has no shading-dictionary builder, so a real gradient would mean
 * hand-writing PDF objects. The first stop is used as a flat fill and the
 * caller is told, rather than the gradient being silently flattened.
 */
export function readGradientColor(
  container: XmlNode | undefined,
  colorMap: PptxColorMap,
  theme: PptxTheme,
): { color: Rgb; alpha?: number } | undefined {
  if (!container) return undefined;
  const gradient = child(container, 'a:gradFill');
  if (!gradient) return undefined;
  const stops = children(gradient, 'a:gsLst').flatMap((list) => children(list, 'a:gs'));
  for (const stop of stops) {
    // A stop names its colour directly, so it is read with the shared colour
    // reader rather than the fill reader.
    const color = readColorNode(stop, colorMap, theme);
    if (color) return color;
  }
  return undefined;
}

/**
 * Whether a node explicitly says "no fill".
 */
export function hasNoFill(container: XmlNode | undefined): boolean {
  return container ? child(container, 'a:noFill') !== undefined : false;
}

/**
 * Resolve a style-list entry, substituting the referring element's colour for
 * the entry's `phClr` placeholder.
 *
 * This is the indirection a theme's style lists exist for. A theme's first
 * fill is written:
 *
 *   `<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>`
 *
 * `phClr` is not a theme slot — it is a *placeholder* for the colour the
 * referring element supplies. A shape that says "use the theme's second fill,
 * in accent1" therefore resolves to the theme's second fill *template* with
 * its `phClr` replaced by accent1, and the template's own modifiers (a tint,
 * a shade) applied on top.
 *
 * Two consequences this function has to respect:
 *
 *   1. The placeholder colour must not go through the colour map. `phClr` is
 *      not a slot name, and looking it up in the map would translate it into
 *      some unrelated slot.
 *   2. The *referring* element's colour wins over the entry's `phClr`. The
 *      entry supplies the shape of the fill, not its colour.
 */
export function resolveStyleListColor(
  index: number,
  list: readonly XmlNode[],
  colorMap: PptxColorMap,
  theme: PptxTheme,
  placeholder: { color: Rgb; alpha?: number } | undefined,
): { color: Rgb; alpha?: number } | undefined {
  // The `idx` is 1-based, so `idx="1"` is the first entry.
  const entry = list[index - 1];
  if (!entry) return undefined;
  if (!placeholder) return undefined;

  // A style-list entry is a fill or a line, so it names its colour the way a
  // fill does — but its colour node is the `phClr` placeholder, which the
  // referring element's colour replaces.
  const template = child(entry, 'a:solidFill') ?? entry;
  const named = child(template, 'a:schemeClr') ?? child(template, 'a:srgbClr');
  if (!named) return undefined;

  // The modifiers belong to the template's colour node, and they apply to the
  // substituted colour.
  const color = applyColorModifiers(placeholder.color, named);
  const alpha = colorAlpha(named) ?? placeholder.alpha;
  return alpha === undefined ? { color } : { color, alpha };
}

/**
 * Read an `a:fillRef` — a shape's pointer to one of the theme's fills.
 *
 * The reference carries two things: the `idx` of the theme fill to use, and
 * the colour to use in place of that fill's `phClr` placeholder.
 */
export function readStyleRefFill(
  reference: XmlNode | undefined,
  colorMap: PptxColorMap,
  theme: PptxTheme,
): { color: Rgb; alpha?: number } | undefined {
  if (!reference) return undefined;
  const index = numberAttr(reference, 'idx');
  if (index === undefined) return undefined;
  const placeholder = readColorNode(reference, colorMap, theme);
  if (!placeholder) return undefined;
  return resolveStyleListColor(index, theme.styles.fillStyles, colorMap, theme, placeholder);
}

/**
 * Read an `a:lnRef` — a shape's pointer to one of the theme's line styles.
 *
 * The theme's line styles also carry a width, so the reference resolves both
 * a colour and a width.
 */
export function readStyleRefLine(
  reference: XmlNode | undefined,
  colorMap: PptxColorMap,
  theme: PptxTheme,
): { color: Rgb; alpha?: number; width?: number } | undefined {
  if (!reference) return undefined;
  const index = numberAttr(reference, 'idx');
  if (index === undefined) return undefined;
  const placeholder = readColorNode(reference, colorMap, theme);
  if (!placeholder) return undefined;
  const resolved = resolveStyleListColor(
    index,
    theme.styles.lineStyles,
    colorMap,
    theme,
    placeholder,
  );
  if (!resolved) return undefined;
  // The width comes from the theme's own line entry, in EMU.
  const entry = theme.styles.lineStyles[index - 1];
  const width = entry ? numberAttr(child(entry, 'a:ln'), 'w') : undefined;
  return width === undefined ? resolved : { ...resolved, width };
}

/**
 * Read a `p:bgRef` — a background that points at the theme's background
 * styles.
 *
 * The `idx` has two ranges, and both select an entry of the theme's
 * `a:bgFillStyleLst`:
 *
 *   - `1001`, `1002` and `1003` select the first, second and third entry.
 *   - `1` to `999` select that entry directly.
 *
 * The 1000-range exists because the theme's background list is short (three
 * entries) and the referring element wants to say "the first one" without
 * colliding with a direct index. Either way the entry is the *template*:
 * its `phClr` is replaced by the reference's own colour, and the template's
 * modifiers apply on top.
 *
 * Note that this is a different axis from the background *inheritance* chain
 * — which background wins is decided by which part declares it (slide,
 * layout or master), not by the `idx`.
 */
export function readBackgroundReference(
  reference: XmlNode | undefined,
  colorMap: PptxColorMap,
  theme: PptxTheme,
): { color: Rgb; alpha?: number } | undefined {
  if (!reference) return undefined;
  const raw = numberAttr(reference, 'idx');
  if (raw === undefined) return undefined;
  const index = raw >= 1001 ? raw - 1000 : raw;
  if (index < 1) return undefined;
  const placeholder = readColorNode(reference, colorMap, theme);
  if (!placeholder) return undefined;
  return resolveStyleListColor(index, theme.styles.backgroundStyles, colorMap, theme, placeholder);
}

/** Convert sRGB to HSL, all channels 0–1 and hue in degrees. */
function rgbToHsl(color: Rgb): { h: number; s: number; l: number } {
  const max = Math.max(color.r, color.g, color.b);
  const min = Math.min(color.r, color.g, color.b);
  const lightness = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: lightness };
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === color.r) hue = ((color.g - color.b) / delta) % 6;
  else if (max === color.g) hue = (color.b - color.r) / delta + 2;
  else hue = (color.r - color.g) / delta + 4;
  hue *= 60;
  if (hue < 0) hue += 360;
  return { h: hue, s: saturation, l: lightness };
}

/** Convert HSL back to sRGB, all channels 0–1. */
function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) return { r: l, g: l, b: l };
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: r + m, g: g + m, b: b + m };
}
