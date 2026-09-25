import { AiError } from './errors.js';

export type ProviderRequest = Readonly<{
  endpoint: string;
  headers: Readonly<Record<string, string>>;
  body: unknown;
  signal?: AbortSignal;
}>;

export type ProviderResponse = Readonly<{
  status: number;
  body: unknown;
}>;

export type ProviderTransport = (request: ProviderRequest) => Promise<ProviderResponse>;

/**
 * The sole browser network seam. Callers must provide a user-configured endpoint and
 * credentials are carried only in an Authorization header, never in a URL or JSON body.
 */
export async function requestProvider(request: ProviderRequest): Promise<ProviderResponse> {
  assertSafeEndpoint(request.endpoint);
  const response = await fetch(request.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...request.headers },
    body: JSON.stringify(request.body),
    ...(request.signal ? { signal: request.signal } : {}),
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, body };
}

export function assertSafeEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AiError({
      kind: 'ai-invalid-connection',
      field: 'endpoint',
      remedy:
        'Use a complete HTTPS endpoint configured by you. Credentials do not belong in the URL.',
    });
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new AiError({
      kind: 'ai-invalid-connection',
      field: 'endpoint',
      remedy: 'Use an HTTP(S) endpoint without embedded credentials.',
    });
  }
  if (/[?&](?:api[_-]?key|token|secret|password)=/iu.test(url.search)) {
    throw new AiError({
      kind: 'ai-invalid-connection',
      field: 'endpoint',
      remedy: 'Remove credential query parameters. Store the key in IndexedDB instead.',
    });
  }
}
