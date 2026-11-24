// Proves the workspace dependency rules in eslint.config.mjs reject what issue #2 requires.
// Each case lints a snippet as if it lived at the given path, using the real repo config,
// and checks which rule fired, not just that something did.
// Dynamic and type-only imports (import(), typeof import()) are not covered yet: see #85.
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });

const BOUNDARY_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-globals',
  'consort/no-cross-workspace-relative',
]);

const PRODUCT_WORKSPACES = [
  'apps/web',
  'apps/coordinator',
  'packages/protocol',
  'packages/client',
  'packages/adapter-claude',
  'tools/check-runner',
  'tools/rehearsal',
  'tools/measure',
];

// Loading the config cold takes several seconds on Windows; do it once, outside any test timeout.
beforeAll(async () => {
  await eslint.calculateConfigForFile('apps/web/src/a.ts');
}, 60_000);

/** Rule IDs of the boundary rules that fired for this snippet. */
async function firedRules(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .map((m) => m.ruleId)
    .filter((id): id is string => id !== null && BOUNDARY_RULES.has(id));
}

describe('workspace boundaries', () => {
  it('web importing coordinator source is rejected', async () => {
    const file = 'apps/web/src/feature.ts';
    expect(await firedRules(file, "import x from '@consort/coordinator';\nexport { x };")).toEqual([
      'no-restricted-imports',
    ]);
    expect(await firedRules(file, "import x from '../../coordinator/src/index.js';\nexport { x };")).toEqual([
      'consort/no-cross-workspace-relative',
    ]);
  });

  it('protocol importing a Node built-in, DOM or Cloudflare type is rejected', async () => {
    const file = 'packages/protocol/src/schema.ts';
    expect(
      await firedRules(file, "import { readFileSync } from 'node:fs';\nexport { readFileSync };"),
    ).toEqual(['no-restricted-imports']);
    expect(await firedRules(file, "import { createHash } from 'crypto';\nexport { createHash };")).toEqual([
      'no-restricted-imports',
    ]);
    expect(await firedRules(file, 'export const title = () => document.title;')).toEqual([
      'no-restricted-globals',
    ]);
    expect(
      await firedRules(
        file,
        "import type { DurableObjectState } from '@cloudflare/workers-types';\nexport type S = DurableObjectState;",
      ),
    ).toEqual(['no-restricted-imports']);
  });

  it('any product workspace importing spike/ is rejected', async () => {
    for (const dir of PRODUCT_WORKSPACES) {
      const file = `${dir}/src/a.ts`;
      expect(await firedRules(file, "import x from '@consort/spike-harness';\nexport { x };"), file).toEqual([
        'no-restricted-imports',
      ]);
      expect(
        await firedRules(file, "import x from '../../../spike/harness/src/index.js';\nexport { x };"),
        file,
      ).toEqual(['consort/no-cross-workspace-relative']);
    }
  });

  it('tools importing coordinator source is rejected', async () => {
    for (const file of [
      'tools/check-runner/src/a.ts',
      'tools/rehearsal/src/a.ts',
      'tools/measure/src/a.ts',
    ]) {
      expect(await firedRules(file, "import x from '@consort/coordinator';\nexport { x };"), file).toEqual([
        'no-restricted-imports',
      ]);
      expect(
        await firedRules(file, "import x from '../../../apps/coordinator/src/index.js';\nexport { x };"),
        file,
      ).toEqual(['consort/no-cross-workspace-relative']);
    }
  });

  // Control cases: the rules must not reject the allowed dependency direction.
  it('allowed imports are accepted', async () => {
    expect(
      await firedRules('apps/web/src/a.ts', "import { x } from '@consort/client';\nexport { x };"),
    ).toEqual([]);
    expect(
      await firedRules('packages/client/src/a.ts', "import { x } from '@consort/protocol';\nexport { x };"),
    ).toEqual([]);
    expect(
      await firedRules('apps/coordinator/src/a.ts', "import { x } from './commands/b.js';\nexport { x };"),
    ).toEqual([]);
    expect(
      await firedRules('tools/measure/src/a.ts', "import { x } from '@consort/protocol';\nexport { x };"),
    ).toEqual([]);
  });

  it('coordinator importing the web app or client is rejected', async () => {
    const file = 'apps/coordinator/src/a.ts';
    expect(await firedRules(file, "import x from '@consort/web';\nexport { x };")).toEqual([
      'no-restricted-imports',
    ]);
    expect(await firedRules(file, "import x from '@consort/client';\nexport { x };")).toEqual([
      'no-restricted-imports',
    ]);
  });
});
