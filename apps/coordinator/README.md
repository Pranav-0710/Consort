# @consort/coordinator

**Area:** Coordinator and protocol (`coordinator`). Reviewers are listed in [CODEOWNERS](../../.github/CODEOWNERS).

Cloudflare Worker ingress plus one SQLite-backed Durable Object per project: authorization, transactional mutations, command receipts, the event log and the outbox.

**May import:** `@consort/protocol`. ESLint enforces this (`eslint.config.mjs`).

## Layout

| Path | What it holds |
| --- | --- |
| `src/index.ts` | Worker entry. Exports `ProjectCoordinator`. Its authenticator accepts nobody until sign-in (#19) and pairing (#21) exist. |
| `src/worker/` | `router.ts` routes and authenticates; `routes/commands.ts` handles `POST .../commands` (bounded body read, `validateAtIngress`, RPC), `POST .../command-windows` and `GET .../commands/:requestId`. |
| `src/do/` | `project-coordinator.ts` is the thin Durable Object; `core.ts` is its logic (startup migrations, `init`, `applyCommand`). |
| `src/db/` | `sql.ts` is the storage port (the subset of the Durable Object SQL API used); `migrations.ts` holds the ordered migrations. |
| `src/mutations/` | `apply.ts` is the single mutation path; `windows.ts` issues and checks command windows; `receipts.ts` keeps and reads retained outcomes; `registry.ts` defines what a handler declares; `production.ts` is the deployed registry (empty for now). |
| `wrangler.jsonc` | Worker and Durable Object binding. No routes are configured. |

## The mutation path

Every command runs through `runMutation` inside one `transactionSync`, in this order:

1. This object holds the project the command names.
2. Current membership or credential status, loaded inside the transaction. For an agent, the identity block must name the credential's connection and the run the authority port verified; then the recovery epoch.
3. The catalogue: principal kind, minimum role, a registered handler.
4. Credential scope for agents and collectors (an empty list is refused; project-wide commands say `'project'`); the command window; then the request ID. An identical retry returns its retained outcome here and writes nothing; the same ID with different content gets `request_id_conflict`; a new request needs room for its receipt or gets `limit_exceeded`.
5. Every reference resolves inside this project as the right kind of record, then the ownership rule.
6. Every expected version, including authority versions. A key the coordinator cannot check is refused, never skipped.
7. The handler. Each event and its outbox row is written as it is emitted, then the receipt.

References are found by field name: `*_id` and `reply_to` hold one ID, `*_ids` a list, and the keys of a `*_versions` map are IDs. A test checks every command payload schema follows this. Free text is never read as a reference.

A refusal or throw at any step rolls everything back. A refusal comes back as its error code; a bug comes back as `internal_error` ("nothing was changed"), because the rollback makes the outcome known. `outcome_unknown` is used only when the call to the object itself fails. The response and any broadcast happen only after commit.

Handlers are synchronous. The SQL handle a handler receives stops working when the transaction ends, and a test rejects network, timer and promise APIs in `src/mutations/` and `src/commands/`.

A fresh object has no tables and writes nothing until `init` creates the project; retrying `init` with the same request returns the original result. If a migration fails, the migration list is out of order or renamed, or storage was written by a newer build, every request gets `project_unavailable` until the object restarts.

## Retries (#11)

A command window is issued by `POST /v1/projects/:id/command-windows` and is bound to the principal, its current scope (and an agent's verified run) and the recovery epoch. A command naming a window that is unknown, expired, another principal's or issued under a different scope gets `command_window_invalid`; one from an earlier epoch gets `recovery_epoch_mismatch`. Neither writes anything.

Every command that passes membership, role, scope and window checks leaves a receipt: committed, or rejected with its error, so a retry gets the same answer. Receipts are keyed by principal and kept until their window expires plus a grace period. `GET /v1/projects/:id/commands/:requestId` returns the caller's own receipt as committed, rejected or unknown; another principal's receipt reads as unknown. At the receipt limit new commands are refused; a live receipt is never evicted. The durations and limits in `windows.ts` are provisional until #69.

## Adding to it

- Add a numbered migration to the end of `MIGRATIONS`. Never edit a released one.
- Register handlers in `src/mutations/production.ts`. `createRegistry` refuses a handler for a command with an ownership rule but no `authorize`, one that non-human principals may send but that declares no `scope`, and one that cannot check a version its command requires.

## Tests

`npm test` runs on Node against `node:sqlite` through the same storage port. Nothing runs in workerd yet: `@cloudflare/vitest-pool-workers` 0.23.0 requires vitest 4, and this repo uses vitest 5. Behaviour specific to the Cloudflare runtime (RPC serialization, `blockConcurrencyWhile`, the real SQLite build) is therefore not covered by these tests.
