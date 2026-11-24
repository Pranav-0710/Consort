# @consort/protocol

**Area:** Coordinator and protocol (`coordinator`). Reviewers are listed in [CODEOWNERS](../../.github/CODEOWNERS).

Shared schemas and types: the command envelope, identity chain, events, cursors, inbox items and the protocol version. It is runtime-neutral, so no Node built-ins, DOM or Cloudflare types.

**May import:** no other `@consort` package, and no Node built-ins, DOM or Cloudflare types. ESLint enforces these (`eslint.config.mjs`). The only third-party dependency should be the schema library chosen in #8. That is checked in review, not by lint.

This is a placeholder created by #2. Real code starts in #8, #9.
