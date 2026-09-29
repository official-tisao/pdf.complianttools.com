<script lang="ts">
  /**
   * Static FAQ rendered into the prerendered HTML (README §7.6: the answer must
   * be in the served page, not produced by hydration). The same entries drive
   * the FAQPage JSON-LD, so the structured data cannot describe a different set
   * of questions than the page shows.
   */
  import { JSONLD_CLOSE, JSONLD_OPEN, faqPageLd } from '$lib/seo';
  import { translate } from '$lib/i18n';

  let {
    entries,
    heading = 'Frequently asked questions',
    locale = 'en',
  }: {
    entries: ReadonlyArray<{ key: string; question: string; answer: string }>;
    heading?: string;
    locale?: import('$lib/i18n').Locale;
  } = $props();

  // The same entries feed the FAQPage JSON-LD, so a localised page still
  // describes the questions it actually shows.
  const localized = $derived(
    entries.map((entry) => ({
      question: translate(locale, `faq.${entry.key}`, entry.question),
      answer: translate(locale, `faq.${entry.key}Body`, entry.answer),
    })),
  );

  // Derived, not captured once: these entries come from a $props() reference
  // that a caller can change after mount, and a stale id would break the
  // aria-labelledby association.
  const headingId = $derived(
    `faq-${entries.length}-${entries[0]?.question.slice(0, 12).replace(/\W+/gu, '-') ?? 'faq'}`,
  );
</script>

<svelte:head>
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + faqPageLd(localized) + JSONLD_CLOSE}
</svelte:head>

<section class="faq" aria-labelledby={headingId}>
  <h2 id={headingId}>{heading}</h2>
  {#each localized as entry (entry.question)}
    <details>
      <summary>{entry.question}</summary>
      <p>{entry.answer}</p>
    </details>
  {/each}
</section>

<style>
  .faq {
    border-top: 1px solid var(--color-hairline);
    margin-top: 48px;
    padding-top: 32px;
  }
  h2 {
    font-size: 1.5rem;
    margin: 0 0 16px;
  }
  details {
    border-bottom: 1px solid var(--color-hairline);
    padding: 12px 0;
  }
  summary {
    cursor: pointer;
    font-weight: 500;
  }
  p {
    color: var(--color-muted);
    line-height: 1.6;
    margin: 8px 0 0;
  }
</style>
