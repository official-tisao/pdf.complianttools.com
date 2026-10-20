import { redirect } from '@sveltejs/kit';

export function GET({ params }) {
  throw redirect(301, `/${params.locale}/resize-pdf-pages`);
}
