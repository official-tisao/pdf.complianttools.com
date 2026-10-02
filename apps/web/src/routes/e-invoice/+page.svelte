<script lang="ts">
  import ENoInvoicePage from '$lib/ENoInvoicePage.svelte';
</script>

<!-- No `locale` prop: the component reads the locale from the `[locale]`
  layout context, so the generated `/ar/e-invoice` renders Arabic. -->
<ENoInvoicePage />
