<script lang="ts">
  import InvoiceCreatorPage from '$lib/InvoiceCreatorPage.svelte';
</script>

<!--
  No `locale` prop: the component reads the locale from the `[locale]` layout's
  context. Passing `locale="en"` here would override that context and make every
  generated `/ar/invoice-creator` render English — which is exactly what the
  first version of this route did.
-->
<InvoiceCreatorPage />
