# @consort/protocol

**Area:** Coordinator and protocol (`coordinator`). Reviewers are listed in [CODEOWNERS](../../.github/CODEOWNERS).

One command shape, one table of who may send each command, and one validator, shared by the web client, the adapter and the coordinator. It is runtime-neutral, so no Node built-ins, DOM or Cloudflare types.

**May import:** no other `@consort` package, and no Node built-ins, DOM or Cloudflare types. ESLint enforces these (`eslint.config.mjs`). The only third-party dependency is [zod](https://zod.dev) 4, used for both types and runtime validation. That is checked in review, not by lint.

## What is here

| Module | Contents |
|---|---|
| `version.ts` | `PROTOCOL_VERSION {major, minor}` and `isSupported`: a client may be older within one major version, never newer. |
| `envelope.ts` | The command envelope: protocol version, project, request ID, command window, recovery epoch, type, payload and expected versions. Agent runs add the `agent` identity-chain block. |
| `identity.ts` | Principal kinds, roles, the agent identity chain and the fields the server derives itself. |
| `commands/` | One strict payload schema per command type. Some are placeholders that later issues complete; the catalogue names which. |
| `catalogue.ts` | For every command: allowed principal kinds, minimum role, ownership rule and required expected versions. |
| `validate.ts` | `validateCommand` and `validateCommandJson`: bounds first, then envelope, catalogue and payload. |
| `limits.ts` | Size and shape bounds. **Provisional** until #58 measures them and #69 sets them. |
| `ids.ts`, `errors.ts`, `hash.ts` | ID-prefix helpers, stable error codes with default messages, and `canonicalPayloadHash`. |
| `events.ts` | `EventRecord`: sequence, recovery epoch, type, record, actor, source, causal request ID, server time and payload. |
| `inbox.ts` | The closed set of seven inbox item types. Participant text is wrapped as `{trust: 'untrusted', text}`. |
| `delivery.ts` | Delivery observations (queued, adapter received, context supplied) and agent acknowledgements, as separate schemas. |
| `status.ts` | `RunStatus` with one field per dimension and no combined status. |
| `capabilities.ts` | Capability flags, each documented, detected, verified or disabled with a reason. |
| `frames.ts`, `gap.ts` | WebSocket frames (agents get `AgentServerFrameSchema`, which has no raw events), and `checkSequence`, which tells a client to apply, ignore, fetch a gap or resync. |
| `receipts.ts` | `CommandWindow` (issued window: ID, recovery epoch, expiry) and `ReceiptStatus` (committed, rejected or unknown) for safe retries. |
| `cursor.ts` | The opaque `Cursor` string. Its claims helpers are exported only from `@consort/protocol/internal`, for the coordinator. |

## Rules it encodes

- The principal comes from the credential or web session, never from the envelope. Supplying `actor` and similar fields is rejected with `server_derived_field`.
- An agent run's work package comes from its registration, never from the payload.
- Owner decisions (accept, reject, reconcile, transfer) require the target, ownership and membership versions, and are never open to agent runs.
- No command approves or merges a pull request or changes a client's local tool permissions.
- Delivery, context supplied, acknowledgement, adoption, reported implementation and verification never share a field or schema.
- Clients never read cursor claims. Lint does not yet stop a client importing `@consort/protocol/internal`; review does.

Passing validation proves shape only. The coordinator still checks membership, role, ownership, the command window and every expected version inside its transaction (#10, #11).
