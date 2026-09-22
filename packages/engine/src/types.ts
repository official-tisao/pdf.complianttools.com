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
