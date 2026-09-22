export type OpId =
  | 'merge'
  | 'split'
  | 'extract-pages'
  | 'remove-pages'
  | 'insert-pages'
  | 'organize'
  | 'rotate'
  | 'compress'
  | 'render'
  | 'inspect';

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
};

export type RunOptions = {
  signal?: AbortSignal;
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
};
