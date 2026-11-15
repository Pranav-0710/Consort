// Backs the #4 criterion "the harness never opens Claude credential or config secrets":
// no harness source file refers to Claude's credential or config locations, or reads
// provider-credential environment variables. A reviewer still confirms this by reading the code.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC = path.dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [full] : [];
  });
}

const FORBIDDEN = [
  /\.credentials/i,
  /\.claude\.json/i,
  /['"`/\\]\.claude['"`/\\]/,
  /homedir\(/,
  /ANTHROPIC_API_KEY/,
  /CLAUDE_CODE_OAUTH/,
  /process\.env\[['"]CLAUDE_(?!CODE_SESSION_ID)/,
];

describe('harness safety', () => {
  it('harness source never refers to Claude credential or config locations', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(5);
    const offences = files.flatMap((file) => {
      const text = readFileSync(file, 'utf8');
      return FORBIDDEN.filter((pattern) => pattern.test(text)).map(
        (pattern) => `${path.relative(SRC, file)} matches ${pattern}`,
      );
    });
    expect(offences).toEqual([]);
  });
});
