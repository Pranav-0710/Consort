// Proves the workspace dependency rules in eslint.config.mjs reject what issue #2 requires.
// Each case lints a snippet as if it lived at the given path, using the real repo config.
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({ cwd: root });

const BOUNDARY_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-globals',
  'consort/no-cross-workspace-relative',
]);

async function boundaryViolations(filePath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId !== null && BOUNDARY_RULES.has(m.ruleId))
    .map((m) => `${m.ruleId}: ${m.message}`);
}

describe('workspace boundaries', () => {
  it('web importing coordinator source is rejected', async () => {
    const file = 'apps/web/src/feature.ts';
    expect(
      await boundaryViolations(file, "import x from '@consort/coordinator';\nexport { x };"),
    ).not.toEqual([]);
    expect(
      await boundaryViolations(file, "import x from '../../coordinator/src/index.js';\nexport { x };"),
    ).not.toEqual([]);
  });

  it('protocol importing a Node built-in, DOM or Cloudflare type is rejected', async () => {
    const file = 'packages/protocol/src/schema.ts';
    expect(
      await boundaryViolations(file, "import { readFileSync } from 'node:fs';\nexport { readFileSync };"),
    ).not.toEqual([]);
    expect(
      await boundaryViolations(file, "import { createHash } from 'crypto';\nexport { createHash };"),
    ).not.toEqual([]);
    expect(await boundaryViolations(file, 'export const title = () => document.title;')).not.toEqual([]);
    expect(
      await boundaryViolations(
        file,
        "import type { DurableObjectState } from '@cloudflare/workers-types';\nexport type S = DurableObjectState;",
      ),
    ).not.toEqual([]);
  });

  it('any product workspace importing spike/ is rejected', async () => {
    for (const file of [
      'apps/web/src/a.ts',
      'apps/coordinator/src/a.ts',
      'packages/protocol/src/a.ts',
      'packages/client/src/a.ts',
      'packages/adapter-claude/src/a.ts',
      'tools/check-runner/src/a.ts',
    ]) {
      expect(
        await boundaryViolations(file, "import x from '@consort/spike-harness';\nexport { x };"),
        file,
      ).not.toEqual([]);
      expect(
        await boundaryViolations(file, "import x from '../../../spike/harness/src/index.js';\nexport { x };"),
        file,
      ).not.toEqual([]);
    }
  });

  it('tools importing coordinator source is rejected', async () => {
    for (const file of [
      'tools/check-runner/src/a.ts',
      'tools/rehearsal/src/a.ts',
      'tools/measure/src/a.ts',
    ]) {
      expect(
        await boundaryViolations(file, "import x from '@consort/coordinator';\nexport { x };"),
        file,
      ).not.toEqual([]);
      expect(
        await boundaryViolations(
          file,
          "import x from '../../../apps/coordinator/src/index.js';\nexport { x };",
        ),
        file,
      ).not.toEqual([]);
    }
  });

  // Control cases: the rules must not reject the allowed dependency direction.
  it('allowed imports are accepted', async () => {
    expect(
      await boundaryViolations('apps/web/src/a.ts', "import { x } from '@consort/client';\nexport { x };"),
    ).toEqual([]);
    expect(
      await boundaryViolations(
        'packages/client/src/a.ts',
        "import { x } from '@consort/protocol';\nexport { x };",
      ),
    ).toEqual([]);
    expect(
      await boundaryViolations(
        'apps/coordinator/src/a.ts',
        "import { x } from './commands/b.js';\nexport { x };",
      ),
    ).toEqual([]);
    expect(
      await boundaryViolations(
        'tools/measure/src/a.ts',
        "import { x } from '@consort/protocol';\nexport { x };",
      ),
    ).toEqual([]);
  });

  it('coordinator importing the web app or client is rejected', async () => {
    const file = 'apps/coordinator/src/a.ts';
    expect(await boundaryViolations(file, "import x from '@consort/web';\nexport { x };")).not.toEqual([]);
    expect(await boundaryViolations(file, "import x from '@consort/client';\nexport { x };")).not.toEqual([]);
  });
});
