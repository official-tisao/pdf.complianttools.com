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
