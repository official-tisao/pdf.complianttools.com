import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfEngineError } from '../errors.js';
import type { OcrModelDescriptor } from '../types.js';
import type { PageRenderer } from '../pdf/operations.js';
import { extractPdfTextPages } from '../conversion/pdf-text.js';

export const OCR_MODELS: readonly OcrModelDescriptor[] = [
  {
    language: 'eng',
    label: 'English',
    modelBytes: 22_000_000,
    modelLicense: 'Apache-2.0',
    status: 'not-installed',
    source: 'user-supplied-local-model',
  },
  {
    language: 'deu',
    label: 'German',
    modelBytes: 22_000_000,
    modelLicense: 'Apache-2.0',
    status: 'not-installed',
    source: 'user-supplied-local-model',
  },
  {
    language: 'fra',
    label: 'French',
    modelBytes: 15_000_000,
    modelLicense: 'Apache-2.0',
    status: 'not-installed',
    source: 'user-supplied-local-model',
  },
  {
    language: 'spa',
    label: 'Spanish',
    modelBytes: 14_000_000,
    modelLicense: 'Apache-2.0',
    status: 'not-installed',
    source: 'user-supplied-local-model',
  },
];

export type OcrCapability = {
  readonly language: string;
  readonly state:
    'ready' | 'model-download-required' | 'runtime-not-configured' | 'unsupported-language';
  readonly model?: OcrModelDescriptor;
  readonly message: string;
};

export type OcrModelStore = {
  has(language: string): Promise<boolean>;
  read?(language: string): Promise<Uint8Array>;
  put(language: string, model: Uint8Array): Promise<void>;
  remove(language: string): Promise<void>;
};

export type OcrImage = {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
};

export type OcrWorker = {
  recognize(image: OcrImage, language: string, model: Uint8Array): Promise<string>;
};

export type OcrOptions = {
  readonly language?: readonly string[];
  readonly outputMode?: 'invisible-text-layer' | 'searchable-pdf' | 'plain-text-export';
  readonly pageRange?: readonly number[];
};

export type OcrResult = {
  readonly bytes: Uint8Array;
  readonly mimeType: 'application/pdf' | 'text/plain';
  readonly outputMode: OcrOptions['outputMode'];
  readonly pages: number;
  readonly fallback: 'none' | 'pdf-text-extraction';
  readonly warnings: readonly string[];
};

export function getOcrModel(language: string): OcrModelDescriptor | undefined {
  return OCR_MODELS.find((model) => model.language === language);
}

export async function getOcrCapability(
  language: string,
  store?: OcrModelStore,
  worker?: OcrWorker,
): Promise<OcrCapability> {
  const model = getOcrModel(language);
  if (!model)
    return {
      language,
      state: 'unsupported-language',
      message: `No approved local OCR model is catalogued for ${language}.`,
    };
  if (!worker)
    return {
      language,
      state: 'runtime-not-configured',
      model,
      message:
        'The local OCR worker is not bundled in this build. Add the reviewed Tesseract.js worker bridge explicitly.',
    };
  const installed = store ? await store.has(language) : false;
  if (!installed)
    return {
      language,
      state: 'model-download-required',
      model,
      message: `${model.label} OCR needs an explicit local model download (${model.modelBytes.toLocaleString()} bytes); nothing is fetched automatically.`,
    };
  return {
    language,
    state: 'ready',
    model: { ...model, status: 'installed' },
    message: `${model.label} OCR is ready and will run locally.`,
  };
}

export async function installOcrModel(
  language: string,
  store: OcrModelStore,
  loadModel: () => Promise<Uint8Array>,
): Promise<OcrModelDescriptor> {
  const model = getOcrModel(language);
  if (!model)
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      remedy: 'Choose an approved language from the local OCR model list.',
    });
  const bytes = await loadModel();
  if (bytes.byteLength !== model.modelBytes) {
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      modelBytes: model.modelBytes,
      remedy: `The selected model did not match the disclosed ${model.modelBytes.toLocaleString()} byte manifest. Remove it and retry with a verified local model.`,
    });
  }
  await store.put(language, bytes);
  return { ...model, status: 'installed' };
}

/** Deterministic fallback for text PDFs; it never pretends that an image was OCR'd. */
export async function ocrFallback(bytes: Uint8Array): Promise<OcrResult | undefined> {
  const pages = await extractPdfTextPages(bytes);
  if (!pages.some((page) => page.text)) return undefined;
  const text = pages.map((page) => `Page ${page.pageNumber}\n${page.text}`).join('\n\n');
  return {
    bytes: new TextEncoder().encode(text),
    mimeType: 'text/plain',
    outputMode: 'plain-text-export',
    pages: pages.length,
    fallback: 'pdf-text-extraction',
    warnings: ['This PDF already contained selectable text; no OCR model was used.'],
  };
}

/**
 * Run an injected local OCR worker. The worker boundary is deliberate: this package does not
 * download a model or silently import a network-backed Tesseract runtime.
 */
export async function ocrPdf(
  bytes: Uint8Array,
  renderer: PageRenderer,
  worker: OcrWorker,
  models: OcrModelStore,
  options: OcrOptions = {},
): Promise<OcrResult> {
  const languages = options.language?.length ? options.language : ['eng'];
  const language = languages[0]!;
  const model = getOcrModel(language);
  if (!model)
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      remedy: 'Choose an approved language from the local OCR model list.',
    });
  if (!(await models.has(language)))
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      modelBytes: model.modelBytes,
      remedy: `${model.label} is not installed. Review the disclosed model size, then explicitly download and cache it locally.`,
    });
  const modelBytes = await readStoredModel(models, language);
  const source = await PDFDocument.load(bytes);
  const pageNumbers = options.pageRange?.length
    ? options.pageRange
    : Array.from({ length: source.getPageCount() }, (_, index) => index + 1);
  const recognized: string[] = [];
  for (const pageNumber of pageNumbers) {
    const frame = await renderer(bytes, pageNumber, 1);
    recognized.push(await worker.recognize(frame, languages.join('+'), modelBytes));
  }
  const mode = options.outputMode ?? 'searchable-pdf';
  if (mode === 'plain-text-export')
    return {
      bytes: new TextEncoder().encode(
        recognized.map((text, index) => `Page ${pageNumbers[index]}\n${text}`).join('\n\n'),
      ),
      mimeType: 'text/plain',
      outputMode: mode,
      pages: pageNumbers.length,
      fallback: 'none',
      warnings: [
        'OCR text was produced by the injected local worker; review recognition before relying on it.',
      ],
    };
  const font = await source.embedFont(StandardFonts.Helvetica);
  for (const [index, pageNumber] of pageNumbers.entries()) {
    const page = source.getPage(pageNumber - 1);
    if (!page) continue;
    page.drawText(recognized[index] ?? '', {
      x: 0,
      y: 0,
      size: 1,
      font,
      color: rgb(1, 1, 1),
      opacity: 0,
    });
  }
  return {
    bytes: await source.save(),
    mimeType: 'application/pdf',
    outputMode: mode,
    pages: pageNumbers.length,
    fallback: 'none',
    warnings: [
      'OCR text is placed as an invisible layer at the page origin; text position boxes are not available through the generic worker boundary.',
    ],
  };
}

async function readStoredModel(store: OcrModelStore, language: string): Promise<Uint8Array> {
  if (!store.read)
    throw new PdfEngineError({
      kind: 'ocr-runtime-unavailable',
      remedy:
        'The local model store can confirm installation but cannot provide model bytes to the OCR worker.',
    });
  return store.read(language);
}
