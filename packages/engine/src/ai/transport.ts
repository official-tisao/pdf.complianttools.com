export type ProviderRequest = {
  endpoint: string;
  body: unknown;
  signal?: AbortSignal;
};

export type ProviderResponse = {
  status: number;
  body: unknown;
};

/** The only future network seam. It is intentionally not called by local operations. */
export async function requestProvider(request: ProviderRequest): Promise<ProviderResponse> {
  const init: RequestInit = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request.body),
  };
  if (request.signal) init.signal = request.signal;
  const response = await fetch(request.endpoint, init);
  const body: unknown = await response.json();
  return { status: response.status, body };
}
