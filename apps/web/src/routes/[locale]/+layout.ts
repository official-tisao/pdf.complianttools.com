import { error } from '@sveltejs/kit';

const LOCALES = ['en', 'en-XA', 'ar'] as const;

/**
 * Restricts /[locale] to the three locales README §21 defines. Anything else is
 * a 404 rather than a silent English fallback, because a mistyped or
 * crawler-discovered URL should not resolve to a page in the wrong language.
 */
export const load = ({ params }: { params: { locale: string } }) => {
  if (!LOCALES.includes(params.locale as (typeof LOCALES)[number])) {
    error(404, `Unknown locale "${params.locale}". Supported: ${LOCALES.join(', ')}.`);
  }
  return { locale: params.locale };
};

export const prerender = true;
export const ssr = true;
