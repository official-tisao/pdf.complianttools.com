/**
 * Shared download helper. Copies into a fresh ArrayBuffer so a Uint8Array view
 * over a larger or shared buffer is not handed to Blob as-is.
 */
export function downloadBytes(bytes: Uint8Array, name: string, mime = 'application/pdf'): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy], { type: mime }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoked on the next tick: revoking synchronously after click() can cancel
  // the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
