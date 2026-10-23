<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<!--
  The `.html` alias of /pdf-to-ods.

  Both URLs are served: some visitors arrive from a link, a bookmark or a search
  result that carries the file extension, and a 404 there loses a tool the site
  does ship. The props are a copy of the canonical route's, so the two pages
  offer the same conversion.
-->
<ConversionTool
  title="PDF to OpenDocument Spreadsheet"
  description="Turn PDF pages into OpenDocument Spreadsheet locally, in your browser. Nothing is uploaded."
  format="ods"
  direction="from-pdf"
  accept=".ods,application/vnd.oasis.opendocument.spreadsheet"
/>
