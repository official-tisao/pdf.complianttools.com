import { PdfEngineError } from './errors.js';

export type RelayResponse = { bytes: Uint8Array; mimeType: 'application/pdf' };

export async function captureWebpageToPdf(
  url: string,
  endpoint: string,
  fetcher: typeof fetch = fetch,
): Promise<RelayResponse> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'webpage-to-pdf',
      remedy: 'Enter a complete http:// or https:// webpage URL.',
    });
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new PdfEngineError({
      kind: 'invalid-operation',
      operation: 'webpage-to-pdf',
      remedy: 'Relay capture accepts only http and https URLs.',
    });
  if (!endpoint.trim())
    throw new PdfEngineError({
      kind: 'relay-not-configured',
      remedy:
        'Configure your self-hosted Relay endpoint to capture a webpage. Local PDF tools remain available without it.',
    });
  try {
    const response = await fetcher(`${endpoint.replace(/\/$/u, '')}/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: parsed.toString() }),
    });
    if (!response.ok) {
      // The Relay knows which failure it hit — a blocked URL, a missing browser
      // binary, a render timeout — and each has a different remedy. Prefer its
      // answer so the message names the actual problem.
      let cause = `Relay returned HTTP ${response.status}.`;
      let remedy =
        'Check that the user-run Relay is reachable and has a compatible headless browser installed.';
      try {
        const body = (await response.json()) as { error?: string; remedy?: string };
        if (typeof body.remedy === 'string' && body.remedy) remedy = body.remedy;
        if (typeof body.error === 'string' && body.error)
          cause = `Relay returned HTTP ${response.status} (${body.error}).`;
      } catch {
        // Non-JSON error body; keep the generic remedy.
      }
      throw new PdfEngineError({ kind: 'relay-failed', endpoint, cause, remedy });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, mimeType: 'application/pdf' };
  } catch (error) {
    if (error instanceof PdfEngineError) throw error;
    throw new PdfEngineError({
      kind: 'relay-failed',
      endpoint,
      cause: error instanceof Error ? error.message : 'Unknown Relay failure.',
      remedy:
        'Check that the user-run Relay is reachable and has a compatible headless browser installed.',
    });
  }
}
