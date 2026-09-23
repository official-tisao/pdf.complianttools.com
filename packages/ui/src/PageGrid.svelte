<script lang="ts">
  import PageThumb from './PageThumb.svelte';

  let {
    pageCount = 0,
    selected = [],
    onselect,
    onreorder,
  }: {
    pageCount?: number;
    selected?: readonly number[];
    onselect?: (page: number, event?: MouseEvent) => void;
    onreorder?: (order: readonly number[]) => void;
  } = $props();
  let focused = $state(1);
  let scrollTop = $state(0);
  let draggedPage = $state<number | undefined>();
  const rowHeight = 154;
  const columns = 4;
  const visibleStart = $derived(
    Math.max(1, Math.floor(scrollTop / rowHeight) * columns - columns * 2 + 1),
  );
  const visibleEnd = $derived(Math.min(pageCount, visibleStart + 32));
  const visiblePages = $derived(
    Array.from(
      { length: Math.max(0, visibleEnd - visibleStart + 1) },
      (_, index) => visibleStart + index,
    ),
  );
  const isSelected = (page: number) => selected.includes(page);

  function keydown(event: Event) {
    const key = (event as unknown as { key: string }).key;
    let next = focused;
    if (key === 'ArrowRight') next = Math.min(pageCount, focused + 1);
    if (key === 'ArrowLeft') next = Math.max(1, focused - 1);
    if (key === 'ArrowDown') next = Math.min(pageCount, focused + columns);
    if (key === 'ArrowUp') next = Math.max(1, focused - columns);
    if (key === ' ') {
      event.preventDefault();
      onselect?.(focused, event as unknown as MouseEvent);
      return;
    }
    if (next !== focused) {
      event.preventDefault();
      focused = next;
    }
  }

  function drop(target: number) {
    if (!draggedPage || draggedPage === target) return;
    const order = Array.from({ length: pageCount }, (_, index) => index + 1).filter(
      (page) => page !== draggedPage,
    );
    order.splice(Math.max(0, order.indexOf(target)), 0, draggedPage);
    onreorder?.(order);
    draggedPage = undefined;
  }
</script>

<div
  class="grid"
  role="grid"
  aria-label="PDF pages"
  tabindex="0"
  onkeydown={keydown}
  onscroll={(event) => (scrollTop = (event.currentTarget as { scrollTop: number }).scrollTop)}
>
  <div class="spacer" style={`height: ${Math.ceil(pageCount / columns) * rowHeight}px`}>
    <div
      class="visible"
      style={`transform: translateY(${Math.floor((visibleStart - 1) / columns) * rowHeight}px)`}
    >
      {#each visiblePages as page (page)}
        <div
          class="cell"
          role="gridcell"
          tabindex="-1"
          draggable="true"
          ondragstart={() => (draggedPage = page)}
          ondragover={(event) => event.preventDefault()}
          ondrop={() => drop(page)}
        >
          <PageThumb
            pageNumber={page}
            selected={isSelected(page)}
            onclick={(event) => {
              focused = page;
              onselect?.(page, event);
            }}
            label={`Page ${page}`}
          />
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .grid {
    border: 1px solid var(--color-hairline, #1c1a171a);
    border-radius: var(--radius-panel, 8px);
    max-height: 520px;
    overflow: auto;
    padding: 4px;
  }
  .grid:focus-visible {
    outline: 3px solid var(--color-focus, #1c1a17);
    outline-offset: 4px;
  }
  .spacer {
    position: relative;
  }
  .visible {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(4, minmax(72px, 1fr));
    left: 0;
    padding: 4px;
    position: absolute;
    right: 0;
    top: 0;
  }
  .cell {
    min-width: 0;
  }
  @media (max-width: 600px) {
    .visible {
      grid-template-columns: repeat(2, minmax(72px, 1fr));
    }
  }
</style>
