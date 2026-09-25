export type OpId =
  | 'merge'
  | 'split'
  | 'extract-pages'
  | 'remove-pages'
  | 'insert-pages'
  | 'organize'
  | 'rotate'
  | 'n-up'
  | 'halve'
  | 'crop'
  | 'resize'
  | 'bookmarks'
  | 'bates'
  | 'compress'
  | 'optimize-web'
  | 'repair'
  | 'rasterize'
  | 'flatten'
  | 'pdfa'
  | 'metadata'
  | 'inspect-structure'
  | 'render'
  | 'inspect'
  | 'view'
  | 'compare'
  | 'ocr'
  | 'editor'
  | 'annotate'
  | 'add-text'
  | 'add-image'
  | 'headers-footers'
  | 'page-numbers'
  | 'watermark'
  | 'overlay'
  | 'create-form'
  | 'fill-form'
  | 'accessibility-audit'
  | 'sign'
  | 'signature-background'
  | 'request-signature'
  | 'protect'
  | 'unlock'
  | 'password-generator'
  | 'redact'
  | 'verify-signature';

export type ConversionDirection = 'to-pdf' | 'from-pdf';

export type FormatId =
  | 'docx'
  | 'doc'
  | 'xlsx'
  | 'xls'
  | 'pptx'
  | 'ppt'
  | 'rtf'
  | 'txt'
  | 'markdown'
  | 'html'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'odg'
  | 'epub'
  | 'csv'
  | 'xml-einvoice'
  | 'zip'
  | 'cbz'
  | 'cbr'
  | 'publisher'
  | 'hwp'
  | 'jpg'
  | 'png'
  | 'bmp'
  | 'gif'
  | 'tiff'
  | 'webp'
  | 'heic'
  | 'svg'
  | 'psd'
  | 'ai'
  | 'indd'
  | 'pdf-image'
  | 'pdf-markdown'
  | 'pdf-html'
  | 'pdf-rtf'
  | 'pdf-txt'
  | 'pdf-odt'
  | 'pdf-ods'
  | 'pdf-odp'
  | 'pdf-epub';

export type CapabilityStatus = 'supported' | 'unavailable';

export type FormatCapability = {
  readonly id: FormatId;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly mimeTypes: readonly string[];
  readonly directions: readonly ConversionDirection[];
  readonly status: CapabilityStatus;
  readonly lazyModule?: string;
  readonly estimatedDownloadBytes?: number;
  readonly note: string;
  readonly unavailableReason?: string;
};

export type ConversionOptions = Readonly<{
  fileName?: string;
  title?: string;
  pageSize?: 'letter' | 'a4' | 'legal';
  margin?: number;
  preserveFormulas?: boolean;
  preserveLayout?: 'flowing' | 'fixed-layout-boxes';
  includeHeaders?: boolean;
  pageRange?: readonly number[];
  backgroundColor?: { r: number; g: number; b: number };
  /** A renderer is required for PDF raster export and stays outside serializable options. */
  renderer?: unknown;
  /** PDF-to-Markdown may only use an external provider after this explicit gesture. */
  allowAiEscalation?: boolean;
}>;

export type ConversionResult = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly extension: string;
  readonly suggestedName: string;
  readonly warnings: readonly string[];
};

export type StepOptions = Readonly<Record<string, unknown>>;

export type MergeOptions = StepOptions & {
  fileOrder?: readonly number[];
  pageRangePerFile?: Readonly<Record<string, string>>;
  preserveBookmarks?: boolean;
  bookmarkStrategy?: 'per-file-top-level' | 'flatten' | 'none';
  insertBlankBetween?: boolean;
};

export type SplitOptions = StepOptions & {
  ranges?: readonly string[];
  pagesPerFile?: number;
  maxBytes?: number;
  bookmarkLevel?: number;
};

export type PdfDocumentHandle = {
  readonly id: string;
  readonly pageCount: number;
};

export type PageRef = {
  readonly documentId: string;
  readonly pageNumber: number;
};

export type Step<Op extends OpId = OpId> = {
  op: Op;
  options: StepOptions;
};

export type Recipe = {
  version: 'r1';
  steps: readonly Step[];
};

export type DocMeta = {
  pageCount: number;
  byteLength: number;
  encrypted: boolean;
  hasText: boolean;
};

export type Plan = {
  recipe: Recipe;
  estimatedPeakBytes: number;
  requiresNetwork: boolean;
  operationCount: number;
  memory: MemoryPlan;
};

export type RunOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: Progress) => void;
};

export type Progress = {
  kind: 'progress';
  completed: number;
  total: number;
  message: string;
};

export type Result = {
  kind: 'result';
  bytes: Uint8Array;
  mimeType: 'application/pdf';
  outputs?: readonly Uint8Array[];
  report?: unknown;
};

export type MemoryPlan = {
  projectedPeakBytes: number;
  maxBytes: number;
  concurrency: number;
  degraded: readonly ('reduced-concurrency' | 'streamed-pages')[];
};

export type PreviewFrame = {
  pageNumber: number;
  width: number;
  height: number;
  pixels: Uint8Array;
};

export type PdfDateFields = {
  readonly creationDate?: Date;
  readonly modificationDate?: Date;
};

export type PdfMetadata = PdfDateFields & {
  readonly title: string;
  readonly author: string;
  readonly subject: string;
  readonly keywords: readonly string[];
  readonly creator: string;
  readonly producer: string;
  readonly customXmp: Readonly<Record<string, string>>;
};

export type OcrModelDescriptor = {
  readonly language: string;
  readonly label: string;
  readonly modelBytes: number;
  readonly modelLicense: 'Apache-2.0';
  readonly status: 'not-installed' | 'installed' | 'unavailable';
  readonly source: 'user-supplied-local-model';
};

export type PageRect = Readonly<{ x: number; y: number; width: number; height: number }>;

export type PdfColor = Readonly<{ r: number; g: number; b: number }>;

export type TextRun = Readonly<{
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName?: string;
  embedded: boolean;
  subsettable: boolean;
}>;

export type TextEditCapability = Readonly<{
  canEditInPlace: boolean;
  reason?:
    'font-not-embedded' | 'font-not-subsettable' | 'text-run-not-found' | 'unsupported-parser';
  remedy: string;
}>;
