<script lang="ts">
  import InvoiceCreatorPage from '$lib/InvoiceCreatorPage.svelte';
  import type { Locale } from '$lib/i18n';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<!--
  The +layout.ts load already rejected any locale outside the supported set, so
  the cast is safe and a mistyped URL 404s rather than rendering English.
-->
<InvoiceCreatorPage locale={data.locale as Locale} />
