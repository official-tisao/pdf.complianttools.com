<script lang="ts">
  /* global HTMLVideoElement */
  /**
   * Camera capture for the Scan to PDF tool.
   *
   * Permission is requested only by the "Start camera" gesture, never on mount
   * and never on page load — a scan page that asks for the camera before the
   * user has asked to scan anything is exactly the behaviour this project
   * forbids. The stream is stopped on Stop and on unmount.
   *
   * The engine stays DOM-free: it never calls getUserMedia and never touches a
   * canvas. This component owns the browser surface and hands the engine plain
   * bytes, so the same deskew code runs here and in a worker (§8.4).
   */
  import type { ScanFrame, ScanMediaStream } from '@pdf-complianttools/engine';
  import { stopScanCamera } from '@pdf-complianttools/engine/scan';

  let {
    onframes,
    onstatus,
  }: {
    /** Called with the accumulated frames whenever the list changes. */
    onframes: (frames: readonly ScanFrame[]) => void;
    onstatus: (message: string) => void;
  } = $props();

  let video: HTMLVideoElement | undefined = $state();
  let streaming = $state(false);
  let busy = $state(false);
  let deskewEnabled = $state(true);
  // The engine's own minimal seam type, not the DOM `MediaStream`: the engine
  // must not depend on DOM lib types, so the two are deliberately different.
  let stream: ScanMediaStream | undefined;

  // Ids, not array indices, so reordering or deleting a page can never make a
  // control point at the wrong frame.
  let pages = $state<{ id: number; frame: ScanFrame; degrees: number }[]>([]);
  let nextId = 0;

  function publish() {
    onframes(pages.map((entry) => entry.frame));
  }

  function stopStream() {
    if (stream) stopScanCamera(stream);
    stream = undefined;
    streaming = false;
  }

  async function startCamera() {
    busy = true;
    try {
      // Deep subpath, so opening the camera does not pull the PDF engine's
      // heavy modules into a route that has not assembled anything yet.
      const { requestScanCamera } = await import('@pdf-complianttools/engine/scan');
      stream = await requestScanCamera();
      if (video) {
        // The engine's seam type is structurally what `srcObject` accepts.
        video.srcObject = stream as unknown as MediaProvider;
        await video.play().catch(() => undefined);
      }
      streaming = true;
      onstatus('Camera is live. Frames stay on this device.');
    } catch (caught) {
      // PdfEngineError's message is its remedy, so a denied permission reaches
      // the user with an action attached rather than as a bare failure.
      onstatus(
        caught instanceof Error
          ? caught.message
          : 'The camera could not be started. You can still add image files.',
      );
    } finally {
      busy = false;
    }
  }

  function stopCamera() {
    stopStream();
    onstatus('Camera stopped.');
  }

  async function capture() {
    if (!video || !streaming) return;
    busy = true;
    try {
      const { width, height } = video;
      if (!width || !height) throw new Error('The camera has not produced a frame yet.');
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('This browser could not read a frame from the camera.');
      context.drawImage(video, 0, 0);

      let degrees = 0;
      if (deskewEnabled) {
        const { toGrayscale, deskewInWorker } =
          await import('@pdf-complianttools/engine/scan-deskew');
        const captured = context.getImageData(0, 0, width, height);
        const result = await deskewInWorker(toGrayscale(captured.data, width, height, 4));
        if (result.estimate.applied) {
          degrees = result.estimate.angleDegrees;
          // Paint the corrected page back through the browser's own encoder,
          // rather than shipping a PNG codec into this route.
          const corrected = result.image;
          const correctedData = context.createImageData(corrected.width, corrected.height);
          for (let index = 0; index < corrected.pixels.length; index += 1) {
            const value = corrected.pixels[index]!;
            const at = index * 4;
            correctedData.data[at] = value;
            correctedData.data[at + 1] = value;
            correctedData.data[at + 2] = value;
            correctedData.data[at + 3] = 255;
          }
          canvas.width = corrected.width;
          canvas.height = corrected.height;
          context.putImageData(correctedData, 0, 0);
        }
      }

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('The captured page could not be encoded as an image.');
      const frame: ScanFrame = {
        bytes: new Uint8Array(await blob.arrayBuffer()),
        format: 'png',
      };
      pages = [...pages, { id: nextId++, frame, degrees }];
      publish();
      onstatus(
        `Captured page ${pages.length}. ${degrees ? `Deskewed by ${degrees}°.` : 'No rotation correction was needed.'}`,
      );
    } catch (caught) {
      onstatus(caught instanceof Error ? caught.message : 'The frame could not be captured.');
    } finally {
      busy = false;
    }
  }

  function move(id: number, delta: number) {
    const index = pages.findIndex((entry) => entry.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= pages.length) return;
    const next = [...pages];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(target, 0, moved);
    pages = next;
    publish();
  }

  function remove(id: number) {
    pages = pages.filter((entry) => entry.id !== id);
    publish();
  }

  // Releasing the camera on unmount: a scan page that keeps the recording light
  // on after the user navigates away is a bug, not a feature.
  $effect(() => () => stopStream());
</script>

<div class="scan-capture">
  <h2>Capture with the camera</h2>
  <p class="note">
    The camera is requested only when you start it. Frames never leave this device.
  </p>
  {#if streaming}<video bind:this={video} playsinline muted aria-label="Camera preview"
    ></video>{/if}
  <div class="row">
    {#if streaming}
      <button onclick={capture} disabled={busy}>Capture page</button>
      <button onclick={stopCamera}>Stop camera</button>
    {:else}
      <button onclick={startCamera} disabled={busy}>Start camera</button>
    {/if}
    <label class="toggle"
      ><input type="checkbox" bind:checked={deskewEnabled} /> Auto-deskew captured pages</label
    >
  </div>
  {#if pages.length}
    <ol class="pages">
      {#each pages as entry, index (entry.id)}
        <li>
          <span>Page {index + 1}{entry.degrees ? ` (${entry.degrees}° corrected)` : ''}</span>
          <span class="controls">
            <button
              onclick={() => move(entry.id, -1)}
              disabled={index === 0}
              aria-label={`Move page ${index + 1} earlier`}>Earlier</button
            >
            <button
              onclick={() => move(entry.id, 1)}
              disabled={index === pages.length - 1}
              aria-label={`Move page ${index + 1} later`}>Later</button
            >
            <button onclick={() => remove(entry.id)} aria-label={`Remove page ${index + 1}`}
              >Remove</button
            >
          </span>
        </li>
      {/each}
    </ol>
  {/if}
</div>

<style>
  .scan-capture {
    border: 1px solid var(--color-hairline);
    border-radius: 16px;
    margin: 24px 0;
    max-width: 640px;
    padding: 20px;
  }
  h2 {
    font-size: 1.125rem;
    margin: 0 0 8px;
  }
  video {
    border-radius: 8px;
    margin: 12px 0;
    max-width: 100%;
    width: 320px;
  }
  .row {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .toggle {
    align-items: center;
    display: inline-flex;
    gap: 8px;
    margin: 0;
  }
  .pages {
    list-style: decimal;
    margin: 16px 0 0;
    padding-left: 24px;
  }
  .pages li {
    align-items: center;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    margin: 6px 0;
  }
  .controls {
    display: inline-flex;
    gap: 4px;
  }
  .controls button {
    margin: 0;
    padding: 4px 10px;
  }
</style>
