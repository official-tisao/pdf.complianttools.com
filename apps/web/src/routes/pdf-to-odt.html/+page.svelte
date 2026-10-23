<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<!--
  The `.html` alias of /pdf-to-odt.

  Both URLs are served: some visitors arrive from a link, a bookmark or a search
  result that carries the file extension, and a 404 there loses a tool the site
  does ship. The props are a copy of the canonical route's, so the two pages
  offer the same conversion.
-->
<ConversionTool
  title="PDF to OpenDocument Text"
  description="Turn PDF pages into OpenDocument Text locally, in your browser. Nothing is uploaded."
  format="odt"
  direction="from-pdf"
  accept=".odt,application/vnd.oasis.opendocument.text"
/>
