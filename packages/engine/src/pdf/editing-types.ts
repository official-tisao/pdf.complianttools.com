import type { PageRect, PdfColor, TextEditCapability, TextRun } from '../types.js';

export type AnnotationKind =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'freehand'
  | 'sticky-note'
  | 'square'
  | 'circle'
  | 'arrow'
  | 'callout';
export type AnnotationOptions = Readonly<{
  page: number;
  kind: AnnotationKind;
  rect: PageRect;
  color?: PdfColor;
  opacity?: number;
  contents?: string;
  id?: string;
}>;
export type AddTextOptions = Readonly<{
  page: number;
  text: string;
  x: number;
  y: number;
  size?: number;
  color?: PdfColor;
  opacity?: number;
}>;
export type AddImageOptions = Readonly<{
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
}>;
export type HeaderFooterOptions = Readonly<{
  header?: string;
  footer?: string;
  size?: number;
  margin?: number;
}>;
export type RedactionOptions = Readonly<{
  method: 'manual-box' | 'text-search-match';
  page?: number;
  searchPattern?: string;
  presetPattern?: 'ssn' | 'email' | 'phone' | 'credit-card';
  removeMetadataOnRedact?: boolean;
}>;
export type RedactionVerification = Readonly<{
  passed: boolean;
  findings: readonly string[];
  checkedContents: boolean;
  checkedStructureTree: boolean;
  checkedXmp: boolean;
}>;
export type AccessibilityAudit = Readonly<{
  hasStructureTree: boolean;
  imageCount: number;
  taggedImageCount: number;
  headings: readonly number[];
  headingGaps: boolean;
  readingOrder: 'declared' | 'not-declared';
  warnings: readonly string[];
}>;
export type SignatureVerification = Readonly<{
  status: 'unsigned' | 'verified' | 'invalid' | 'unsupported';
  signatures: readonly { byteRange: readonly number[]; cmsPresent: boolean }[];
  remedy: string;
}>;

export type { PageRect, PdfColor, TextEditCapability, TextRun };
