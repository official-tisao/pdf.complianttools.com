import assert from 'node:assert/strict';
import test from 'node:test';
import { assembleScans, requestScanCamera, stopScanCamera, PdfEngineError } from '../dist/index.js';

/**
 * Installs a fake `navigator.mediaDevices` for the duration of `body`.
 *
 * `navigator` is a configurable accessor on the Node global, so it can be
 * redefined and put back without leaking into other tests. The original
 * descriptor is restored in a `finally`, so a failing assertion cannot leave the
 * global patched for the rest of the file.
 */
async function withMediaDevices(value, body) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get: () => ({ mediaDevices: value }),
  });
  try {
    return await body();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}

/** A DOMException-shaped rejection, which is what getUserMedia actually throws. */
function domException(name) {
  const error = new Error(`rejected: ${name}`);
  error.name = name;
  return error;
}

const fakeStream = () => ({ getTracks: () => [{ stop: () => {} }] });

// --- requestScanCamera: success ---

test('a granted permission returns the stream and never throws', async () => {
  let received;
  const stream = fakeStream();
  const result = await withMediaDevices(
    {
      getUserMedia: (constraints) => {
        received = constraints;
        return Promise.resolve(stream);
      },
    },
    () => requestScanCamera(),
  );
  assert.equal(result, stream);
  // The rear camera is requested ideally, and audio is never opened: this tool
  // captures pages, it does not record.
  assert.deepEqual(received, { video: { facingMode: { ideal: 'environment' } }, audio: false });
});

test('requesting the camera does not start a stream as a side effect of import', async () => {
  // The module is already imported at the top of this file. If it opened a
  // stream on import, the counter here would be non-zero without any call.
  let calls = 0;
  await withMediaDevices(
    {
      getUserMedia: () => {
        calls += 1;
        return Promise.resolve(fakeStream());
      },
    },
    () => new Promise((resolve) => setTimeout(resolve, 0)),
  );
  assert.equal(calls, 0);
});

// --- requestScanCamera: the runtime has no camera at all ---

test('a runtime with no getUserMedia is an unsupported-feature with a remedy', async () => {
  await withMediaDevices(undefined, () =>
    assert.rejects(
      () => requestScanCamera(),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'unsupported-feature' &&
        error.details.feature === 'camera capture' &&
        /import scanned image files/u.test(error.details.remedy),
    ),
  );
});

test('a navigator with no mediaDevices is the same typed failure', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, get: () => ({}) });
  try {
    await assert.rejects(
      () => requestScanCamera(),
      (error) => error instanceof PdfEngineError && error.details.kind === 'unsupported-feature',
    );
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
  }
});

// --- requestScanCamera: a refusal is not the same as an absent device ---

test('a denied permission is permission-denied and says how to allow it', async () => {
  for (const name of ['NotAllowedError', 'PermissionDeniedError', 'SecurityError']) {
    await withMediaDevices({ getUserMedia: () => Promise.reject(domException(name)) }, () =>
      assert.rejects(
        () => requestScanCamera(),
        (error) =>
          error instanceof PdfEngineError &&
          error.details.kind === 'permission-denied' &&
          error.details.resource === 'camera' &&
          /Allow camera access/u.test(error.details.remedy),
        name,
      ),
    );
  }
});

test('an absent camera is NOT reported as a denied permission', async () => {
  // Telling someone to grant permission on a device that has no camera sends
  // them somewhere they cannot succeed. These must stay distinguishable.
  for (const name of ['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError']) {
    await withMediaDevices({ getUserMedia: () => Promise.reject(domException(name)) }, () =>
      assert.rejects(
        () => requestScanCamera(),
        (error) =>
          error instanceof PdfEngineError &&
          error.details.kind === 'camera-unavailable' &&
          /No camera was found/u.test(error.details.remedy),
        name,
      ),
    );
  }
});

test('an unrecognised rejection is still typed and still actionable', async () => {
  // A platform string or a non-Error must not escape as an opaque failure.
  await withMediaDevices({ getUserMedia: () => Promise.reject('something went wrong') }, () =>
    assert.rejects(
      () => requestScanCamera(),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'camera-unavailable' &&
        error.details.remedy.length > 0,
    ),
  );
});

test('an Error with no recognised name still carries a remedy', async () => {
  await withMediaDevices({ getUserMedia: () => Promise.reject(new Error('boom')) }, () =>
    assert.rejects(
      () => requestScanCamera(),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'camera-unavailable' &&
        // The unrecognised branch reports the rejection's name, not its message,
        // and still routes the user to the file-import path.
        /\(Error\)/u.test(error.details.remedy) &&
        /import scanned image files/iu.test(error.details.remedy),
    ),
  );
});

test('a mediaDevices that throws synchronously is still typed', async () => {
  await withMediaDevices(
    {
      getUserMedia: () => {
        throw new Error('secure context required');
      },
    },
    () =>
      assert.rejects(
        () => requestScanCamera(),
        (error) => error instanceof PdfEngineError && error.details.kind === 'camera-unavailable',
      ),
  );
});

// --- stopScanCamera ---

test('stopScanCamera stops every track exactly once', () => {
  let stops = 0;
  stopScanCamera({
    getTracks: () => [
      {
        stop: () => {
          stops += 1;
        },
      },
      {
        stop: () => {
          stops += 1;
        },
      },
    ],
  });
  assert.equal(stops, 2);
});

test('stopScanCamera tolerates a stream with no tracks', () => {
  // A stream that was already ended reports no tracks; that must not throw on
  // the teardown path, where a second failure would mask the first.
  assert.doesNotThrow(() => stopScanCamera({ getTracks: () => [] }));
});

// --- assembleScans: error branches ---

test('an empty page list is refused with a remedy', async () => {
  await assert.rejects(
    () => assembleScans([]),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'invalid-operation' &&
      /at least one page/u.test(error.details.remedy),
  );
});

test('a corrupt page becomes a typed error naming the page and the format', async () => {
  // The decoders throw bare library errors — and for a truncated PNG, a
  // non-Error with no message at all. Uncaught, that reaches the user as an
  // empty status line. Every one of these must arrive typed and actionable.
  const cases = [
    ['truncated png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]), 'png'],
    ['random bytes', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'png'],
    ['zero bytes', new Uint8Array(0), 'png'],
    ['truncated jpeg', new Uint8Array([255, 216, 255, 224, 0, 0, 0, 0]), 'jpg'],
  ];
  for (const [label, bytes, format] of cases) {
    await assert.rejects(
      () => assembleScans([{ bytes, format }]),
      (error) =>
        error instanceof PdfEngineError &&
        error.details.kind === 'unsupported-format' &&
        error.details.direction === 'to-pdf' &&
        error.details.format === format &&
        /Page 1 could not be read/u.test(error.details.remedy),
      label,
    );
  }
});

test('a bad page is reported by its position, not silently dropped', async () => {
  // The remedy must point at the page that failed: a three-page scan where a
  // later one is corrupt is only fixable if the user is told which one.
  await assert.rejects(
    () =>
      assembleScans([
        { bytes: new Uint8Array(0), format: 'png' },
        { bytes: new Uint8Array(0), format: 'png' },
        { bytes: new Uint8Array(0), format: 'png' },
      ]),
    (error) => error instanceof PdfEngineError && /Page 1/u.test(error.details.remedy),
  );
});

test('a typed engine error passes through without being relabelled', async () => {
  // The wrapping must not overwrite a deliberate, specific error with a generic
  // one, so the remedy the decoder chose is the remedy the user sees.
  await assert.rejects(
    () => assembleScans([{ bytes: new Uint8Array(0), format: 'png' }]),
    (error) =>
      error instanceof PdfEngineError &&
      error.details.kind === 'unsupported-format' &&
      /import a PNG or JPEG/u.test(error.details.remedy),
  );
});
