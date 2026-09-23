import { AiError } from './errors.js';
import { requestProvider, type ProviderTransport } from './transport.js';
import type {
  AiCapability,
  AiOperationRequest,
  ProviderAdapter,
  ProviderConnection,
  ProviderInvocation,
  ProviderResult,
} from './types.js';

export const ALL_AI_CAPABILITIES: readonly AiCapability[] = [
  'chat',
  'summarize',
  'translate',
  'generate',
];

export function createProviderAdapter(
  connection: ProviderConnection,
  transport: ProviderTransport = requestProvider,
): ProviderAdapter {
  validateConnection(connection);
  return {
    id: connection.id,
    family: connection.family,
    capabilities: connection.capabilities,
    async invoke(input: ProviderInvocation): Promise<ProviderResult> {
      if (!connection.capabilities.includes(input.request.capability))
        throw new AiError({
          kind: 'ai-provider-unsupported-capability',
          capability: input.request.capability,
          remedy: 'Choose a connected provider that declares this capability.',
        });
      const body = applyTemplate(connection.requestTemplate, input.request, connection.model);
      const response = await transport({
        endpoint: connection.endpoint,
        headers: {
          [connection.authHeader]: `${connection.authPrefix}${input.credential}`,
        },
        body,
        ...(input.signal ? { signal: input.signal } : {}),
      }).catch(() => {
        throw new AiError({
          kind: 'ai-provider-unreachable',
          providerId: connection.id,
          remedy: 'Check the configured endpoint and provider availability, then try again.',
        });
      });
      if (response.status < 200 || response.status >= 300)
        throw new AiError({
          kind: 'ai-provider-unreachable',
          providerId: connection.id,
          remedy:
            'The configured provider rejected the request. Review its endpoint, key, and template.',
        });
      const value = readPath(response.body, connection.responsePath);
      if (typeof value !== 'string' || !value.trim())
        throw new AiError({
          kind: 'ai-provider-invalid-response',
          providerId: connection.id,
          remedy:
            'The response did not match the user-supplied response path; no output was fabricated.',
        });
      return { text: value, raw: response.body };
    },
  };
}

export const createOpenAiCompatibleAdapter = createProviderAdapter;
export const createAnthropicCompatibleAdapter = createProviderAdapter;
export const createGenericHttpTemplateAdapter = createProviderAdapter;

export function createFixtureConnection(
  family: ProviderConnection['family'],
  id = `fixture-${family}`,
): ProviderConnection {
  return {
    id,
    label: 'Fixture provider',
    family,
    endpoint: 'https://provider.invalid/ai',
    authHeader: 'authorization',
    authPrefix: 'Bearer ',
    requestTemplate: {
      capability: '{{capability}}',
      model: '{{model}}',
      input: '{{input}}',
    },
    responsePath: 'output',
    capabilities: ALL_AI_CAPABILITIES,
  };
}

function validateConnection(connection: ProviderConnection): void {
  if (!connection.id.trim()) invalid('id');
  if (!connection.endpoint.trim()) invalid('endpoint');
  if (!connection.authHeader.trim()) invalid('authHeader');
  if (!connection.responsePath.trim()) invalid('responsePath');
  if (!connection.capabilities.length) invalid('capabilities');
}

function invalid(field: string): never {
  throw new AiError({
    kind: 'ai-invalid-connection',
    field,
    remedy: `Configure a non-empty ${field} before connecting a provider.`,
  });
}

function applyTemplate(template: unknown, request: AiOperationRequest, model?: string): unknown {
  const values: Record<string, string> = {
    capability: request.capability,
    prompt: request.prompt,
    input: request.prompt,
    context: request.context?.text ?? '',
    targetLanguage: request.targetLanguage ?? '',
    outputInstruction: request.outputInstruction ?? '',
    model: model ?? '',
  };
  if (typeof template === 'string') return replaceTokens(template, values);
  if (Array.isArray(template)) return template.map((item) => applyTemplate(item, request, model));
  if (template && typeof template === 'object')
    return Object.fromEntries(
      Object.entries(template).map(([key, value]) => [key, applyTemplate(value, request, model)]),
    );
  return template;
}

function replaceTokens(value: string, values: Readonly<Record<string, string>>): string {
  return value.replaceAll(
    /\{\{([A-Za-z][A-Za-z0-9]*)\}\}/gu,
    (_match, key: string) => values[key] ?? '',
  );
}

function readPath(value: unknown, path: string): unknown {
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, segment) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[segment];
    }, value);
}
