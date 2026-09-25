import {
  assertAiConfirmation,
  confirmAiCall,
  createAdapterRegistry,
  createAiCallPlan,
  createIndexedDbKeyStore,
  createProviderAdapter,
  type AiConfirmation,
  type AiOperationRequest,
  type AiCallPlan,
  type ProviderConnection,
  type ProviderResult,
} from '@pdf-complianttools/engine';

export async function getConfiguredConnection(): Promise<
  { connection: ProviderConnection; secret: string } | undefined
> {
  const store = createIndexedDbKeyStore();
  const metadata = await store.listMetadata();
  const first = metadata[0];
  return first ? store.get(first.providerId) : undefined;
}

export function makePlan(connection: ProviderConnection, request: AiOperationRequest): AiCallPlan {
  return createAiCallPlan(connection.id, request, {
    ...(connection.inputPricePerMillionUsd === undefined
      ? {}
      : { inputPricePerMillionUsd: connection.inputPricePerMillionUsd }),
    ...(connection.outputPricePerMillionUsd === undefined
      ? {}
      : { outputPricePerMillionUsd: connection.outputPricePerMillionUsd }),
  });
}

export async function sendConfirmed(
  connection: ProviderConnection,
  secret: string,
  request: AiOperationRequest,
  plan: AiCallPlan,
): Promise<ProviderResult> {
  const confirmation: AiConfirmation = confirmAiCall(plan, {
    kind: 'click',
    occurredAt: Date.now(),
  });
  assertAiConfirmation(plan, confirmation);
  const registry = createAdapterRegistry();
  registry.register(createProviderAdapter(connection));
  return registry
    .require(connection.id, request.capability)
    .invoke({ request, connection, credential: secret });
}
