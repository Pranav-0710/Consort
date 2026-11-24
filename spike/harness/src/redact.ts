// Removes tokens, emails and home paths from text before it is logged or shared.
// Applied to every harness log line, and available as a CLI for captured output (redact-cli).

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  // Provider and platform keys
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, '[REDACTED:anthropic-key]'],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, '[REDACTED:api-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED:github-token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED:github-token]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[REDACTED:jwt]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/\bBasic\s+[A-Za-z0-9+/=]{8,}/gi, 'Basic [REDACTED]'],
  [/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, '[REDACTED:aws-key]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED:slack-token]'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED:private-key]'],
  // Credentials embedded in URLs: scheme://user:password@host
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s:@/"\\]+:[^\s@/"\\]+@/gi, '$1[REDACTED]@'],
  // Cookie headers: the whole value, not just the first pair
  [/((?:set-)?cookie\s*:\s*)(?!\[REDACTED)[^"\\\r\n]+/gi, '$1[REDACTED]'],
  // key=value or "key": "value" for secret-looking keys, including prefixed names (DB_PASSWORD,
  // client_secret) and JSON that has been stringified again (\"token\":\"x\").
  [
    /((?:\\?")?[A-Za-z0-9_.-]*(?:token|secret|password|passwd|pwd|api[_-]?key|access[_-]?key|private[_-]?key|credentials?|authorization)(?:\\?")?\s*[:=]\s*(?:\\?")?)(?!\[REDACTED)[^"\\\s,}&]+/gi,
    '$1[REDACTED]',
  ],
  // Emails
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED:email]'],
  // Home directories: Windows (raw or JSON-escaped backslashes, or forward slashes), Git Bash, macOS, Linux
  [/[A-Za-z]:(?:\\\\|\\|\/)Users(?:\\\\|\\|\/)[^\\/\s"']+/gi, '%USERPROFILE%'],
  [/(?:\/[a-z])?\/(?:home|Users)\/[^/\s"']+/g, '~'],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out;
}
