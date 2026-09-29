<script lang="ts">
  import '@pdf-complianttools/ui/tokens.css';
  import { page } from '$app/state';
  import { HREFLANG, canonicalUrl } from '$lib/seo';

  let { children } = $props();
</script>

<svelte:head>
  <meta name="theme-color" content="#f0eeea" />
  <!--
    No site-wide <meta name="description"> here on purpose. SvelteKit does NOT
    dedupe <svelte:head> entries by attribute name, so shipping a default here
    produced TWO description tags on every tool route (verified in the build
    output) — a conflict for crawlers. The description is therefore owned
    solely by the page: each tool component sets a specific one.

    Canonical and hreflang DO live here, unlike the description. They are
    derived purely from the route path, so every page computes the identical
    value for itself, and deriving them once here means a new route cannot ship
    without them.
  -->
  <link rel="canonical" href={canonicalUrl(page.url.pathname)} />
  {#each HREFLANG as entry (entry.hreflang)}
    <link rel="alternate" hreflang={entry.hreflang} href={canonicalUrl(page.url.pathname)} />
  {/each}
</svelte:head>

<header class="site-header">
  <a class="brand" href="/">pdf.complianttools.com</a>
  <nav aria-label="Primary navigation">
    <a href="/merge">Merge</a>
    <a href="/convert">Convert</a>
    <a href="/create-pdf">Create</a>
    <a href="/invoice-creator">Invoices</a>
    <a href="/e-invoice">E-invoice</a>
    <a href="/pdf-to-markdown">PDF to Markdown</a>
    <a href="/recipe">Recipes</a>
    <a href="/batch">Batch</a>
    <a href="/ai/chat-with-pdf">AI tools</a>
    <a href="/connect-ai">Connect AI</a>
    <a href="/#tools">Tools</a>
  </nav>
  <span class="mode" aria-label="Processing mode">Local-first</span>
</header>

<main>
  {@render children()}
</main>

<footer>
  <span>Nothing uploaded for local tools.</span>
  <span aria-live="polite">{page.url.pathname}</span>
</footer>

<style>
  :global(body) {
    background: var(--color-canvas);
    color: var(--color-ink);
    font-family: var(--font-sans);
    margin: 0;
  }

  .site-header,
  footer {
    align-items: center;
    display: flex;
    justify-content: space-between;
    margin: auto;
    max-width: 1280px;
    padding: 16px 40px;
  }

  .brand,
  nav a {
    color: inherit;
    text-decoration: none;
  }

  .brand {
    font-weight: 600;
  }

  nav {
    display: flex;
    gap: 28px;
  }

  .mode,
  footer {
    color: var(--color-muted);
    font-size: 0.875rem;
  }

  footer {
    border-top: 1px solid var(--color-hairline);
    margin-top: 80px;
  }

  @media (max-width: 767px) {
    .site-header,
    footer {
      padding-inline: 24px;
    }

    nav {
      display: none;
    }
  }

  @media (max-width: 479px) {
    .site-header,
    footer {
      padding-inline: 16px;
    }
  }
</style>
