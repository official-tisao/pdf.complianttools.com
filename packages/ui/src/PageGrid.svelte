<script lang="ts">
  import PageThumb from './PageThumb.svelte';

  let {
    pageCount = 0,
    selected = [],
    onselect,
    onreorder,
    reorderable = false,
    thumbnailLoader,
    thumbnailKey = '',
  }: {
    pageCount?: number;
    selected?: readonly number[];
    onselect?: (page: number, event?: MouseEvent) => void;
    /**
     * Two shapes, because two things reorder: a drag-and-drop drop emits the
     * complete new order (it already knows every page), while a keyboard
     * Alt+Arrow emits only the intent — "move page N to position T" — and the
     * parent owns the sequence. Emitting a full order from the keyboard would
     * force the grid to duplicate state it does not have.
     */
    onreorder?: (change: readonly number[] | { type: 'move'; page: number; to: number }) => void;
    /** Whether Alt+Arrow moves the focused page, rather than only selecting it. */
    reorderable?: boolean;
    /** Lazily renders only the pages in or near the visible viewport. */
    thumbnailLoader?: (page: number) => Promise<string>;
    /** Changes when the selected PDF changes, invalidating cached thumbnails. */
    thumbnailKey?: string;
  } = $props();
  let focused = $state(1);
  let scrollTop = $state(0);
  let draggedPage = $state<number | undefined>();
  let thumbnails = $state<Record<number, string>>({});
  let pendingThumbnails = $state<number[]>([]);
  let previousThumbnailKey = '';
  const rowHeight = 154;
  /**
   * Measured from the rendered grid rather than hardcoded. The stylesheet
   * drops to two columns under 600px, so a fixed count made ArrowUp/ArrowDown
   * move by the wrong number of pages on a phone — the most likely place a
   * keyboard user hits this component.
   */
  let gridElement = $state<HTMLDivElement | undefined>(undefined);
  const columns = $derived.by(() => {
    const rendered = gridElement?.querySelector('.visible');
    if (!rendered) return 4;
    const tracks = getComputedStyle(rendered).gridTemplateColumns;
    const measured = tracks.split(' ').filter(Boolean).length;
    return measured > 0 ? measured : 4;
  });
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

  // The grid is virtualized, so thumbnail work is demand-driven. The parent
  // owns pdf.js/pdfium and supplies a renderer; this package only coordinates
  // which visible pages need a small image.
  $effect(() => {
    const key = thumbnailKey;
    const loader = thumbnailLoader;
    const visible = visiblePages;
    if (key !== previousThumbnailKey) {
      previousThumbnailKey = key;
      thumbnails = {};
      pendingThumbnails = [];
    }
    if (!loader) return;
    for (const page of visible) {
      if (thumbnails[page] || pendingThumbnails.includes(page)) continue;
      pendingThumbnails = [...pendingThumbnails, page];
      void loader(page)
        .then((src) => {
          if (thumbnailKey === key) thumbnails = { ...thumbnails, [page]: src };
        })
        .catch(() => {
          // A failed preview must not make the PDF tool unusable; the numbered
          // fallback remains available and the page can still be opened.
        })
        .finally(() => {
          pendingThumbnails = pendingThumbnails.filter((pending) => pending !== page);
        });
    }
  });

  /**
   * Moves a page by `offset` places in the current order.
   *
   * The order is held by the parent, so this reconstructs the visible order
   * from `selected`-independent state: an unmodified grid is 1..pageCount, and
   * once the parent applies a reorder it passes the new order back down. Rather
   * than duplicate that state here, the grid emits only the *intent* — "move
   * page N by k" — through the same `onreorder` channel, and the parent owns
   * the sequence.
   */
  function moveFocused(by: number) {
    if (!reorderable) return;
    const target = Math.max(1, Math.min(pageCount, focused + by));
    if (target === focused) return;
    onreorder?.({ type: 'move', page: focused, to: target });
    focused = target;
  }

  function keydown(event: Event) {
    const key = (event as unknown as { key: string }).key;
    const alt = (event as unknown as { altKey: boolean }).altKey;

    // Alt+Arrow reorders, so the operation is reachable without a pointer.
    if (alt && reorderable && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
      event.preventDefault();
      moveFocused(
        key === 'ArrowLeft'
          ? -1
          : key === 'ArrowRight'
            ? 1
            : key === 'ArrowUp'
              ? -columns
              : columns,
      );
      return;
    }

    let next = focused;
    if (key === 'ArrowRight') next = Math.min(pageCount, focused + 1);
    if (key === 'ArrowLeft') next = Math.max(1, focused - 1);
    if (key === 'ArrowDown') next = Math.min(pageCount, focused + columns);
    if (key === 'ArrowUp') next = Math.max(1, focused - columns);
    if (key === 'Home') next = 1;
    if (key === 'End') next = pageCount;
    if (key === ' ' || key === 'Enter') {
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
  aria-activedescendant={`page-cell-${focused}`}
  tabindex="0"
  bind:this={gridElement}
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
          id={`page-cell-${page}`}
          aria-selected={isSelected(page)}
          tabindex="-1"
          draggable="true"
          ondragstart={() => (draggedPage = page)}
          ondragover={(event) => event.preventDefault()}
          ondrop={() => drop(page)}
        >
          <PageThumb
            pageNumber={page}
            selected={isSelected(page)}
            src={thumbnails[page]}
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
  /* The column count is also read by script so Alt+Arrow and the arrow keys
     agree with what is rendered; both must change together. */
  @media (max-width: 600px) {
    .visible {
      grid-template-columns: repeat(2, minmax(72px, 1fr));
    }
  }
</style>
