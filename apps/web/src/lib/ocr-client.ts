import {
  getOcrModel,
  installOcrModel,
  type OcrModelStore,
  type OcrModelDescriptor,
} from '@pdf-complianttools/engine';

export async function downloadOcrModel(
  language: string,
  store: OcrModelStore,
  onProgress?: (loaded: number, total: number) => void,
): Promise<OcrModelDescriptor> {
  const selected = getOcrModel(language);
  if (!selected) throw new Error(`No approved OCR model is catalogued for ${language}.`);
  if (typeof navigator !== 'undefined' && !navigator.onLine)
    throw new Error(
      `${selected.label} OCR is offline and is not cached. Connect once, then explicitly download the model.`,
    );
  return installOcrModel(language, store, async () => {
    const response = await fetch(selected.sourceUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`The pinned model source returned HTTP ${response.status}.`);
    const total = Number(response.headers.get('content-length')) || selected.modelBytes;
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      onProgress?.(bytes.byteLength, total);
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      chunks.push(chunk.value);
      loaded += chunk.value.byteLength;
      onProgress?.(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  });
}
