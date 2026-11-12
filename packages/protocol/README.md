# @consort/protocol

**Area:** Coordinator and protocol (`coordinator`). Reviewers are listed in [CODEOWNERS](../../.github/CODEOWNERS).

Shared schemas and types: the command envelope, identity chain, events, cursors, inbox items and the protocol version. It is runtime-neutral, so no Node built-ins, DOM or Cloudflare types.

**May import:** its schema library only (no other `@consort` package). ESLint enforces this (`eslint.config.mjs`).

This is a placeholder created by #2. Real code starts in #8, #9.
