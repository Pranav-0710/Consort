import { describe, expect, it } from 'vitest';

import { redact } from './redact.js';

// Synthetic values only. None of these is a real credential. Token-shaped samples are
// assembled at runtime from fragments, so no complete token literal appears in source
// and the repository's secret scan (gitleaks) has nothing to match.
const fake = (...parts: string[]) => parts.join('');
const BODY = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const TOKENS = {
  anthropic: fake('sk-', 'ant-', 'api03-', BODY),
  openai: fake('sk-', 'proj-', BODY.slice(0, 32)),
  githubClassic: fake('gh', 'p_', BODY),
  githubFine: fake('github', '_pat_', '11ABCDEFG0123456789', '_abcdefghijklmnop'),
  jwt: [
    fake('ey', 'JhbGciOiJIUzI1NiJ9'),
    fake('ey', 'JzdWIiOiIxMjM0NTY3ODkwIn0'),
    'dozjgNryP4J3jVmNHl0w5N',
  ].join('.'),
};

const SAMPLE = [
  '{"session_id":"abc","transcript_path":"C:\\\\Users\\\\alice\\\\.claude\\\\projects\\\\x.jsonl"}',
  `ANTHROPIC key ${TOKENS.anthropic} in a log`,
  `openai ${TOKENS.openai}`,
  `github ${TOKENS.githubClassic} and ${TOKENS.githubFine}`,
  'Authorization: Bearer abc.def-ghi_jkl012345',
  '{"token":"spike-shared-secret-123","refresh_token":"r3fr3sh","password":"hunter22"}',
  `jwt ${TOKENS.jwt}`,
  'mail from alice.example@example.com',
  'cwd /home/alice/consort and /Users/alice/consort and /c/Users/alice/consort and C:/Users/alice/x',
].join('\n');

describe('redact', () => {
  it('known token patterns in a sample log are removed', () => {
    const out = redact(SAMPLE);
    for (const secret of [
      ...Object.values(TOKENS),
      'abc.def-ghi_jkl012345',
      'spike-shared-secret-123',
      'r3fr3sh',
      'hunter22',
      'alice.example@example.com',
      'alice',
    ]) {
      expect(out, secret).not.toContain(secret);
    }
  });

  it('leaves ordinary hook fields readable', () => {
    const out = redact(
      '{"session_id":"7f3c","hook_event_name":"PostToolUse","tool_name":"Bash","max_tokens":5}',
    );
    expect(out).toContain('"session_id":"7f3c"');
    expect(out).toContain('"hook_event_name":"PostToolUse"');
    expect(out).toContain('"tool_name":"Bash"');
  });

  it('catches prefixed names, re-stringified JSON and other common credential shapes', () => {
    const value = fake('Zq', '9vXw', '2Lp7Rt');
    const cases: Array<[string, string]> = [
      [`export SPIKE_TOKEN=\\"${value}\\"`, value],
      [`{\\"token\\":\\"${value}\\"}`, value],
      [`client_secret=${value}`, value],
      [`DB_PASSWORD=${value}`, value],
      [`AWS_SECRET_ACCESS_KEY=${value}`, value],
      [`Authorization: Basic ${fake('dXNl', 'cjpwYXNz')}`, fake('dXNl', 'cjpwYXNz')],
      [`key ${fake('AK', 'IA', 'ABCDEFGHIJKLMNOP')}`, fake('AK', 'IA', 'ABCDEFGHIJKLMNOP')],
      [`slack ${fake('xo', 'xb-', '1234567890-abcdef')}`, fake('xo', 'xb-', '1234567890-abcdef')],
      [`Cookie: sid=${value}; theme=dark`, value],
      [`https://bob:${value}@git.example.org/repo`, value],
      [
        [fake('-----BEGIN ', 'PRIVATE KEY-----'), value, fake('-----END ', 'PRIVATE KEY-----')].join('\\n'),
        value,
      ],
    ];
    for (const [input, secret] of cases) expect(redact(input), input).not.toContain(secret);
  });

  it('is idempotent', () => {
    const once = redact(SAMPLE);
    expect(redact(once)).toBe(once);
  });
});
