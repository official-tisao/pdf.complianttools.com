<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import { readPdfMetadata, setPdfMetadata, type PdfMetadata } from '@pdf-complianttools/engine';

  let file = $state<File>();
  let bytes = $state<Uint8Array>();
  let metadata = $state<PdfMetadata>();
  let keywords = $state('');
  let title = $state('');
  let author = $state('');
  let subject = $state('');
  let strip = $state(false);
  let downloadUrl = $state('');
  let status = $state('Choose a PDF to inspect and edit its metadata locally.');

  async function selectFile(files: FileList | null) {
    file = files?.[0];
    if (!file) return;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      metadata = await readPdfMetadata(bytes);
      title = metadata.title;
      author = metadata.author;
      subject = metadata.subject;
      keywords = metadata.keywords.join(', ');
      status = 'Metadata read locally. The source file remains unchanged.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Metadata could not be read locally.';
    }
  }

  async function save() {
    if (!bytes || !file) return;
    try {
      const result = await setPdfMetadata(bytes, {
        title,
        author,
        subject,
        keywords: keywords
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        strip,
        customXmp: metadata?.customXmp ?? {},
      });
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(
        new Blob([result.slice().buffer as ArrayBuffer], { type: 'application/pdf' }),
      );
      status = 'Updated PDF ready. Download it to keep the new metadata.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Metadata could not be written locally.';
    }
  }
</script>

<svelte:head
  ><title>PDF metadata editor</title><meta
    name="description"
    content="Read and edit PDF document information locally without uploading the file."
  /></svelte:head
>
<section class="page">
  <p class="eyebrow">DOCUMENT INFO</p>
  <h1>Metadata editor</h1>
  <p class="lede">
    Read and write standard Info fields, dates, and the app’s namespaced custom XMP locally.
    Strip-all is explicit.
  </p>
  <FileDrop
    accept=".pdf,application/pdf"
    multiple={false}
    label="Choose a PDF to inspect"
    onchange={selectFile}
  />
  {#if metadata}
    <div class="editor">
      <label>Title<input bind:value={title} /></label>
      <label>Author<input bind:value={author} /></label>
      <label>Subject<input bind:value={subject} /></label>
      <label>Keywords<input bind:value={keywords} placeholder="comma, separated" /></label>
      <label
        >Creation date<input
          value={metadata.creationDate?.toISOString().slice(0, 10) ?? 'not set'}
          readonly
        /></label
      >
      <label
        >Modification date<input
          value={metadata.modificationDate?.toISOString().slice(0, 10) ?? 'not set'}
          readonly
        /></label
      >
      <label class="checkbox"
        ><input type="checkbox" bind:checked={strip} /> Strip standard metadata before writing</label
      >
      <div class="actions">
        <Button onclick={save}>Write new PDF</Button>{#if downloadUrl}<a
            class="download"
            href={downloadUrl}
            download={`${file?.name.replace(/\.pdf$/iu, '') ?? 'document'}-metadata.pdf`}
            >Download updated PDF</a
          >{/if}
      </div>
    </div>
    <details>
      <summary>Custom XMP fields</summary>
      <pre>{JSON.stringify(metadata.customXmp, null, 2)}</pre>
      <p>
        Only the namespaced custom fields shown here are written. Arbitrary third-party XMP
        namespaces are preserved only when this reader can identify them.
      </p>
    </details>
  {/if}
  <p class="status" role="status" aria-live="polite">{status}</p>
</section>

<style>
  .page {
    margin: auto;
    max-width: 960px;
    padding: 72px 40px 0;
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
  .status,
  details p {
    color: var(--color-muted);
  }
  .editor {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    display: grid;
    gap: 16px;
    margin-top: 24px;
    padding: 24px;
  }
  .editor label {
    display: grid;
    gap: 8px;
  }
  .editor input:not([type='checkbox']) {
    border: 1px solid var(--color-hairline);
    border-radius: 6px;
    font: inherit;
    min-height: 36px;
    padding: 6px 8px;
  }
  .checkbox {
    align-items: center;
    display: flex !important;
  }
  .actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
  }
  .download {
    color: inherit;
    font-weight: 600;
  }
  .status {
    min-height: 24px;
  }
  details {
    margin-top: 16px;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
  }
  pre {
    overflow: auto;
  }
  @media (max-width: 767px) {
    .page {
      padding-inline: 24px;
    }
  }
</style>
