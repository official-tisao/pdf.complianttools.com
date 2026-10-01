import type { InvoiceData, InvoiceResult } from './types.js';
import { PdfEngineError } from './errors.js';

/**
 * The invoice arithmetic, UBL emission, and structural validation — none of
 * which touches a PDF.
 *
 * This is a separate module from `invoice.ts` because writing or reading a PDF
 * needs pdf-lib (~171 KB gzip), and a browser that is only filling in a form
 * should not pay for it on page load. The invoice routes import the totals and
 * the validator from here statically, so live totals work immediately, and pull
 * `./invoice.js` only when the user actually creates or recovers a document.
 *
 * Everything exported here must stay free of pdf-lib. A single static import of
 * it puts the whole library back in the route's initial chunk, which is exactly
 * the regression `scripts/measure-bundle.mjs` is there to catch.
 */

/** Written and read back under the same name so recovery is exact. */
export const INVOICE_ATTACHMENT_NAME = 'invoice.xml';

export const money = (value: number): string => value.toFixed(2);
/** Truncate visibly, so a clipped invoice line never reads as a complete one. */
export const ellipsize = (value: string, max: number): string =>
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

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
export const CURRENCY_CODE = /^[A-Z]{3}$/u;

export function invalid(remedy: string): never {
  throw new PdfEngineError({ kind: 'invalid-operation', operation: 'invoice', remedy });
}
