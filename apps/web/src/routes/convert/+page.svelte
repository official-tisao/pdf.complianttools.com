<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import { getAvailableFormats, getFormatRegistry } from '@pdf-complianttools/engine';
  import type { FormatId } from '@pdf-complianttools/engine';

  let files = $state<File[]>([]);
  let selectedFormat = $state<FormatId>('docx');
  let pastedHtml = $state('');
  let remoteUrl = $state('');
  let status = $state('');
  let downloadHref = $state<string | undefined>();
  let selectedCapability = $derived(
    getAvailableFormats('to-pdf').find((item) => item.id === selectedFormat),
  );
  const available = getAvailableFormats('to-pdf');
  const unavailable = getFormatRegistry().filter((item) => item.status === 'unavailable');

  function selectFiles(fileList: FileList | null) {
    files = fileList ? Array.from(fileList) : [];
    const extension = files[0]?.name.toLowerCase().match(/\.[^.]+$/u)?.[0];
    const match = available.find((item) => extension && item.extensions.includes(extension));
    if (match) selectedFormat = match.id;
    status =
      files.length > 0 ? `${files.length} file${files.length === 1 ? '' : 's'} ready locally.` : '';
  }

  async function convert() {
    const file = files[0];
    if (!file && !pastedHtml.trim()) {
      status = 'Choose a file or paste HTML first.';
      return;
    }
    if (remoteUrl.trim()) {
      status =
        'URL capture is Relay-gated. Paste the HTML here for local processing, or configure Relay explicitly.';
      return;
    }
    try {
      const engine = await import('@pdf-complianttools/engine');
      const input = file
        ? new Uint8Array(await file.arrayBuffer())
        : new TextEncoder().encode(pastedHtml);
      const result = await engine.convertToPdf(
        { bytes: input, format: file ? selectedFormat : 'html', fileName: file?.name },
        {},
      );
      const blob = new Blob([result.bytes.buffer as ArrayBuffer], { type: result.mimeType });
      downloadHref = URL.createObjectURL(blob);
      status = `${result.suggestedName} is ready. ${result.warnings.join(' ')}`;
    } catch (error) {
      status =
        error instanceof Error
          ? error.message
          : 'Conversion failed; the original file was not changed.';
    }
  }
</script>

<svelte:head>
  <title>Convert files to PDF locally</title>
  <meta
    name="description"
    content="Convert supported office, text, markup, archive, and image files to PDF locally in your browser."
  />
</svelte:head>

<section class="tool-page">
  <p class="eyebrow">CONVERT</p>
  <h1>Convert files locally</h1>
  <p class="lede">
    Only targets with a real browser-compatible adapter appear in the selector. Unsupported formats
    stay visible with a specific remedy.
  </p>

  <div class="panel">
    <FileDrop accept="*/*" onchange={selectFiles} />
    <label>
      Format
      <select bind:value={selectedFormat} aria-label="Input format">
        {#each available as capability (capability.id)}
          <option value={capability.id}>{capability.label}</option>
        {/each}
      </select>
    </label>
    <label>
      Paste HTML/CSS for local conversion
      <textarea bind:value={pastedHtml} rows="8" placeholder="<h1>Private, local HTML</h1>"
      ></textarea>
    </label>
    <label>
      Enter a URL <span>(Relay required)</span>
      <input bind:value={remoteUrl} type="url" placeholder="https://example.com" />
    </label>
    {#if selectedCapability}
      <p class="note">{selectedCapability.note}</p>
    {/if}
    <Button onclick={convert}>Convert locally</Button>
    {#if downloadHref}
      <a class="download" href={downloadHref} download>Download converted PDF</a>
    {/if}
    <p class="status" role="status">{status}</p>
  </div>

  <section class="unavailable" aria-labelledby="unavailable-heading">
    <h2 id="unavailable-heading">Not offered without a safe local reader</h2>
    <ul>
      {#each unavailable as capability (capability.id)}
        <li><strong>{capability.label}:</strong> {capability.unavailableReason}</li>
      {/each}
    </ul>
  </section>
</section>

<style>
  .tool-page {
    margin: auto;
    max-width: 960px;
    padding: 96px 40px 0;
  }
  .eyebrow {
    color: var(--color-muted);
    font-size: 0.875rem;
    letter-spacing: 0.12em;
  }
  h1 {
    font-size: clamp(2.5rem, 6vw, 4rem);
    letter-spacing: -0.05em;
    margin: 12px 0;
  }
  .lede,
  .note,
  .status {
    color: var(--color-muted);
    max-width: 720px;
  }
  .panel {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    display: grid;
    gap: 20px;
    margin-top: 32px;
    padding: 28px;
  }
  label {
    display: grid;
    gap: 8px;
    font-weight: 600;
  }
  select,
  input,
  textarea {
    border: 1px solid var(--color-hairline);
    border-radius: 10px;
    font: inherit;
    padding: 12px;
  }
  label span {
    color: var(--color-muted);
    font-size: 0.875rem;
    font-weight: 400;
  }
  .download {
    color: inherit;
    font-weight: 600;
  }
  .unavailable {
    margin-top: 56px;
  }
  li {
    margin: 10px 0;
  }
  @media (max-width: 767px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
  }
</style>
