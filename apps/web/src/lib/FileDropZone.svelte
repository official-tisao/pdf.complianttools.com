<script lang="ts">
  /* global ClipboardEvent, HTMLInputElement */
  /**
   * Wraps a real <input type="file"> and layers drag, drop, and paste on top of
   * it at hydration, per README §7.6. The native input is always rendered and
   * always usable, so this is an enhancement rather than the only way in — a
   * keyboard or assistive-technology user never depends on the drop target.
   */
  let {
    label,
    accept,
    multiple = false,
    onfiles,
    describedBy,
  }: {
    label: string;
    accept?: string;
    multiple?: boolean;
    onfiles: (files: File[]) => void;
    describedBy?: string;
  } = $props();

  let dragging = $state(false);
  // Drag events fire for every descendant, so a counter avoids the flicker of
  // dragging over a child element clearing the highlight on leave.
  let depth = 0;

  function accept_(list: FileList | null | undefined) {
    if (!list || list.length === 0) return;
    onfiles(multiple ? Array.from(list) : [list[0] as File]);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    depth = 0;
    dragging = false;
    accept_(event.dataTransfer?.files);
  }

  function onDragOver(event: DragEvent) {
    // Without preventDefault the browser refuses the drop entirely.
    event.preventDefault();
    depth += 1;
    dragging = true;
  }

  function onDragLeave() {
    depth = Math.max(0, depth - 1);
    if (depth === 0) dragging = false;
  }

  function onPaste(event: ClipboardEvent) {
    const pasted = Array.from(event.clipboardData?.files ?? []);
    if (pasted.length > 0) {
      event.preventDefault();
      onfiles(multiple ? pasted : [pasted[0] as File]);
    }
  }
</script>

<label
  class="dropzone"
  class:dragging
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
  onpaste={onPaste}
>
  <span class="dropzone-label">{label}</span>
  <input
    type="file"
    {accept}
    {multiple}
    aria-describedby={describedBy}
    onchange={(event) => accept_((event.currentTarget as HTMLInputElement).files)}
  />
  <span class="dropzone-hint">Drop or paste a file here, or choose one.</span>
</label>

<style>
  .dropzone {
    border: 1px dashed var(--color-hairline);
    border-radius: 8px;
    display: grid;
    gap: 8px;
    margin: 16px 0;
    max-width: 520px;
    padding: 12px;
  }
  /* Set by the user agent on :focus-visible, not this element's own hover. */
  .dropzone:focus-within {
    border-color: var(--color-ink);
    outline: 2px solid var(--color-ink);
    outline-offset: 2px;
  }
  .dropzone.dragging {
    background: color-mix(in srgb, var(--color-ink) 8%, transparent);
    border-style: solid;
  }
  .dropzone-label {
    font-weight: 500;
  }
  .dropzone-hint {
    color: var(--color-muted);
    font-size: 0.875rem;
  }
  input {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    font: inherit;
    padding: 12px;
  }
</style>
