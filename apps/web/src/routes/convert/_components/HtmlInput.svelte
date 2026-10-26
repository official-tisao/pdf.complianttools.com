<!--
  Source-preservation only: HTML/CSS input pipeline retained for future expansion.
  Not rendered by default; re-activate via route or tab when needed.
-->
<script lang="ts">
  let { pastedHtml }: { pastedHtml: string } = $props();
  // Bidirectional bind preserved via oninput so parent state updates when source activates
</script>

<label>
  Paste HTML/CSS for local conversion
  <textarea bind:value={pastedHtml} rows="8" placeholder="<h1>Private, local HTML</h1>"></textarea>
</label>
