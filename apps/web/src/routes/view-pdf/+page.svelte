<script lang="ts">
  import PdfViewer from '$lib/PdfViewer.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';

  const path = '/view-pdf';
  const description =
    'View, search, and navigate a PDF in your browser without uploading it anywhere.';
  const structuredData = softwareApplicationLd({ name: 'PDF viewer', description, path });
</script>

<svelte:head>
  <title>PDF viewer</title>
  <meta name="description" content={description} />
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head><PdfViewer />
