<script lang="ts">
  import { setLocaleContext, type UiLocale } from '../__locale/context';
  import { localeAttributes } from '$lib/i18n';
  import type { LayoutProps } from './$types';

  let { data, children }: LayoutProps = $props();

  // Read once, deliberately. `locale` is a path segment, so it cannot change
  // without a navigation to a different route — which remounts this layout and
  // runs this again. `setContext` also only accepts a value during
  // initialisation, so capturing here is required, not merely convenient.
  // svelte-ignore state_referenced_locally
  const locale = data.locale as UiLocale;

  // Set before the children render, so every page shell below reads the right
  // locale. English routes sit outside this tree and fall back to `en`.
  setLocaleContext(locale);

  const attributes = $derived(localeAttributes(locale));
</script>

<!--
  `lang` and `dir` wrap the localized subtree rather than sitting on <html>.
  SvelteKit has no `<svelte:html>` tag and `app.html` is static, so the document
  element cannot carry a per-route attribute without a hook that rewrites the
  prerendered markup. Wrapping is sufficient for direction: the browser applies
  `dir` to the whole subtree, which is the convention the invoice surfaces
  already ship with.
-->
<div class="locale-root" lang={attributes.lang} dir={attributes.dir}>
  {@render children?.()}
</div>

<style>
  /* The wrapper exists only to carry `lang`/`dir`; it must not introduce a
     block that changes the page's own layout. */
  .locale-root {
    display: contents;
  }
</style>
