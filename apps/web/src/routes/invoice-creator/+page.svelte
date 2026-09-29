<script lang="ts">
  import FeaturePage from '$lib/FeaturePage.svelte';
  import InvoiceBuilder from '$lib/InvoiceBuilder.svelte';
  import FaqSection from '$lib/FaqSection.svelte';

  const faq = [
    {
      question: 'Are my invoice details uploaded anywhere?',
      answer:
        'No. The invoice is built and rendered entirely in this browser tab. Nothing is sent to a server, and the saved templates live in this browser’s own storage — clearing site data removes them.',
    },
    {
      question: 'What is the UBL-style XML attached to the PDF?',
      answer:
        'It is a structured copy of the same invoice — invoice number, dates, both parties, every line item with its tax rate, and the totals — embedded as a file inside the PDF. A system that can read it does not have to scrape the rendered page.',
    },
    {
      question: 'Is this invoice validated against the official UBL schema?',
      answer:
        'Not yet. The XML is checked against a set of structural rules, and the file passes those, but full published-schema validation is not available in a browser-only tool. Validate the exported XML against the schema your recipient requires before sending it.',
    },
    {
      question: 'Does the tool check my tax rates or registration numbers?',
      answer:
        'No. It does arithmetic and structure only. Tax rates, VAT registration numbers, and legal compliance are your responsibility to confirm before issuing a business document.',
    },
  ];
</script>

<FeaturePage
  kind="invoice"
  title="Invoice creator"
  description="Build a reviewable invoice PDF with line items, totals, and structured XML attached."
>
  <InvoiceBuilder variant="creator" />
  <noscript>
    <p>
      This invoice builder runs entirely in your browser and needs JavaScript enabled. Without it
      the form above is visible but cannot calculate totals or produce a PDF. Nothing is sent to a
      server at any point.
    </p>
  </noscript>
  <FaqSection entries={faq} />
</FeaturePage>
