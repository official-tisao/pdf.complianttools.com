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
  | 'inspect';

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
