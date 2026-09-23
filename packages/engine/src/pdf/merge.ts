import { PDFDocument } from 'pdf-lib';

export async function mergePdfBuffers(sources: readonly Uint8Array[]): Promise<Uint8Array> {
  if (sources.length === 0) {
    throw new Error('At least one PDF source is required.');
  }

  const output = await PDFDocument.create();
  for (const source of sources) {
    const input = await PDFDocument.load(source, { ignoreEncryption: false });
    const pages = await output.copyPages(input, input.getPageIndices());
    for (const page of pages) output.addPage(page);
  }
  return output.save();
}
