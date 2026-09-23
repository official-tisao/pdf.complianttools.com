<script lang="ts">
  let {
    accept = '.pdf,application/pdf',
    multiple = true,
    label = 'Drop PDF files here or choose files',
    onchange,
  }: {
    accept?: string;
    multiple?: boolean;
    label?: string;
    onchange?: (files: FileList | null) => void;
  } = $props();

  let isDragging = $state(false);

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    isDragging = false;
    onchange?.(event.dataTransfer?.files ?? null);
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
