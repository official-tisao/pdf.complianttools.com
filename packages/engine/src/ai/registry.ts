import { AiError } from './errors.js';
import type { AiCapability, ProviderAdapter } from './types.js';

export type AdapterRegistry = Readonly<{
  register(adapter: ProviderAdapter): void;
  get(providerId: string): ProviderAdapter | undefined;
  require(providerId: string, capability: AiCapability): ProviderAdapter;
  list(): readonly ProviderAdapter[];
}>;

export function createAdapterRegistry(adapters: readonly ProviderAdapter[] = []): AdapterRegistry {
  const entries = new Map<string, ProviderAdapter>();
  for (const adapter of adapters) entries.set(adapter.id, adapter);
  return {
    register(adapter) {
      entries.set(adapter.id, adapter);
    },
    get(providerId) {
      return entries.get(providerId);
    },
    require(providerId, capability) {
      const adapter = entries.get(providerId);
      if (!adapter || !adapter.capabilities.includes(capability))
        throw new AiError({
          kind: 'ai-provider-unsupported-capability',
          capability,
          remedy: 'Connect a provider that is configured for this AI capability.',
        });
      return adapter;
    },
    list() {
      return [...entries.values()];
    },
  };
}

export const ADAPTER_REGISTRY_ROWS = Object.freeze([
  ['A1', 'openai-compatible', 'chat'],
  ['A2', 'openai-compatible', 'summarize'],
  ['A3', 'openai-compatible', 'translate'],
  ['A4', 'openai-compatible', 'generate'],
  ['A5', 'anthropic-compatible', 'chat'],
  ['A6', 'anthropic-compatible', 'summarize'],
  ['A7', 'generic-http-template', 'chat'],
  ['A8', 'generic-http-template', 'generate'],
] as const);
