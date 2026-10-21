/**
 * A small OOXML scanner for the PPTX reader.
 *
 * OOXML is a ZIP of XML parts, and the engine ships no XML parser. Rather than
 * add one — which would mean a new production dependency, a lockfile change
 * and a licence-manifest change, against a repo whose stated position is "our
 * own readers" (README §7.3, PLAN P3-04) — this module scans the markup
 * directly.
 *
 * The scanner is *targeted*, not general. OOXML is a fixed vocabulary, and this
 * renderer reads about fifteen element types. A general tree parser would have
 * to model forty element types it never looks at, and its failure mode is
 * silent data loss: a subtly wrong parse mis-renders a slide rather than
 * refusing it. A targeted scanner instead recognises what it knows and skips
 * everything else by tag balance, so an element it does not understand is
 * skipped rather than misinterpreted.
 *
 * The scanner is namespace-prefix-literal: it matches `p:sp`, `a:xfrm` and so
 * on. OOXML's prefix vocabulary is stable across PowerPoint, Keynote, Google
 * Slides and pptxgenjs, and matching a prefix is immune to a producer
 * re-binding a prefix to a different namespace URI.
 */

/** One element of a parsed OOXML part. */
export type XmlNode = {
  /** The qualified name as written, e.g. `p:sp` or `a:xfrm`. */
  readonly name: string;
  /** The element's attributes, with entity references decoded. */
  readonly attrs: Readonly<Record<string, string>>;
  /** The element's child elements, in document order. */
  readonly children: readonly XmlNode[];
  /** The element's own text content, with entity references decoded. */
  readonly text: string;
};

/**
 * The five predefined XML entities plus numeric character references.
 *
 * Numeric references are not theoretical: pptxgenjs writes a bullet character
 * as `char="&#x2022;"`, so a decoder that handles only the named entities
 * renders the raw entity text into the PDF.
 */
const ENTITY_PATTERN = /&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/**
 * Decode the entity references in an XML attribute value or text node.
 *
 * A single pass with one lookup, so the order of the alternatives cannot
 * matter. Decoding `&amp;` in a separate later pass would turn `&amp;lt;`
 * into `<` rather than into the literal text `&lt;`; a single pass cannot
 * make that mistake.
 */
export function decodeXmlEntities(value: string): string {
  if (!value.includes('&')) return value;
  return value.replace(ENTITY_PATTERN, (match, entity: string) => {
    const named = NAMED_ENTITIES[entity];
    if (named !== undefined) return named;
    // A numeric reference: decimal (`&#8212;`) or hex (`&#x2022;`).
    const codePoint = entity.startsWith('#x')
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      // A code point outside the Unicode range is a malformed reference, not a
      // reason to lose the text around it.
      return match;
    }
  });
}

/**
 * Parse an OOXML part into a tree.
 *
 * The returned node is the part's root element, not a synthetic document
 * wrapper: every OOXML part has exactly one root.
 */
export function parseXml(xml: string): XmlNode {
  const root: MutableNode = { name: '#document', attrs: {}, children: [], text: '' };
  let current: MutableNode = root;
  let index = 0;

  while (index < xml.length) {
    const open = xml.indexOf('<', index);
    if (open === -1) {
      appendText(current, xml.slice(index));
      break;
    }
    if (open > index) appendText(current, xml.slice(index, open));
    index = open;

    // Comments, processing instructions, CDATA and doctypes all sit outside
    // the element tree. A processing instruction opens every OOXML part, so
    // skipping them is not an edge case.
    if (xml.startsWith('<!--', index)) {
      const end = xml.indexOf('-->', index + 4);
      if (end === -1) break;
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', index)) {
      const end = xml.indexOf(']]>', index + 9);
      if (end === -1) break;
      appendText(current, xml.slice(index + 9, end));
      index = end + 3;
      continue;
    }
    if (xml.startsWith('<?', index)) {
      const end = xml.indexOf('?>', index + 2);
      if (end === -1) break;
      index = end + 2;
      continue;
    }
    if (xml.startsWith('<!', index)) {
      const end = xml.indexOf('>', index + 2);
      if (end === -1) break;
      index = end + 1;
      continue;
    }

    const close = findTagEnd(xml, index);
    if (close === -1) break;
    const body = xml.slice(index + 1, close);
    index = close + 1;

    if (body.startsWith('/')) {
      const name = body.slice(1).trim();
      // The closing tag names the element being closed, so it is compared
      // with the *current* node — comparing with the parent only works for
      // markup one level deep, and silently derails the parse for anything
      // nested.
      if (current.name === name && current.parent) current = current.parent;
      continue;
    }

    const selfClosing = body.endsWith('/');
    const inner = selfClosing ? body.slice(0, -1) : body;
    const nameMatch = /^([^\s/>]+)/u.exec(inner);
    const name = nameMatch?.[1] ?? '';
    if (!name) continue;

    const child: MutableNode = {
      name,
      attrs: parseAttributes(inner.slice(name.length)),
      children: [],
      text: '',
      parent: current,
    };
    current.children.push(child);
    if (!selfClosing) current = child;
  }

  // Every OOXML part has exactly one root element, so the synthetic
  // document node is unwrapped and the caller gets the real root.
  const frozen = freeze(root);
  return frozen.children.length === 1 ? (frozen.children[0] as XmlNode) : frozen;
}

type MutableNode = {
  name: string;
  attrs: Record<string, string>;
  children: MutableNode[];
  text: string;
  parent?: MutableNode;
};

function appendText(node: MutableNode, value: string): void {
  if (!value) return;
  node.text += decodeXmlEntities(value);
}

/**
 * Find the `>` that ends a tag, ignoring any that sit inside a quoted
 * attribute value.
 *
 * A `>` inside an attribute value is legal XML and does occur in OOXML — alt
 * text and shape descriptions carry it. Scanning to the first `>` would split
 * such a tag in half and desynchronise the whole parse.
 */
function findTagEnd(xml: string, start: number): number {
  let quote: string | undefined;
  for (let index = start + 1; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return -1;
}

/**
 * Read the attributes of a tag body.
 *
 * The values were already delimited by the quote-aware tag scan, so this
 * pattern cannot mis-split one: an XML attribute value cannot contain a raw
 * quote of its own delimiter, and the producer escapes it as `&quot;`.
 */
function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu;
  for (const match of source.matchAll(pattern)) {
    const name = match[1];
    if (!name) continue;
    attributes[name] = decodeXmlEntities(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

function freeze(node: MutableNode): XmlNode {
  return {
    name: node.name,
    attrs: node.attrs,
    children: node.children.map(freeze),
    text: node.text,
  };
}

/**
 * The first child element with the given name, or `undefined`.
 */
export function child(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((candidate) => candidate.name === name);
}

/**
 * Every child element with the given name, in document order.
 */
export function children(node: XmlNode, name: string): readonly XmlNode[] {
  return node.children.filter((candidate) => candidate.name === name);
}

/**
 * The first descendant with the given name, searched depth-first.
 *
 * Used for the elements whose position in the tree is not fixed — `a:xfrm`
 * under `p:spPr`, for instance, or `a:xfrm` under `p:grpSpPr`.
 */
export function descendant(node: XmlNode, name: string): XmlNode | undefined {
  for (const candidate of node.children) {
    if (candidate.name === name) return candidate;
    const found = descendant(candidate, name);
    if (found) return found;
  }
  return undefined;
}

/**
 * Read an attribute as a number, or `undefined` when it is absent or not a
 * number.
 */
export function numberAttr(node: XmlNode | undefined, name: string): number | undefined {
  const raw = node?.attrs?.[name];
  if (raw === undefined || raw === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Read an attribute as a boolean.
 *
 * OOXML writes booleans as `1`/`0` and as `true`/`false`, and an absent
 * attribute means "inherit", which is different from an explicit `0`.
 */
export function boolAttr(node: XmlNode, name: string): boolean | undefined {
  const raw = node.attrs[name];
  if (raw === undefined) return undefined;
  if (raw === '1' || raw === 'true' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return undefined;
}
