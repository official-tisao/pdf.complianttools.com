import type { OptionField } from '@pdf-complianttools/ui/OptionPanel.svelte';

export const toolOptions: Record<string, OptionField[]> = {
  merge: [
    { key: 'preserveBookmarks', label: 'Preserve bookmarks', type: 'checkbox', value: true },
    {
      key: 'bookmarkStrategy',
      label: 'Bookmark strategy',
      type: 'select',
      value: 'per-file-top-level',
      options: ['per-file-top-level', 'flatten', 'none'],
    },
    {
      key: 'insertBlankBetween',
      label: 'Insert blank page between files',
      type: 'checkbox',
      value: false,
      advanced: true,
    },
  ],
  split: [
    { key: 'pagesPerFile', label: 'Pages per file', type: 'number', value: 1, min: 1, step: 1 },
    {
      key: 'maxBytes',
      label: 'Maximum output bytes',
      type: 'number',
      value: 0,
      min: 0,
      step: 1,
      advanced: true,
    },
  ],
  compress: [
    {
      key: 'preset',
      label: 'Preset',
      type: 'select',
      value: 'balanced',
      options: ['extreme', 'balanced', 'high-quality', 'custom'],
    },
    { key: 'quality', label: 'Image quality', type: 'range', value: 75, min: 1, max: 100, step: 1 },
    {
      key: 'stripMetadata',
      label: 'Strip metadata',
      type: 'checkbox',
      value: false,
      advanced: true,
    },
    {
      key: 'linearize',
      label: 'Optimize for web delivery',
      type: 'checkbox',
      value: false,
      advanced: true,
    },
  ],
  'extract-pages': [{ key: 'pages', label: 'Pages (for example 1-3,5)', type: 'text', value: '1' }],
  'remove-pages': [
    { key: 'pages', label: 'Pages (for example odd,2-4)', type: 'text', value: '1' },
  ],
  insert: [
    { key: 'index', label: 'Insert before page', type: 'number', value: 1, min: 1, step: 1 },
    { key: 'blankPages', label: 'Blank pages', type: 'number', value: 1, min: 0, step: 1 },
  ],
  rotate: [
    {
      key: 'degrees',
      label: 'Rotation',
      type: 'select',
      value: '90',
      options: ['90', '180', '270', '-90'],
    },
  ],
  'n-up': [
    {
      key: 'columns',
      label: 'Pages per sheet',
      type: 'select',
      value: '2',
      options: ['2', '4', '6', '9'],
    },
    { key: 'booklet', label: 'Booklet order', type: 'checkbox', value: false, advanced: true },
  ],
  halve: [
    {
      key: 'direction',
      label: 'Split direction',
      type: 'select',
      value: 'horizontal',
      options: ['horizontal', 'vertical'],
    },
    { key: 'threshold', label: 'Oversize ratio', type: 'number', value: 1.25, min: 1, step: 0.05 },
  ],
  crop: [
    { key: 'left', label: 'Left margin', type: 'number', value: 0, min: 0 },
    { key: 'top', label: 'Top margin', type: 'number', value: 0, min: 0 },
    { key: 'right', label: 'Right margin', type: 'number', value: 0, min: 0 },
    { key: 'bottom', label: 'Bottom margin', type: 'number', value: 0, min: 0 },
  ],
  resize: [
    { key: 'width', label: 'Width (points)', type: 'number', value: 612, min: 1 },
    { key: 'height', label: 'Height (points)', type: 'number', value: 792, min: 1 },
    {
      key: 'mode',
      label: 'Fit mode',
      type: 'select',
      value: 'scale-to-fit',
      options: ['scale-to-fit', 'crop-to-fit'],
    },
  ],
  bates: [
    { key: 'prefix', label: 'Prefix', type: 'text', value: '' },
    { key: 'suffix', label: 'Suffix', type: 'text', value: '' },
    { key: 'start', label: 'Starting number', type: 'number', value: 1, min: 0 },
    { key: 'padding', label: 'Zero padding', type: 'number', value: 6, min: 1, max: 12, step: 1 },
  ],
  'optimize-web': [
    { key: 'progressive', label: 'Progressive delivery', type: 'checkbox', value: true },
  ],
  repair: [],
  rasterize: [{ key: 'dpi', label: 'DPI', type: 'number', value: 150, min: 72, max: 600 }],
  flatten: [
    { key: 'forms', label: 'Flatten form fields', type: 'checkbox', value: true },
    { key: 'annotations', label: 'Flatten annotations', type: 'checkbox', value: true },
  ],
  pdfa: [
    {
      key: 'conformanceLevel',
      label: 'Conformance',
      type: 'select',
      value: '2b',
      options: ['1b', '2b', '3b'],
    },
    {
      key: 'fallbackOnFailure',
      label: 'On failure',
      type: 'select',
      value: 'report-only',
      options: ['report-only', 'best-effort-fix'],
    },
  ],
  metadata: [
    { key: 'title', label: 'Title', type: 'text', value: '' },
    { key: 'author', label: 'Author', type: 'text', value: '' },
    { key: 'subject', label: 'Subject', type: 'text', value: '' },
    { key: 'strip', label: 'Remove all metadata', type: 'checkbox', value: false, advanced: true },
  ],
  bookmarks: [{ key: 'entries', label: 'Bookmark editor', type: 'text', value: 'Page 1' }],
};

export function fieldsFor(tool: string): OptionField[] {
  return toolOptions[tool] ?? [];
}
