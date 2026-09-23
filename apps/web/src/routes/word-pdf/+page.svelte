<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Word to PDF"
  description="Turn DOCX documents into readable PDFs locally, with structure and paragraphs preserved."
  format="docx"
  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
/>
