<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';

  let {
    title,
    eyebrow = 'CONVERT',
    description,
    format,
    direction = 'to-pdf',
    accept,
    available = true,
    unavailableReason = '',
    note = '',
  }: {
    title: string;
    eyebrow?: string;
    description: string;
    format: string;
    direction?: 'to-pdf' | 'from-pdf';
    accept: string;
    available?: boolean;
    unavailableReason?: string;
    note?: string;
  } = $props();

  let files = $state<File[]>([]);
  let busy = $state(false);
  let message = $state('');
  let error = $state('');

  function selectFiles(fileList: FileList | null) {
    files = fileList ? Array.from(fileList) : [];
    message = '';
    error = '';
  }

  async function convert() {
    const file = files[0];
    if (!file || !available) return;
    busy = true;
    message = '';
    error = '';
    try {
      const { convertFile } = await import('@pdf-complianttools/engine');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await convertFile(direction, format as never, bytes, { fileName: file.name });
      const url = URL.createObjectURL(
        new Blob([result.bytes.buffer as ArrayBuffer], { type: result.mimeType }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.suggestedName;
      link.click();
      URL.revokeObjectURL(url);
      message =
        result.warnings.length > 0
          ? result.warnings.join(' ')
          : 'Conversion complete. Your file stayed local.';
    } catch (caught) {
      error =
        caught instanceof Error ? caught.message : 'The conversion could not be completed locally.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head>
  <title>{title} locally</title>
  <meta name="description" content={description} />
</svelte:head>

<section class="tool-page">
  <p class="eyebrow">{eyebrow}</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  <div class="trust-note"><strong>Local-first.</strong> Nothing is uploaded for this path.</div>
  {#if available}
    <FileDrop
      {accept}
      onchange={selectFiles}
      label={`Drop a file here or choose ${format.toUpperCase()} input`}
    />
    <div class="toolbar">
      <span>{files.length} file{files.length === 1 ? '' : 's'} ready</span>
      <Button disabled={files.length === 0 || busy} onclick={convert}
        >{busy ? 'Converting...' : 'Convert locally'}</Button
      >
    </div>
    {#if message}<p class="message" role="status">{message}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {:else}
    <div class="unavailable" role="status">
      <h2>Not available in the clean local build</h2>
      <p>{unavailableReason}</p>
      <p>{note}</p>
      <p>The original file is kept on your device. Choose the suggested export path and retry.</p>
    </div>
  {/if}
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
  .lede {
    color: var(--color-muted);
    font-size: 1.125rem;
    max-width: 640px;
  }
  .trust-note,
  .unavailable {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    margin: 28px 0;
    padding: 20px 24px;
  }
  .trust-note {
    color: var(--color-secondary-ink);
  }
  .toolbar {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin-top: 20px;
  }
  .message {
    color: #2f6333;
  }
  .error {
    color: #9a2d24;
  }
  .unavailable {
    border: 1px solid var(--color-hairline);
  }
  .unavailable h2 {
    margin-top: 0;
  }
  .unavailable p {
    color: var(--color-muted);
  }

  @media (max-width: 767px) {
    .tool-page {
      padding: 80px 24px 0;
    }
    .toolbar {
      align-items: flex-start;
      flex-direction: column;
      gap: 16px;
    }
  }

  @media (max-width: 479px) {
    .tool-page {
      padding-inline: 16px;
    }
  }
</style>
