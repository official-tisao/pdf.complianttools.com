import { Certificate, ContentInfo, CryptoEngine, SignedData, SignedDataVerifyError } from 'pkijs';
import type { SignatureVerification, SignatureVerificationOptions } from './editing-types.js';

type SignatureRecord = {
  byteRange: number[];
  cmsPresent: boolean;
  cmsBytes?: Uint8Array;
  signedBytes?: Uint8Array;
};

type SignatureInspection = {
  record: SignatureRecord;
  status: 'verified' | 'invalid' | 'unsupported' | 'untrusted';
  remedy: string;
};

const HEX = /^[0-9a-f]+$/iu;
const INTEGER_LIST = /^\s*-?\d+(?:\s+-?\d+)*\s*$/u;

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

function decodeHex(value: string): Uint8Array | undefined {
  const compact = value.replace(/\s+/gu, '');
  if (!compact || compact.length % 2 !== 0 || !HEX.test(compact)) return undefined;
  const bytes = new Uint8Array(compact.length / 2);
  for (let index = 0; index < bytes.length; index += 1)
    bytes[index] = Number.parseInt(compact.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function parseByteRange(raw: string): number[] {
  if (!INTEGER_LIST.test(raw))
    return raw
      .trim()
      .split(/\s+/u)
      .map(() => Number.NaN);
  return raw.trim().split(/\s+/u).map(Number);
}

function isValidByteRange(
  byteRange: readonly number[],
  byteLength: number,
  contentsStart: number | undefined,
  contentsEnd: number | undefined,
): boolean {
  if (
    byteRange.length !== 4 ||
    byteRange.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    byteRange[0] !== 0
  )
    return false;
  const [firstStart, firstLength, secondStart, secondLength] = byteRange;
  if (
    firstStart === undefined ||
    firstLength === undefined ||
    secondStart === undefined ||
    secondLength === undefined
  )
    return false;
  if (
    firstStart + firstLength > byteLength ||
    secondStart > byteLength ||
    secondStart + secondLength > byteLength ||
    firstLength > secondStart ||
    secondLength === 0
  )
    return false;
  if (contentsStart === undefined || contentsEnd === undefined) return true;
  return firstLength <= contentsStart && secondStart >= contentsEnd;
}

function inspectPdfSignatures(
  bytes: Uint8Array,
):
  | { kind: 'unsigned' }
  | { kind: 'malformed-byte-range'; signatures: SignatureRecord[] }
  | { kind: 'ready'; signatures: SignatureRecord[] } {
  const source = new TextDecoder('latin1').decode(bytes);
  const signatures: SignatureRecord[] = [];
  for (let cursor = 0; cursor < source.length;) {
    const marker = source.indexOf('/ByteRange', cursor);
    if (marker === -1) break;
    const open = source.indexOf('[', marker + '/ByteRange'.length);
    const close = open === -1 ? -1 : source.indexOf(']', open + 1);
    if (open === -1 || close === -1) {
      signatures.push({ byteRange: [], cmsPresent: false });
      return { kind: 'malformed-byte-range', signatures };
    }
    const byteRange = parseByteRange(source.slice(open + 1, close));
    const objectEnd = source.indexOf('endobj', close + 1);
    const nextByteRange = source.indexOf('/ByteRange', close + 1);
    const boundary =
      [objectEnd, nextByteRange]
        .filter((value) => value >= 0)
        .sort((left, right) => left - right)[0] ?? source.length;
    const contentsMarker = source.indexOf('/Contents', close + 1);
    const contentsOpen =
      contentsMarker >= 0 && contentsMarker < boundary
        ? source.indexOf('<', contentsMarker + '/Contents'.length)
        : -1;
    const contentsClose = contentsOpen >= 0 ? source.indexOf('>', contentsOpen + 1) : -1;
    const encodedContents =
      contentsOpen >= 0 && contentsClose >= 0 && contentsClose < boundary
        ? source.slice(contentsOpen + 1, contentsClose)
        : undefined;
    const cmsBytes = encodedContents === undefined ? undefined : decodeHex(encodedContents);
    const contentsStart = contentsOpen >= 0 ? contentsOpen + 1 : undefined;
    const contentsEnd = contentsClose >= 0 ? contentsClose : undefined;
    const cmsPresent = encodedContents !== undefined && encodedContents.trim().length > 0;
    const record: SignatureRecord = { byteRange, cmsPresent };
    if (cmsBytes) record.cmsBytes = cmsBytes;
    if (isValidByteRange(byteRange, bytes.length, contentsStart, contentsEnd)) {
      const firstStart = byteRange[0] ?? 0;
      const firstLength = byteRange[1] ?? 0;
      const secondStart = byteRange[2] ?? 0;
      const secondLength = byteRange[3] ?? 0;
      record.signedBytes = new Uint8Array([
        ...bytes.slice(firstStart, firstStart + firstLength),
        ...bytes.slice(secondStart, secondStart + secondLength),
      ]);
    } else {
      signatures.push(record);
      return { kind: 'malformed-byte-range', signatures };
    }
    signatures.push(record);
    cursor = close + 1;
  }
  return signatures.length === 0 ? { kind: 'unsigned' } : { kind: 'ready', signatures };
}

function verificationCode(error: unknown): number | undefined {
  if (error instanceof SignedDataVerifyError) return error.code;
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = error.code;
  return typeof code === 'number' ? code : undefined;
}

function isUnsupportedCmsError(error: unknown): boolean {
  return [1, 2, 3, 7, 8, 9, 10].includes(verificationCode(error) ?? -1);
}

async function inspectCms(
  record: SignatureRecord,
  trustAnchors: readonly Uint8Array[],
): Promise<SignatureInspection> {
  const unsupported = (remedy: string): SignatureInspection => ({
    record,
    status: 'unsupported',
    remedy,
  });
  if (!record.cmsBytes || !record.signedBytes)
    return unsupported(
      'A signature field is present, but its CMS/PKCS#7 Contents is missing or not valid hexadecimal.',
    );
  if (!globalThis.crypto?.subtle)
    return unsupported(
      'Web Crypto is unavailable, so the CMS signature cannot be verified locally.',
    );
  let contentInfo: ContentInfo;
  let signedData: SignedData;
  try {
    contentInfo = ContentInfo.fromBER(asArrayBuffer(record.cmsBytes));
    if (contentInfo.contentType !== ContentInfo.SIGNED_DATA || !contentInfo.content)
      return unsupported(
        'The signature Contents is not a supported detached CMS SignedData object.',
      );
    signedData = new SignedData({ schema: contentInfo.content });
  } catch {
    return unsupported('The signature Contents is not a parseable CMS/PKCS#7 object.');
  }
  if (signedData.signerInfos.length === 0 || !signedData.certificates?.length)
    return unsupported(
      'The CMS object has no signer and certificate material that this verifier can use.',
    );

  const crypto = new CryptoEngine({ name: 'pdf.complianttools', crypto: globalThis.crypto });
  const data = asArrayBuffer(record.signedBytes);
  let cryptographic: Awaited<ReturnType<SignedData['verify']>>;
  try {
    cryptographic = await signedData.verify(
      { signer: 0, data, checkChain: false, extendedMode: true },
      crypto,
    );
  } catch (error) {
    if (isUnsupportedCmsError(error))
      return unsupported(
        'The CMS object uses a signer or algorithm that the browser-compatible verifier does not support.',
      );
    return {
      record,
      status: 'invalid',
      remedy: 'The PDF bytes or CMS signature value do not verify against the signed ByteRange.',
    };
  }
  if (!cryptographic.signatureVerified)
    return {
      record,
      status: 'invalid',
      remedy: 'The PDF bytes or CMS signature value do not verify against the signed ByteRange.',
    };
  if (trustAnchors.length === 0)
    return {
      record,
      status: 'untrusted',
      remedy:
        'The CMS signature is cryptographically valid, but no user-supplied trust anchor was provided. Web Crypto does not expose the browser/OS certificate store to this local verifier.',
    };

  let trustedCertificates: Certificate[];
  try {
    trustedCertificates = trustAnchors.map((anchor) => Certificate.fromBER(asArrayBuffer(anchor)));
  } catch {
    return {
      record,
      status: 'unsupported',
      remedy: 'At least one supplied trust anchor is not a parseable DER X.509 certificate.',
    };
  }
  try {
    const trusted = await signedData.verify(
      {
        signer: 0,
        data,
        checkChain: true,
        trustedCerts: trustedCertificates,
        extendedMode: true,
      },
      crypto,
    );
    if (trusted.signatureVerified && trusted.signerCertificateVerified)
      return {
        record,
        status: 'verified',
        remedy:
          'The CMS signature and its certificate path verify against a supplied trust anchor.',
      };
  } catch (error) {
    if (!isUnsupportedCmsError(error) && verificationCode(error) !== 5)
      return {
        record,
        status: 'invalid',
        remedy: 'The supplied trust path or CMS signature could not be verified.',
      };
  }
  return {
    record,
    status: 'untrusted',
    remedy:
      'The CMS signature is cryptographically valid, but its signer certificate does not chain to a supplied trust anchor.',
  };
}

/**
 * Verify detached PDF signatures without claiming authority over a root program.
 * The caller must explicitly pass DER trust anchors when a `verified` result is required.
 */
export async function verifyDigitalSignatures(
  bytes: Uint8Array,
  options: SignatureVerificationOptions = {},
): Promise<SignatureVerification> {
  const inspected = inspectPdfSignatures(bytes);
  if (inspected.kind === 'unsigned')
    return { status: 'unsigned', signatures: [], remedy: 'No PDF signature ByteRange was found.' };
  const signatures = inspected.signatures.map(({ byteRange, cmsPresent }) => ({
    byteRange,
    cmsPresent,
  }));
  if (inspected.kind === 'malformed-byte-range')
    return {
      status: 'malformed-byte-range',
      signatures,
      remedy:
        'The signature ByteRange is malformed, overlaps the file, or does not cover the PDF outside Contents.',
    };
  const reports = await Promise.all(
    inspected.signatures.map((record) => inspectCms(record, options.trustAnchors ?? [])),
  );
  const firstFailure = reports.find((report) => report.status !== 'verified');
  if (firstFailure) return { status: firstFailure.status, signatures, remedy: firstFailure.remedy };
  return {
    status: 'verified',
    signatures,
    remedy: 'The CMS signature and its certificate path verify against a supplied trust anchor.',
  };
}
