import { expect, type Page } from '@playwright/test';

/**
 * Waiting for a route to be interactive.
 *
 * Every route in this app is prerendered (README §7.6, SvelteKit +
 * adapter-static), so the served HTML is complete before any client code runs.
 * That has two consequences for a browser test:
 *
 *   1. The prerendered markup accepts input, then throws it away when the
 *      client mounts. `fill()` writes into the pre-hydration DOM, the values
 *      vanish, and the assertion observes the initial state — while a manual
 *      run with a sleep passes, so the app looks fine. The bug is in the test.
 *   2. `axe` can only see the DOM the browser actually built. Auditing the
 *      prerendered shell measures markup no user with JavaScript enabled ever
 *      interacts with — and anything a route paints after mount (a `<canvas>`
 *      in the viewer, a hydrated grid) is simply absent from it.
 *
 * So "the heading is visible" proves nothing about either. The layout sets
 * `data-hydrated` on `<body>` via an action (`apps/web/src/routes/+layout.svelte`),
 * which fires only once the client component has mounted, and the page shells
 * set the same attribute on their root element. Waiting on the body attribute
 * covers every route, including the eleven that mount no page shell and so have
 * no component-level signal.
 */

/** A cold dev server compiles a route on first request; the default 5s is not enough. */
export const HYDRATION_TIMEOUT = 30_000;

/** Navigates and waits until the client has mounted. */
export const openHydrated = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  await expect(page.locator('body[data-hydrated="true"]')).toBeAttached({
    timeout: HYDRATION_TIMEOUT,
  });
};

/**
 * Navigates and waits for the invoice builder specifically.
 *
 * Its own signal is kept because a form that silently falls back to the
 * pre-hydration DOM is the failure this file exists to prevent, and
 * `.builder` is more specific than the document-wide flag.
 */
export const openBuilder = async (page: Page, path: string): Promise<void> => {
  await page.goto(path);
  await expect(page.locator('.builder[data-hydrated="true"]')).toBeAttached({
    timeout: HYDRATION_TIMEOUT,
  });
};
