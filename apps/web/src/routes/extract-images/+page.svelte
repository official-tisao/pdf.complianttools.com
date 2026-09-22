<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Extract embedded images"
  eyebrow="EXTRACT"
  description="Pull original JPEG or JPEG 2000 image streams from PDF page content without confusing them with rendered page screenshots."
  format="pdf-image"
  accept="application/pdf,.pdf"
  direction="from-pdf"
  available={false}
  unavailableReason="Embedded extraction is exposed in the engine API and is being wired to the browser download surface after stream-type preview support."
  note="Use the returned original-image collection, never a rendered page image, when this route is enabled."
/>
