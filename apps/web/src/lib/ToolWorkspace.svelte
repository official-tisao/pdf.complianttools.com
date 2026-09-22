<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import OptionPanel, { type OptionField } from '@pdf-complianttools/ui/OptionPanel.svelte';
  import PageGrid from '@pdf-complianttools/ui/PageGrid.svelte';
  import { inspectWithPdfJs } from '@pdf-complianttools/engine';

  let {
    title,
    eyebrow = 'PDF TOOL',
    description,
    options = [],
    actionLabel = 'Export PDF',
    onrun,
  }: {
    title: string;
    eyebrow?: string;
    description: string;
    options?: OptionField[];
    actionLabel?: string;
    onrun?: (files: File[], values: Record<string, string | number | boolean>) => Promise<void>;
  } = $props();
  let files = $state<File[]>([]);
  let values = $state<Record<string, string | number | boolean>>({});
  let seeded = false;
  let status = $state('');
  let pageCount = $state(0);

  $effect(() => {
    if (!seeded) {
      seeded = true;
      values = Object.fromEntries(options.map((field) => [field.key, field.value]));
    }
  });

  async function selectFiles(list: FileList | null) {
    files = list ? Array.from(list) : [];
    status = files.length
      ? `${files.length} file${files.length === 1 ? '' : 's'} ready locally.`
      : '';
    const first = files[0];
    if (!first) {
      pageCount = 0;
      return;
    }
    try {
      pageCount = (await inspectWithPdfJs(new Uint8Array(await first.arrayBuffer()))).pageCount;
    } catch (error) {
      pageCount = 0;
      status = error instanceof Error ? error.message : 'This PDF could not be previewed locally.';
    }
  }
  function changeOption(key: string, value: string | number | boolean) {
    values = { ...values, [key]: value };
  }
  async function runTool() {
    if (!onrun || files.length === 0) return;
    status = 'Working locally…';
    try {
      await onrun(files, values);
      status = 'Done. Your original files were not changed.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'The operation could not be completed.';
    }
  }
</script>

<section class="tool-page">
  <p class="eyebrow">{eyebrow}</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  <FileDrop accept=".pdf,application/pdf" onchange={selectFiles} />
  <div class="workspace">
    <div class="preview">
      <div class="toolbar">
        <span>{files.length} file{files.length === 1 ? '' : 's'} ready</span><Button
          disabled={files.length === 0 || !onrun}
          onclick={runTool}>{actionLabel}</Button
        >
      </div>
      {#if pageCount > 0}<PageGrid {pageCount} />{:else}<p class="empty">
          Page previews appear here after you select a PDF.
        </p>{/if}
    </div>
    {#if options.length > 0}<OptionPanel fields={options} onchange={changeOption} />{/if}
  </div>
  <p class="status" role="status" aria-live="polite">{status}</p>
</section>

<style>
  .tool-page {
    margin: auto;
    max-width: 1120px;
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
    max-width: 680px;
  }
  .workspace {
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1.5fr) minmax(280px, 0.8fr);
    margin-top: 32px;
  }
  .preview {
    background: color-mix(in srgb, var(--color-white) 55%, transparent);
    border: 1px solid var(--color-hairline);
    border-radius: var(--radius-panel);
    min-height: 240px;
    padding: 20px;
  }
  .toolbar {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin-bottom: 24px;
  }
  .toolbar span,
  .empty,
  .status {
    color: var(--color-muted);
  }
  @media (max-width: 767px) {
    .tool-page {
      padding-inline: 24px;
      padding-top: 72px;
    }
    .workspace {
      grid-template-columns: 1fr;
    }
  }
</style>
