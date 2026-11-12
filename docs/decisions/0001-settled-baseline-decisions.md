# 0001: Settled baseline decisions

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Pranav-0710
- **Issue:** #1

## Context

The planning baseline in `docs/planning/` selected an architecture and left a few engineering choices open. Before the issue plan was written, those choices were settled with recommended defaults so that the 78 issues could be specific. This record collects them in one place. No issue needs a separate record for any of these.

None of these decisions has been tested. Where a choice depends on real client behavior, an M0 spike issue checks it, and a failed observation changes the decision through a new record.

## Decision

### Product constraints (from the user; not open to change)

1. **Multiplayer scope.** Teammates and the agents each of them owns collaborate across development. Conflict repair is one use case, not the product. (`../planning/ARCHITECTURE_BLUEPRINT.md §1`, `../planning/COMPETITIVE_AND_PROBLEM_VALIDATION.md`, "Scope correction".)
2. **Subscription-only inference.** Users bring their existing Claude Pro and ChatGPT Plus clients. There is no separately billed model API, no hidden server-side inference, no pooled or extracted credentials and no paid fallback. Routing, authorization, version checks and state transitions are deterministic. (`../planning/ARCHITECTURE_BLUEPRINT.md`, "Subscription-based production constraint".)
3. **Production intent with staged gates:** hackathon demo, then controlled pilot, then public launch. (`../planning/FIRST_RELEASE_SPEC.md §7`.)
4. **Claude Code first.** Codex is part of the product and comes through its own adapter after capability proof. (`../planning/AGENT_CAPABILITY_MATRIX.md §4`.)

### Architecture (selected in planning)

5. **Coordinator:**
   - a Cloudflare Worker authenticates and routes requests
   - one SQLite-backed Durable Object per project holds membership, authority, rooms, shared contracts, command receipts, an ordered event log and an outbox
   - every mutation is checked and written in one transaction (rule H01)

   (`../planning/ROOM_AGENT_CONTRACT.md §3`, `../planning/ARCHITECTURE_STRESS_TEST.md`.)
6. **Clients:**
   - a React and TypeScript web client
   - a local Node adapter for Claude Code, using MCP tools plus supported hooks with a durable local inbox and outbox
   - checkpoint delivery is the baseline, and channels push is optional later

   (`../planning/AGENT_CAPABILITY_MATRIX.md §4`.)
7. **Advisory only.** Room status never blocks merges, and GitHub stays authoritative for PR review and merge. (`../planning/ARCHITECTURE_BLUEPRINT.md §4`.)

### Engineering defaults (settled before the issue plan)

8. **Human sign-in:** GitHub OAuth. Project membership and roles live in the coordinator, not in GitHub. Issue #17 decides where global user and session records live.
9. **Adapter pairing:** device-code style. An expiring, single-use code is approved by the human in the connection panel and yields a scoped, revocable credential for that one connection. It is never placed in model context. (#21, #22.)
10. **Handoff identity:** a commit SHA pushed to the shared remote. Retrieval verifies the SHA. Uncommitted snapshots cannot be published in v1. (#49–#51.)
11. **Combined checks:** a designated participant's local runner builds a temporary worktree from the baseline plus the selected SHAs, in a stated order, and runs the agreed command. (#53, #56.)
12. **Evidence trust:**
    - The server sets the source class from the submitting credential.
    - Runner results are labelled "checked (participant-collected)" and never "independently verified".
    - A criterion counts as satisfied only when its human owner accepts that evidence.
    - The runner uses a separately scoped evidence-collector credential from the same pairing flow.

    (#21, #54, #57.)
13. **Room model:** one feature room holds several work packages. Each package owns its task agreement, and reconciliation obligations, pins and acknowledgements attach to packages. ROOM_AGENT_CONTRACT's "room" corresponds to a work package. (#23, #44.)
14. **Agent inbox:** a closed set of item types:
    - addressed question
    - answer to own question
    - accepted revision affecting the run
    - reconciliation obligation
    - handoff published, replaced or withdrawn for a declared consumer

    General chat is never forwarded. (#9, #35.)
15. **Agent tools:**
    - read_context
    - acknowledge
    - publish_plan
    - ask_question
    - answer_question
    - propose_change
    - publish_handoff
    - record_retrieval
    - adopt_handoff
    - attach_evidence

    There is no accept tool, so agents propose and humans accept. (#29, #38, #46, #51, #55.)
16. **Delivery beyond checkpoints:** a bounded Stop-hook delivery (option b) and an opt-in listen tool (option c) are both per-human opt-in under a bounded policy. Neither may be enabled from a chat message. The spike verdict (#16) decides which ship. (#7, #40.)

## Alternatives

Per-room coordinators, rejected in planning because cross-room acceptance would need cross-object consistency. Hosted agent runtimes, a central model and a custom merge queue are out of the first release; see `../planning/ARCHITECTURE_BLUEPRINT.md §7`.

## Consequences

- Delivery to Claude is checkpoint-based unless #16 accepts more. An idle session does not wake on its own, and the UI says so instead of implying immediacy.
- Numeric limits are provisional until #69 sets them from measurements.
- These decisions are still open, each with its own issue:
  - pre-project identity store: #17
  - judge or demo access: #65
  - restore identity: #71
  - the event's build-window rules, which spike and product code wait for

## Traces to

AC01, AC04, AC06, AC08, AC09, AC10, AC11, AC13; rules H01, H02, H07, H08, H12.
