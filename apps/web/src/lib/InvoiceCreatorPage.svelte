<script lang="ts">
  /**
   * The invoice-creator body, shared by the canonical `/invoice-creator` route
   * and its `/[locale]/invoice-creator` sibling. Extracted so a translation
   * cannot fix one copy and miss the other — which is exactly the divergence
   * that happens when the same page exists at two paths.
   */
  import FeaturePage from '$lib/FeaturePage.svelte';
  import InvoiceBuilder from '$lib/InvoiceBuilder.svelte';
  import FaqSection from '$lib/FaqSection.svelte';
  import { translate, type Locale } from '$lib/i18n';
  import { getLocaleContext } from '../routes/__locale/context';

  let { locale: localeProp }: { locale?: Locale } = $props();

  // Explicit prop wins; otherwise the `[locale]` layout's context supplies it,
  // so a generated `[locale]` route renders this component translated without
  // re-declaring its props. English routes fall back to the `en` source.
  const locale = $derived(localeProp ?? getLocaleContext());
  const t = (key: string, fallback: string) => translate(locale, key, fallback);

  const faq = [
    {
      key: 'invoice.upload',
      question: 'Are my invoice details uploaded anywhere?',
      answer:
        'No. The invoice is built and rendered entirely in this browser tab. Nothing is sent to a server, and the saved templates live in this browser’s own storage — clearing site data removes them.',
    },
    {
      key: 'invoice.xml',
      question: 'What is the UBL-style XML attached to the PDF?',
      answer:
        'It is a structured copy of the same invoice — invoice number, dates, both parties, every line item with its tax rate, and the totals — embedded as a file inside the PDF. A system that can read it does not have to scrape the rendered page.',
    },
    {
      key: 'invoice.schema',
      question: 'Is this invoice validated against the official UBL schema?',
      answer:
        'Not yet. The XML is checked against a set of structural rules, and the file passes those, but full published-schema validation is not available in a browser-only tool. Validate the exported XML against the schema your recipient requires before sending it.',
    },
    {
      key: 'invoice.taxRates',
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
  <InvoiceBuilder variant="creator" {locale} />
  <noscript>
    <p>
      {t(
        'noscript.invoice',
        'This invoice builder runs entirely in your browser and needs JavaScript enabled. Without it the form above is visible but cannot calculate totals or produce a PDF. Nothing is sent to a server at any point.',
      )}
    </p>
  </noscript>
  <FaqSection entries={faq} {locale} />
</FeaturePage>
