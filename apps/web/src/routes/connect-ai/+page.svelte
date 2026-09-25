<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import {
    ALL_AI_CAPABILITIES,
    createIndexedDbKeyStore,
    type AiProviderFamily,
    type ProviderConnection,
  } from '@pdf-complianttools/engine';

  let family = $state<AiProviderFamily>('generic-http-template');
  let label = $state('My AI connection');
  let endpoint = $state('');
  let model = $state('');
  let authHeader = $state('authorization');
  let authPrefix = $state('Bearer ');
  let secret = $state('');
  let responsePath = $state('output');
  let requestTemplate = $state(
    '{"capability":"{{capability}}","input":"{{input}}","context":"{{context}}"}',
  );
  let status = $state('');
  let configured = $state<
    readonly { providerId: string; label: string; family: AiProviderFamily }[]
  >([]);

  async function refresh() {
    try {
      const metadata = await createIndexedDbKeyStore().listMetadata();
      configured = metadata.map(({ providerId, label: savedLabel, family: savedFamily }) => ({
        providerId,
        label: savedLabel,
        family: savedFamily,
      }));
    } catch (error) {
      status = error instanceof Error ? error.message : 'IndexedDB is unavailable.';
    }
  }

  async function save() {
    if (!endpoint.trim() || !secret.trim()) {
      status = 'Endpoint and key are required. The key is written only to IndexedDB.';
      return;
    }
    let template: unknown;
    try {
      template = JSON.parse(requestTemplate);
    } catch {
      status =
        'Request template must be valid JSON with {{capability}}, {{input}}, or {{context}} placeholders.';
      return;
    }
    const connection: ProviderConnection = {
      id: `connection-${globalThis.crypto.randomUUID()}`,
      label: label.trim() || 'My AI connection',
      family,
      endpoint: endpoint.trim(),
      ...(model.trim() ? { model: model.trim() } : {}),
      authHeader: authHeader.trim(),
      authPrefix,
      requestTemplate: template,
      responsePath: responsePath.trim(),
      capabilities: ALL_AI_CAPABILITIES,
    };
    try {
      await createIndexedDbKeyStore().save(connection, secret);
      secret = '';
      status = 'Saved. The key is not shown again, included in recipes, or sent to this app.';
      await refresh();
    } catch (error) {
      status = error instanceof Error ? error.message : 'Connection could not be saved.';
    }
  }

  function remove(providerId: string) {
    void createIndexedDbKeyStore()
      .remove(providerId)
      .then(refresh)
      .catch(
        (error: unknown) =>
          (status = error instanceof Error ? error.message : 'Could not remove connection.'),
      );
  }

  $effect(() => {
    void refresh();
  });
</script>

<svelte:head>
  <title>Connect your AI</title>
  <meta
    name="description"
    content="Configure an explicit, user-owned AI connection without sending keys to this app."
  />
</svelte:head>

<section class="page">
  <p class="eyebrow">BYOK · EXPLICIT ONLY</p>
  <h1>Connect your AI</h1>
  <p class="lede">
    Your key stays in this browser’s IndexedDB. Nothing is enabled until you configure an endpoint
    and start a clearly labelled, cost-estimated request. This app does not own a provider account
    or verify provider retention.
  </p>

  <section class="guides" aria-labelledby="guides-heading">
    <h2 id="guides-heading">Choose a provider family</h2>
    <div class="cards">
      <article>
        <h3>OpenAI-compatible</h3>
        <p>
          Use the endpoint, auth header, request body, and response path documented by your chosen
          service. Compatibility is not assumed by this app.
        </p>
      </article>
      <article>
        <h3>Anthropic-compatible</h3>
        <p>
          Use the service’s current documentation to supply its endpoint, authentication header,
          template, and output path. No live schema is bundled.
        </p>
      </article>
      <article>
        <h3>Generic HTTP template</h3>
        <p>
          Map the provider-neutral placeholders <code>{'{{capability}}'}</code>,
          <code>{'{{input}}'}</code>, and <code>{'{{context}}'}</code> to your endpoint’s current request
          shape.
        </p>
      </article>
    </div>
  </section>

  <form
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <h2>Store a connection</h2>
    <label>Label<input bind:value={label} autocomplete="off" /></label>
    <label
      >Provider family<select bind:value={family}
        ><option value="generic-http-template">Generic HTTP template</option><option
          value="openai-compatible">OpenAI-compatible</option
        ><option value="anthropic-compatible">Anthropic-compatible</option></select
      ></label
    >
    <label
      >Endpoint<input
        bind:value={endpoint}
        type="url"
        placeholder="https://your-provider.example/v1/…"
        autocomplete="off"
      /></label
    >
    <label>Model or deployment name<input bind:value={model} autocomplete="off" /></label>
    <div class="two-col">
      <label>Auth header<input bind:value={authHeader} autocomplete="off" /></label><label
        >Auth prefix<input bind:value={authPrefix} autocomplete="off" /></label
      >
    </div>
    <label>API key<input bind:value={secret} type="password" autocomplete="new-password" /></label>
    <label
      >Request template JSON<textarea bind:value={requestTemplate} rows="5" spellcheck="false"
      ></textarea></label
    >
    <label
      >Response text path<input
        bind:value={responsePath}
        placeholder="output"
        autocomplete="off"
      /></label
    >
    <p class="hint">
      Templates and response paths are user-supplied because provider schemas can change. Keys never
      go in the endpoint, template, recipe, URL, or diagnostic output.
    </p>
    <Button type="submit">Save in IndexedDB</Button>
  </form>

  <section aria-labelledby="saved-heading">
    <h2 id="saved-heading">Saved connections</h2>
    {#if configured.length}<ul>
        {#each configured as item (item.providerId)}<li>
            <span>{item.label} · {item.family}</span><button
              type="button"
              onclick={() => remove(item.providerId)}>Remove</button
            >
          </li>{/each}
      </ul>{:else}<p class="hint">
        No provider is configured. Local fallbacks remain available.
      </p>{/if}
  </section>
  <p class="status" role="status">{status}</p>
</section>

<style>
  .page {
    margin: auto;
    max-width: 1120px;
    padding: 96px 40px 0;
  }
  .eyebrow {
    color: var(--color-muted);
    font-size: 0.875rem;
    letter-spacing: 0.12em;
  }
  h1 {
    font-size: clamp(2.5rem, 6vw, 4rem);
    letter-spacing: -0.05em;
    margin: 12px 0;
  }
  .lede,
  .hint,
  .status {
    color: var(--color-muted);
    max-width: 800px;
  }
  .guides,
  form,
  section[aria-labelledby='saved-heading'] {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    margin-top: 32px;
    padding: 28px;
  }
  .cards {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(3, 1fr);
  }
  article {
    background: var(--color-platinum);
    border-radius: var(--radius-panel);
    padding: 20px;
  }
  article p {
    color: var(--color-muted);
  }
  form {
    display: grid;
    gap: 16px;
    max-width: 800px;
  }
  label {
    display: grid;
    gap: 6px;
  }
  input,
  select,
  textarea {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    font: inherit;
    padding: 10px 12px;
  }
  textarea {
    font-family: ui-monospace, monospace;
  }
  .two-col {
    display: grid;
    gap: 16px;
    grid-template-columns: 1fr 1fr;
  }
  ul {
    display: grid;
    gap: 8px;
    padding: 0;
  }
  li {
    align-items: center;
    display: flex;
    justify-content: space-between;
    list-style: none;
  }
  li button {
    background: none;
    border: 0;
    color: var(--color-muted);
    cursor: pointer;
    text-decoration: underline;
  }
  @media (max-width: 767px) {
    .page {
      padding-inline: 24px;
    }
    .cards,
    .two-col {
      grid-template-columns: 1fr;
    }
  }
</style>
