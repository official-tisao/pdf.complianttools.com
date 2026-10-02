<script lang="ts">
  /* global HTMLElement, KeyboardEvent */
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import { comparePdfs, type CompareReport } from '@pdf-complianttools/engine';

  let before = $state<File>();
  let after = $state<File>();
  let report = $state<CompareReport>();
  let status = $state('Choose the original and revised PDF locally.');
  let activeChange = $state(0);

  function takeBefore(files: FileList | null) {
    before = files?.[0];
    report = undefined;
  }
  function takeAfter(files: FileList | null) {
    after = files?.[0];
    report = undefined;
  }

  async function compare() {
    if (!before || !after) return;
    status = 'Comparing selectable text locally…';
    try {
      report = await comparePdfs(
        new Uint8Array(await before.arrayBuffer()),
        new Uint8Array(await after.arrayBuffer()),
      );
      activeChange = 0;
      status = report.text.identical
        ? 'No text changes found.'
        : `${report.text.changes.length} text change${report.text.changes.length === 1 ? '' : 's'} found.`;
    } catch (error) {
      status = error instanceof Error ? error.message : 'The PDFs could not be compared locally.';
    }
  }

  function moveChange(event: KeyboardEvent) {
    if (!report || report.text.identical || !report.text.changes.length) return;
    const current = Number((event.target as HTMLElement).dataset.changeIndex ?? activeChange);
    const last = report.text.changes.length - 1;
    let next: number;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = Math.min(last, current + 1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = Math.max(0, current - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    activeChange = next;
    document.getElementById(`change-${next}`)?.focus();
  }

  /** Hydration readiness — see the note in `ToolWorkspace.svelte`. */
  // NOT `$derived(true)`, which the linter prefers: a constant derived value
  // is also true during prerendering, so `data-hydrated="true"` would be
  // baked into the served HTML and the flag would mean nothing. Verified in
  // the build output — all 458 prerendered pages carry `data-hydrated="false"`.
  // The flag has to flip on the client, which needs an effect.
  // eslint-disable-next-line svelte/prefer-writable-derived
  let hydrated = $state(false);
  $effect(() => {
    hydrated = true;
  });
</script>

<section
  class="compare"
  aria-labelledby="compare-heading"
  data-hydrated={hydrated ? 'true' : 'false'}
>
  <p class="eyebrow">LOCAL DIFFERENCE REPORT</p>
  <h1 id="compare-heading">Compare PDFs</h1>
  <p class="lede">
    Text changes run locally. Pixel heatmaps use the injected local pdfium renderer when it is
    configured; this build reports that capability instead of silently substituting a different
    renderer.
  </p>
  <div class="inputs">
    <div>
      <h2>Original</h2>
      <FileDrop
        accept=".pdf,application/pdf"
        multiple={false}
        label="Choose original PDF"
        onchange={takeBefore}
      />{#if before}<p>{before.name}</p>{/if}
    </div>
    <div>
      <h2>Revised</h2>
      <FileDrop
        accept=".pdf,application/pdf"
        multiple={false}
        label="Choose revised PDF"
        onchange={takeAfter}
      />{#if after}<p>{after.name}</p>{/if}
    </div>
  </div>
  <Button disabled={!before || !after} onclick={compare}>Compare locally</Button>
  <p class="status" role="status" aria-live="polite">{status}</p>
  {#if report}
    <section class="report" aria-labelledby="report-heading">
      <div class="report-header">
        <h2 id="report-heading">Difference report</h2>
        <span
          >{report.text.pagesCompared} page{report.text.pagesCompared === 1 ? '' : 's'} compared</span
        >
      </div>
      <p class="capability">
        Pixel comparison: <strong
          >{report.pixelCapability === 'available'
            ? 'available'
            : 'local pdfium renderer required'}</strong
        >. Text comparison is complete and does not require a network or model.
      </p>
      {#if report.text.identical}<p>No added, removed, replaced, or moved lines were found.</p>
      {:else}<ul class="changes" role="listbox" aria-label="Text changes" onkeydown={moveChange}>
          {#each report.text.changes as change, index (change.pageNumber + '-' + change.lineNumber + '-' + index)}<li
              id={`change-${index}`}
              data-change-index={index}
              role="option"
              aria-selected={activeChange === index}
              tabindex={activeChange === index ? 0 : -1}
            >
              <span class={`kind ${change.kind}`}>{change.kind}</span><span
                >page {change.pageNumber}, line {change.lineNumber}: {change.text}</span
              >{#if change.counterpart}<small> counterpart: {change.counterpart}</small>{/if}
            </li>{/each}
        </ul>{/if}
      {#if report.pixel}<ul class="pixel-list" aria-label="Pixel difference pages">
          {#each report.pixel as page (page.pageNumber)}<li>
              Page {page.pageNumber}: {page.changedPixels.toLocaleString()} changed pixels ({(
                page.ratio * 100
              ).toFixed(2)}%).
            </li>{/each}
        </ul>{/if}
    </section>
  {/if}
</section>

<style>
  .compare {
    margin: auto;
    max-width: 1120px;
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
  h2 {
    font-size: 1.2rem;
  }
  .lede,
  .status,
  .capability,
  .inputs p,
  .report-header span {
    color: var(--color-muted);
  }
  .inputs {
    display: grid;
    gap: 20px;
    grid-template-columns: 1fr 1fr;
    margin: 28px 0;
  }
  .inputs > div,
  .report {
    background: var(--color-white);
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    padding: 20px;
  }
  .status {
    min-height: 24px;
  }
  .report {
    margin-top: 24px;
  }
  .report-header {
    align-items: baseline;
    display: flex;
    justify-content: space-between;
  }
  .changes,
  .pixel-list {
    display: grid;
    gap: 10px;
    padding-left: 20px;
  }
  .changes li {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    outline: none;
    padding: 6px;
  }
  .changes li:focus-visible {
    box-shadow: 0 0 0 3px var(--color-focus, #6a8f72);
    border-radius: 6px;
  }
  .changes small {
    color: var(--color-muted);
    flex-basis: 100%;
  }
  .kind {
    border-radius: 999px;
    font-size: 0.8rem;
    padding: 2px 8px;
    text-transform: capitalize;
  }
  .added {
    background: #d3e2cf;
  }
  .removed {
    background: #e3ded0;
  }
  .replaced {
    background: #d6e0ea;
  }
  .moved {
    background: #ebe6de;
  }
  @media (max-width: 767px) {
    .compare {
      padding-inline: 24px;
    }
    .inputs {
      grid-template-columns: 1fr;
    }
  }
</style>
