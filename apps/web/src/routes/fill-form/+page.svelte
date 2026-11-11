<script lang="ts">
  import { page } from '$app/state';
  import FillFormWorkspace from '$lib/FillFormWorkspace.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';

  const description =
    'Fill out PDF forms locally in your browser. Detect AcroForm fields, edit values, and export a filled PDF. No uploads.';
  const structuredData = $derived(
    softwareApplicationLd({ name: 'Fill PDF Form', description, path: page.url.pathname }),
  );
</script>

<svelte:head>
  <!-- safe-html-reviewed: JSON-LD is serialized and escaped by $lib/seo. -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>

<FillFormWorkspace />
