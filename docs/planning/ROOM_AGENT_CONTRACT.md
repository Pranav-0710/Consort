# Shared task rooms — room-to-Claude contract

Status: architecture contract v0.2, 9 November 2026. Project-level coordination is accepted by the user. The protocol below incorporates an adversarial tabletop review; implementation, integration, load, and recovery tests have not been executed. See ARCHITECTURE_STRESS_TEST.md for the scenario matrix and remaining proof obligations.

## 1. Purpose, decisions, and conceptual model

The platform lets teammates participate in ongoing coding-agent work and coordinates accepted decisions across related tasks. Claude Code is the first supported client. Each developer retains their own session and checkout.

Accepted product decisions:

- Team members can inspect, discuss, ask questions, and propose changes.
- A named, transferable task owner accepts consequential task changes.
- Work within an accepted agreement continues without repeated approval.
- The initial platform warns about stale or unresolved work; it does not block merges.
- One project coordinator owns its rooms, shared contracts, current membership, and authority records. This replaces the earlier one-coordinator-per-room proposal.
- Infrastructure must fit free allowances. Existing Claude inference is a separate cost dependency to resolve before the event.
- Core application code will be built during the hackathon. This is planning material.

The task agreement describes what must be achieved. The agent plan describes how a particular run intends to achieve it. Evidence records what was observed. These records cannot substitute for one another.

The design borrows optimistic concurrency checks from databases, explicit delivery acknowledgements from messaging systems, and revision-specific evidence from CI systems. The coordinator, rather than the model, enforces authorization and valid state transitions.

### Scope and identity

- Project: membership, access policy, and shared contracts.
- Room: one task outcome, its agreement, discussion, and participating runs.
- Shared contract: a separately owned, versioned decision referenced by multiple rooms, such as an API's monetary units.
- Connection: a registered local adapter, authenticated to a human and authorized project.
- Run: a particular execution attempt attached to a Claude session and checkout. A fresh or restarted execution attempt receives a new run identity; acknowledgements are not silently inherited.
- Checkout identity: repository, worktree, branch, and known commit, with dirty state where relevant. A branch name alone is insufficient.

An observation stores its source and observation time. A server acceptance stores server time and event order. Laptop clocks do not decide order.

## 2. Risk critique and non-negotiable invariants

1. Only an authorized human can accept a consequential agreement change. Agents can propose changes, including to shared contracts, but cannot approve them.
2. Acceptance checks the current agreement version, relevant shared-contract versions, and current authority atomically. Stale acceptance fails explicitly.
3. A task owner cannot override a project-level shared contract through a task edit. Its contract owner must accept the shared change.
4. Persist an accepted mutation and its notification intent together before acknowledging success or broadcasting it.
5. Every mutation carries a stable request ID. With current authorization, a valid command window/recovery epoch, and a retained receipt, retrying the same ID and payload returns its prior outcome; the same ID with different content is rejected. Expired or unavailable outcomes require explicit reconciliation.
6. Delivery to an adapter, insertion into model context, model acknowledgement, reported implementation, and verification are different facts.
7. Acknowledgements are per run and per relevant version. They do not imply correctness or authorize merges.
8. A disconnected adapter, expired connection, closed session, or silent agent is never marked current based on absence of errors.
9. Human discussion and external text cannot directly become approved instructions. Rendering, routing, and model context preserve their source and status.
10. Room approval never bypasses Claude's local tool permissions. Revoking room access does not stop an external process or erase already downloaded data.
11. Verification identifies the exact artifact and check. A passing test proves the stated check passed, not that every requirement is satisfied.
12. Agent-generated questions, answers, plans, and summaries remain attributed reports, not accepted policy.

Principal failure vectors: stale concurrent decisions; duplicate or uncertain external execution; incompatible cross-room contracts; mistaken identity after a branch/session change; credential leakage or cross-project access; model interpretation of discussion as instructions; and unsupported client capabilities.

Out of scope for the first release: universal semantic-conflict discovery, terminal takeover, mandatory merge enforcement, hosted coding runtimes, full transcript mining, and unlimited client compatibility.

## 3. Architecture and the six-record contract

### Coordination boundary

Accepted initial topology: one project coordinator with task rooms, shared contracts, current project membership, and authority records stored inside it. Task acceptance, shared-contract checks, and current project authorization occur within one storage boundary. The ingress authenticates identity; the coordinator makes the current project authorization decision. A stale access token alone cannot establish current project membership.

Cloudflare Worker routes authenticated requests to the project's SQLite-backed Durable Object. React clients receive live updates; local adapters maintain resumable connections. Keep network calls and model execution outside storage transactions.

This deliberately bounds coordination to a project. It requires project-size and event-rate limits and load testing. A later split into per-room coordinators would need explicit cross-object consistency semantics; it is not a transparent scaling switch.

Persist canonical records plus a durable ordered event/outbox log. WebSockets notify and transport updates; they are not durable storage. Presence can be ephemeral, but accepted decisions and pending requests cannot be.

### Common envelope

Every command names project, room where applicable, actor, request ID, target record, and expected version where relevant. The server derives identity from authenticated credentials and checks membership; a claimed actor ID is not trusted.

Agent operations additionally identify connection, run, context generation, and checkout. Events carry an internal server event sequence, project recovery epoch, record version, source, and causal request ID. Public cursors are opaque and scope-bound. Schemas have a protocol version so unsupported clients can be rejected clearly. Mutations include a server-issued command-window identifier; acceptance includes expected authority and applicable dependency versions as well as the target version.

The server resolves and validates the complete registered identity relationship: credential -> project and scope -> connection generation -> run -> context generation -> checkout. It also checks ownership and scope of every referenced room, plan, question, request, acknowledgement, evidence record, and shared contract. Client-supplied IDs cannot establish or change these bindings. A valid adapter cannot submit as a different participant's run by substituting an ID.

Historical ingestion is distinct from a current-state mutation. After reconnection, a currently authorized participant can submit an attributed report about an earlier run/version, using a valid current command window and its original provenance. This appends historical information only; it cannot update the current plan, task completion, or verification. Old transport commands are not replayed merely to preserve their content. Unauthorized former members cannot upload even historical reports through this route.

### A. Agreement

Fields: goal, requirements with stable IDs, exclusions, acceptance criteria, task owner, version, referenced shared-contract versions, and provenance of accepted changes.

The room sends the current agreement and relevant contracts on initial attachment, reconnection, context restoration, and after accepted updates. Later deliveries can contain bounded deltas plus a retrievable snapshot.

Claude reports explicit acknowledgement or an incompatibility question. It cannot modify the authoritative agreement by editing its plan.

An accepted change creates a new agreement revision. Reversing it creates another revision; it is not erased or silently withdrawn. Sensitive content can still be redacted under the retention/deletion policy while retaining non-sensitive audit metadata.

### B. Plan

Fields: run, plan version, based-on agreement/contract versions, stable step IDs, step status, dependencies, blockers, and available evidence references.

Claude publishes and updates its own plan. It may revise implementation steps within the accepted agreement. Changing scope or shared behavior requires a change request.

The server can check declared versions and authorship, but cannot reliably classify every natural-language change as consequential. Ambiguous changes must be surfaced for review; this is a limit of the advisory system.

Completing every plan step does not mark the task verified. Plan freshness is computed from its declared dependencies.

### C. Question

Fields: author, target person/run, related requirement/step/contract, text, urgency, status, answer, and optional resolution reference.

Members and agents can ask and answer. Questions are explicitly addressed before being delivered to an agent; general room conversation is not automatically injected.

An answer that proposes new scope remains discussion until accepted through a change request. Agent questions should be routed to the responsible person, with an attention inbox for unresolved items.

Questions are intended as informational requests. A prompt label alone cannot enforce read-only behavior inside an external agent. Any strict read-only execution mode requires separately tested client controls.

### D. Change request

Fields: proposer, target agreement or shared contract, expected version, proposed change, reason, declared affected requirements/tasks/runs, and acceptance/rejection provenance.

States: proposed, accepted, rejected, withdrawn, or superseded before acceptance. Accepted requests create a durable agreement/contract revision and delivery intents; their execution outcomes are tracked separately.

Only the current appropriate owner can accept. Ownership transfer is an atomic, authorized operation; it does not approve pending requests. No inactivity-based automatic ownership transfer in the initial release.

Before acceptance, show affected declared dependencies and any uncertainty. A change to a shared contract marks dependent work as needing reconciliation; it does not instantly update every agent.

### E. Acknowledgement

Fields: run, request/change ID, agreement and contract versions, acknowledgement type, source, timestamps, and optional concerns.

Types are separate observations:

- Adapter received: stored by the local connection.
- Context supplied: adapter/hook reports providing the update at a supported checkpoint.
- Agent acknowledged: Claude explicitly reports recognizing the version.
- Application reported: Claude reports applying it and links evidence where available.

The server never fabricates agent acknowledgement from delivery success. It records what the agent reported, without treating that as a proof of comprehension.

Old acknowledgements remain historical. Superseding a request does not erase the fact that a run acted under it.

### F. Evidence

Fields: author/collector, requirement ID and revision, agreement and relevant contract versions, artifact location, repository and exact revision or content identity, dirty-worktree qualification, check description and method/version, result, verifier, observation time, and trust/source classification.

Evidence can be agent-reported output, an independently collected CI result, or a human review. These sources remain distinguishable.

Verification is attached to a named criterion and artifact. A later code change does not erase the historical result, but it cannot inherit that result as current verification without a valid basis.

MVP: collect evidence and show verification pending unless an authorized human or independently observed check establishes the specified result. Do not create a generic green 'verified' badge from Claude's final answer.

### Minimal operations and authority

| Operation | Authorized actor | Important condition |
|---|---|---|
| Read room context and changes | Authorized member or scoped adapter | Check current access; bound result size |
| Publish/update plan | Its registered agent run | Expected plan version and declared agreement versions |
| Ask/answer question | Authorized participant | Preserve author and target |
| Propose change | Authorized participant | Name the current target version |
| Accept/reject change | Current task or contract owner | Atomic authority/version check |
| Acknowledge change | Target registered run | Explicit acknowledgement type and exact versions |
| Attach evidence | Authorized participant/collector | Preserve source and exact artifact identity |
| Record verification | Authorized reviewer or trusted collector | Name criterion, check, and artifact |
| Transfer task ownership | Current owner to eligible member; designated project administrator for explicit recovery | Atomic authority-version check, visible history and reason |

Human-only operations are not exposed to the agent credential. The initial model distinguishes readers from contributors and owners; 'anyone can propose' means an authorized contributing member.

### Claude Code connection

- MCP tools provide structured publishing, retrieval, questions, acknowledgement, and evidence operations.
- Hooks supply bounded relevant context at supported lifecycle checkpoints; startup/resume must refresh authoritative state rather than trust old injected context.
- Channels are an optional push path for open sessions after version, authentication, policy, and protocol compatibility are verified. They are currently a research preview.
- Each connection advertises tested capabilities; the UI derives controls from them.
- Without working push support, requests remain queued until a supported checkpoint. A closed session cannot be remotely revived by this design.
- The local adapter maintains a durable inbox/outbox and cursor, scoped per project/run. It authenticates outbound to the service; no public inbound laptop endpoint is required.
- Hooks should read bounded local state where practical and have short deadlines. Service unavailability should warn and mark coordination stale, not block normal editing in this advisory release.
- Do not use Stop-hook continuation loops to manufacture progress updates or acknowledgements. Structured reporting has a token cost, so publish meaningful milestones rather than every tool event.

### One complete exchange

1. Claude attaches to a room and retrieves agreement v3 plus its referenced contracts.
2. Claude acknowledges those versions and publishes a plan based on them.
3. A teammate proposes a requirement change against v3.
4. The owner accepts; the coordinator atomically stores v4, its event, and delivery intents.
5. Relevant adapters receive the update. Each run is independently marked as awaiting acknowledgement.
6. At a supported delivery point, Claude reads v4 and acknowledges it or raises an incompatibility question.
7. Claude revises its plan, performs work under its normal permissions, and reports application with evidence.
8. A reviewer or observed check evaluates the relevant criterion against the exact artifact. Other criteria can remain unresolved.

## 4. Validation protocol

### v0.2 hardening rules derived from the tabletop review

**H01 — Atomic project mutations.** A mutation transaction checks current membership, credential scope, command window, record/authority versions, and applicable dependency versions; it writes the canonical change, command receipt, audit event, and notification intent together. Network access, model work, and broadcast occur outside it. Single-threaded execution is not a substitute for a transaction: asynchronous I/O can permit interleaving. Serialization and validation happen at commit, not only when the UI first displays a proposal.

**H02 — Contract adoption is explicit.** Maintain a declared dependency registry. Accepting a shared-contract revision atomically records the new target and affected-room reconciliation obligations. The existing room agreements retain their pinned versions until their owners reconcile them. Rooms show target, pinned version, and each run's acknowledged bundle separately. Compatible old-version exceptions require explicit approval by the contract owner with scope and expiry; a new task cannot silently select an obsolete version. Acceptance of a contract does not mean the deployed API changed. Breaking changes require a migration/compatibility plan and rollout evidence before deployment can be represented as complete. Advisory coordination cannot stop an external merge or deployment.

**H03 — Authority versions and orphaned tasks.** Ownership and membership have versions independent of agreement content. Acceptance before a transfer remains accepted; acceptance by the former owner after a transfer is rejected. Project administrators may explicitly reassign an orphaned task/contract with a reason and audit record, but do not automatically accept its pending proposals. Protect the last active project administrator from accidental removal without a replacement or project shutdown. An unavailable owner creates an attention item, not an automatic authority grant.

**H04 — Bounded retry contract.** The server issues a command window tied to principal, scope, and recovery epoch. Commands are accepted only while that window is valid and current authorization passes. Retain deduplication outcomes/tombstones throughout the supported window and recovery grace period; configured durations must be established before launch. After expiry, reconcile state and create an intentional new command rather than silently replaying an old one. Check authorization before returning cached outcomes. A timed-out response means 'outcome unknown' until queried or reconciled. Storage limits must reject new work explicitly rather than evict required deduplication records early.

**H05 — Durable delivery without repeated execution.** Canonical state, an outbox record, and command outcome are committed together. Sending can be retried; socket delivery is not acknowledgement. Local receipt is persisted before advancing the durable cursor. Replay conveys current desired state, prior reports, and unresolved work, rather than a blind imperative to execute again. An agent that may already have acted enters 'application outcome unknown; inspect required.' Do not automatically repeat uncertain external side effects.

**H06 — Authorized replay.** Authorize each request, cached result, and replay/broadcast batch against current membership and connection scope. Revocation closes or invalidates active subscriptions and prohibits future server release of protected content; already released bytes and downloaded data cannot be recalled. Cursors bind to project, principal/view scope, membership-policy version, recovery epoch, and retention boundary. A cursor never grants access. Scope changes or compacted history trigger an authorized snapshot at a recorded sequence boundary followed by later events. Deletion/redaction also applies to snapshots and replay, not only the main UI.

**H07 — Context generation and connection fencing.** A run tracks context generation separately from execution identity. Startup/resume/compaction recovery refreshes accepted context and asks for acknowledgement for that generation. If restoration cannot be observed reliably, show context continuity as unconfirmed. A reconnecting adapter receives a new connection generation; an older competing connection cannot mutate current run state. Switching worktrees, branches, repositories, or restoring files requires an updated checkout record and freshness review. Do not infer memory from adapter health.

**H08 — Verification checks code and specification.** Evidence applicability depends on artifact identity, criterion revision, relevant contracts, and verification method. Any changed input invalidates automatic reuse for current acceptance while preserving the historical observation. Dirty-worktree results must identify their content snapshot or stay qualified. A merge commit may differ from the tested feature commit. Evidence submissions cannot overwrite independent verification or self-upgrade trust. Human review may establish a named criterion while disclosing its method and scope.

**H09 — Recovery must not resurrect authority.** Restore into quarantine before ordinary traffic. Establish a fresh random recovery epoch through a recovery process that cannot restore the old epoch unchanged; the safer initial recovery procedure uses a new isolated project identity. Re-establish current authorized membership from a trusted source or explicit administrator review rather than accepting restored ACLs. Reissue credentials, invalidate old cursors/connections, and require runs to reattach and reconcile. Restored outbox entries are evidence of historical intent, not automatically replayable instructions. Record the recovery point and possible lost decisions; inspect external code/deployments that may be ahead of the backup. This procedure must be implemented and rehearsed before claiming production recovery.

**H10 — Bounded work and observable overload.** Configure limits for participants, active runs, dependency edges, proposal size, evidence metadata, pending requests, and replay batches. A project-wide change must fit its bounded transaction; otherwise reject with actionable scope reduction rather than partially accept it. Separate optional presence/activity traffic from accepted changes. Use bounded retries, reconnect jitter, and visible backpressure. Persist retry scheduling or recover it from the outbox; in-memory timers are insufficient. Large artifacts remain outside the coordination transaction; metadata links do not count as independently verified evidence. Numbers remain a load-test gate, not an unlimited-service claim.

**H11 — Close, cancel, delete, and reopen are distinct.** Closing a room makes it read-only and refuses new changes; unresolved work must be resolved or explicitly recorded as deferred/unknown. Cancellation records intent and any supported delivery outcome; it does not kill external processes. Reopening is an authorized, versioned transition with fresh reconciliation. Detaching a run stops future deliveries without falsifying its history. Project deletion first disables access and command acceptance, then purges under a documented retention policy; late retries cannot recreate a deleted project. Preserve non-sensitive tombstones as permitted by that policy. Never use client-supplied project IDs to implicitly create missing projects.

**H12 — Content and command safety.** Preserve attribution, sanitize rendered content, enforce schema/payload limits, and reject cross-project references. Ordinary comments do not become executable tool arguments. Only explicit questions and approved changes enter the agent's routed inbox. Sensitive local capture is opt-in and minimized; logs must exclude credentials and raw private content by default. External evidence URLs are not fetched with privileged credentials or arbitrary network access; first-release links remain untrusted until a specific collector validates them. Agent and human credentials remain distinct. These controls constrain authority but do not prove immunity to model prompt injection.

### Status vocabulary

Expose separate fields for connection health, transport synchronization, context generation/acknowledged versions, plan freshness, reconciliation obligations, evidence applicability, and uncertain effects. Avoid a global 'all synchronized' or 'safe to merge' badge inferred from one field.

### Transition boundaries

| Operation | Precondition | Durable outcome | What it does not imply |
|---|---|---|---|
| Accept task change | Current owner/authority, target version, and dependency bundle | New agreement revision and delivery intent | Agent acted |
| Accept shared change | Current contract owner, contract version, and bounded affected set | New target revision plus reconciliation obligations | Rooms adopted it or deployment changed |
| Reconcile room | Current task owner accepts compatible target bindings or valid exception | New agreement revision and refreshed obligations | Runs have read it |
| Acknowledge bundle | Current run/connection/context identity | Attributed version acknowledgement | Plan or implementation complies |
| Submit verification | Authorized verifier, exact artifact/specification/check | Scoped result | Entire task or different commit verified |
| Restore project | Quarantined recovery and fresh epoch/current authority | New coordination incarnation | Old credentials or pending effects are safe |

No tests have been run: this is a design contract. Required acceptance scenarios for implementation:

| Scenario | Expected result |
|---|---|
| Two acceptances target the same old version | One valid transition; the other explicitly requires reconciliation |
| Agent calls a human acceptance operation | Authorization rejects it |
| Duplicate command ID after timeout | With current authorization and valid window/epoch, retained outcome returned without a second mutation; otherwise explicit reconciliation |
| Duplicate ID with changed payload | Rejected |
| Crash after persistence but before broadcast | Reconnect/replay eventually exposes the accepted event |
| Adapter gets a request but model does not | Received shown; agent acknowledgement absent |
| Old run reconnects after agreement/ownership change | Reconciliation required; stale authority cannot accept changes |
| Member revoked while socket remains open | Subsequent reads/writes rejected and delivery stopped |
| Branch, worktree, or execution attempt changes | Identity/freshness updated; acknowledgements not blindly reused |
| Test evidence belongs to a prior commit | Historical pass retained; current verification remains unresolved |
| Shared contract changes during task acceptance | Atomic version check rejects inconsistent acceptance |
| Room text attempts to grant itself authority | Remains untrusted content; backend permissions unchanged |
| Channel unavailable | Capability displayed accurately; checkpoint delivery remains available if supported |
| Free allowance exhausted or service offline | Clear degraded state; no false acknowledgement or endless retry loop |

Measure delivery latency separately from acknowledgement latency. Track pending-request age, replay failures, duplicate retries, stale runs, unauthorized operations, hook overhead, and reporting token overhead. Establish performance budgets through tests instead of inventing production guarantees.

## 5. Recovery, containment, and remaining gates

Reconnect states: disconnected -> reconciling -> current or action required. Resume from an acknowledged event cursor; if history has been compacted, send a current snapshot plus unresolved requests. Receipt by a socket is not a durable client acknowledgement.

Bound buffers and payload sizes. Retry with backoff and limits; prioritize accepted changes over optional activity updates. Do not discard accepted requests silently when a local queue fills.

External side effects are not automatically undone when an agreement is reverted. Show affected work and create corrective tasks. Exactly-once external execution is not promised; an uncertain action result requires inspection before retry.

Before production rollout, test storage restore and schema rollback/recovery, tenant isolation, revocation, retention/redaction, protocol upgrades, load limits, and adapter compatibility. Preserve versioned exports and define an operator recovery procedure; backup presence alone is insufficient.

Implementation gates still open:

- Verify actual Claude Code versions, authentication, hooks, and optional channel compatibility on the team's machines.
- Clarify how existing Claude usage fits the free-tools budget; no additional platform model dependency is planned.
- Validate project-coordinator throughput and storage limits against the intended team size.
- Choose evidence sources for the first demo; do not imply a CI integration before it exists.
- Resolve exact hackathon submission/build rules before producing prohibited pre-event application assets.

File mutation manifest for this revision: [MODIFY] outputs/ROOM_AGENT_CONTRACT.md — accepted topology and stress-test hardening; [NEW] outputs/ARCHITECTURE_STRESS_TEST.md — tabletop traces, scenario coverage, and implementation proof obligations. No application files changed.

### Primary references consulted

- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code channels: https://code.claude.com/docs/en/channels
- Cloudflare Durable Object storage: https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/
- Cloudflare Durable Object design rules: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- MCP security guidance: https://modelcontextprotocol.io/specification/latest/basic/security_best_practices

