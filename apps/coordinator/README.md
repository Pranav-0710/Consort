# @consort/coordinator

**Area:** Coordinator and protocol (`coordinator`). Reviewers are listed in [CODEOWNERS](../../.github/CODEOWNERS).

Cloudflare Worker ingress plus one SQLite-backed Durable Object per project: authorization, transactional mutations, command receipts, the event log and the run outbox.

**May import:** `@consort/protocol`. ESLint enforces this (`eslint.config.mjs`).

## Layout

| Path | What it holds |
| --- | --- |
| `src/index.ts` | Worker entry. Exports `ProjectCoordinator`. Its authenticator accepts nobody until sign-in (#19) and pairing (#21) exist. |
| `src/worker/` | `router.ts` routes and authenticates; `routes/commands.ts` handles `POST .../commands` (bounded body read, `validateAtIngress`, RPC), `POST .../command-windows` and `GET .../commands/:requestId`. |
| `src/do/` | `project-coordinator.ts` is the thin Durable Object; `core.ts` is its logic (startup migrations, `init`, `applyCommand`, outbox delivery). The object's `alarm()` runs outbox retries. |
| `src/db/` | `sql.ts` is the storage port (the subset of the Durable Object SQL API used); `migrations.ts` holds the ordered migrations. |
| `src/outbox/` | `store.ts` queues inbox items for runs and keeps their delivery state; `outbox.ts` delivers them after commit, on the alarm and when a run connects; `ports.ts` is the transport and alarm boundary with #13; `config.ts` holds the provisional retry timing. |
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
7. The handler. Each event, and any inbox item it queues for a run, is written as it is emitted, then the receipt.

References are found by field name: `*_id` and `reply_to` hold one ID, `*_ids` a list, and the keys of a `*_versions` map are IDs. A test checks every command payload schema follows this. Free text is never read as a reference.

A refusal or throw at any step rolls everything back. A refusal comes back as its error code; a bug comes back as `internal_error` ("nothing was changed"), because the rollback makes the outcome known. `outcome_unknown` is used only when the call to the object itself fails. The response and any broadcast happen only after commit.

Handlers are synchronous. The SQL handle a handler receives stops working when the transaction ends, and a test rejects network, timer and promise APIs in `src/mutations/` and `src/commands/`.

A fresh object has no tables and writes nothing until `init` creates the project; retrying `init` with the same request returns the original result. If a migration fails, the migration list is out of order or renamed, or storage was written by a newer build, every request gets `project_unavailable` until the object restarts.

## Retries (#11)

A command window is issued by `POST /v1/projects/:id/command-windows` and is bound to the principal, its current scope (and an agent's verified run) and the recovery epoch. A command naming a window that is unknown, expired, another principal's or issued under a different scope gets `command_window_invalid`; one from an earlier epoch gets `recovery_epoch_mismatch`. Neither writes anything.

Every command that passes membership, role, scope and window checks leaves a receipt: committed, or rejected with its error. A receipt is bound to the principal, the window it was made under and that window's scope (and agent run):

- The same request ID and content under the same window returns the retained outcome and writes nothing. Any rejection is final for that request ID.
- The same ID with different content, or under a different window, gets `request_id_conflict`. A client never resends a request under a new window; it reads the receipt instead, so a request can never run twice.
- `GET /v1/projects/:id/commands/:requestId` returns the caller's own receipt as committed, rejected or unknown. Another principal's receipt, or one made under a scope or run the caller no longer holds, reads as unknown.
- Reconcile through the receipt, never by finding a request ID in the event stream: request IDs are visible to every member.

Receipts are kept until their window expires plus a grace period, and expired receipts and windows are pruned in a transaction of their own before each command. At the per-principal or per-project receipt limit, new commands get `limit_exceeded` (HTTP 429 with `Retry-After`); a live receipt is never evicted, and an identical retry is still answered. The durations and limits in `windows.ts` are provisional until #69.

## Delivery to runs (#12)

Web clients follow the event log by cursor (#13). Agent runs get inbox items through the outbox, because their receipt must be durable:

- An item is queued with `enqueueInboxItem` inside the transaction of the change that caused it. It gets a fixed position in its run's inbox and a `delivery` record. A run holding too many unsettled items refuses the causing command with `limit_exceeded`.
- After each commit, on each alarm and when a run connects, every due item for a connected run is recorded as sent with its next retry time, then handed to the transport. A send is never an acknowledgement: a row stays `sent` until the run's cursor acknowledgement (`acknowledgeDelivery`) reaches its position.
- Retries back off exponentially with jitter, up to a cap. After the attempt limit a row becomes `stalled` with a `delivery.stalled` event. Stalled rows are not retried and never deleted, and a late acknowledgement still settles them.
- Rows for a run with no live connection are not touched, so an offline adapter consumes no attempts and never wakes the object. The alarm is set only from connected runs' retry times, never sooner than a minimum delay, and is re-armed from storage at startup.
- Before sending, the run's current standing is resolved. A refused credential cancels the run's rows, a row outside the credential's scope is cancelled, and a row from an earlier recovery epoch is cancelled rather than replayed.
- A resend carries the same item ID and position, so the adapter deduplicates it (#14).

`deliveryStatus` gives the unsettled count, the stalled count and the oldest unsettled age for the run's status (#25). Sockets, frames, cursor signing and cursor verification belong to #13; until then the deployed object has no transport and sends nothing. The timing and limits in `outbox/config.ts` are provisional until #69.

## Adding to it

- Add a numbered migration to the end of `MIGRATIONS`. Never edit a released one.
- Register handlers in `src/mutations/production.ts`. `createRegistry` refuses a handler for a command with an ownership rule but no `authorize`, one that non-human principals may send but that declares no `scope`, and one that cannot check a version its command requires.

## Tests

`npm test` runs on Node against `node:sqlite` through the same storage port. Nothing runs in workerd yet: `@cloudflare/vitest-pool-workers` 0.23.0 requires vitest 4, and this repo uses vitest 5. Behaviour specific to the Cloudflare runtime (RPC serialization, `blockConcurrencyWhile`, the real SQLite build) is therefore not covered by these tests.
