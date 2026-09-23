<script lang="ts">
  import '@pdf-complianttools/ui/tokens.css';
  import { page } from '$app/state';

  let { children } = $props();
</script>

<svelte:head>
  <meta name="theme-color" content="#f0eeea" />
  <meta name="description" content="Local-first PDF tools that run in your browser." />
</svelte:head>

<header class="site-header">
  <a class="brand" href="/">pdf.complianttools.com</a>
  <nav aria-label="Primary navigation">
    <a href="/merge">Merge</a>
    <a href="/convert">Convert</a>
    <a href="/pdf-to-markdown">PDF to Markdown</a>
    <a href="/recipe">Recipes</a>
    <a href="/batch">Batch</a>
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
