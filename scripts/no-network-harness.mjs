export async function runNoNetworkCheck(operation) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (...args) => {
    calls += 1;
    throw new Error(`Unexpected network request: ${String(args[0])}`);
  };
  try {
    await operation();
  } finally {
    globalThis.fetch = originalFetch;
  }
  if (calls !== 0) throw new Error(`Expected zero network calls, observed ${calls}.`);
}
