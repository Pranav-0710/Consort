# Reasoning and evidence behind the planning baseline

> Imported from the planning pack. It is edited only to remove handoff notes that were addressed to a specific coding assistant (issue #80), and the rationale is unchanged. "The product owner" refers to the project's owner.

11 November 2026. Read before treating the specifications as an implementation checklist. This companion explains rationale, historical evidence and unresolved tensions; it does not introduce new accepted functionality or replace detailed contracts.

## 1. The product thesis behind the documents

The desired change is from several isolated coding-agent conversations to useful collaboration around a shared outcome. A team's agents should be able to contribute their work and knowledge to one another while the humans can inspect and influence the result. Independence remains valuable: each developer retains their workflow, client, checkout and permissions.

The platform therefore has two audiences at the same time. Humans need understandable goals, ownership, questions, decisions and results. Agents need structured tools and scoped context for the same work. Building only a nice chat UI would miss the agent side; building only an agent-message API would miss the shared human experience.

Multiplayer does not require everyone typing in one terminal. It requires participation that makes a difference: a useful question is answered by the right participant, an accepted decision reaches relevant work, or an output becomes usable by another contributor. Judge a feature by the collaborative outcome it enables, not the number of agents visible.

## 2. What was learned from HiveMind

The following observations are reported in Part B of the historical HACKATHON_HANDOFF.md. They were not reproduced during planning, and they describe HiveMind rather than this new platform.

| Historical observation | Why it matters to the new product |
| --- | --- |
| Two synthetic planning trials of agent self-recording through Stop reported about 7.02x and 2.09x token-cost-equivalent overhead; one grew from one turn to five. | Reporting can become the expensive task. Test reporting burden; do not import those ratios as predictions of this app's cost. |
| Raw captured assistant text contained extensive narration; final answers and prompts were filtered to reduce noise. | Activity capture is not the same as useful collaborative state. Prefer explicit meaningful publications. |
| Extracted claims needed exact source grounding; formatting normalization and negation errors caused problems. | Model-generated decisions must preserve provenance and uncertainty. Do not let an inferred summary become accepted policy. |
| Quoted record titles generated duplicate records; paraphrases exceeded otherwise valid citations. | Feedback and summarization loops can manufacture apparent knowledge. Preserve origin and separate source statements from interpretation. |
| A pilot snapshot reported 44 provisional records, zero agent work items and 13 synced PRs without decision linkage. | A populated memory store did not prove a functioning coordination loop. The new demo must show actual use and linkage. |
| A context-scoping bug meant merged branch decisions failed to reach later main-branch sessions. | Context visibility and applicability must follow declared work and versions, not a branch name alone. |
| An unavailable service once blocked local edits unexpectedly; advisory behavior replaced that broad failure mode. | Coordination outages must be represented honestly and should not unexpectedly seize control of ordinary local work. |
| A teammate found navigation difficult and value unclear; context delivery inside the agent was largely invisible. | Make the collaborative effect understandable in the room without showing every internal event. |

The historical integer-cents versus decimal-amount example was a design counterexample, not a verified customer incident: two agents can touch different files, merge cleanly and still disagree semantically. It motivates explicit shared behavior and joint checks, not a claim that our platform automatically detects every semantic conflict.

HiveMind used a side model for extraction. That is historical implementation detail, not a requirement or budget loophole for this product. The new design excludes required separately billed APIs and avoids a hidden central reasoning service. Do not add a free hosted side-model dependency without checking whether it is necessary and authorized.

## 3. Why the ownership model is explicit

Agent output can be useful while still being wrong or inconsistent with another person's intent. The design gives humans authority over consequential requirements and shared behavior, while permitting ordinary technical exchange without repeated approval.

Task ownership, shared-contract ownership, feature coordination and local tool authority are different responsibilities. One person may hold several, but the platform must not infer them from a prominent room role. Accepting a shared change does not grant permission to edit every developer's task or machine.

This is not intended as a review button on every message. A question about an existing interface can be answered directly. If the answer proposes changing the interface, that proposed change follows the established owner path. A frequent design mistake would be turning all collaboration into approval bureaucracy because the protocol contains authority checks.

Human ownership survives agent restart. Run-specific observations do not. This avoids transferring apparent comprehension to a fresh agent that has not loaded the relevant context.

## 4. Why the distinctions in the protocol matter to users

The detailed state definitions live in COLLABORATION_PROTOCOL.md and ROOM_AGENT_CONTRACT.md. Their purpose is to prevent believable but false product stories:

| Misleading story | Concrete risk |
| --- | --- |
| All agents are updated because a change was accepted. | A disconnected consumer may still be building against the old behavior. |
| Agent is current because its adapter received bytes. | The model may not yet have processed them, or its context may have changed. |
| The handoff is current because the branch name is unchanged. | The branch's contents can move while consumers use an earlier artifact. |
| Two individual checks passed, so the feature works together. | The combined tree, environment or shared requirement may never have been checked. |
| No response means the command failed. | Acceptance or an external edit may already have happened; a retry can duplicate effects. |
| Restored database means restored safe authority. | A backup can predate revocation or external work and resurrect permissions or stale commands. |
| Cancelled in the room means execution stopped. | The external client may continue running; coordination state cannot retroactively undo code changes. |

Keep this rigor underneath simple user language. Most users need the concrete consequence and next action, not the full transport envelope.

## 5. Architectural rationale, without reopening selected decisions

The project-level coordinator is a chosen consistency boundary for shared contracts, ownership and related work. Earlier per-room coordination would have complicated cross-room acceptance. This does not establish unlimited project size or high throughput; test explicit operating limits.

The durable event/outbox model exists because web notifications can fail after authoritative state commits. Durable history is distinct from live presence. Replay is not a command to perform all prior edits again. A user returning after disconnection needs current intent and unresolved obligations, with historical effects inspected where uncertain.

Local execution keeps the first build aligned with existing user clients and subscriptions. It also creates real issues—artifact access, machine availability, distinct checkouts and permissions—that cannot be solved by merely publishing links. Those are engineering decisions still to settle, not features already implemented.

The selected Cloudflare stack is documented in the blueprint. Changing it later requires an explicit rationale and preservation of the coordination guarantees; there is no need to start a generic technology-selection debate before testing the existing choice.

## 6. User intent, recommendations and technical proof have different weights

The product owner's multiplayer direction, production intent, existing subscriptions and API-budget constraint are explicit requirements. The selected architecture is the result of recommendations accepted during planning. Some detailed UI choices remain proposed implementation guidance. Source documentation establishes upstream mechanisms only. Nothing here proves that our adapter works in the intended environment.

If a source-supported mechanism fails a real-client test, update the product promise or adapter design. Do not hide the failure behind a diagram, a mocked acknowledgement or a development-only flag. If a design detail conflicts with the product owner's intent, explain the conflict and recommend a resolution rather than silently reframing the product.

The six-person development team is a problem-discovery fact. Historical event rules described teams of two to four. We have not established the actual registered event roster; do not assume all six will enter together. Confirm only when roster affects registration or the build plan.

## 7. Event and presentation tensions to resolve at the appropriate time

The historical source separates the idea-submission PPT from the later live build/demo. Its date, duration and rubric details were inconsistent or tentative. Treat the screenshot's six PPT content requirements as supplied context; verify event-period rules before producing submission code, polished assets or fixed hour-by-hour plans.

The historical source mentions judge accessibility without an authentication barrier, while the production design requires scoped access. If that requirement is confirmed, design an explicitly limited demo experience rather than publishing unauthenticated write/control endpoints. No demo access scheme has been selected.

Planning produced text only. Do not assume the new application can reuse HiveMind core code, or that claiming new commits would satisfy an event-period authorship rule.

## 8. How to make implementation progress without another planning loop

The current specifications are enough to identify the first useful experiment and vertical slice. An elaborate UI cannot compensate for an adapter that never supplies the question to the other agent. Prove the collaboration path early and revise the experience to match it.

When implementation starts and event scope allows it, inspect the actual repository and its local instructions first. Determine what already exists; planning did not inspect an application source tree. Do not fabricate file layouts as if they were present.

Build the path connecting human-visible intent to an actual scoped agent response. Add storage, transport and rendering in service of that path. Use the established acceptance criteria and stress scenarios as test inputs, not as tests already passed. Test invariants through real transitions rather than writing shallow tests that merely duplicate type definitions.

Update the canonical spec/protocol when choices become concrete. Keep names and statuses consistent across UI and server. Avoid a parallel set of architecture files whose authority is unclear. Do not reopen settled questions to demonstrate thoroughness.

## 9. High-value unknowns and the evidence that would settle them

| Unknown | Useful evidence |
| --- | --- |
| Delivery latency and supported checkpoint behavior | Trace a unique versioned question/update through actual client observations and agent response. |
| Reporting overhead | Count publication calls, added turns/context and human corrections on a real small feature. |
| Artifact access between machines | Retrieve an immutable handoff with consumer credentials and verify observed content identity. |
| Joint verification | Assemble a named candidate from selected inputs and collect a scoped check; repeat after an input changes. |
| Secure pairing and revocation | Attempts to attach wrong project/run, replay pairing and use revoked credentials must fail appropriately. |
| Recovery | Reconcile after interrupted delivery and restore without replaying uncertain external work or reviving old authority. |
| Value over ordinary tools | Observe comparable team work using GitHub/chat/client features and the product; include the platform's extra effort. |
| Production-supported packaging | Clean-machine installation with the intended account and supported settings, without an undisclosed preview bypass. |

The existing docs define expected behavior, not numeric service targets. Do not invent latency, cost, availability or savings commitments. Establish measured limits and document the conditions.
