export type AiCapability = 'chat' | 'summarize' | 'translate' | 'generate';

export type AiProviderFamily =
  'openai-compatible' | 'anthropic-compatible' | 'generic-http-template';

export type AiTextPage = Readonly<{
  pageNumber: number;
  text: string;
}>;

export type AiDocumentContext = Readonly<{
  pages: readonly AiTextPage[];
  text: string;
  characterCount: number;
  tokenEstimate: number;
  truncated: boolean;
}>;

export type AiOperationRequest = Readonly<{
  capability: AiCapability;
  prompt: string;
  context?: AiDocumentContext;
  targetLanguage?: string;
  outputInstruction?: string;
}>;

export type AiCostEstimate = Readonly<{
  inputCharacters: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd?: number;
  pricingBasis: 'provider-configured' | 'provider-pricing-unknown';
}>;

export type AiCallPlan = Readonly<{
  planId: string;
  providerId: string;
  capability: AiCapability;
  estimate: AiCostEstimate;
  createdAt: number;
  expiresAt: number;
}>;

export type UserGesture = Readonly<{
  kind: 'click' | 'keyboard';
  occurredAt: number;
}>;

export type AiConfirmation = Readonly<{
  planId: string;
  confirmedAt: number;
  gesture: UserGesture;
}>;

export type ProviderConnection = Readonly<{
  id: string;
  label: string;
  family: AiProviderFamily;
  endpoint: string;
  model?: string;
  authHeader: string;
  authPrefix: string;
  requestTemplate: unknown;
  responsePath: string;
  capabilities: readonly AiCapability[];
  inputPricePerMillionUsd?: number;
  outputPricePerMillionUsd?: number;
}>;

export type ProviderInvocation = Readonly<{
  request: AiOperationRequest;
  connection: ProviderConnection;
  credential: string;
  signal?: AbortSignal;
}>;

export type ProviderResult = Readonly<{
  text: string;
  raw: unknown;
}>;

export type ProviderAdapter = Readonly<{
  id: string;
  family: AiProviderFamily;
  capabilities: readonly AiCapability[];
  invoke(input: ProviderInvocation): Promise<ProviderResult>;
}>;

export type LocalAiResult = Readonly<{
  capability: AiCapability;
  mode: 'local-fallback';
  title: string;
  text: string;
  matches?: readonly Readonly<{ pageNumber: number; excerpt: string }>[];
}>;

export type AiKeyMetadata = Readonly<{
  providerId: string;
  label: string;
  family: AiProviderFamily;
  endpoint: string;
  capabilities: readonly AiCapability[];
  updatedAt: number;
}>;

export interface AiKeyStore {
  save(connection: ProviderConnection, secret: string): Promise<void>;
  get(providerId: string): Promise<{ connection: ProviderConnection; secret: string } | undefined>;
  listMetadata(): Promise<readonly AiKeyMetadata[]>;
  remove(providerId: string): Promise<void>;
}
