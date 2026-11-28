# @consort/coordinator

**Area:** Coordinator and protocol (`coordinator`). Reviewers are listed in [CODEOWNERS](../../.github/CODEOWNERS).

Cloudflare Worker ingress plus one SQLite-backed Durable Object per project: authorization, transactional mutations, command receipts, the event log and the outbox.

**May import:** `@consort/protocol`. ESLint enforces this (`eslint.config.mjs`).

## Layout

| Path | What it holds |
| --- | --- |
| `src/index.ts` | Worker entry. Exports `ProjectCoordinator`. Its authenticator accepts nobody until sign-in (#19) and pairing (#21) exist. |
| `src/worker/` | `router.ts` handles `POST /v1/projects/:id/commands`: authenticate, bounded body read, `validateAtIngress`, RPC to the project's object. |
| `src/do/` | `project-coordinator.ts` is the thin Durable Object; `core.ts` is its logic (startup migrations, `init`, `applyCommand`). |
| `src/db/` | `sql.ts` is the storage port (the subset of the Durable Object SQL API used); `migrations.ts` holds the ordered migrations. |
| `src/mutations/` | `apply.ts` is the single mutation path; `registry.ts` defines what a handler declares; `production.ts` is the deployed registry (empty for now). |
| `wrangler.jsonc` | Worker and Durable Object binding. No routes are configured. |

## The mutation path

Every command runs through `runMutation` inside one `transactionSync`, in this order: the project and recovery epoch; current membership or credential status; the catalogue (principal kind, minimum role, a registered handler); credential scope; every referenced ID resolving inside this project, then the ownership rule; every expected version, including authority versions; the handler; and finally the event, outbox and receipt rows. A refusal or throw at any step rolls everything back. The response and any broadcast happen only after commit.

Handlers are synchronous. The SQL handle a handler receives stops working when the transaction ends, and a test rejects network, timer and promise APIs in `src/mutations/` and `src/commands/`.

A fresh object has no tables and writes nothing until `init` creates the project. If a migration fails, or storage was written by a newer build, every request gets `project_unavailable`.

## Adding to it

- Add a numbered migration to the end of `MIGRATIONS`. Never edit a released one.
- Register handlers in `src/mutations/production.ts`. `createRegistry` refuses a handler for a command with an ownership rule but no `authorize`, or one that non-human principals may send but that declares no `scope`.

## Tests

`npm test` runs on Node against `node:sqlite` through the same storage port. Nothing runs in workerd yet: `@cloudflare/vitest-pool-workers` 0.23.0 requires vitest 4, and this repo uses vitest 5. Behaviour specific to the Cloudflare runtime (RPC serialization, `blockConcurrencyWhile`, the real SQLite build) is therefore not covered by these tests.
