<script lang="ts">
  import FeaturePage from '$lib/FeaturePage.svelte';
  import InvoiceBuilder from '$lib/InvoiceBuilder.svelte';
</script>

<FeaturePage
  kind="invoice"
  title="Invoice creator"
  description="Build a reviewable invoice PDF with line items, totals, and structured XML attached."
>
  <InvoiceBuilder variant="creator" />
</FeaturePage>
