import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import type { InvoiceData, InvoiceLine, InvoiceResult } from './types.js';
import { PdfEngineError } from './errors.js';
import {
  CURRENCY_CODE,
  INVOICE_ATTACHMENT_NAME,
  ISO_DATE,
  ellipsize,
  invalid,
  invoiceToUblXml,
  invoiceTotals,
  money,
  validateEInvoiceXml,
} from './invoice-core.js';

/**
 * Writing and reading a PDF — the half of the invoice feature that needs
 * pdf-lib. The arithmetic and the XML live in `./invoice-core.js`, which does
 * not, so a route that only renders live totals can import those statically and
 * still keep pdf-lib out of its initial chunk.
 *
 * The helpers above are imported as values because `createInvoicePdf` calls
 * them. The four below are re-exported so `@pdf-complianttools/engine/invoice`
 * keeps the surface its consumers already resolve; the invoice routes import
 * them from `invoice-core` directly instead, because importing them from here
 * would drag pdf-lib back onto the initial load path.
 */
export {
  invoiceTotals,
  invoiceToUblXml,
  validateEInvoiceXml,
  INVOICE_ATTACHMENT_NAME,
  type EInvoiceValidation,
} from './invoice-core.js';

export async function createInvoicePdf(invoice: InvoiceData): Promise<InvoiceResult> {
  if (
    !invoice.invoiceNumber ||
    !invoice.issueDate ||
    !invoice.currency ||
    invoice.lines.length === 0
  )
    invalid('Provide an invoice number, issue date, currency, and at least one line item.');
  if (!ISO_DATE.test(invoice.issueDate))
    invalid(`Issue date must be an ISO date (YYYY-MM-DD); received "${invoice.issueDate}".`);
  if (invoice.dueDate && !ISO_DATE.test(invoice.dueDate))
    invalid(`Due date must be an ISO date (YYYY-MM-DD); received "${invoice.dueDate}".`);
  if (!CURRENCY_CODE.test(invoice.currency))
    invalid(`Currency must be a 3-letter ISO 4217 code; received "${invoice.currency}".`);
  if (invoice.dueDate && invoice.dueDate < invoice.issueDate)
    invalid(`Due date (${invoice.dueDate}) cannot precede the issue date (${invoice.issueDate}).`);

  invoice.lines.forEach((line, index) => {
    const where = `Line ${index + 1}`;
    if (!line.description.trim()) invalid(`${where} needs a description.`);
    if (!Number.isFinite(line.quantity) || line.quantity <= 0)
      invalid(`${where} quantity must be a positive number; received "${line.quantity}".`);
    if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0)
      invalid(`${where} unit price must be a non-negative number; received "${line.unitPrice}".`);
    if (
      line.taxRate !== undefined &&
      (!Number.isFinite(line.taxRate) || line.taxRate < 0 || line.taxRate > 100)
    )
      invalid(`${where} tax rate must be between 0 and 100; received "${line.taxRate}".`);
  });
  const xml = invoiceToUblXml(invoice);
  const totals = invoiceTotals(invoice);
  const document = await PDFDocument.create();
  const page = document.addPage([612, 792]);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  page.drawText(`Invoice ${invoice.invoiceNumber}`, { x: 48, y: 744, size: 20, font: bold });
  page.drawText(
    `Issued ${invoice.issueDate}${invoice.dueDate ? ` · Due ${invoice.dueDate}` : ''}`,
    { x: 48, y: 720, size: 10, font },
  );
  page.drawText(`From: ${invoice.supplier.name}`, { x: 48, y: 686, size: 11, font });
  page.drawText(`To: ${invoice.customer.name}`, { x: 48, y: 668, size: 11, font });
  invoice.lines.forEach((line: InvoiceLine, index) => {
    const y = 620 - index * 22;
    page.drawText(ellipsize(line.description, 55), { x: 48, y, size: 10, font });
    page.drawText(`${money(line.quantity)} × ${money(line.unitPrice)} ${invoice.currency}`, {
      x: 380,
      y,
      size: 10,
      font,
    });
  });
  const totalY = 590 - invoice.lines.length * 22;
  page.drawText(`Net ${money(totals.net)} ${invoice.currency}`, {
    x: 380,
    y: totalY,
    size: 10,
    font,
  });
  page.drawText(`Tax ${money(totals.tax)} ${invoice.currency}`, {
    x: 380,
    y: totalY - 16,
    size: 10,
    font,
  });
  page.drawText(`Total ${money(totals.gross)} ${invoice.currency}`, {
    x: 380,
    y: totalY - 36,
    size: 12,
    font: bold,
  });
  if (invoice.notes) page.drawText(ellipsize(invoice.notes, 120), { x: 48, y: 96, size: 9, font });
  await document.attach(new TextEncoder().encode(xml), INVOICE_ATTACHMENT_NAME, {
    mimeType: 'application/xml',
    description: 'Structured UBL invoice data',
  });
  return {
    pdf: await document.save({ useObjectStreams: true, addDefaultPage: false }),
    xml,
    totals,
  };
}
export type RecoveredAttachment = { name: string; mimeType?: string; bytes: Uint8Array };

/**
 * Reads the file attachments out of a PDF.
 *
 * This is deterministic extraction of the embedded file, not text scraping: it
 * walks Catalog /Names /EmbeddedFiles, follows each Filespec to its /EF stream,
 * and inflates Flate-compressed content. It therefore recovers the exact bytes
 * this module attached, and recovers nothing from an arbitrary PDF — a PDF
 * with no embedded invoice has no structured data to give back.
 */
export async function extractPdfAttachments(bytes: Uint8Array): Promise<RecoveredAttachment[]> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw new PdfEngineError({
      kind: 'corrupt-structure',
      remedy: 'The file could not be opened as a PDF, so its attachments cannot be read.',
      repairable: false,
    });
  }
  // pdf-lib's `lookup(key, Type)` THROWS when the key is absent rather than
  // returning undefined, so every step must be guarded with get(). A PDF with
  // no /Names tree is the common case, not an error.
  const indirect = (value: unknown): unknown =>
    value === undefined ? undefined : document.context.lookup(value as never);
  const namesDict = indirect(document.catalog.get(PDFName.of('Names'))) as PDFDict | undefined;
  const embeddedDict = indirect(namesDict?.get(PDFName.of('EmbeddedFiles'))) as PDFDict | undefined;
  const names = indirect(embeddedDict?.get(PDFName.of('Names'))) as PDFArray | undefined;
  if (!names) return [];

  const attachments: RecoveredAttachment[] = [];
  for (let index = 0; index + 1 < names.size(); index += 2) {
    const nameObject = names.lookup(index);
    const filespec = document.context.lookup(names.lookup(index + 1)) as PDFDict | undefined;
    const efNode = filespec?.get(PDFName.of('EF'));
    const entry = efNode ? (document.context.lookup(efNode) as PDFDict | undefined) : undefined;
    const fileNode = entry?.get(PDFName.of('F')) ?? entry?.get(PDFName.of('UF'));
    const stream = fileNode
      ? (document.context.lookup(fileNode) as PDFRawStream | undefined)
      : undefined;
    if (!(stream instanceof PDFRawStream)) continue;

    const raw = stream.getContents();
    const filter = String(stream.dict.get(PDFName.of('Filter')) ?? '');
    let content: Uint8Array;
    if (filter.includes('FlateDecode')) {
      // DecompressionStream, not node:zlib: the engine must stay runnable in the
      // browser (STCC #1), and a node builtin here breaks every route's bundle.
      try {
        // PDF /FlateDecode is zlib-wrapped, so the format is 'deflate'. Raw
        // deflate ('deflate-raw') rejects these bytes outright.
        const inflater = new DecompressionStream('deflate');
        const writer = inflater.writable.getWriter();
        // Awaited in order: the write must land before close, and both must
        // settle before the readable side is read, or a failure here surfaces
        // as an empty result rather than an error we can report.
        await writer.write(raw as Uint8Array<ArrayBuffer>);
        await writer.close();
        content = new Uint8Array(await new Response(inflater.readable).arrayBuffer());
      } catch {
        throw new PdfEngineError({
          kind: 'corrupt-structure',
          remedy: `The attachment "${String(nameObject)}" is compressed with data this build cannot inflate.`,
          repairable: false,
        });
      }
    } else {
      content = raw;
    }
    // /Subtype names the MIME type on the embedded stream, not the Filespec.
    // pdf-lib writes it as /application#2Fxml.
    const subtype = String(stream.dict.get(PDFName.of('Subtype')) ?? '');
    const mimeType = subtype.replace(/^\//u, '').replace(/#2F/gu, '/').trim();
    attachments.push({
      name: decodePdfText(nameObject),
      ...(mimeType ? { mimeType } : {}),
      bytes: content,
    });
  }
  return attachments;
}

/** PDF text strings are UTF-16BE with a BOM, or literal bytes when unmarked. */
function decodePdfText(value: unknown): string {
  const raw = value?.toString() ?? '';
  const hex = /^<([0-9A-Fa-f]+)>$/u.exec(raw);
  if (!hex?.[1]) return raw.replace(/^\(|\)$/gu, '');
  const body = hex[1].replace(/(..)/gu, '$1 ');
  const bytes = Uint8Array.from(
    body
      .split(/\s+/u)
      .filter(Boolean)
      .map((pair) => parseInt(pair, 16)),
  );
  return new TextDecoder('utf-16be').decode(bytes);
}

/**
 * Recovers the e-invoice XML that `createInvoicePdf` attached to a PDF.
 *
 * Deliberately narrow: it returns the attached XML, or a typed error saying
 * there is none. It does NOT attempt to read invoice fields back out of the
 * rendered page, because that would mean guessing at a business document's
 * meaning from pixels, and a wrong guess here is a wrong invoice.
 */
export async function extractInvoiceXmlFromPdf(bytes: Uint8Array): Promise<string> {
  const attachments = await extractPdfAttachments(bytes);
  const xml = attachments.find(
    (attachment) =>
      /\.xml$/iu.test(attachment.name) || attachment.mimeType?.includes('xml') === true,
  );
  if (!xml) {
    throw new PdfEngineError({
      kind: 'unsupported-feature',
      feature: 'e-invoice XML attachment',
      remedy:
        'This PDF carries no embedded e-invoice XML. Only invoices produced with a structured attachment can be recovered; a PDF with no attachment has no structured data to read back.',
    });
  }
  const text = new TextDecoder().decode(xml.bytes);
  const check = validateEInvoiceXml(text);
  if (!check.valid) {
    throw new PdfEngineError({
      kind: 'corrupt-structure',
      remedy: `The attached XML did not pass local structural validation. ${check.remedy ?? ''}`,
      repairable: false,
    });
  }
  return text;
}
