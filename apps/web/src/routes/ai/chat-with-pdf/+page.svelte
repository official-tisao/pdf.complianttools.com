<script lang="ts">
  import AiDocumentTool from '$lib/AiDocumentTool.svelte';
</script>

<svelte:head>
  <title>Chat with PDF — AI (local first, BYOK)</title>
</svelte:head>

<AiDocumentTool
  kind="chat"
  title="Chat with a PDF"
  description="Search extracted PDF text locally first. Open-ended questions can be sent to your configured provider only after an explicit, cost-estimated confirmation."
/>
