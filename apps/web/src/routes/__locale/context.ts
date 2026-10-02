import { getContext, setContext } from 'svelte';
import type { Locale } from '$lib/i18n';

/** Re-exported so the layout need not import from two modules. */
export type UiLocale = Locale;

/**
 * The active UI locale, held in context rather than threaded as a prop.
 *
 * The four page shells each already accept `locale`, so they can be called
 * directly — but a generated `[locale]` route would otherwise have to
 * re-declare every prop of the route it mirrors (`title`, `format`, `accept`,
 * `options`, …), which is a second place to update whenever a tool's copy or
 * options change, and would drift silently.
 *
 * With the locale in context the generated route can render the canonical page
 * component unchanged:
 *
 *     <Route />            // the same component the English route renders
 *
 * and the shell reads `locale` from context instead of a prop. The route stays
 * defined once and is rendered in three locales.
 */

const KEY = Symbol('pdf-locale');

/** Set by the `[locale]` layout. Absent on English routes, which default to `en`. */
export function setLocaleContext(locale: UiLocale) {
  setContext(KEY, locale);
}

/**
 * The current locale, defaulting to `en`.
 *
 * `getContext` returns `undefined` outside a `[locale]` tree, which is the
 * normal case for the 76 English routes — so the default is the English
 * source locale rather than a required context, and no English route has to
 * change.
 */
export function getLocaleContext(): UiLocale {
  return getContext<UiLocale | undefined>(KEY) ?? 'en';
}
