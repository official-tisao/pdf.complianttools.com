<script lang="ts">
  import AiDocumentTool from '$lib/AiDocumentTool.svelte';
</script>

<svelte:head>
  <title>Translate PDF — AI (T67, no local fallback)</title>
</svelte:head>

<AiDocumentTool
  kind="translate"
  title="Translate a PDF"
  description="There is no safe local translation fallback in this build. Without a configured provider the original document stays unchanged and no request is made."
/>
