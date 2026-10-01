import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const eslint = new ESLint({
  cwd: root,
  ignore: false,
  overrideConfigFile: resolve(root, 'eslint.config.mjs'),
});

test('unsafe DOM fixture fails the custom lint rule', async () => {
  const [result] = await eslint.lintText(
    'const value = eval("1"); document.body.innerHTML = value;',
    {
      filePath: resolve(root, 'tests/eslint-fixtures/no-unsafe-dom.ts'),
    },
  );
  assert.ok(result.messages.some((message) => message.ruleId === 'project-security/no-unsafe-dom'));
});

test('engine fetch fixture fails outside the transport seam', async () => {
  const [result] = await eslint.lintText('await fetch("https://example.test");', {
    filePath: resolve(root, 'packages/engine/src/not-allowed.ts'),
  });
  assert.ok(
    result.messages.some((message) => message.ruleId === 'project-security/no-engine-fetch'),
  );
});

/**
 * STCC #11. `en-XA` is documented as catching hardcoded strings, and could not:
 * `pseudo()` is applied to the fallback given to `translate()`, so a literal in
 * a template was never accented, padded, or translated — and the pseudo-locale
 * pass stayed green. These fixtures pin the rule that closes that hole, in both
 * directions: a planted literal must fail, and legitimate copy must pass.
 */
const shellPath = (name) => resolve(root, `apps/web/src/lib/${name}`);

test('a user-visible literal in shell markup fails the i18n rule', async () => {
  const [result] = await eslint.lintText(
    `<script lang="ts">let { locale = 'en' } = $props();</script>
<section><p class="eyebrow">EDIT &amp; SECURITY</p><h1>Rotate pages</h1></section>`,
    { filePath: shellPath('ToolWorkspace.svelte') },
  );
  const hits = result.messages.filter(
    (message) => message.ruleId === 'project-security/no-untranslated-copy',
  );
  assert.ok(hits.length >= 2, `expected both literals reported, got ${hits.length}`);
  assert.match(hits[0].message, /translate\(\)/u);
});

test('a literal assigned to a rendered field fails the i18n rule', async () => {
  const [result] = await eslint.lintText(
    `<script lang="ts">
  const t = (key: string, fallback: string) => fallback;
  let status = $state('');
  function run() { status = 'Working locally'; }
</script>`,
    { filePath: shellPath('ToolWorkspace.svelte') },
  );
  assert.ok(
    result.messages.some(
      (message) =>
        message.ruleId === 'project-security/no-untranslated-copy' &&
        /`status` becomes user-visible/u.test(message.message),
    ),
  );
});

test('copy routed through translate is allowed, fallback and all', async () => {
  // The English fallback is the *source* locale, not an untranslated string, so
  // both halves of `t(key, 'English')` must pass. A rule that rejected this
  // would make the catalogue impossible to write.
  const [result] = await eslint.lintText(
    `<script lang="ts">
  const t = (key: string, fallback: string) => fallback;
  let status = $state('');
  function run() { status = t('shell.status.working', 'Working locally…'); }
</script>
<section><p>{t('shell.preview.empty', 'Page previews appear here after you select a PDF.')}</p></section>`,
    { filePath: shellPath('ToolWorkspace.svelte') },
  );
  assert.deepEqual(
    result.messages.filter((m) => m.ruleId === 'project-security/no-untranslated-copy'),
    [],
  );
});

test('non-copy literals are not flagged', async () => {
  // Class names, MIME types, engine op ids and filenames are English-looking
  // but never read by a user. Flagging them would train the rule to be ignored.
  const [result] = await eslint.lintText(
    `<script lang="ts">
  const accept = '.pdf,application/pdf';
  let label = $state('');
  function run() { label = accept; }
</script>
<section><a href="/pdf-to-pdfa" class="button-primary">PDF/A</a></section>`,
    { filePath: shellPath('ConversionTool.svelte') },
  );
  assert.deepEqual(
    result.messages.filter((m) => m.ruleId === 'project-security/no-untranslated-copy'),
    [],
  );
});

test('the rule applies only to the four page shells', async () => {
  // A route file legitimately holds its own English copy until it is catalogued,
  // and the invoice surfaces keep their copy in their own catalogue.
  const [result] = await eslint.lintText('<section><p>Scan images</p></section>', {
    filePath: resolve(root, 'apps/web/src/lib/InvoiceBuilder.svelte'),
  });
  assert.deepEqual(
    result.messages.filter((m) => m.ruleId === 'project-security/no-untranslated-copy'),
    [],
  );
});
