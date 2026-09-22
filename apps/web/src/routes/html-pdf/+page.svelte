<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Pasted HTML to PDF"
  description="Convert pasted or selected local HTML into a PDF. Live URL capture is a separate, explicit Relay flow."
  format="html"
  accept=".html,.htm,text/html"
/>
