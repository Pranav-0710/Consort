// ESLint flat config for the whole monorepo.
//
// Workspace boundaries are enforced here, by ESLint alone:
//   1. `no-restricted-imports` allows each workspace only the @consort/* packages it may
//      depend on, and bans Node built-ins, DOM globals and Cloudflare types in protocol.
//   2. `consort/no-cross-workspace-relative` (defined below) rejects relative imports that
//      reach into another workspace's files, which package-name rules cannot see.
// The tests in test/boundaries.test.ts prove both. See docs/CONTRIBUTING.md.
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Every workspace, the @consort packages it may import, and its runtime.
// Keep in sync with "workspaces" in package.json and the references in tsconfig.json.
export const WORKSPACES = {
  'packages/protocol': { allow: [], env: 'neutral' },
  'packages/client': { allow: ['protocol'], env: 'neutral' },
  'apps/coordinator': { allow: ['protocol'], env: 'workers' },
  'apps/web': { allow: ['protocol', 'client'], env: 'browser' },
  'packages/adapter-claude': { allow: ['protocol', 'client'], env: 'node' },
  'tools/check-runner': { allow: ['protocol', 'client'], env: 'node' },
  'tools/rehearsal': { allow: ['protocol', 'client'], env: 'node' },
  'tools/measure': { allow: ['protocol', 'client'], env: 'node' },
  'spike/harness': { allow: ['protocol', 'client'], env: 'node' },
};

const ENV_GLOBALS = {
  neutral: { ...globals.es2022 },
  browser: { ...globals.es2022, ...globals.browser },
  workers: { ...globals.es2022, ...globals.serviceworker },
  node: { ...globals.es2022, ...globals.node },
};

const NODE_BUILTINS = builtinModules.filter((m) => !m.startsWith('_'));
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'HTMLElement',
  'Element',
];

function workspaceOf(absPath) {
  const rel = path.relative(ROOT, absPath).split(path.sep).join('/');
  return Object.keys(WORKSPACES).find((dir) => rel === dir || rel.startsWith(`${dir}/`)) ?? null;
}

const consortPlugin = {
  rules: {
    'no-cross-workspace-relative': {
      meta: {
        type: 'problem',
        docs: { description: "Reject relative imports that reach into another workspace's files." },
        messages: {
          cross:
            "Relative import reaches into '{{target}}'. Import another workspace by its @consort package name, if this workspace is allowed to depend on it.",
        },
        schema: [],
      },
      create(context) {
        const from = workspaceOf(context.filename);
        if (!from) return {};
        const check = (node) => {
          const source = node.source;
          if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
          if (!source.value.startsWith('.')) return;
          const target = workspaceOf(path.resolve(path.dirname(context.filename), source.value));
          if (target !== from) {
            context.report({
              node: source,
              messageId: 'cross',
              data: { target: target ?? 'outside any workspace' },
            });
          }
        };
        return {
          ImportDeclaration: check,
          ExportNamedDeclaration: check,
          ExportAllDeclaration: check,
          ImportExpression: check,
        };
      },
    },
  },
};

function boundaryRule(dir, { allow }) {
  const allowed = allow.length ? allow.map((a) => `@consort/${a}`).join(', ') : 'no other @consort package';
  const patterns = [
    {
      group: ['@consort/*', ...allow.map((a) => `!@consort/${a}`)],
      message: `${dir} may import only ${allowed} (dependency direction, issue #2).`,
    },
  ];
  const paths = [];
  if (dir === 'packages/protocol') {
    patterns.push(
      { group: ['node:*'], message: 'protocol must stay runtime-neutral: no Node built-ins.' },
      { group: ['@cloudflare/*'], message: 'protocol must stay runtime-neutral: no Cloudflare types.' },
    );
    for (const name of NODE_BUILTINS) {
      paths.push({ name, message: 'protocol must stay runtime-neutral: no Node built-ins.' });
    }
  }
  return ['error', { paths, patterns }];
}

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**', '**/coverage/**', 'docs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { consort: consortPlugin },
  },
  // Root-level config and test files run on Node.
  {
    files: ['*.{js,mjs,cjs,ts}', 'test/**/*.{js,mjs,ts}', '.github/**/*.{js,mjs}'],
    languageOptions: { globals: ENV_GLOBALS.node },
  },
  // One block per workspace: runtime globals plus its boundary rules.
  ...Object.entries(WORKSPACES).map(([dir, ws]) => ({
    files: [`${dir}/**/*.{js,mjs,cjs,ts,tsx,jsx}`],
    languageOptions: { globals: ENV_GLOBALS[ws.env] },
    rules: {
      'no-restricted-imports': boundaryRule(dir, ws),
      'consort/no-cross-workspace-relative': 'error',
      ...(dir === 'packages/protocol'
        ? {
            'no-restricted-globals': [
              'error',
              ...DOM_GLOBALS.map((name) => ({
                name,
                message: 'protocol must stay runtime-neutral: no DOM.',
              })),
            ],
          }
        : {}),
    },
  })),
  // Accessibility rules for the web app's JSX.
  {
    ...jsxA11y.flatConfigs.recommended,
    files: ['apps/web/**/*.{jsx,tsx}'],
  },
);
