import { PdfEngineError } from '../errors.js';
import type { ConversionDirection, FormatCapability, FormatId } from '../types.js';

const supported = (
  id: FormatId,
  label: string,
  extensions: readonly string[],
  mimeTypes: readonly string[],
  directions: readonly ConversionDirection[],
  note: string,
  lazyModule?: string,
  estimatedDownloadBytes?: number,
): FormatCapability => ({
  id,
  label,
  extensions,
  mimeTypes,
  directions,
  status: 'supported',
  note,
  ...(lazyModule ? { lazyModule } : {}),
  ...(estimatedDownloadBytes ? { estimatedDownloadBytes } : {}),
});

const unavailable = (
  id: FormatId,
  label: string,
  extensions: readonly string[],
  mimeTypes: readonly string[],
  directions: readonly ConversionDirection[],
  unavailableReason: string,
): FormatCapability => ({
  id,
  label,
  extensions,
  mimeTypes,
  directions,
  status: 'unavailable',
  note: 'This target is intentionally not offered until a permissive local implementation exists.',
  unavailableReason,
});

export const FORMAT_REGISTRY: readonly FormatCapability[] = [
  supported(
    'docx',
    'Word (DOCX)',
    ['.docx'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['to-pdf', 'from-pdf'],
    'Structure is read with mammoth and written with docx.',
    'docx',
    1_200_000,
  ),
  unavailable(
    'doc',
    'Legacy Word (DOC)',
    ['.doc'],
    ['application/msword'],
    ['to-pdf', 'from-pdf'],
    'Legacy OLE2/CFB parsing is not yet complete; the file is preserved and can be re-exported as DOCX.',
  ),
  supported(
    'xlsx',
    'Excel (XLSX)',
    ['.xlsx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['to-pdf', 'from-pdf'],
    'Sheet values and page-oriented table output are supported.',
    'exceljs',
    1_800_000,
  ),
  unavailable(
    'xls',
    'Legacy Excel (XLS)',
    ['.xls'],
    ['application/vnd.ms-excel'],
    ['to-pdf', 'from-pdf'],
    'Legacy OLE2/CFB parsing is not yet complete; save the workbook as XLSX and retry.',
  ),
  supported(
    'pptx',
    'PowerPoint (PPTX)',
    ['.pptx'],
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    ['to-pdf', 'from-pdf'],
    'OOXML slide text is read locally and slides are written with pptxgenjs.',
    'pptxgenjs',
    1_000_000,
  ),
  unavailable(
    'ppt',
    'Legacy PowerPoint (PPT)',
    ['.ppt'],
    ['application/vnd.ms-powerpoint'],
    ['to-pdf', 'from-pdf'],
    'Legacy binary presentation parsing is not yet complete; save the presentation as PPTX and retry.',
  ),
  supported(
    'rtf',
    'Rich Text Format',
    ['.rtf'],
    ['application/rtf', 'text/rtf'],
    ['to-pdf', 'from-pdf'],
    'Plain text and common RTF paragraph controls are preserved.',
  ),
  supported(
    'txt',
    'Plain text',
    ['.txt'],
    ['text/plain'],
    ['to-pdf', 'from-pdf'],
    'UTF-8 and UTF-16 text are decoded locally.',
  ),
  supported(
    'markdown',
    'Markdown',
    ['.md', '.markdown'],
    ['text/markdown', 'text/plain'],
    ['to-pdf', 'from-pdf'],
    'Headings, lists, tables, and fenced code blocks are rendered deterministically.',
  ),
  supported(
    'html',
    'Pasted HTML',
    ['.html', '.htm'],
    ['text/html'],
    ['to-pdf', 'from-pdf'],
    'Pasted HTML is rendered locally after active content and remote URLs are removed; arbitrary URL capture belongs to the explicit Relay route.',
  ),
  supported(
    'odt',
    'OpenDocument Text',
    ['.odt'],
    ['application/vnd.oasis.opendocument.text'],
    ['to-pdf', 'from-pdf'],
    'ODF XML is read from and written to a ZIP container.',
    'jszip',
    260_000,
  ),
  supported(
    'ods',
    'OpenDocument Spreadsheet',
    ['.ods'],
    ['application/vnd.oasis.opendocument.spreadsheet'],
    ['to-pdf', 'from-pdf'],
    'ODF XML is read from and written to a ZIP container.',
    'jszip',
    260_000,
  ),
  supported(
    'odp',
    'OpenDocument Presentation',
    ['.odp'],
    ['application/vnd.oasis.opendocument.presentation'],
    ['to-pdf', 'from-pdf'],
    'ODF XML is read from and written to a ZIP container.',
    'jszip',
    260_000,
  ),
  supported(
    'odg',
    'OpenDocument Graphics',
    ['.odg'],
    ['application/vnd.oasis.opendocument.graphics'],
    ['to-pdf', 'from-pdf'],
    'ODF XML is read locally; complex drawing objects are reported as warnings.',
  ),
  supported(
    'epub',
    'EPUB',
    ['.epub'],
    ['application/epub+zip'],
    ['to-pdf', 'from-pdf'],
    'Reflowable EPUB chapters are extracted in spine order; fixed-layout styling is best effort.',
    'fflate',
    55_000,
  ),
  supported(
    'csv',
    'Comma-separated values',
    ['.csv'],
    ['text/csv'],
    ['to-pdf', 'from-pdf'],
    'Tables use bounded column-width heuristics and preserve cell text.',
  ),
  supported(
    'xml-einvoice',
    'XML e-invoice',
    ['.xml'],
    ['application/xml', 'text/xml'],
    ['to-pdf'],
    'UBL-style invoice fields are rendered as a local table; attachment authoring is not claimed.',
  ),
  supported(
    'zip',
    'ZIP of pages or images',
    ['.zip'],
    ['application/zip'],
    ['to-pdf', 'from-pdf'],
    'Image entries become pages; PDF output is packaged as a ZIP on export.',
    'fflate',
    55_000,
  ),
  supported(
    'cbz',
    'Comic book archive',
    ['.cbz'],
    ['application/vnd.comicbook+zip', 'application/zip'],
    ['to-pdf', 'from-pdf'],
    'CBZ image entries become pages. CBR is unavailable because no permissive RAR reader is bundled.',
    'fflate',
    55_000,
  ),
  unavailable(
    'cbr',
    'RAR comic book archive',
    ['.cbr'],
    ['application/vnd.comicbook-rar'],
    ['to-pdf', 'from-pdf'],
    'RAR decoding is not bundled; export the archive as CBZ/ZIP locally and retry.',
  ),
  unavailable(
    'publisher',
    'Publisher (PUB)',
    ['.pub'],
    ['application/vnd.ms-publisher'],
    ['to-pdf'],
    'PUB is a proprietary binary layout format; no permissive browser reader is bundled.',
  ),
  unavailable(
    'hwp',
    'Hangul Word Processor (HWP)',
    ['.hwp'],
    ['application/x-hwp'],
    ['to-pdf'],
    'HWP is a proprietary binary format; export as ODT or DOCX and retry.',
  ),
  supported(
    'jpg',
    'JPEG image',
    ['.jpg', '.jpeg'],
    ['image/jpeg'],
    ['to-pdf', 'from-pdf'],
    'JPEG bytes are embedded without a re-encode on PDF write.',
  ),
  supported(
    'png',
    'PNG image',
    ['.png'],
    ['image/png'],
    ['to-pdf', 'from-pdf'],
    'PNG alpha is composited over the selected background on PDF write.',
  ),
  supported(
    'bmp',
    'BMP image',
    ['.bmp'],
    ['image/bmp'],
    ['to-pdf'],
    'BMP is decoded locally through the browser image pipeline.',
  ),
  supported(
    'gif',
    'GIF image',
    ['.gif'],
    ['image/gif'],
    ['to-pdf'],
    'The first frame is used for PDF write; animation is not preserved.',
  ),
  unavailable(
    'tiff',
    'TIFF image',
    ['.tif', '.tiff'],
    ['image/tiff'],
    ['to-pdf', 'from-pdf'],
    'A permissive multi-page TIFF codec is not bundled; export TIFF pages as PNG/JPEG first.',
  ),
  supported(
    'webp',
    'WebP image',
    ['.webp'],
    ['image/webp'],
    ['to-pdf'],
    'WebP is decoded locally through the browser image pipeline.',
  ),
  supported(
    'heic',
    'HEIC/HEIF image',
    ['.heic', '.heif'],
    ['image/heic', 'image/heif'],
    ['to-pdf'],
    'Decode-only through the browser or platform image decoder; no bundled codec is shipped.',
  ),
  supported(
    'svg',
    'SVG image',
    ['.svg'],
    ['image/svg+xml'],
    ['to-pdf'],
    'Basic SVG shapes are written as PDF vector operators; unsupported effects receive a typed error.',
  ),
  supported(
    'psd',
    'Photoshop (PSD)',
    ['.psd'],
    ['image/vnd.adobe.photoshop'],
    ['to-pdf'],
    'Only the flattened composite is extracted; layers are never claimed to round-trip.',
  ),
  supported(
    'ai',
    'Illustrator (AI)',
    ['.ai'],
    ['application/postscript', 'application/pdf'],
    ['to-pdf'],
    'PDF-backed AI files are read as PDF; other variants receive a typed unavailable result.',
  ),
  unavailable(
    'indd',
    'InDesign (INDD)',
    ['.indd'],
    ['application/x-indesign'],
    ['to-pdf'],
    'INDD is a proprietary container with no permissive browser reader.',
  ),
  supported(
    'pdf-image',
    'Rendered PDF pages',
    ['.png'],
    ['image/png'],
    ['from-pdf'],
    'Pages are rendered to PNG through the supplied local pdfium renderer, distinct from original embedded-image extraction.',
  ),
  supported(
    'pdf-markdown',
    'Markdown extracted from PDF',
    ['.md'],
    ['text/markdown'],
    ['from-pdf'],
    'Text is grouped by page and line; inferred structure is marked for review.',
  ),
  supported(
    'pdf-html',
    'HTML extracted from PDF',
    ['.html'],
    ['text/html'],
    ['from-pdf'],
    'Text and page boundaries are exported without claiming visual re-layout fidelity.',
  ),
  supported(
    'pdf-rtf',
    'RTF extracted from PDF',
    ['.rtf'],
    ['application/rtf'],
    ['from-pdf'],
    'Extracted text is emitted as paragraph-oriented RTF.',
  ),
  supported(
    'pdf-txt',
    'Text extracted from PDF',
    ['.txt'],
    ['text/plain'],
    ['from-pdf'],
    'Text is extracted page by page.',
  ),
  supported(
    'pdf-odt',
    'ODT extracted from PDF',
    ['.odt'],
    ['application/vnd.oasis.opendocument.text'],
    ['from-pdf'],
    'Extracted text is placed in a local ODT container.',
  ),
  supported(
    'pdf-ods',
    'ODS extracted from PDF',
    ['.ods'],
    ['application/vnd.oasis.opendocument.spreadsheet'],
    ['from-pdf'],
    'Line-oriented text is placed into a local ODS sheet.',
  ),
  supported(
    'pdf-odp',
    'ODP extracted from PDF',
    ['.odp'],
    ['application/vnd.oasis.opendocument.presentation'],
    ['from-pdf'],
    'Each PDF page becomes an ODP slide with extracted text.',
  ),
  supported(
    'pdf-epub',
    'EPUB extracted from PDF',
    ['.epub'],
    ['application/epub+zip'],
    ['from-pdf'],
    'Each PDF page becomes a reflowable EPUB chapter.',
  ),
];

const registryById = new Map(FORMAT_REGISTRY.map((entry) => [entry.id, entry]));

export function getFormatRegistry(): readonly FormatCapability[] {
  return FORMAT_REGISTRY;
}

export function getFormatCapability(format: FormatId): FormatCapability {
  const capability = registryById.get(format);
  if (!capability) {
    throw new PdfEngineError({
      kind: 'unsupported-format',
      format,
      direction: 'to-pdf',
      remedy:
        'Choose a format shown in the conversion registry and keep the original file unchanged.',
    });
  }
  return capability;
}

export function isFormatAvailable(format: FormatId, direction: ConversionDirection): boolean {
  const capability = getFormatCapability(format);
  return capability.status === 'supported' && capability.directions.includes(direction);
}

export function getAvailableFormats(direction: ConversionDirection): readonly FormatCapability[] {
  return FORMAT_REGISTRY.filter(
    (capability) => capability.status === 'supported' && capability.directions.includes(direction),
  );
}

export async function loadFormatAdapter(
  format: FormatId,
  options: { confirmLargeDownload?: boolean; direction?: ConversionDirection } = {},
): Promise<unknown> {
  const capability = getFormatCapability(format);
  const direction = options.direction ?? 'to-pdf';
  if (capability.status !== 'supported') {
    throw new PdfEngineError({
      kind: 'unsupported-format',
      format,
      direction,
      remedy: capability.unavailableReason ?? capability.note,
    });
  }
  if (!capability.directions.includes(direction)) {
    throw new PdfEngineError({
      kind: 'unsupported-format',
      format,
      direction,
      remedy: `${capability.label} is not offered in the ${direction} direction. ${capability.note}`,
    });
  }
  if ((capability.estimatedDownloadBytes ?? 0) > 2 * 1024 * 1024 && !options.confirmLargeDownload) {
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: `${capability.label} adapter download`,
      remedy: `This optional adapter is about ${Math.ceil((capability.estimatedDownloadBytes ?? 0) / 1_048_576)} MB. Confirm the download before loading it.`,
    });
  }
  switch (format) {
    case 'docx':
      return import('mammoth');
    case 'xlsx':
      return import('exceljs');
    case 'pptx':
      return import('pptxgenjs');
    case 'odt':
    case 'ods':
    case 'odp':
    case 'epub':
    case 'zip':
    case 'cbz':
      return import('fflate');
    default:
      return import('./convert.js');
  }
}
