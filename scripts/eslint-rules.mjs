const isMemberNamed = (node, name) =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.property?.type === 'Identifier' &&
  node.property.name === name;

export const noUnsafeDom = {
  meta: {
    type: 'problem',
    docs: { description: 'Reject unsafe DOM sinks unless explicitly reviewed.' },
    schema: [],
    messages: {
      eval: 'eval() is forbidden; use a typed, deterministic implementation.',
      html: 'innerHTML is forbidden outside a reviewed safe-HTML adapter.',
    },
  },
  create(context) {
    const source = context.sourceCode?.text ?? '';
    const reviewed = source.includes('safe-html-reviewed');
    return {
      CallExpression(node) {
        if (!reviewed && node.callee.type === 'Identifier' && node.callee.name === 'eval') {
          context.report({ node, messageId: 'eval' });
        }
      },
      AssignmentExpression(node) {
        if (!reviewed && isMemberNamed(node.left, 'innerHTML')) {
          context.report({ node, messageId: 'html' });
        }
      },
      MemberExpression(node) {
        if (!reviewed && isMemberNamed(node, 'innerHTML')) {
          context.report({ node, messageId: 'html' });
        }
      },
    };
  },
};

/**
 * Rejects a user-visible string literal written directly into a page shell's
 * markup or script.
 *
 * README §21 says `en-XA` exists to "catch hardcoded strings". It could not.
 * `pseudo()` is applied to the *fallback* passed to `translate()`, so a literal
 * typed straight into a template is never accented, never padded, and never
 * translated — the pseudo-locale pass stayed green over untranslated copy. This
 * rule closes that hole at the point of authorship instead of after it.
 *
 * The check is deliberately narrow, because a broad "any English literal" rule
 * would flag class names, `accept` MIME types, engine op ids, filenames, and
 * the English fallback every `t()` call legitimately carries. Only two shapes
 * are reported:
 *
 *   1. A text node in markup — `>Rotate pages<` — which a user reads.
 *   2. A string assigned to a status/label/error/message field, which becomes
 *      user-visible the moment it renders.
 *
 * `t(key, 'English fallback')` is always allowed: the fallback is the English
 * *source*, not an untranslated string.
 */

/** Prop/state names whose value is rendered to the user. */
const VISIBLE_FIELDS = new Set([
  'status',
  'error',
  'message',
  'label',
  'title',
  'description',
  'note',
  'unavailableReason',
  'actionLabel',
  'eyebrow',
  'headline',
  'placeholder',
]);

/** Files that render tool copy and therefore must route it through `translate`. */
const SHELL_FILES = [
  'ToolWorkspace.svelte',
  'PhaseCTool.svelte',
  'ConversionTool.svelte',
  'FeaturePage.svelte',
];

/** Words that are legitimately Latin in any locale (format names, units, paths). */
const LATIN_ALLOWANCE =
  /\b(PDF|PDF\/A|DOCX|XLSX|PPTX|XML|UBL|OASIS|CAD|ISO|IndexedDB|JavaScript|Relay|Bates|pdfium|QR|AcroForm|JPEG|PNG|SSN|CSV|HTML|UTF|JS|CSS|OK|GB|MB|KB|P1|https?)\b/u;

/**
 * Copy that is genuinely a brand or a proper noun and so stays Latin in every
 * locale. Kept narrow: anything that could be prose belongs in the catalogue.
 */
const BRAND_ALLOWANCE = /(pdf\.complianttools\.com|com\.[a-z]+)/iu;

/** A text node with real prose: letters, not just symbols or punctuation. */
const hasProse = (text) =>
  /[A-Za-z]{2,}/u.test(text) && !LATIN_ALLOWANCE.test(text) && !BRAND_ALLOWANCE.test(text);

export const noUntranslatedCopy = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'User-visible strings in a page shell must go through translate(), not be written inline.',
    },
    schema: [],
    messages: {
      markup:
        "User-visible copy must be a translate() call, not a literal in markup. Wrap it: t('shell.…', '…').",
      field:
        '`{{field}}` becomes user-visible, so it must be a translate() call rather than a literal.',
    },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    if (!SHELL_FILES.some((shell) => filename.endsWith(shell))) return {};

    const inScript = (node) => {
      // Walk up to see whether the literal already sits inside a `t(...)` call.
      let current = node.parent;
      while (current) {
        if (
          current.type === 'CallExpression' &&
          current.callee.type === 'Identifier' &&
          current.callee.name === 't'
        ) {
          return true;
        }
        if (current.type === 'SvelteElement' || current.type === 'Program') break;
        current = current.parent;
      }
      return false;
    };

    const text = context.sourceCode.getText();
    // The `<style>` block is parsed into the same AST as markup, so a CSS
    // property name reads as an English word. A user never sees it.
    const styleStart = text.indexOf('<style');
    const styleEnd = text.indexOf('</style>');

    return {
      // `>Rotate pages<` — a text node between tags.
      SvelteText(node) {
        const copy = node.value.trim();
        if (copy.length < 3 || !hasProse(copy) || inScript(node)) return;
        if (styleStart !== -1 && node.range[0] > styleStart && node.range[0] < styleEnd) return;
        context.report({ node, messageId: 'markup' });
      },
      // `status = 'Working locally…'` — assigned to a rendered field.
      AssignmentExpression(node) {
        const left = node.left;
        if (left.type !== 'Identifier' || !VISIBLE_FIELDS.has(left.name)) return;
        const right = node.right;
        if (right.type !== 'Literal' || typeof right.value !== 'string') return;
        if (!hasProse(right.value) || inScript(node)) return;
        context.report({ node, messageId: 'field', data: { field: left.name } });
      },
    };
  },
};

export const noEngineFetch = {
  meta: {
    type: 'problem',
    docs: { description: 'Keep network transport out of the engine.' },
    schema: [],
    messages: { fetch: 'Direct fetch is forbidden in packages/engine; use ai/transport.ts only.' },
  },
  create(context) {
    const filename = context.filename.replaceAll('\\', '/');
    const inEngine =
      filename.includes('/packages/engine/') || filename.startsWith('packages/engine/');
    const isTransport =
      filename.endsWith('/ai/transport.ts') || filename.endsWith('packages/engine/ai/transport.ts');
    return {
      CallExpression(node) {
        if (
          inEngine &&
          !isTransport &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'fetch'
        ) {
          context.report({ node, messageId: 'fetch' });
        }
      },
    };
  },
};
