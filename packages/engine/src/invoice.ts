import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { InvoiceData, InvoiceLine, InvoiceResult } from './types.js';
import { PdfEngineError } from './errors.js';

const money = (value: number): string => value.toFixed(2);
const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

export function invoiceTotals(invoice: InvoiceData): InvoiceResult['totals'] {
  const net = invoice.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  const tax = invoice.lines.reduce(
    (sum, line) => sum + (line.quantity * line.unitPrice * (line.taxRate ?? 0)) / 100,
    0,
  );
  return { net: Number(money(net)), tax: Number(money(tax)), gross: Number(money(net + tax)) };
}

export function invoiceToUblXml(invoice: InvoiceData): string {
  const totals = invoiceTotals(invoice);
  const lineXml = invoice.lines
    .map(
      (line, index) =>
        `<cac:InvoiceLine><cbc:ID>${index + 1}</cbc:ID><cbc:InvoicedQuantity>${money(line.quantity)}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="${escapeXml(invoice.currency)}">${money(line.quantity * line.unitPrice)}</cbc:LineExtensionAmount><cac:Item><cbc:Name>${escapeXml(line.description)}</cbc:Name></cac:Item><cac:Price><cbc:PriceAmount currencyID="${escapeXml(invoice.currency)}">${money(line.unitPrice)}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>${escapeXml(invoice.invoiceNumber)}</cbc:ID><cbc:IssueDate>${escapeXml(invoice.issueDate)}</cbc:IssueDate>${invoice.dueDate ? `<cbc:DueDate>${escapeXml(invoice.dueDate)}</cbc:DueDate>` : ''}<cbc:DocumentCurrencyCode>${escapeXml(invoice.currency)}</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cbc:Name>${escapeXml(invoice.supplier.name)}</cbc:Name>${invoice.supplier.taxId ? `<cbc:CompanyID>${escapeXml(invoice.supplier.taxId)}</cbc:CompanyID>` : ''}</cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cbc:Name>${escapeXml(invoice.customer.name)}</cbc:Name>${invoice.customer.taxId ? `<cbc:CompanyID>${escapeXml(invoice.customer.taxId)}</cbc:CompanyID>` : ''}</cac:Party></cac:AccountingCustomerParty>${lineXml}<cac:LegalMonetaryTotal><cbc:TaxExclusiveAmount currencyID="${escapeXml(invoice.currency)}">${money(totals.net)}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount currencyID="${escapeXml(invoice.currency)}">${money(totals.gross)}</cbc:TaxInclusiveAmount><cbc:PayableAmount currencyID="${escapeXml(invoice.currency)}">${money(totals.gross)}</cbc:PayableAmount></cac:LegalMonetaryTotal></Invoice>`;
}

export function validateEInvoiceXml(xml: string): { valid: boolean; remedy?: string } {
  const valid =
    /^\s*<\?xml[\s\S]*?<Invoice\b[\s\S]*<\/Invoice>\s*$/u.test(xml) &&
    /<cbc:ID>[^<]+<\/cbc:ID>/u.test(xml) &&
    /TaxInclusiveAmount/u.test(xml);
  return valid
    ? { valid }
    : {
        valid,
        remedy:
          'Provide a UBL Invoice XML document with ID, currency, line items, and monetary totals.',
      };
}

export async function createInvoicePdf(invoice: InvoiceData): Promise<InvoiceResult> {
  if (
    !invoice.invoiceNumber ||
    !invoice.issueDate ||
    !invoice.currency ||
    invoice.lines.length === 0
  )
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'invoice',
      remedy: 'Provide an invoice number, issue date, currency, and at least one line item.',
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
    page.drawText(line.description.slice(0, 55), { x: 48, y, size: 10, font });
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
  if (invoice.notes) page.drawText(invoice.notes.slice(0, 120), { x: 48, y: 96, size: 9, font });
  await document.attach(new TextEncoder().encode(xml), 'invoice.xml', {
    mimeType: 'application/xml',
    description: 'Structured UBL invoice data',
  });
  return {
    pdf: await document.save({ useObjectStreams: true, addDefaultPage: false }),
    xml,
    totals,
  };
}
