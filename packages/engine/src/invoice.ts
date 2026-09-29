import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import type { InvoiceData, InvoiceLine, InvoiceResult } from './types.js';
import { PdfEngineError } from './errors.js';

/** Written and read back under the same name so recovery is exact. */
export const INVOICE_ATTACHMENT_NAME = 'invoice.xml';

const money = (value: number): string => value.toFixed(2);
/** Truncate visibly, so a clipped invoice line never reads as a complete one. */
const ellipsize = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;
const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

/** UBL 2.1 `cbc:ID` for a `cac:TaxCategory`. Zero-rated lines get the conventional "Z". */
type TaxSchedule = { id: string; rate: number; taxable: number; tax: number };

/**
 * Groups lines by tax rate into UBL tax categories. The invoice total and the
 * emitted XML are both derived from this one grouping so they cannot drift.
 */
function taxSchedules(invoice: InvoiceData): TaxSchedule[] {
  const byRate = new Map<number, { taxable: number; tax: number }>();
  for (const line of invoice.lines) {
    const rate = line.taxRate ?? 0;
    const net = line.quantity * line.unitPrice;
    const bucket = byRate.get(rate) ?? { taxable: 0, tax: 0 };
    bucket.taxable += net;
    bucket.tax += (net * rate) / 100;
    byRate.set(rate, bucket);
  }
  return [...byRate.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rate, totals], index) => ({
      id: rate === 0 ? 'Z' : index === 0 ? 'S' : `S${index}`,
      rate,
      taxable: totals.taxable,
      tax: totals.tax,
    }));
}

function categoryIdFor(schedules: readonly TaxSchedule[], rate: number): string {
  return schedules.find((schedule) => schedule.rate === rate)?.id ?? 'Z';
}

export function invoiceTotals(invoice: InvoiceData): InvoiceResult['totals'] {
  const schedules = taxSchedules(invoice);
  const net = Number(money(schedules.reduce((sum, schedule) => sum + schedule.taxable, 0)));
  const tax = Number(money(schedules.reduce((sum, schedule) => sum + schedule.tax, 0)));
  // Gross is summed from the ROUNDED net and tax. Rounding each total
  // independently and then adding the unrounded floats produced documents
  // whose stated total did not match their own net and tax lines.
  return { net, tax, gross: Number(money(net + tax)) };
}

export function invoiceToUblXml(invoice: InvoiceData): string {
  const totals = invoiceTotals(invoice);
  const schedules = taxSchedules(invoice);
  const currency = escapeXml(invoice.currency);
  const lineXml = invoice.lines
    .map((line, index) => {
      const rate = line.taxRate ?? 0;
      return `<cac:InvoiceLine><cbc:ID>${index + 1}</cbc:ID><cbc:InvoicedQuantity unitCode="C62">${money(line.quantity)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${currency}">${money(line.quantity * line.unitPrice)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${escapeXml(line.description)}</cbc:Name><cac:ClassifiedTaxCategory><cbc:ID>${categoryIdFor(schedules, rate)}</cbc:ID><cbc:Percent>${money(rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory></cac:Item><cac:Price><cbc:PriceAmount currencyID="${currency}">${money(line.unitPrice)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
    })
    .join('');
  const taxTotalXml = schedules
    .map(
      (schedule) =>
        `<cac:TaxSubtotal><cbc:TaxableAmount currencyID="${currency}">${money(schedule.taxable)}</cbc:TaxableAmount><cbc:TaxAmount currencyID="${currency}">${money(schedule.tax)}</cbc:TaxAmount><cac:TaxCategory><cbc:ID>${schedule.id}</cbc:ID><cbc:Percent>${money(schedule.rate)}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:CustomizationID>urn:pdf.complianttools.com:ubl:invoice:1</cbc:CustomizationID><cbc:ProfileID>urn:fdc:peppol.eu:2017:poocl:billing:01:1.0</cbc:ProfileID><cbc:ID>${escapeXml(invoice.invoiceNumber)}</cbc:ID><cbc:IssueDate>${escapeXml(invoice.issueDate)}</cbc:IssueDate>${invoice.dueDate ? `<cbc:DueDate>${escapeXml(invoice.dueDate)}</cbc:DueDate>` : ''}<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode>${invoice.notes ? `<cbc:Note>${escapeXml(invoice.notes)}</cbc:Note>` : ''}<cac:AccountingSupplierParty><cac:Party><cbc:Name>${escapeXml(invoice.supplier.name)}</cbc:Name>${invoice.supplier.taxId ? `<cbc:CompanyID>${escapeXml(invoice.supplier.taxId)}</cbc:CompanyID>` : ''}${invoice.supplier.address ? `<cac:PostalAddress><cbc:StreetName>${escapeXml(invoice.supplier.address)}</cbc:StreetName></cac:PostalAddress>` : ''}</cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cbc:Name>${escapeXml(invoice.customer.name)}</cbc:Name>${invoice.customer.taxId ? `<cbc:CompanyID>${escapeXml(invoice.customer.taxId)}</cbc:CompanyID>` : ''}${invoice.customer.address ? `<cac:PostalAddress><cbc:StreetName>${escapeXml(invoice.customer.address)}</cbc:StreetName></cac:PostalAddress>` : ''}</cac:Party></cac:AccountingCustomerParty><cac:TaxTotal><cbc:TaxAmount currencyID="${currency}">${money(totals.tax)}</cbc:TaxAmount>${taxTotalXml}</cac:TaxTotal>${lineXml}<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="${currency}">${money(totals.net)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${currency}">${money(totals.gross)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${currency}">${money(totals.gross)}</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>`;
}

export type EInvoiceValidation = {
  valid: boolean;
  remedy?: string;
  /** Which structural rules failed, so the remedy can name the actual cause. */
  failures?: string[];
};

/**
 * Structural validation only. This checks the shape our emitter produces and
 * the rules a consumer needs before the document is worth sending on; it is
 * NOT schema validation against the published UBL/ZUGFeRD XSD, which stays
 * deferred until that artifact is registered (PLAN.md P7-03).
 */
export function validateEInvoiceXml(xml: string): EInvoiceValidation {
  const failures: string[] = [];
  if (!/^\s*<\?xml\s+version="1\.0"[^>]*\?>/u.test(xml)) failures.push('missing XML declaration');
  const open = xml.match(/<(?:[\w.-]+:)?Invoice\b[^>]*>/u);
  if (!open) failures.push('missing Invoice root element');
  if (!/<\/((?:[\w.-]+:)?Invoice)>\s*$/u.test(xml)) failures.push('unterminated Invoice element');
  if (!/<cbc:ID>[^<]+<\/cbc:ID>/u.test(xml)) failures.push('missing invoice ID');
  if (!/<cbc:DocumentCurrencyCode>[^<]+<\/cbc:DocumentCurrencyCode>/u.test(xml))
    failures.push('missing document currency');
  if (!/<cbc:IssueDate>\d{4}-\d{2}-\d{2}<\/cbc:IssueDate>/u.test(xml))
    failures.push('missing or malformed issue date');
  if (!/<cac:InvoiceLine\b/u.test(xml)) failures.push('no invoice lines');
  if (!/<cac:TaxTotal>[\s\S]*?<cbc:TaxAmount/u.test(xml)) failures.push('missing tax total');
  if (!/<cac:LegalMonetaryTotal>[\s\S]*?PayableAmount/u.test(xml))
    failures.push('missing monetary total');

  if (failures.length === 0) return { valid: true };
  return {
    valid: false,
    failures,
    remedy: `This XML is not a usable e-invoice: ${failures.join('; ')}.`,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const CURRENCY_CODE = /^[A-Z]{3}$/u;

function invalid(remedy: string): never {
  throw new PdfEngineError({ kind: 'invalid-operation', operation: 'invoice', remedy });
}

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
