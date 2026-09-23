<script lang="ts">
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import { inspectStructure, type StructureReport } from '@pdf-complianttools/engine';
  let report = $state<StructureReport>();
  let status = $state('Choose a PDF to inspect locally.');
  async function inspect(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    try {
      report = await inspectStructure(new Uint8Array(await file.arrayBuffer()));
      status = 'Structure report ready. No document bytes left this page.';
    } catch (error) {
      status =
        error instanceof Error
          ? error.message
          : 'The PDF structure could not be inspected locally.';
    }
  }
</script>

<svelte:head
  ><title>PDF structure inspector</title><meta
    name="description"
    content="Inspect PDF pages, version, encryption, fonts, tags, and object counts locally."
  /></svelte:head
>
<section class="page">
  <p class="eyebrow">STRUCTURE</p>
  <h1>Structure inspector</h1>
  <p class="lede">
    Inspect page count, byte size, version, encryption, active content, fonts, and available tag
    nodes without uploading.
  </p>
  <FileDrop
    accept=".pdf,application/pdf"
    multiple={false}
    label="Choose a PDF to inspect"
    onchange={inspect}
  />
  {#if report}<div class="report">
      <dl>
        <div>
          <dt>Pages</dt>
          <dd>{report.pageCount}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{report.byteLength.toLocaleString()} bytes</dd>
        </div>
        <div>
          <dt>PDF version</dt>
          <dd>{report.version}</dd>
        </div>
        <div>
          <dt>Encrypted</dt>
          <dd>{report.encrypted ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt>JavaScript actions</dt>
          <dd>{report.hasJavaScript ? 'Present — not executed' : 'None detected'}</dd>
        </div>
        <div>
          <dt>Indirect objects</dt>
          <dd>{report.objectCount.toLocaleString()}</dd>
        </div>
      </dl>
      <h2>Fonts</h2>
      {#if report.fonts.length}<ul>
          {#each report.fonts as font (font.name)}<li>
              <code>{font.name}</code> — embedded: {font.embedded}
            </li>{/each}
        </ul>{:else}<p>No FontName entries were found in the raw object graph.</p>{/if}
      <h2>Tag tree</h2>
      {#if report.tagTree.length}<ul>
          {#each report.tagTree as tag, index (tag.role + index)}<li>{tag.role}</li>{/each}
        </ul>{:else}<p>
          No tagged structure nodes were detected by the bounded local inspector.
        </p>{/if}
    </div>{/if}
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
  .report p {
    color: var(--color-muted);
  }
  .report {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    margin-top: 24px;
    padding: 24px;
  }
  dl {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(3, 1fr);
  }
  dt {
    color: var(--color-muted);
    font-size: 0.875rem;
  }
  dd {
    font-weight: 600;
    margin: 4px 0 0;
  }
  h2 {
    font-size: 1.2rem;
    margin-top: 28px;
  }
  li + li {
    margin-top: 8px;
  }
  .status {
    min-height: 24px;
  }
  @media (max-width: 767px) {
    .page {
      padding-inline: 24px;
    }
    dl {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
