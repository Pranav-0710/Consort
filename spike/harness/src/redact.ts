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
  // key=value or "key": "value" for secret-looking keys
  [
    /("?\b(?:[a-z_]*token|secret|password|passwd|api[_-]?key|authorization)"?\s*[:=]\s*"?)(?!\[REDACTED)[^"\s,}&]+/gi,
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
