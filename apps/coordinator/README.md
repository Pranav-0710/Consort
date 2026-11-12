# @consort/coordinator

**Area:** Coordinator and protocol (`coordinator`). Reviewers are listed in [CODEOWNERS](../../.github/CODEOWNERS).

Cloudflare Worker ingress plus one SQLite-backed Durable Object per project: authorization, transactional mutations, command receipts, the event log and the outbox.

**May import:** `@consort/protocol`. ESLint enforces this (`eslint.config.mjs`).

This is a placeholder created by #2. Real code starts in #10.
