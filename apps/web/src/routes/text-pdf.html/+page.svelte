<script lang="ts">
  import ConversionTool from '$lib/ConversionTool.svelte';
</script>

<ConversionTool
  title="Text and Markdown to PDF"
  description="Create a clean PDF from TXT, RTF, or Markdown without sending the source anywhere."
  format="markdown"
  accept=".txt,.rtf,.md,.markdown,text/plain,text/markdown,application/rtf"
/>
