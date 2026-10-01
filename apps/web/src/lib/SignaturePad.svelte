<script lang="ts">
  /* global CanvasRenderingContext2D, HTMLCanvasElement, PointerEvent */

  let {
    label,
    clearLabel,
    help,
    onchange,
  }: {
    label: string;
    clearLabel: string;
    help: string;
    onchange: (bytes: Uint8Array | undefined) => void;
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  let drawing = false;
  let hasInk = $state(false);

  function context(): CanvasRenderingContext2D | undefined {
    const value = canvas?.getContext('2d');
    if (!value) return undefined;
    value.lineCap = 'round';
    value.lineJoin = 'round';
    value.lineWidth = 3;
    value.strokeStyle = '#18211b';
    return value;
  }

  function point(event: PointerEvent): { x: number; y: number } {
    const bounds = canvas!.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas!.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas!.height,
    };
  }

  function start(event: PointerEvent) {
    if (!canvas) return;
    drawing = true;
    canvas.setPointerCapture(event.pointerId);
    const position = point(event);
    const value = context();
    value?.beginPath();
    value?.moveTo(position.x, position.y);
    hasInk = true;
  }

  function move(event: PointerEvent) {
    if (!drawing) return;
    const position = point(event);
    context()?.lineTo(position.x, position.y);
    context()?.stroke();
  }

  function finish() {
    if (!drawing) return;
    drawing = false;
    void exportPng();
  }

  async function exportPng() {
    if (!canvas || !hasInk) {
      onchange(undefined);
      return;
    }
    const blob = await new Promise<Blob | null>((resolve) => canvas!.toBlob(resolve, 'image/png'));
    onchange(blob ? new Uint8Array(await blob.arrayBuffer()) : undefined);
  }

  function clear() {
    const value = canvas?.getContext('2d');
    if (value && canvas) value.clearRect(0, 0, canvas.width, canvas.height);
    hasInk = false;
    onchange(undefined);
  }
</script>

<div class="signature-pad" role="group" aria-label={label}>
  <p class="field-label">{label}</p>
  <p class="help">{help}</p>
  <canvas
    bind:this={canvas}
    width="640"
    height="180"
    aria-hidden="true"
    onpointerdown={start}
    onpointermove={move}
    onpointerup={finish}
    onpointercancel={finish}
  ></canvas>
  <button type="button" onclick={clear} disabled={!hasInk}>{clearLabel}</button>
</div>

<style>
  .signature-pad {
    display: grid;
    gap: 8px;
    margin: 20px 0;
    max-width: 640px;
  }
  .field-label {
    font-weight: 600;
    margin: 0;
  }
  .help {
    color: var(--color-muted);
    margin: 0;
  }
  canvas {
    background: #fff;
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    height: 180px;
    max-width: 100%;
    touch-action: none;
    width: 640px;
  }
</style>
