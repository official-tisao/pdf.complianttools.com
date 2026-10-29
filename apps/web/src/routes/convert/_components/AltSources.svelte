<!--
  Source-preservation only: Alternate source inputs (HTML paste + URL/Relay) isolated
  for future route expansion. Not mounted on /convert by design to keep PDF pipeline clean.
-->
<script lang="ts">
  import HtmlInput from './HtmlInput.svelte';
  import UrlInput from './UrlInput.svelte';

  let pastedHtml = $state('');
  let remoteUrl = $state('');
</script>

<section class="alt-sources" aria-label="Alternative source inputs">
  <h2>Alternative inputs (future expansion)</h2>
  <HtmlInput bind:pastedHtml />
  <UrlInput bind:remoteUrl />
</section>
