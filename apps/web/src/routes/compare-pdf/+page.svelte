<script lang="ts">
  import CompareWorkspace from '$lib/CompareWorkspace.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';

  const path = '/compare-pdf';
  const description =
    'Compare two PDFs side by side with a text and visual diff, entirely in your browser.';
  const structuredData = softwareApplicationLd({
    name: 'Compare PDFs',
    description,
    path,
  });
</script>

<svelte:head>
  <title>Compare PDFs</title>
  <meta name="description" content={description} />
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head><CompareWorkspace />
