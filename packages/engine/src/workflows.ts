import { PDFDocument, StandardFonts } from 'pdf-lib';
import { PdfEngineError } from './errors.js';
import { createTextPdf } from './create.js';
import { mergePdfBuffers } from './pdf/merge.js';

export type PackAttachment = { name: string; bytes: Uint8Array };

export async function buildDocumentPack(
  title: string,
  attachments: readonly PackAttachment[],
): Promise<Uint8Array> {
  if (attachments.length === 0)
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'document-pack',
      remedy: 'Add at least one PDF attachment to the pack.',
    });
  const entries: string[] = [];
  let page = 1;
  for (const attachment of attachments) {
    try {
      const document = await PDFDocument.load(attachment.bytes);
      const count = document.getPageCount();
      entries.push(`${attachment.name} — pages ${page + 1}-${page + count}`);
      page += count;
    } catch {
      throw new PdfEngineError({
        kind: 'conversion-failed',
        format: 'pdf',
        direction: 'to-pdf',
        cause: `Attachment ${attachment.name} is not a readable PDF.`,
        remedy:
          'Preserve the original attachment and export it as a valid PDF before building the pack.',
      });
    }
  }
  const toc = await createTextPdf(`${title} — Table of contents`, entries);
  return mergePdfBuffers([toc, ...attachments.map((attachment) => attachment.bytes)]);
}

export async function addPackCover(title: string, subtitle?: string): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawText(title, { x: 60, y: 650, size: 28, font });
  if (subtitle) page.drawText(subtitle, { x: 60, y: 615, size: 14 });
  return document.save({ useObjectStreams: true, addDefaultPage: false });
}
