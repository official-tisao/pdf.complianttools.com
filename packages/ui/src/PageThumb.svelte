<script lang="ts">
  let {
    pageNumber,
    selected = false,
    label = `Page ${pageNumber}`,
    onclick,
  }: {
    pageNumber: number;
    selected?: boolean;
    label?: string;
    onclick?: (event: MouseEvent) => void;
  } = $props();
</script>

<button class:selected type="button" aria-label={label} aria-pressed={selected} {onclick}>
  <span aria-hidden="true">{pageNumber}</span>
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
    justify-content: center;
    min-width: 72px;
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
