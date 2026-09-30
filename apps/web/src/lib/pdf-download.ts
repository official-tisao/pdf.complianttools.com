/**
 * Shared plumbing for tool routes that export a PDF.
 *
 * Every wired route needs the same three things — read the chosen files as
 * bytes, hand them to an engine op, and offer the result as a download — and
 * each one used to reimplement the download half inline. Keeping it here means
 * a route file is only its own operation.
 *
 * The object URL is revoked after the click rather than immediately, because
 * revoking synchronously can cancel the download in some browsers before it
 * has started reading the blob.
 */

export type ToolValues = Record<string, string | number | boolean>;

export function readBytes(files: File[]): Promise<Uint8Array[]> {
  return Promise.all(files.map(async (file) => new Uint8Array(await file.arrayBuffer())));
}

export function firstBytes(files: File[]): Promise<Uint8Array> {
  return files[0]?.arrayBuffer().then((buffer) => new Uint8Array(buffer));
}

export function download(bytes: Uint8Array, name: string, type = 'application/pdf') {
  const url = globalThis.URL.createObjectURL(
    new globalThis.Blob([bytes.buffer as ArrayBuffer], { type }),
  );
  const anchor = globalThis.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  // Revoked on the next turn: revoking synchronously can cancel the download
  // before the browser has started reading the blob.
  globalThis.setTimeout(() => globalThis.URL.revokeObjectURL(url), 0);
}

/** Downloads several outputs without the last one replacing the others. */
export function downloadEach(outputs: Uint8Array[], nameFor: (index: number) => string) {
  outputs.forEach((bytes, index) => download(bytes, nameFor(index)));
}

/**
 * Reads a page selector option. The engine accepts `number[] | string` and
 * parses strings like `1-3,5` and `odd` itself, so the option value is passed
 * through unchanged rather than re-parsed here.
 */
export function selector(value: ToolValues['pages']): string | number[] {
  const text = String(value ?? '').trim();
  return text === '' ? '' : text;
}

export function numberOf(value: ToolValues[keyof ToolValues], fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function textOf(value: ToolValues[keyof ToolValues], fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function flag(value: ToolValues[keyof ToolValues]): boolean {
  return value === true || value === 'true';
}
