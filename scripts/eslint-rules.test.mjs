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
