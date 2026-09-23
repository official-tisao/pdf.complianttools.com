<script lang="ts">
  import Button from '@pdf-complianttools/ui/Button.svelte';
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import {
    createAiCallPlan,
    createDocumentContext,
    extractPdfTextPages,
    parsePageDelimitedTranslation,
    runLearningFallback,
    runLocalFallback,
    textPagesToPdf,
    type AiCallPlan,
    type AiCapability,
    type AiDocumentContext,
    type LocalAiResult,
  } from '@pdf-complianttools/engine';
  import AiCallConfirm from '$lib/AiCallConfirm.svelte';
  import { getConfiguredConnection, sendConfirmed } from '$lib/ai-client';

  type ToolKind = 'chat' | 'learning' | 'translate';
  type LearningMode = 'summary' | 'quiz' | 'flashcards' | 'mind-map';

  let { kind, title, description }: { kind: ToolKind; title: string; description: string } =
    $props();

  let file = $state<File | undefined>();
  let prompt = $state('');
  let targetLanguage = $state('French');
  let learningMode = $state<LearningMode>('summary');
  let context = $state<AiDocumentContext | undefined>();
  let result = $state<LocalAiResult | undefined>();
  let plan = $state<AiCallPlan | undefined>();
  let translatedPdf = $state<Uint8Array | undefined>();
  let status = $state('');
  let busy = $state(false);

  async function extractContext() {
    if (!file) throw new Error('Choose a PDF first.');
    const pages = await extractPdfTextPages(new Uint8Array(await file.arrayBuffer()));
    return createDocumentContext(
      pages.map((page) => ({ pageNumber: page.pageNumber, lines: page.lines })),
    );
  }

  async function runLocal() {
    busy = true;
    plan = undefined;
    try {
      context = await extractContext();
      if (kind === 'learning') result = runLearningFallback(learningMode, context);
      else result = runLocalFallback(kind, context, prompt);
      status = context.truncated
        ? 'Local result ready. The document exceeded the context preview cap; only the shown local text was used.'
        : 'Local result ready. No network request was made.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Local AI flow failed.';
    } finally {
      busy = false;
    }
  }

  async function prepareProvider() {
    busy = true;
    try {
      context ??= await extractContext();
      const configured = await getConfiguredConnection();
      if (!configured) {
        status =
          'No provider is configured. Open Connect your AI to add one; the local result remains available.';
        return;
      }
      const capability: AiCapability = kind === 'learning' ? 'summarize' : kind;
      const request = {
        capability,
        prompt:
          kind === 'learning'
            ? `Create a ${learningMode} from this document.`
            : kind === 'translate'
              ? `Translate this document to ${targetLanguage}. Return exactly one ordered section per source page using ---PAGE N--- markers, with the translated text after each marker. Do not add commentary.`
              : prompt,
        context,
        ...(kind === 'translate' ? { targetLanguage } : {}),
      };
      plan = createAiCallPlan(configured.connection.id, request, {
        ...(configured.connection.inputPricePerMillionUsd === undefined
          ? {}
          : { inputPricePerMillionUsd: configured.connection.inputPricePerMillionUsd }),
        ...(configured.connection.outputPricePerMillionUsd === undefined
          ? {}
          : { outputPricePerMillionUsd: configured.connection.outputPricePerMillionUsd }),
      });
      status = 'Review the estimate below. Nothing has been sent.';
    } catch (error) {
      status = error instanceof Error ? error.message : 'Could not prepare the provider request.';
    } finally {
      busy = false;
    }
  }

  async function sendProvider() {
    if (!plan || !context) return;
    busy = true;
    try {
      const configured = await getConfiguredConnection();
      if (!configured || configured.connection.id !== plan.providerId) {
        status = 'The provider connection changed. Prepare a fresh estimate.';
        return;
      }
      const capability: AiCapability = kind === 'learning' ? 'summarize' : kind;
      const request = {
        capability,
        prompt:
          kind === 'learning'
            ? `Create a ${learningMode} from this document.`
            : kind === 'translate'
              ? `Translate this document to ${targetLanguage}. Return exactly one ordered section per source page using ---PAGE N--- markers, with the translated text after each marker. Do not add commentary.`
              : prompt,
        context,
        ...(kind === 'translate' ? { targetLanguage } : {}),
      };
      const providerResult = await sendConfirmed(
        configured.connection,
        configured.secret,
        request,
        plan,
      );
      if (kind === 'translate') {
        const translatedPages = parsePageDelimitedTranslation(
          providerResult.text,
          context.pages.map((page) => page.pageNumber),
        );
        if (!translatedPages) {
          plan = undefined;
          result = undefined;
          translatedPdf = undefined;
          status =
            'The provider response did not preserve the required page markers. No translated PDF was created.';
          return;
        }
        translatedPdf = await textPagesToPdf(
          translatedPages.map((page) => page.text.split(/\r?\n/)),
          { pageSize: 'letter' },
        );
        result = {
          capability,
          mode: 'local-fallback',
          title: 'Translated text — review before export',
          text: translatedPages.map((page) => `Page ${page.pageNumber}\n${page.text}`).join('\n\n'),
        };
        status =
          'Page-boundary-preserving text was reflowed through the local PDF writer. Review it before export.';
      } else {
        result = {
          capability,
          mode: 'local-fallback',
          title: 'Provider result — review before use',
          text: providerResult.text,
        };
        status = 'Provider response received. Review it before exporting or relying on it.';
      }
      plan = undefined;
    } catch (error) {
      status = error instanceof Error ? error.message : 'Provider request failed.';
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{title}</title><meta name="description" content={description} /></svelte:head>

<section class="page">
  <p class="eyebrow">BYOK AI · LOCAL FIRST</p>
  <h1>{title}</h1>
  <p class="lede">{description}</p>
  <p class="privacy">
    Local extraction runs first. A provider request is never automatic and is shown with a
    token/character estimate before confirmation.
  </p>
  <FileDrop
    accept=".pdf,application/pdf"
    multiple={false}
    onchange={(list) => {
      file = list?.[0];
      result = undefined;
      plan = undefined;
      translatedPdf = undefined;
    }}
  />
  {#if kind === 'chat'}
    <label
      >Search or question<textarea
        bind:value={prompt}
        rows="4"
        placeholder="Where is the termination date mentioned?"></textarea></label
    >
  {:else if kind === 'learning'}
    <label
      >Local learning aid<select bind:value={learningMode}
        ><option value="summary">Summary</option><option value="quiz">Quiz</option><option
          value="flashcards">Flashcards</option
        ><option value="mind-map">Mind map</option></select
      ></label
    >
    <label
      >Optional focus<textarea
        bind:value={prompt}
        rows="3"
        placeholder="Focus on the key obligations"></textarea></label
    >
  {:else}
    <label>Target language<input bind:value={targetLanguage} /></label>
  {/if}
  <div class="actions">
    <Button disabled={busy || !file} onclick={() => void runLocal()}
      >{kind === 'translate' ? 'Check local availability' : 'Run locally first'}</Button
    ><Button variant="secondary" disabled={busy || !file} onclick={() => void prepareProvider()}
      >Prepare explicit AI request</Button
    ><a href="/connect-ai">Connect your AI</a>
  </div>
  <p class="status" role="status">{status}</p>
  {#if context}<p class="context">
      Context estimate: {context.characterCount.toLocaleString()} characters · about {context.tokenEstimate.toLocaleString()}
      tokens{context.truncated ? ' · capped' : ''}
    </p>{/if}
  {#if plan}<AiCallConfirm {plan} onconfirm={() => void sendProvider()} />{/if}
  {#if result}<section class="result" aria-labelledby="result-heading">
      <h2 id="result-heading">{result.title}</h2>
      <pre>{result.text}</pre>
      {#if result.matches?.length}<ul>
          {#each result.matches as match (match.pageNumber + match.excerpt)}<li>
              <strong>Page {match.pageNumber}:</strong>
              {match.excerpt}
            </li>{/each}
        </ul>{/if}
    </section>{/if}
  {#if translatedPdf}<Button
      variant="secondary"
      onclick={() => {
        const url = URL.createObjectURL(
          new Blob([Uint8Array.from(translatedPdf ?? []).buffer], { type: 'application/pdf' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'translated-review.pdf';
        link.click();
        URL.revokeObjectURL(url);
      }}>Download reviewed translation PDF</Button
    >{/if}
  {#if kind === 'translate'}<p class="limitation">
      A keyed response is shown for review. True layout-preserving reflow requires a provider
      response that preserves page boundaries; this page will not fabricate that guarantee.
    </p>{/if}
</section>

<style>
  .page {
    margin: auto;
    max-width: 960px;
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
  .privacy,
  .status,
  .context,
  .limitation {
    color: var(--color-muted);
    max-width: 800px;
  }
  .privacy,
  .limitation {
    border-left: 3px solid var(--color-ink);
    padding-left: 16px;
  }
  label {
    display: grid;
    gap: 8px;
    margin-top: 24px;
  }
  textarea,
  input,
  select {
    border: 1px solid var(--color-hairline);
    border-radius: 8px;
    font: inherit;
    padding: 12px;
  }
  textarea {
    resize: vertical;
  }
  .actions {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 24px 0;
  }
  .actions a {
    color: inherit;
  }
  .result {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    margin-top: 24px;
    padding: 24px;
  }
  pre {
    font: 0.95rem/1.55 var(--font-sans);
    white-space: pre-wrap;
  }
  ul {
    padding-left: 20px;
  }
  @media (max-width: 767px) {
    .page {
      padding-inline: 24px;
    }
  }
</style>
