<script lang="ts">
  /**
   * Structured data for a tool route. Canonical and hreflang are emitted once in
   * the layout because they derive purely from the path; only the JSON-LD needs
   * per-page copy, so this is what bespoke routes mount.
   */
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';
  import { page } from '$app/state';

  let {
    name,
    description,
    category = 'BusinessApplication',
  }: { name: string; description: string; category?: string } = $props();

  const structuredData = $derived(
    softwareApplicationLd({
      name,
      description,
      path: page.url.pathname,
      category,
    }),
  );
</script>

<svelte:head>
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>
