import { jsPDF } from 'jspdf';

/** Create a blank PDF without relying on a browser or a network connection. */
export function createBlankPdf(width = 595.28, height = 841.89): Uint8Array {
  const document = new jsPDF({ unit: 'pt', format: [width, height], compress: true });
  return new Uint8Array(document.output('arraybuffer'));
}
