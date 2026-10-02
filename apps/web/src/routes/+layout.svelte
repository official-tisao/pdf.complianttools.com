<script lang="ts">
  /* global HTMLElement */
  import '@pdf-complianttools/ui/tokens.css';
  import { page } from '$app/state';
  import { canonicalPath, canonicalUrl, hreflangLinks, staticRoute } from '$lib/seo';
  import '$lib/configure-pdfjs';
  import ToolDirectory from '$lib/ToolDirectory.svelte';

  let { children } = $props();

  /**
   * App-wide hydration signal.
   *
   * Every route is prerendered, so the served HTML is complete before the
   * client runs. An audit that reads the page before hydration measures markup
   * that no user with JavaScript enabled ever sees — and a `<canvas>` a route
   * paints only after mount simply is not in the DOM yet.
   *
   * It lives on `<body>` rather than on a shell because eleven routes mount no
   * page shell and so have no component-level signal to wait on, and because
   * one app-wide flag cannot drift from the others. `<svelte:body>` accepts
   * only event attributes, so this is an action rather than a bound attribute.
   *
   * SvelteKit keeps its own `hydrated` flag module-scoped and does not expose
   * it, so there is no framework signal to reuse here.
   */
  function markHydrated(node: HTMLElement) {
    node.dataset.hydrated = 'true';
    return {};
  }
</script>

<svelte:body use:markHydrated />

<svelte:head>
  <meta name="theme-color" content="#f0eeea" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <!--
    No site-wide <meta name="description"> here on purpose. SvelteKit does NOT
    dedupe <svelte:head> entries by attribute name, so shipping a default here
    produced TWO description tags on every tool route (verified in the build
    output) — a conflict for crawlers. The description is therefore owned
    solely by the page: each tool component sets a specific one.

    Canonical and hreflang DO live here, unlike the description. Deriving them
    once from the route path means a new route cannot ship without them.

    The canonical is the *unprefixed* URL on every locale, so all three variants
    of a page point at one document and the alternates below disambiguate it.
    Pointing each locale at itself would tell a crawler there are three
    competing documents rather than three translations of one.
  -->
  <link rel="canonical" href={canonicalUrl(canonicalPath(page.url.pathname))} />
  {#each hreflangLinks(page.url.pathname) as entry (entry.hreflang)}
    <link rel="alternate" hreflang={entry.hreflang} href={entry.href} />
  {/each}
</svelte:head>

<header class="site-header">
  <a class="brand" href="/">pdf.complianttools.com</a>
  <nav aria-label="Primary navigation">
    <a href={staticRoute('/merge')}>Merge</a>
    <a href={staticRoute('/convert')}>Convert</a>
    <a href={staticRoute('/create-pdf')}>Create</a>
    <a href={staticRoute('/invoice-creator')}>Invoices</a>
    <a href={staticRoute('/e-invoice')}>E-invoice</a>
    <a href={staticRoute('/pdf-to-markdown')}>PDF to Markdown</a>
    <a href={staticRoute('/recipe')}>Recipes</a>
    <a href={staticRoute('/batch')}>Batch</a>
    <a href={staticRoute('/ai/chat-with-pdf')}>AI tools</a>
    <a href={staticRoute('/connect-ai')}>Connect AI</a>
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

<!--
  Appendix E rule 9. Every page therefore links into the whole tool graph, not
  just the 11 routes the header lists — which is what lets a crawler (and a
  reader) reach a page it would not otherwise know exists.
-->
<ToolDirectory />

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
