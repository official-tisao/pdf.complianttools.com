import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfEngineError } from '../errors.js';
import type { OcrModelDescriptor } from '../types.js';
import type { PageRenderer } from '../pdf/operations.js';
import { extractPdfTextPages } from '../conversion/pdf-text.js';

const TESSDATA_PINNED_COMMIT = '87416418657359cb625c412a48b6e1d6d41c29bd';
const TESSDATA_BASE_URL = `https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@${TESSDATA_PINNED_COMMIT}`;
const TESSDATA_CACHE_PATH = `pdf-complianttools/tessdata_fast/${TESSDATA_PINNED_COMMIT}`;

/** The IndexedDB cache namespace used by Tesseract.js for the pinned model catalogue. */
export const OCR_TESSDATA_CACHE_PATH = TESSDATA_CACHE_PATH;

/** Return the exact idb-keyval key consumed by the Tesseract.js browser worker. */
export function getOcrCacheKey(language: string): string {
  return `${TESSDATA_CACHE_PATH}/${language}.traineddata`;
}

function model(
  language: string,
  label: string,
  modelBytes: number,
  sha256: string,
): OcrModelDescriptor {
  return {
    language,
    label,
    modelBytes,
    modelLicense: 'Apache-2.0',
    status: 'not-installed',
    source: 'pinned-browser-direct',
    sourceUrl: `${TESSDATA_BASE_URL}/${language}.traineddata`,
    sha256,
  };
}

/** Four-language contract from README §6.7; models are lazy and never bundled by default. */
export const OCR_MODELS: readonly OcrModelDescriptor[] = [
  model(
    'eng',
    'English',
    4_113_088,
    '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  ),
  model(
    'deu',
    'German',
    1_525_436,
    '19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d',
  ),
  model(
    'fra',
    'French',
    1_130_365,
    'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca',
  ),
  model(
    'spa',
    'Spanish',
    2_294_433,
    '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464',
  ),
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

export type TesseractOcrWorkerOptions = {
  /** Application-origin worker asset, copied from the pinned Tesseract.js package. */
  readonly workerPath: string;
  /** Application-origin core glue asset, with its matching wasm beside it. */
  readonly corePath: string;
  readonly cachePath?: string;
  readonly onProgress?: (event: { status: string; progress: number }) => void;
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
  return OCR_MODELS.find((entry) => entry.language === language);
}

export async function getOcrCapability(
  language: string,
  store?: OcrModelStore,
  worker?: OcrWorker,
): Promise<OcrCapability> {
  const selected = getOcrModel(language);
  if (!selected)
    return {
      language,
      state: 'unsupported-language',
      message: `No approved local OCR model is catalogued for ${language}.`,
    };
  if (!worker)
    return {
      language,
      state: 'runtime-not-configured',
      model: selected,
      message:
        'The local OCR worker is not configured. Recognition requires the reviewed application-origin Tesseract.js bridge.',
    };
  const installed = store ? await store.has(language) : false;
  if (!installed)
    return {
      language,
      state: 'model-download-required',
      model: selected,
      message: `${selected.label} OCR needs an explicit local model download (${selected.modelBytes.toLocaleString()} bytes); nothing is fetched automatically.`,
    };
  return {
    language,
    state: 'ready',
    model: { ...selected, status: 'installed' },
    message: `${selected.label} OCR is ready and will run locally.`,
  };
}

/** SHA-256 verification is performed before a model enters the local store. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    bytes.slice().buffer as ArrayBuffer,
  );
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join(
    '',
  );
}

export async function installOcrModel(
  language: string,
  store: OcrModelStore,
  loadModel: () => Promise<Uint8Array>,
): Promise<OcrModelDescriptor> {
  const selected = getOcrModel(language);
  if (!selected)
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      remedy: 'Choose an approved language from the local OCR model list.',
    });
  let bytes: Uint8Array;
  try {
    bytes = await loadModel();
  } catch (error) {
    throw new PdfEngineError({
      kind: 'ocr-download-failed',
      language,
      cause: error instanceof Error ? error.message : String(error),
      remedy: `The ${selected.label} model could not be downloaded. Check the connection and retry the explicit model action.`,
    });
  }
  if (bytes.byteLength !== selected.modelBytes)
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      modelBytes: selected.modelBytes,
      remedy: `The selected model was ${bytes.byteLength.toLocaleString()} bytes, not the disclosed ${selected.modelBytes.toLocaleString()} byte manifest. Remove it and retry from the pinned source.`,
    });
  let actualHash: string;
  try {
    actualHash = await sha256Hex(bytes);
  } catch {
    throw new PdfEngineError({
      kind: 'ocr-runtime-unavailable',
      remedy: `The browser could not verify the ${selected.label} model hash. Use a browser with Web Crypto enabled and retry.`,
    });
  }
  if (actualHash !== selected.sha256)
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      modelBytes: selected.modelBytes,
      remedy: `The ${selected.label} model hash did not match the pinned manifest. No bytes were stored; retry from the registered source.`,
    });
  await store.put(language, bytes);
  return { ...selected, status: 'installed' };
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

type TesseractWorkerLike = {
  recognize(
    image: unknown,
    options?: Record<string, unknown>,
    output?: Record<string, boolean>,
  ): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
};

type TesseractRuntime = {
  OEM: { LSTM_ONLY: number };
  createWorker(
    language: string,
    oem: number,
    options: Record<string, unknown>,
  ): Promise<TesseractWorkerLike>;
};

/**
 * Create a lazy Tesseract.js adapter. Dynamic import and worker creation happen only when the
 * caller explicitly starts recognition. The PDF bytes never cross the model host boundary; only
 * the rendered RGBA page is sent to the application-origin OCR worker.
 */
export function createTesseractOcrWorker(
  options: TesseractOcrWorkerOptions,
): OcrWorker & { dispose(): Promise<void> } {
  let activeLanguage: string | undefined;
  let activeWorker: TesseractWorkerLike | undefined;
  let creation: Promise<TesseractWorkerLike> | undefined;

  const ensureWorker = async (language: string): Promise<TesseractWorkerLike> => {
    const selected = getOcrModel(language);
    if (!selected)
      throw new PdfEngineError({
        kind: 'ocr-model-unavailable',
        language,
        remedy: 'Choose an approved language from the local OCR model list.',
      });
    if (activeWorker && activeLanguage === language) return activeWorker;
    if (activeWorker) {
      await activeWorker.terminate();
      activeWorker = undefined;
    }
    if (creation && activeLanguage === language) return creation;
    activeLanguage = language;
    creation = (async () => {
      const imported: unknown = await import('tesseract.js');
      const runtime = ((imported as { default?: unknown }).default ?? imported) as TesseractRuntime;
      const langPath = selected.sourceUrl.slice(0, selected.sourceUrl.lastIndexOf('/'));
      const worker = await runtime.createWorker(language, runtime.OEM.LSTM_ONLY, {
        workerPath: options.workerPath,
        corePath: options.corePath,
        langPath,
        cachePath: options.cachePath ?? TESSDATA_CACHE_PATH,
        cacheMethod: 'write',
        gzip: false,
        workerBlobURL: false,
        logger: (event: { status: string; progress: number }) => options.onProgress?.(event),
      });
      activeWorker = worker;
      return worker;
    })();
    try {
      return await creation;
    } catch {
      creation = undefined;
      activeLanguage = undefined;
      throw new PdfEngineError({
        kind: 'ocr-runtime-unavailable',
        remedy: `The local Tesseract.js worker could not initialize for ${selected.label}. Confirm the application-origin runtime assets and retry.`,
      });
    }
  };

  return {
    async recognize(image, language) {
      const worker = await ensureWorker(language);
      const png = await rgbaToPng(image);
      try {
        const input =
          typeof Blob === 'function'
            ? new Blob([png.buffer as ArrayBuffer], { type: 'image/png' })
            : png;
        const result = await worker.recognize(input, {}, { text: true });
        return result.data.text;
      } catch (error) {
        throw new PdfEngineError({
          kind: 'ocr-recognition-failed',
          language,
          cause: error instanceof Error ? error.message : String(error),
          remedy: 'Text recognition failed. Try a clearer scan or a different approved language.',
        });
      }
    },
    async dispose() {
      const worker = activeWorker;
      activeWorker = undefined;
      creation = undefined;
      activeLanguage = undefined;
      if (worker) await worker.terminate();
    },
  };
}

/** Run the injected local OCR worker over locally rendered pages. */
export async function ocrPdf(
  bytes: Uint8Array,
  renderer: PageRenderer,
  worker: OcrWorker,
  models: OcrModelStore,
  options: OcrOptions = {},
): Promise<OcrResult> {
  const languages = options.language?.length ? options.language : ['eng'];
  const language = languages[0]!;
  const selected = getOcrModel(language);
  if (!selected)
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      remedy: 'Choose an approved language from the local OCR model list.',
    });
  if (!(await models.has(language)))
    throw new PdfEngineError({
      kind: 'ocr-model-unavailable',
      language,
      modelBytes: selected.modelBytes,
      remedy: `${selected.label} is not installed. Review the disclosed model size, then explicitly download and cache it locally.`,
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
        'OCR text was produced by a local worker; review recognition before relying on it.',
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

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Uint8Array): Uint8Array {
  const type = new TextEncoder().encode(name);
  const output = new Uint8Array(12 + data.length);
  const view = new DataView(output.buffer);
  view.setUint32(0, data.length);
  output.set(type, 4);
  output.set(data, 8);
  view.setUint32(8 + data.length, crc32(output.subarray(4, 8 + data.length)));
  return output;
}

async function rgbaToPng(image: OcrImage): Promise<Uint8Array> {
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    image.width <= 0 ||
    image.height <= 0 ||
    image.pixels.length !== image.width * image.height * 4
  )
    throw new PdfEngineError({
      kind: 'ocr-recognition-failed',
      language: 'unknown',
      cause: 'Invalid RGBA frame',
      remedy: 'The PDF renderer returned an invalid RGBA frame; retry with a supported PDF.',
    });
  const scanlines = new Uint8Array(image.height * (image.width * 4 + 1));
  for (let row = 0; row < image.height; row += 1) {
    const target = row * (image.width * 4 + 1);
    scanlines.set(
      image.pixels.subarray(row * image.width * 4, (row + 1) * image.width * 4),
      target + 1,
    );
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([scanlines.buffer as ArrayBuffer])
        .stream()
        .pipeThrough(new CompressionStream('deflate')),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, image.width);
  headerView.setUint32(4, image.height);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', new Uint8Array()),
  ];
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
