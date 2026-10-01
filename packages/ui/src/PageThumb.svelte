<script lang="ts">
  let {
    pageNumber,
    selected = false,
    label = `Page ${pageNumber}`,
    src = '',
    onclick,
  }: {
    pageNumber: number;
    selected?: boolean;
    label?: string;
    src?: string;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<button class:selected type="button" aria-label={label} aria-pressed={selected} {onclick}>
  <span class="page-number" aria-hidden="true">{pageNumber}</span>
  <span class="preview" aria-hidden="true">
    {#if src}<img {src} alt="" />{/if}
  </span>
</button>

<style>
  button {
    align-items: center;
    aspect-ratio: 0.707;
    background: #fff;
    border: 1px solid var(--color-hairline, #1c1a171a);
    border-radius: var(--radius-panel, 8px);
    color: var(--color-secondary-ink, #464442);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    justify-content: center;
    min-width: 72px;
    overflow: hidden;
    padding: 8px;
  }

  .page-number {
    flex: 0 0 auto;
    line-height: 1;
  }

  .preview {
    align-items: center;
    background: #fafafa;
    border: 1px solid var(--color-hairline, #1c1a171a);
    border-radius: 4px;
    display: flex;
    flex: 1 1 auto;
    justify-content: center;
    min-height: 0;
    overflow: hidden;
    padding: 3px;
    width: 100%;
  }

  img {
    display: block;
    height: auto;
    max-height: 100%;
    max-width: 100%;
    object-fit: contain;
  }

  button.selected {
    border: 2px solid var(--color-ink, #1c1a17);
    color: var(--color-ink, #1c1a17);
  }

  button:focus-visible {
    outline: 3px solid var(--color-focus, #1c1a17);
    outline-offset: 3px;
  }
</style>
