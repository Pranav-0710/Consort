import { describe, expect, it } from 'vitest';

import { redact } from './redact.js';

// Synthetic values only. None of these is a real credential.
const SAMPLE = [
  '{"session_id":"abc","transcript_path":"C:\\\\Users\\\\alice\\\\.claude\\\\projects\\\\x.jsonl"}',
  'ANTHROPIC key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 in a log',
  'openai sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345',
  'github ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 and github_pat_11ABCDEFG0123456789_abcdefghijklmnop',
  'Authorization: Bearer abc.def-ghi_jkl012345',
  '{"token":"spike-shared-secret-123","refresh_token":"r3fr3sh","password":"hunter22"}',
  'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
  'mail from alice.example@example.com',
  'cwd /home/alice/consort and /Users/alice/consort and /c/Users/alice/consort and C:/Users/alice/x',
].join('\n');

describe('redact', () => {
  it('known token patterns in a sample log are removed', () => {
    const out = redact(SAMPLE);
    for (const secret of [
      'sk-ant-api03-AbCdEfGh',
      'sk-proj-AbCdEfGh',
      'ghp_AbCdEfGh',
      'github_pat_11ABCDEFG',
      'abc.def-ghi_jkl012345',
      'spike-shared-secret-123',
      'r3fr3sh',
      'hunter22',
      'eyJhbGciOiJIUzI1NiJ9',
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

  it('is idempotent', () => {
    const once = redact(SAMPLE);
    expect(redact(once)).toBe(once);
  });
});
