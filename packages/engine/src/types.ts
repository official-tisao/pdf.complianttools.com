import type { EngineError } from './errors.js';

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
  | 'create-pdf'
  | 'qr-code'
  | 'invoice'
  | 'document-pack'
  | 'scan-to-pdf';

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

export type PagePreset = {
  size: 'a4' | 'letter' | 'legal';
  orientation: 'portrait' | 'landscape';
};

export type PdfTemplate = 'blank' | 'grid' | 'lined' | 'dot';

export type CreatePdfOptions = {
  preset?: PagePreset;
  template?: PdfTemplate;
  pages?: readonly { title?: string; lines?: readonly string[] }[];
  margin?: number;
};

export type QrPayload =
  | { kind: 'text' | 'url'; value: string }
  | { kind: 'vcard'; name: string; phone?: string; email?: string; organization?: string };

export type QrRender = {
  modules: readonly boolean[][];
  version: number;
  svg: string;
  png: Uint8Array;
  pdf: Uint8Array;
};

export type InvoiceLine = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
};

export type InvoiceData = {
  invoiceNumber: string;
  issueDate: string;
  dueDate?: string;
  currency: string;
  supplier: { name: string; address?: string; taxId?: string };
  customer: { name: string; address?: string; taxId?: string };
  lines: readonly InvoiceLine[];
  notes?: string;
};

export type InvoiceResult = {
  pdf: Uint8Array;
  xml: string;
  totals: { net: number; tax: number; gross: number };
};

export type BatchItemStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type BatchItemResult = {
  index: number;
  status: BatchItemStatus;
  attempts: number;
  output?: Uint8Array;
  error?: EngineError;
};

export type BatchOptions = {
  concurrency?: number;
  maxRetries?: number;
  maxMemoryBytes?: number;
  signal?: AbortSignal;
  onItem?: (item: BatchItemResult) => void;
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
