<script lang="ts">
  let {
    accept = '.pdf,application/pdf',
    multiple = true,
    label = 'Drop PDF files here or choose files',
    onchange,
    onreject,
  }: {
    accept?: string;
    multiple?: boolean;
    label?: string;
    onchange?: (files: FileList | null) => void;
    /**
     * Called when a drop carries more than one file and `multiple` is off.
     *
     * A drop never reaches the file input — the browser hands the drop zone
     * its own `FileList` — so the count cannot be reported through `onchange`
     * without silently truncating. This callback is how the caller learns
     * that the drop was refused, so it can explain the refusal instead of
     * leaving the user watching a drop that did nothing.
     *
     * Optional and off by default: a caller that passes no callback keeps
     * the previous behaviour, where a multi-file drop was truncated to the
     * first file.
     */
    onreject?: (reason: 'multiple') => void;
  } = $props();

  let isDragging = $state(false);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    const dropped = event.dataTransfer?.files ?? null;
    if (!multiple && dropped && dropped.length > 1) {
      onreject?.('multiple');
      return;
    }
    onchange?.(dropped);
  }
</script>

<div
  class:dragging={isDragging}
  class="drop-zone"
  role="region"
  aria-label="File upload"
  ondragover={(event) => {
    event.preventDefault();
    isDragging = true;
  }}
  ondragleave={() => (isDragging = false)}
  ondrop={handleDrop}
>
  <label>
    <span>{label}</span>
    <input
      type="file"
      {accept}
      {multiple}
      onchange={(event) => onchange?.(event.currentTarget.files)}
    />
  </label>
</div>

<style>
  .drop-zone {
    border: 1px dashed #1c1a1750;
    border-radius: var(--radius-panel, 8px);
    padding: 32px;
    text-align: center;
    transition:
      background 160ms ease,
      border-color 160ms ease;
  }

  .drop-zone.dragging {
    background: #ebe6de;
    border-color: #1c1a17;
  }

  label {
    color: var(--color-secondary-ink, #464442);
    cursor: pointer;
    display: grid;
    gap: 12px;
  }

  input {
    margin: auto;
  }
</style>
