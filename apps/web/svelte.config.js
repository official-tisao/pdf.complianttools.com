import adapter from '@sveltejs/adapter-static';

// SvelteKit runs the config in the CLI process, where `$app/environment` does
// not exist. `BUILDING` is set by the build script and unset for the dev server,
// which is the signal this file needs.
const isBuild = process.env.PDF_TOOLS_BUILD === '1';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({ fallback: '200.html' }),
    prerender: {
      handleHttpError: 'warn',
    },
    // Registered for real builds only. Enabling this while the dev server runs
    // makes it stop emitting the client module, so the app never hydrates and
    // every hydration-dependent test fails against a page that merely looks
    // fine. A service worker is a production concern: `vite build` is what
    // emits it, and the offline suite runs against a served build.
    ...(isBuild ? { serviceWorker: { register: true } } : {}),
  },
};

export default config;
