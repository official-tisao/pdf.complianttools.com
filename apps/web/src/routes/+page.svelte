<script lang="ts">
  import FileDrop from '@pdf-complianttools/ui/FileDrop.svelte';
  import { JSONLD_CLOSE, JSONLD_OPEN, softwareApplicationLd } from '$lib/seo';

  let files = $state<File[]>([]);

  function acceptFiles(fileList: FileList | null) {
    files = fileList ? Array.from(fileList) : [];
  }

  const structuredData = softwareApplicationLd({
    name: 'pdf.complianttools.com',
    description:
      'Merge, organize, and transform PDFs locally in your browser. Deterministic tools never upload your files.',
    path: '/',
  });
</script>

<svelte:head>
  <title>Local-first PDF tools</title>
  <meta name="description" content="Merge, organize, and transform PDFs locally in your browser." />
  <!-- safe-html-reviewed: JSON-LD needs a script element Svelte cannot emit; the payload is JSON.stringify from $lib/seo with "<" escaped, tested in scripts/seo.test.mjs -->
  {@html JSONLD_OPEN + structuredData + JSONLD_CLOSE}
</svelte:head>

<section class="hero">
  <p class="eyebrow">LOCAL-FIRST DOCUMENT TOOLS</p>
  <h1>Every PDF tool. In your browser.</h1>
  <p class="lede">Merge, organize, convert, sign, and inspect documents without uploading them.</p>
  <div class="actions">
    <!--
      Styled as links rather than <Button><a></a></Button>: nesting an anchor
      inside a button is invalid HTML and gives the tap target no accessible
      role. These are navigation, so they are links.
    -->
    <a class="button button-primary" href="/merge">Start with Merge PDF</a>
    <a class="button button-secondary" href="/ai/chat-with-pdf">Explore local-first AI</a>
    <a class="button button-secondary" href="/#tools">Browse tools</a>
  </div>
  <FileDrop onchange={acceptFiles} />
  {#if files.length > 0}
    <p class="status" role="status">
      {files.length} file{files.length === 1 ? '' : 's'} selected locally.
    </p>
  {/if}
</section>

<section id="tools" class="tool-grid" aria-labelledby="tools-heading">
  <h2 id="tools-heading">A calm, capable PDF workspace</h2>
  <div class="cards">
    <article>
      <h3>Local by default</h3>
      <p>Your files stay in the browser for deterministic tools.</p>
    </article>
    <article>
      <h3>Honest capability</h3>
      <p>Unsupported inputs explain what happened and what to try next.</p>
    </article>
    <article>
      <h3>Composable workflows</h3>
      <p>Recipes, previews, and batch work share one engine contract.</p>
    </article>
  </div>

  <nav class="tool-directory" aria-labelledby="directory-heading">
    <h3 id="directory-heading">Create and invoices</h3>
    <ul>
      <li><a href="/create-pdf">Blank / templated PDF creator</a></li>
      <li><a href="/invoice-creator">Invoice creator with saved templates</a></li>
      <li><a href="/e-invoice">Electronic invoice (UBL-style XML)</a></li>
      <li><a href="/qr-code">QR code generator</a></li>
      <li><a href="/document-pack-builder">Document pack builder</a></li>
      <li><a href="/scan-to-pdf">Scan to PDF</a></li>
    </ul>
  </nav>
</section>

<style>
  .hero,
  .tool-grid {
    margin: auto;
    max-width: 1280px;
    padding: 120px 40px 0;
  }

  .hero {
    text-align: center;
  }

  .eyebrow {
    color: var(--color-muted);
    font-size: 0.875rem;
    letter-spacing: 0.12em;
  }

  h1 {
    font-size: clamp(2.5rem, 6vw, 3.5rem);
    letter-spacing: -0.05em;
    line-height: 1.1;
    margin: 16px auto;
    max-width: 800px;
  }

  .lede {
    color: var(--color-muted);
    font-size: 1.25rem;
    margin: auto;
    max-width: 640px;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    justify-content: center;
    margin: 32px 0;
  }

  /* Matches packages/ui Button.svelte so the hero CTAs look identical to every
     tool page, with the same 44px touch target. */
  .actions .button {
    align-items: center;
    border: 1px solid transparent;
    border-radius: var(--radius-pill, 999px);
    display: inline-flex;
    font: 600 1rem/1.5 var(--font-sans, system-ui, sans-serif);
    min-height: 44px;
    padding: 10px 28px;
    text-decoration: none;
  }
  .actions .button-primary {
    background: var(--color-ink);
    color: var(--color-white);
  }
  .actions .button-secondary {
    border-color: var(--color-hairline);
    color: var(--color-ink);
  }
  .actions .button:focus-visible {
    outline: 3px solid var(--color-focus, #1c1a17);
    outline-offset: 3px;
  }

  .status {
    color: var(--color-muted);
  }

  .tool-grid {
    padding-top: 100px;
  }

  h2 {
    font-size: 2rem;
    letter-spacing: -0.04em;
  }

  .cards {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(3, 1fr);
  }

  /* Real tool links, not marketing copy: the "Browse tools" CTA used to land on
     three brand statements, which left every tool reachable only by typing a
     URL. */
  .tool-directory {
    border-top: 1px solid var(--color-hairline);
    margin-top: 48px;
    padding-top: 32px;
  }
  .tool-directory h3 {
    font-size: 1.125rem;
    margin: 0 0 16px;
  }
  .tool-directory ul {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(3, 1fr);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .tool-directory a {
    color: inherit;
    text-decoration: none;
  }
  .tool-directory a:hover {
    text-decoration: underline;
  }
  .tool-directory a:focus-visible {
    outline: 2px solid currentcolor;
    outline-offset: 4px;
  }
  @media (max-width: 767px) {
    .tool-directory ul {
      grid-template-columns: 1fr;
    }
  }

  article {
    background: var(--color-white);
    border-radius: var(--radius-panel);
    padding: 24px;
  }

  article p {
    color: var(--color-muted);
  }

  @media (max-width: 767px) {
    .hero,
    .tool-grid {
      padding-inline: 24px;
      padding-top: 80px;
    }

    .cards {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 479px) {
    .hero,
    .tool-grid {
      padding-inline: 16px;
    }
  }
</style>
