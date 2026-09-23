import { PDFArray, PDFDocument, PDFDict, PDFName, StandardFonts, degrees, rgb } from 'pdf-lib';
import { unzlibSync, zlibSync } from 'fflate';
import { PdfEngineError } from '../errors.js';
import { extractPdfTextPages } from '../conversion/pdf-text.js';
import type {
  AnnotationKind,
  AnnotationOptions,
  AccessibilityAudit,
  AddImageOptions,
  AddTextOptions,
  HeaderFooterOptions,
  PageRect,
  PdfColor,
  RedactionOptions,
  RedactionVerification,
  SignatureVerification,
  TextEditCapability,
  TextRun,
} from './editing-types.js';

function loadError(operation: string, error: unknown): never {
  if (error instanceof PdfEngineError) throw error;
  throw new PdfEngineError({
    kind: 'corrupt-structure',
    repairable: true,
    remedy: `The PDF could not be ${operation}. Re-export it from its source application and retry.`,
  });
}

async function load(bytes: Uint8Array, operation: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch (error) {
    return loadError(operation, error);
  }
}

function pageFor(document: PDFDocument, pageNumber: number): ReturnType<PDFDocument['getPage']> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > document.getPageCount()) {
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'page-selection',
      remedy: `Choose a page from 1 to ${document.getPageCount()}.`,
    });
  }
  return document.getPage(pageNumber - 1);
}

function color(value?: PdfColor) {
  return rgb(value?.r ?? 0.12, value?.g ?? 0.11, value?.b ?? 0.1);
}

function safeOpacity(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 1));
}

function expandToken(value: string, page: number, total: number, date = new Date()): string {
  return value
    .replaceAll('{page}', String(page))
    .replaceAll('{total}', String(total))
    .replaceAll('{date}', date.toISOString().slice(0, 10));
}

function escapePdfLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function embeddedFontEvidence(bytes: Uint8Array): { embedded: boolean; subsettable: boolean } {
  const source = new TextDecoder('latin1').decode(bytes);
  const embedded = /\/FontFile(?:2|3)?\b/u.test(source);
  const subsettable = embedded && /\/BaseFont\s*\/[^\s/]+\+/u.test(source);
  return { embedded, subsettable };
}

/** A read-side editor model. It deliberately exposes capability evidence instead of pretending pdf-lib can parse every text run. */
export async function inspectTextRuns(bytes: Uint8Array): Promise<readonly TextRun[]> {
  const pages = await extractPdfTextPages(bytes);
  const font = embeddedFontEvidence(bytes);
  return pages.flatMap((page) =>
    page.lines.map((text, index) => ({
      page: page.pageNumber,
      text,
      x: 0,
      y: Math.max(0, 800 - index * 14),
      width: text.length * 6,
      height: 12,
      embedded: font.embedded,
      subsettable: font.subsettable,
    })),
  );
}

export function getTextEditCapability(
  run: Pick<TextRun, 'embedded' | 'subsettable'> | undefined,
): TextEditCapability {
  if (!run)
    return {
      canEditInPlace: false,
      reason: 'text-run-not-found',
      remedy: 'Select an existing text run, or add a new text box over the page.',
    };
  if (!run.embedded)
    return {
      canEditInPlace: false,
      reason: 'font-not-embedded',
      remedy: 'The font is not embedded. Add a new text box using a local standard font instead.',
    };
  if (!run.subsettable)
    return {
      canEditInPlace: false,
      reason: 'font-not-subsettable',
      remedy: 'The embedded font is not proven subsettable. Add a new text box instead.',
    };
  return {
    canEditInPlace: true,
    remedy: 'The simple text-run editor can replace literal Tj text.',
  };
}

function streamList(
  page: ReturnType<PDFDocument['getPage']>,
): Array<{ getContentsString(): string }> {
  const contents = page.node.Contents();
  if (!contents) return [];
  if (contents instanceof PDFArray) {
    return contents
      .asArray()
      .map(
        (value) => page.node.context.lookup(value) as unknown as { getContentsString(): string },
      );
  }
  return [contents as { getContentsString(): string }];
}

function replacePageStreams(
  document: PDFDocument,
  page: ReturnType<PDFDocument['getPage']>,
  transform: (source: string) => string,
): boolean {
  const streams = streamList(page);
  let changed = false;
  const refs = streams.map((stream) => {
    const source = stream.getContentsString();
    const transformed = transform(source);
    changed ||= transformed !== source;
    return document.context.register(document.context.flateStream(transformed));
  });
  if (refs.length === 0) return false;
  if (refs.length === 1) page.node.set(PDFName.of('Contents'), refs[0]!);
  else page.node.set(PDFName.of('Contents'), document.context.obj(refs));
  return changed;
}

export async function editTextRun(
  bytes: Uint8Array,
  options: {
    page: number;
    find: string;
    replace: string;
    fallback?: AddTextOptions;
    capability?: { embedded: boolean; subsettable: boolean };
  },
): Promise<Uint8Array> {
  const document = await load(bytes, 'edit text');
  const evidence = options.capability ?? embeddedFontEvidence(bytes);
  const capability = getTextEditCapability(evidence);
  if (!capability.canEditInPlace) {
    if (options.fallback) return addTextToPdf(bytes, options.fallback);
    throw new PdfEngineError({
      kind: 'font-not-embedded-cannot-edit-text',
      remedy: capability.remedy,
    });
  }
  const page = pageFor(document, options.page);
  const find = escapePdfLiteral(options.find);
  const replacement = `(${escapePdfLiteral(options.replace)}) Tj`;
  const changed = replacePageStreams(document, page, (source) =>
    source.replace(new RegExp(`\\(${find}\\)\\s*Tj`, 'u'), replacement),
  );
  if (!changed)
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'complex PDF text-run encoding',
      remedy:
        'The selected text is not a simple literal text run. Add a new text box over it instead.',
    });
  return document.save();
}

export async function addTextToPdf(
  bytes: Uint8Array,
  options: AddTextOptions,
): Promise<Uint8Array> {
  const document = await load(bytes, 'add text');
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = pageFor(document, options.page);
  page.drawText(options.text, {
    x: options.x,
    y: options.y,
    size: options.size ?? 12,
    font,
    color: color(options.color),
    opacity: safeOpacity(options.opacity),
  });
  return document.save();
}

export async function addImageToPdf(
  bytes: Uint8Array,
  imageBytes: Uint8Array,
  options: AddImageOptions,
): Promise<Uint8Array> {
  const document = await load(bytes, 'add image');
  const page = pageFor(document, options.page);
  let image;
  try {
    image =
      imageBytes[0] === 0x89
        ? await document.embedPng(imageBytes)
        : await document.embedJpg(imageBytes);
  } catch {
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'image format for PDF placement',
      remedy: 'Use a PNG or JPEG image and retry; the original file was not changed.',
    });
  }
  page.drawImage(image, {
    x: options.x,
    y: options.y,
    width: options.width,
    height: options.height,
    opacity: safeOpacity(options.opacity),
    rotate: degrees(options.rotation ?? 0),
  });
  return document.save();
}

type RgbaImage = { width: number; height: number; pixels: Uint8Array };

function readPng(bytes: Uint8Array): RgbaImage {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('Not a PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  const data: number[] = [];
  while (offset + 12 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
    const type = new TextDecoder().decode(bytes.slice(offset + 4, offset + 8));
    const chunk = bytes.slice(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = new DataView(chunk.buffer, chunk.byteOffset, 4).getUint32(0);
      height = new DataView(chunk.buffer, chunk.byteOffset + 4, 4).getUint32(0);
      if (chunk[8] !== 8 || chunk[9] !== 6) throw new Error('Only 8-bit RGBA PNG is supported');
    } else if (type === 'IDAT') data.push(...chunk);
    offset += length + 12;
    if (type === 'IEND') break;
  }
  if (!width || !height || data.length === 0) throw new Error('PNG is missing image data');
  const scanlines = unzlibSync(new Uint8Array(data));
  const stride = width * 4;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    const outputStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = scanlines[rowStart + x] ?? 0;
      const left = x >= 4 ? pixels[outputStart + x - 4]! : 0;
      const up = y > 0 ? pixels[outputStart - stride + x]! : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[outputStart - stride + x - 4]! : 0;
      pixels[outputStart + x] =
        filter === 1
          ? (raw + left) & 255
          : filter === 2
            ? (raw + up) & 255
            : filter === 3
              ? (raw + Math.floor((left + up) / 2)) & 255
              : filter === 4
                ? (raw + paeth(left, up, upperLeft)) & 255
                : raw;
    }
  }
  return { width, height, pixels };
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance
      ? up
      : upperLeft;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const output = new Uint8Array(data.length + 12);
  new DataView(output.buffer).setUint32(0, data.length);
  output.set(typeBytes, 4);
  output.set(data, 8);
  new DataView(output.buffer).setUint32(data.length + 8, crc32(output.slice(4, data.length + 8)));
  return output;
}

function writePng(image: RgbaImage): Uint8Array {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, image.width);
  view.setUint32(4, image.height);
  header[8] = 8;
  header[9] = 6;
  const scanlines = new Uint8Array((image.width * 4 + 1) * image.height);
  for (let y = 0; y < image.height; y += 1)
    scanlines.set(
      image.pixels.slice(y * image.width * 4, (y + 1) * image.width * 4),
      y * (image.width * 4 + 1) + 1,
    );
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlibSync(scanlines)),
    pngChunk('IEND', new Uint8Array()),
  ];
  const output = new Uint8Array(
    signature.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  output.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

/** Remove near-background pixels connected to the image edge; only lossless PNG input is accepted. */
export function removeSignatureBackground(bytes: Uint8Array, threshold = 32): Uint8Array {
  let image: RgbaImage;
  try {
    image = readPng(bytes);
  } catch {
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'signature background removal for this image codec',
      remedy:
        'Export the signature photo as an 8-bit RGBA PNG and retry. JPEG decoding is deliberately not guessed locally.',
    });
  }
  const { width, height, pixels } = image;
  const background = [pixels[0]!, pixels[1]!, pixels[2]!];
  const transparent = new Uint8Array(width * height);
  const queue: number[] = [];
  for (let x = 0; x < width; x += 1) {
    queue.push(x, (height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) queue.push(y * width, y * width + width - 1);
  while (queue.length) {
    const index = queue.pop()!;
    if (transparent[index]) continue;
    const pixel = index * 4;
    const distance = Math.max(
      Math.abs(pixels[pixel]! - background[0]!),
      Math.abs(pixels[pixel + 1]! - background[1]!),
      Math.abs(pixels[pixel + 2]! - background[2]!),
    );
    if (distance > threshold && pixels[pixel + 3]! > 0) continue;
    transparent[index] = 1;
    pixels[pixel + 3] = 0;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) queue.push(index - 1);
    if (x + 1 < width) queue.push(index + 1);
    if (y > 0) queue.push(index - width);
    if (y + 1 < height) queue.push(index + width);
  }
  return writePng(image);
}

export async function addHeadersFooters(
  bytes: Uint8Array,
  options: HeaderFooterOptions,
): Promise<Uint8Array> {
  const document = await load(bytes, 'add headers and footers');
  const font = await document.embedFont(StandardFonts.Helvetica);
  const total = document.getPageCount();
  document.getPages().forEach((page, index) => {
    const pageNumber = index + 1;
    const size = options.size ?? 9;
    if (options.header)
      page.drawText(expandToken(options.header, pageNumber, total), {
        x: options.margin ?? 24,
        y: page.getHeight() - (options.margin ?? 24),
        size,
        font,
      });
    if (options.footer)
      page.drawText(expandToken(options.footer, pageNumber, total), {
        x: options.margin ?? 24,
        y: options.margin ?? 24,
        size,
        font,
      });
  });
  return document.save();
}

function roman(value: number): string {
  const pairs: readonly [number, string][] = [
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
  let result = '';
  let remaining = Math.max(1, value);
  for (const [unit, token] of pairs)
    while (remaining >= unit) {
      result += token;
      remaining -= unit;
    }
  return result;
}

export async function addPageNumbers(
  bytes: Uint8Array,
  options: {
    format?: '1' | 'page-of-total' | 'roman';
    start?: number;
    skipFirst?: number;
    position?: string;
    size?: number;
  },
): Promise<Uint8Array> {
  const document = await load(bytes, 'add page numbers');
  const font = await document.embedFont(StandardFonts.Helvetica);
  const total = document.getPageCount();
  for (const [index, page] of document.getPages().entries()) {
    if (index < (options.skipFirst ?? 0)) continue;
    const value = (options.start ?? 1) + index;
    const number = options.format === 'roman' ? roman(value) : String(value);
    const label = options.format === 'page-of-total' ? `Page ${number} of ${total}` : number;
    const position = options.position ?? 'bottom-center';
    const x = position.endsWith('left')
      ? 24
      : position.endsWith('right')
        ? page.getWidth() - 56
        : page.getWidth() / 2 - 20;
    const y = position.startsWith('top') ? page.getHeight() - 24 : 18;
    page.drawText(label, { x, y, size: options.size ?? 10, font });
  }
  return document.save();
}

export async function addWatermark(
  bytes: Uint8Array,
  options: {
    text: string;
    opacity?: number;
    rotation?: number;
    tiled?: boolean;
    behindContent?: boolean;
    size?: number;
  },
): Promise<Uint8Array> {
  if (options.behindContent)
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'watermark behind existing content',
      remedy:
        'Choose in-front watermarking; pdf-lib cannot safely prepend a watermark below arbitrary existing content streams.',
    });
  const document = await load(bytes, 'add watermark');
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  for (const page of document.getPages()) {
    const width = page.getWidth();
    const height = page.getHeight();
    const text = options.text;
    const size = options.size ?? 48;
    const placements = options.tiled
      ? Array.from({ length: 9 }, (_, index) => ({
          x: 40 + ((index % 3) * width) / 3,
          y: height - 70 - (Math.floor(index / 3) * height) / 3,
        }))
      : [{ x: width / 2 - text.length * size * 0.15, y: height / 2 }];
    for (const placement of placements)
      page.drawText(text, {
        ...placement,
        size,
        font,
        opacity: safeOpacity(options.opacity ?? 0.25),
        rotate: degrees(options.rotation ?? 45),
        color: rgb(0.45, 0.45, 0.45),
      });
  }
  return document.save();
}

function appendAnnotation(
  document: PDFDocument,
  page: ReturnType<PDFDocument['getPage']>,
  kind: AnnotationKind,
  rect: PageRect,
  options: AnnotationOptions,
): void {
  const context = document.context;
  const annotation = context.obj({
    Type: 'Annot',
    Subtype:
      kind === 'sticky-note'
        ? 'Text'
        : kind === 'freehand'
          ? 'Ink'
          : kind === 'square'
            ? 'Square'
            : kind === 'circle'
              ? 'Circle'
              : kind === 'arrow'
                ? 'Line'
                : kind === 'callout'
                  ? 'FreeText'
                  : kind === 'highlight'
                    ? 'Highlight'
                    : kind === 'underline'
                      ? 'Underline'
                      : 'StrikeOut',
    Rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height],
    C: [options.color?.r ?? 1, options.color?.g ?? 0.85, options.color?.b ?? 0],
    CA: safeOpacity(options.opacity ?? 0.35),
    Contents: options.contents ?? '',
    NM: options.id ?? `local-annotation-${Date.now()}`,
  }) as PDFDict;
  if (kind === 'highlight' || kind === 'underline' || kind === 'strikeout') {
    annotation.set(
      PDFName.of('QuadPoints'),
      context.obj([
        rect.x,
        rect.y + rect.height,
        rect.x + rect.width,
        rect.y + rect.height,
        rect.x,
        rect.y,
        rect.x + rect.width,
        rect.y,
      ]),
    );
  }
  if (kind === 'freehand') {
    annotation.set(
      PDFName.of('InkList'),
      context.obj([[rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]]),
    );
  }
  if (kind === 'arrow' || kind === 'callout')
    annotation.set(
      PDFName.of('L'),
      context.obj([rect.x, rect.y, rect.x + rect.width, rect.y + rect.height]),
    );
  page.node.addAnnot(context.register(annotation));
}

export async function addAnnotation(
  bytes: Uint8Array,
  options: AnnotationOptions,
): Promise<Uint8Array> {
  const document = await load(bytes, 'add annotation');
  appendAnnotation(document, pageFor(document, options.page), options.kind, options.rect, options);
  return document.save();
}

export async function overlayPdf(
  baseBytes: Uint8Array,
  overlayBytes: Uint8Array,
  options: { page?: number; opacity?: number } = {},
): Promise<Uint8Array> {
  const document = await load(baseBytes, 'apply PDF overlay');
  const overlay = await load(overlayBytes, 'open PDF overlay');
  const source = overlay.getPage((options.page ?? 1) - 1);
  if (!source)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'overlay',
      remedy: 'Choose an overlay page that exists.',
    });
  const embedded = await document.embedPage(source);
  for (const page of document.getPages())
    page.drawPage(embedded, {
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
      opacity: safeOpacity(options.opacity),
    });
  return document.save();
}

export async function auditAccessibility(bytes: Uint8Array): Promise<AccessibilityAudit> {
  const source = new TextDecoder('latin1').decode(bytes);
  const headings = [...source.matchAll(/\/H([1-6])\b/gu)].map((match) => Number(match[1]));
  const imageCount = (source.match(/\/Subtype\s*\/Image\b/gu) ?? []).length;
  const figureCount = (source.match(/\/Figure\b/gu) ?? []).length;
  const hasStructureTree = /\/StructTreeRoot\b/u.test(source);
  const headingGaps = headings.some(
    (level, index) => index > 0 && level > headings[index - 1]! + 1,
  );
  return {
    hasStructureTree,
    imageCount,
    taggedImageCount: Math.min(imageCount, figureCount),
    headings,
    headingGaps,
    readingOrder: hasStructureTree ? 'declared' : 'not-declared',
    warnings: [
      !hasStructureTree ? 'No structure tree is present.' : '',
      imageCount > figureCount ? 'One or more images have no Figure tag/alt-text evidence.' : '',
      headingGaps ? 'Heading levels skip one or more ranks.' : '',
    ].filter(Boolean),
  };
}

export async function signPdf(
  bytes: Uint8Array,
  options: {
    page: number;
    text?: string;
    imageBytes?: Uint8Array;
    x: number;
    y: number;
    width: number;
    height: number;
    dateStamp?: boolean;
  },
): Promise<Uint8Array> {
  const document = await load(bytes, 'place visible signature');
  const page = pageFor(document, options.page);
  if (options.imageBytes) {
    const image =
      options.imageBytes[0] === 0x89
        ? await document.embedPng(options.imageBytes)
        : await document.embedJpg(options.imageBytes);
    page.drawImage(image, {
      x: options.x,
      y: options.y,
      width: options.width,
      height: options.height,
    });
  } else {
    const font = await document.embedFont(StandardFonts.TimesRoman);
    page.drawText(options.text ?? 'Signed', {
      x: options.x,
      y: options.y + options.height / 3,
      size: Math.min(options.height, 32),
      font,
    });
  }
  if (options.dateStamp) {
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText(new Date().toISOString().slice(0, 10), {
      x: options.x,
      y: options.y - 12,
      size: 8,
      font,
    });
  }
  return document.save();
}

export async function createFormPdf(
  bytes: Uint8Array,
  fields: readonly {
    name: string;
    type: 'text' | 'checkbox' | 'radio' | 'dropdown' | 'date' | 'signature';
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    options?: readonly string[];
  }[],
): Promise<Uint8Array> {
  const document = await load(bytes, 'create form fields');
  const form = document.getForm();
  for (const field of fields) {
    const page = pageFor(document, field.page);
    const appearance = { x: field.x, y: field.y, width: field.width, height: field.height };
    if (field.type === 'signature')
      throw new PdfEngineError({
        kind: 'unsupported-feature',
        feature: 'AcroForm signature-field authoring',
        remedy:
          'Place a visible signature locally, or use a user-provided signing API for certificate-backed fields.',
      });
    if (field.type === 'text' || field.type === 'date')
      form.createTextField(field.name).addToPage(page, appearance);
    else if (field.type === 'checkbox') form.createCheckBox(field.name).addToPage(page, appearance);
    else if (field.type === 'radio') {
      const group = form.createRadioGroup(field.name);
      for (const option of field.options ?? ['Option 1', 'Option 2'])
        group.addOptionToPage(option, page, appearance);
    } else if (field.type === 'dropdown') {
      const dropdown = form.createDropdown(field.name);
      dropdown.setOptions([...(field.options ?? [])]);
      dropdown.addToPage(page, appearance);
    }
  }
  form.updateFieldAppearances();
  return document.save();
}

export type FormFieldInfo = Readonly<{
  name: string;
  type: string;
  value?: string | boolean | readonly string[];
}>;

export async function inspectFormFields(bytes: Uint8Array): Promise<readonly FormFieldInfo[]> {
  const document = await load(bytes, 'inspect form fields');
  return document
    .getForm()
    .getFields()
    .flatMap((field): FormFieldInfo[] => {
      const type = field.constructor.name;
      if (type === 'PDFTextField') {
        const value = document.getForm().getTextField(field.getName()).getText();
        return value === undefined
          ? [{ name: field.getName(), type }]
          : [{ name: field.getName(), type, value }];
      }
      if (type === 'PDFCheckBox')
        return [
          {
            name: field.getName(),
            type,
            value: document.getForm().getCheckBox(field.getName()).isChecked(),
          },
        ];
      if (type === 'PDFRadioGroup') {
        const value = document.getForm().getRadioGroup(field.getName()).getSelected();
        return value === undefined
          ? [{ name: field.getName(), type }]
          : [{ name: field.getName(), type, value }];
      }
      if (type === 'PDFDropdown')
        return [
          {
            name: field.getName(),
            type,
            value: document.getForm().getDropdown(field.getName()).getSelected(),
          },
        ];
      return [{ name: field.getName(), type }];
    });
}

export async function fillFormPdf(
  bytes: Uint8Array,
  values: Readonly<Record<string, string | boolean | readonly string[]>>,
): Promise<Uint8Array> {
  const document = await load(bytes, 'fill form fields');
  const form = document.getForm();
  for (const [name, value] of Object.entries(values)) {
    const field = form.getFieldMaybe(name);
    if (!field) continue;
    switch (field.constructor.name) {
      case 'PDFTextField':
        form.getTextField(name).setText(String(value));
        break;
      case 'PDFCheckBox': {
        if (value) form.getCheckBox(name).check();
        else form.getCheckBox(name).uncheck();
        break;
      }
      case 'PDFRadioGroup':
        form.getRadioGroup(name).select(String(value));
        break;
      case 'PDFDropdown':
        form.getDropdown(name).select(Array.isArray(value) ? [...value] : String(value));
        break;
      case 'PDFSignature':
        throw new PdfEngineError({
          kind: 'unsupported-feature',
          feature: 'filling a certificate-backed signature field',
          remedy:
            'Use a user-supplied certificate signing path; visible signatures remain available locally.',
        });
      default:
        throw new PdfEngineError({
          kind: 'unsupported-feature',
          feature: `AcroForm field type ${field.constructor.name}`,
          remedy: 'Fill supported AcroForm fields manually in a compatible PDF reader.',
        });
    }
  }
  form.updateFieldAppearances();
  return document.save();
}

function pageHasRedactionTarget(text: string, options: RedactionOptions): boolean {
  if (options.searchPattern) {
    try {
      return new RegExp(options.searchPattern, 'u').test(text);
    } catch {
      return text.includes(options.searchPattern);
    }
  }
  if (options.presetPattern) {
    const patterns: Record<string, RegExp> = {
      ssn: /\b\d{3}-\d{2}-\d{4}\b/u,
      email: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u,
      phone: /\b(?:\+?\d[\d ()-]{7,}\d)\b/u,
      'credit-card': /\b(?:\d[ -]*?){13,19}\b/u,
    };
    return patterns[options.presetPattern]!.test(text);
  }
  return true;
}

export async function redactPdf(
  bytes: Uint8Array,
  options: RedactionOptions,
): Promise<{
  bytes: Uint8Array;
  verification: RedactionVerification;
  warnings: readonly string[];
}> {
  const pages = await extractPdfTextPages(bytes);
  const document = await load(bytes, 'redact document content');
  const targets = new Set<number>();
  for (const page of pages)
    if (
      (options.page === undefined || options.page === page.pageNumber) &&
      pageHasRedactionTarget(page.lines.join('\n'), options)
    )
      targets.add(page.pageNumber);
  if (targets.size === 0)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'redact',
      remedy: 'No matching text was found. Review the search pattern or mark a page manually.',
    });
  for (const pageNumber of targets) {
    const page = pageFor(document, pageNumber);
    page.node.delete(PDFName.of('Contents'));
    page.node.delete(PDFName.of('Annots'));
    page.drawRectangle({
      x: 0,
      y: 0,
      width: page.getWidth(),
      height: page.getHeight(),
      color: rgb(0, 0, 0),
    });
  }
  if (options.removeMetadataOnRedact !== false) {
    document.setTitle('');
    document.setAuthor('');
    document.setSubject('');
    document.setKeywords([]);
    document.setCreator('');
    document.setProducer('');
    document.catalog.delete(PDFName.of('Metadata'));
    document.catalog.delete(PDFName.of('StructTreeRoot'));
  }
  const output = await document.save();
  const verification = await verifyRedaction(output, options);
  if (!verification.passed)
    throw new PdfEngineError({
      kind: 'redaction-verification-failed',
      findings: verification.findings,
      remedy:
        'The export was withheld because the verification pass found recoverable redaction content. Keep the original and use a trusted redaction-capable desktop tool.',
    });
  return {
    bytes: output,
    verification,
    warnings: [
      'This local fallback removes the complete content stream of each affected page to guarantee removal; surrounding page content is not preserved. Review the result before sharing.',
    ],
  };
}

export async function verifyRedaction(
  bytes: Uint8Array,
  options: RedactionOptions,
): Promise<RedactionVerification> {
  const raw = new TextDecoder('latin1').decode(bytes);
  const text = (await extractPdfTextPages(bytes)).map((page) => page.lines.join('\n')).join('\n');
  const needles = options.searchPattern ? [options.searchPattern] : [];
  const findings = needles
    .filter((needle) => raw.includes(needle) || text.includes(needle))
    .map((needle) => `The redacted value remains searchable: ${needle}`);
  return {
    passed: findings.length === 0,
    findings,
    checkedContents: true,
    checkedStructureTree: !/\/StructTreeRoot\b/u.test(raw),
    checkedXmp: !/\/Metadata\b/u.test(raw),
  };
}

export async function prepareSignatureRequest(
  bytes: Uint8Array,
  recipients: readonly string[],
  message: string,
): Promise<Uint8Array> {
  const encoded = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return new TextEncoder().encode(
    JSON.stringify({
      version: 'signature-request-r1',
      recipients,
      message,
      documentHex: encoded,
      delivery: 'user-owned-channel-required',
    }),
  );
}

export function assertSignatureDeliveryConfigured(configured: boolean): void {
  if (!configured)
    throw new PdfEngineError({
      kind: 'credential-required',
      channel: 'user-owned email or signing API',
      remedy:
        'Configure your own delivery channel. This app does not operate a signing backend or send documents by default.',
    });
}

export function generateSecurePassword(options: { length?: number; symbols?: boolean } = {}): {
  password: string;
  entropyBits: number;
} {
  const length = options.length ?? 24;
  const alphabet = `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789${options.symbols === false ? '' : '!@#$%^&*()-_=+'}`;
  const values = new Uint32Array(length);
  if (!globalThis.crypto?.getRandomValues)
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'secure password generation',
      remedy: 'Use a browser or runtime with Web Crypto enabled; no weak fallback is used.',
    });
  globalThis.crypto.getRandomValues(values);
  const password = Array.from(values, (value) => alphabet[value % alphabet.length]).join('');
  return { password, entropyBits: Math.floor(length * Math.log2(alphabet.length)) };
}

export async function protectPdf(): Promise<never> {
  throw new PdfEngineError({
    kind: 'unsupported-feature',
    feature: 'PDF standard security encryption',
    remedy:
      'The current permissive browser writer cannot author AES/RC4 security dictionaries safely. Use a trusted local desktop PDF encryptor, then return to this app for local editing.',
  });
}

export async function unlockPdf(): Promise<never> {
  throw new PdfEngineError({
    kind: 'encrypted-unknown-password',
    remedy:
      'Known-password decryption is not available in the current permissive browser stack. Do not brute-force; decrypt with a trusted local PDF reader and retry.',
  });
}

export async function verifyDigitalSignatures(bytes: Uint8Array): Promise<SignatureVerification> {
  const source = new TextDecoder('latin1').decode(bytes);
  const matches = [...source.matchAll(/\/ByteRange\s*\[([^\]]+)\]/gu)];
  if (matches.length === 0)
    return { status: 'unsigned', signatures: [], remedy: 'No PDF signature ByteRange was found.' };
  const signatures = matches.map((match) => ({
    byteRange: (match[1] ?? '').trim().split(/\s+/u).map(Number),
    cmsPresent: /\/Contents\s*<[da-f]+>/iu.test(source),
  }));
  const malformed = signatures.some(
    (signature) =>
      signature.byteRange.length !== 4 ||
      signature.byteRange.some((value) => !Number.isSafeInteger(value) || value < 0),
  );
  if (malformed)
    return {
      status: 'invalid',
      signatures,
      remedy: 'The signature ByteRange is malformed and cannot be trusted.',
    };
  return {
    status: 'unsupported',
    signatures,
    remedy:
      'CMS/PKCS#7 certificate-chain verification needs a user-supplied trust anchor or a dedicated permissive verifier; no root-certificate program is bundled.',
  };
}
