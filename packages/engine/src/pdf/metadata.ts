import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import type { PdfMetadata } from '../types.js';
import { PdfEngineError } from '../errors.js';

type MetadataOptions = Partial<PdfMetadata> & {
  readonly strip?: boolean;
};

async function load(bytes: Uint8Array, operation: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { ignoreEncryption: false });
  } catch {
    throw new PdfEngineError({
      kind: 'corrupt-structure',
      repairable: true,
      remedy: `The PDF could not be ${operation}. Re-export it from its source application and retry.`,
    });
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function xmpPacket(values: Readonly<Record<string, string>>): string {
  const fields = Object.entries(values)
    .map(([key, value]) => `<ct:${key}>${escapeXml(value)}</ct:${key}>`)
    .join('');
  return `<?xpacket begin="&#xFEFF;" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:ct="https://pdf.complianttools.com/xmp/1.0/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>${fields}</rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
}

function unescapeXml(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function readCustomXmp(bytes: Uint8Array): Record<string, string> {
  const source = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const packetStart = source.indexOf('<x:xmpmeta');
  if (packetStart < 0) return {};
  const packetEnd = source.indexOf('</x:xmpmeta>', packetStart);
  if (packetEnd < 0) return {};
  const packet = source.slice(packetStart, packetEnd + '</x:xmpmeta>'.length);
  const values: Record<string, string> = {};
  let cursor = 0;
  while (cursor < packet.length) {
    const openTag = packet.indexOf('<ct:', cursor);
    if (openTag < 0) break;
    const keyStart = openTag + 4;
    const keyEnd = packet.indexOf('>', keyStart);
    if (keyEnd < 0) break;
    const key = packet.slice(keyStart, keyEnd);
    if (!/^[A-Za-z][\w.-]*$/u.test(key)) {
      cursor = keyEnd + 1;
      continue;
    }
    const closeTag = `</ct:${key}>`;
    const valueEnd = packet.indexOf(closeTag, keyEnd + 1);
    if (valueEnd < 0) {
      cursor = keyEnd + 1;
      continue;
    }
    values[key] = unescapeXml(packet.slice(keyEnd + 1, valueEnd));
    cursor = valueEnd + closeTag.length;
  }
  return values;
}

export async function readPdfMetadata(bytes: Uint8Array): Promise<PdfMetadata> {
  const document = await load(bytes, 'read document metadata');
  const keywords = document.getKeywords() ?? '';
  const result = {
    title: document.getTitle() ?? '',
    author: document.getAuthor() ?? '',
    subject: document.getSubject() ?? '',
    keywords: keywords
      ? keywords
          .split(/,\s*/u)
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    creator: document.getCreator() ?? '',
    producer: document.getProducer() ?? '',
    customXmp: readCustomXmp(bytes),
  };
  const creationDate = document.getCreationDate();
  const modificationDate = document.getModificationDate();
  return {
    ...result,
    ...(creationDate ? { creationDate } : {}),
    ...(modificationDate ? { modificationDate } : {}),
  } satisfies PdfMetadata;
}

/** Update standard Info fields and a namespaced, uncompressed custom XMP packet locally. */
export async function setPdfMetadata(
  bytes: Uint8Array,
  options: MetadataOptions,
): Promise<Uint8Array> {
  const document = await load(bytes, 'edit metadata');
  if (options.strip) {
    document.setTitle('');
    document.setAuthor('');
    document.setSubject('');
    document.setKeywords([]);
    document.setCreator('');
    document.setProducer('');
  }
  if (options.title !== undefined) document.setTitle(options.title);
  if (options.author !== undefined) document.setAuthor(options.author);
  if (options.subject !== undefined) document.setSubject(options.subject);
  if (options.keywords !== undefined) document.setKeywords([options.keywords.join(', ')]);
  if (options.creator !== undefined) document.setCreator(options.creator);
  if (options.producer !== undefined) document.setProducer(options.producer);
  if (options.creationDate !== undefined) document.setCreationDate(options.creationDate);
  if (options.modificationDate !== undefined)
    document.setModificationDate(options.modificationDate);
  const customXmp = options.strip ? {} : (options.customXmp ?? {});
  if (Object.keys(customXmp).length > 0) {
    const stream = PDFRawStream.of(
      document.context.obj({ Type: 'Metadata', Subtype: 'XML' }),
      new TextEncoder().encode(xmpPacket(customXmp)),
    );
    document.catalog.set(PDFName.of('Metadata'), document.context.register(stream));
  }
  return document.save();
}
