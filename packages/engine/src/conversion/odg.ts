import { zipSync } from 'fflate';

const encoder = new TextEncoder();

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function createOdg(pages: readonly { lines: readonly string[] }[]): Uint8Array {
  const pageFrames = pages
    .map((page, index) => {
      const textLines = page.lines
        .map(
          (line, lineIdx) =>
            `<draw:frame draw:style-name="P${lineIdx + 1}" draw:name="fr${lineIdx + 1}" svg:width="6in" svg:height="0.4in" svg:x="0.5in" svg:y="${0.5 + lineIdx * 0.4}in"><draw:text-box><text:p text:style-name="T${lineIdx + 1}">${escapeXml(line)}</text:p></draw:text-box></draw:frame>`,
        )
        .join('');
      return `<draw:page draw:name="page${index + 1}" draw:style-name="dp${index + 1}">${textLines}</draw:page>`;
    })
    .join('');

  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:drawing>${pageFrames}</office:drawing></office:body></office:document-content>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3"><office:styles><draw:layer draw:name="Layout"/></office:styles></office:document-styles>`;

  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" office:version="1.3"><office:meta><meta:generator>pdf-complianttools/odg</meta:generator></office:meta></office:document-meta>`;

  const container = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.graphics"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;

  return zipSync({
    mimetype: encoder.encode('application/vnd.oasis.opendocument.graphics'),
    'META-INF/container.xml': encoder.encode(container),
    'content.xml': encoder.encode(content),
    'styles.xml': encoder.encode(styles),
    'meta.xml': encoder.encode(meta),
  });
}
