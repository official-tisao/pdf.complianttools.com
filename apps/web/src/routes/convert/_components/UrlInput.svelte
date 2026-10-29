<!--
  Source-preservation only: URL/Relay pipeline retained for future expansion.
  Not rendered by default; requires Relay configuration when activated.
-->
<script lang="ts">
  let { remoteUrl = $bindable() }: { remoteUrl: string } = $props();
</script>

<label>
  Enter a URL <span>(Relay required)</span>
  <input bind:value={remoteUrl} type="url" placeholder="https://example.com" />
</label>
