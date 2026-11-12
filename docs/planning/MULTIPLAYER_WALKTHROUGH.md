# First multiplayer walkthrough

11 November 2026. Architectural tabletop exercise, not an executed test. Extends MULTIPLAYER_COLLABORATION_MODEL.md and ROOM_AGENT_CONTRACT.md v0.2. Names, artifacts and outcomes below are illustrative.

## Shared outcome

Two developers build a checkout feature using separate Claude sessions and checkouts of one repository. Retrying a purchase must not create a duplicate order. The example excludes real payments; it does not specify a production payment protocol.

Alex owns backend work and the shared checkout API contract. Blair owns frontend work. Alex coordinates acceptance of the feature outcome, but cannot change Blair's task agreement or local permissions. Both can inspect and discuss the shared feature room.

The room connects two work packages with their existing task agreements. A shared view displays their relationship; it does not introduce another conflicting copy of those agreements. Relevant shared-contract versions are explicit references.

## Walkthrough and expected behavior

| Step | Action | What the platform records or displays |
| --- | --- | --- |
| 1 | Alex creates the shared outcome; both humans agree responsibilities and acceptance criteria. | Backend and frontend ownership, shared contract C1, task agreement versions and initial dependency. |
| 2 | Each developer attaches their Claude session and checkout. | Distinct run and checkout identities, scoped access, context supplied and explicit version acknowledgement. Presence alone establishes none of these. |
| 3 | The agents publish their implementation plans. | Plans reference their own agreements and C1. No additional approval is needed for implementation steps within that scope. |
| 4 | Frontend agent asks backend agent whether a timed-out request can safely be retried. | An addressed question linked to checkout work and C1. Its delivery and answer status are tracked separately. |
| 5 | Backend agent identifies that retry behavior is unspecified and proposes a request identifier shared by frontend and backend. | An attributed proposal and explanation. Its answer does not turn the proposal into accepted requirements. |
| 6 | Blair's adapter disconnects. | Frontend is shown with its last known version; pending messages persist. Independent backend work can continue where compatible. |
| 7 | Alex accepts shared contract C2 defining the retry requirement. | Atomic contract update plus notification intent. Affected work is marked as requiring reconciliation, including Alex's backend task. C2 is the current shared target; existing task pins do not silently change. |
| 8 | Alex reconciles backend work; Blair later reconnects and reconciles frontend work. | Each owner explicitly accepts their task's relevant changes. Current context is supplied to each run, followed by acknowledgement or a blocker. Old queued messages retain their original version context. |
| 9 | Backend agent publishes implementation artifact B1 with contract C2 and scoped evidence. | Handoff identifies commit/content identity, producing run, retrieval location, limitations and test evidence. “Ready” remains the producer's report. |
| 10 | Frontend agent adopts B1 and implements artifact F1. | Consumer adoption identifies B1 and C2. It does not imply B1 has been copied, run or verified unless those observations are recorded. |
| 11 | Backend agent publishes B2 after a correction. | B1 remains historical and frontend remains pinned to B1. B2 appears as an available replacement; relevant results require freshness review. |
| 12 | Frontend agent evaluates B2 and adopts it, or reports an incompatibility. | An explicit new adoption or unresolved question. An interface change outside C2 requires the existing shared-change process. |
| 13 | A participant runs agreed combined checks on a constructed candidate containing the selected backend and frontend changes. | Evidence identifies the candidate, source revisions, target baseline, assembly method, relevant agreements and contracts, environment, check command/configuration and outcome. |
| 14 | Someone pushes another relevant commit after the check. | The prior result remains valid only for its original candidate. The changed candidate is unverified until checked; the room does not carry forward a green status automatically. |
| 15 | Humans inspect the evidence and outstanding items before normal PR review. | The room summarizes observed results, unresolved requests and untested requirements. GitHub remains authoritative for PR approvals and merge state. |

## What the humans actually need to see

The feature room should answer five questions without requiring a transcript read:

1. What are we trying to deliver, and who owns each part?
2. What is each agent doing, and what does it need from someone else?
3. Which decisions or outputs changed, and which participants have adapted?
4. What combination was checked, and what remains uncertain?
5. Does anyone need my decision, explanation or review now?

The attention view should prioritize consequential unanswered questions, unresolved adoption, incompatible proposals and failed or stale checks. Routine milestones belong in the room history. Presence and elapsed time are supporting context, not progress evidence.

## Gaps exposed and proposed refinements

### Reconciliation must be a first-class interaction

Accepting C2 and updating every affected task are separate actions. Display the shared target, each task's accepted pin and each run's acknowledged version together. Offer a concise reconciliation action showing the affected requirements. Never present pending downstream adoption as synchronized work.

### Artifact retrieval needs its own observable result

Publishing a handoff, receiving its reference, retrieving its contents and using it are separate facts. Missing permissions, unavailable commits and local-only files must produce a visible retrieval blocker. A local dirty snapshot must have a content identity or be labeled as not reproducibly available. Agents must not invent access to another checkout.

### A combined candidate needs an identity

Two independently passing commits are not a combined check. Name how the candidate was assembled and preserve either its immutable commit or a reproducible input/patch manifest. An assembly conflict is an assembly failure, distinct from a failing build or behavioral check. Candidate execution needs an explicitly authorized runner; worktree separation alone does not provide a security boundary.

### Shared-contract ownership and feature coordination differ

Alex's role coordinating the feature does not grant control of Blair's task, agent or terminal. Changes touching several separately owned contracts may need several existing owners. A partially accepted proposal must not be described as a fully accepted cross-contract change.

### Agent collaboration needs a bounded protocol

An agent can answer another agent within accepted scope without human approval. Repeated clarification loops need limits and a useful unresolved summary. The coordinator enforces identity, routing and versions; models provide technical reasoning. Delivery guarantees cannot establish model comprehension or implementation correctness.

### Reconnection and replacement must remain distinct

An existing run reconnects under a fresh connection generation and reconciles current state. A replacement run gets a new identity and acknowledges its own current context; it inherits task history, not comprehension. Late reports from an old run remain attributed history and cannot resolve a superseded or retargeted request. Inspect uncertain prior edits before repeating them.

If contract acceptance times out, query its recorded outcome. Retry the same command identity and payload only within the valid command window; a timeout alone does not justify issuing a new acceptance command.

## Minimum demonstration and acceptance evidence

The initial demonstration needs two human-owned Claude runs, a shared feature room, addressed questions, one shared-contract change, owner reconciliation, a revision-specific handoff and imported combined-check evidence. It can use a developer-controlled runner rather than building hosted execution infrastructure.

Demonstrate that a disconnected consumer remains visibly behind, a replacement artifact does not silently change its dependency, and a changed candidate does not inherit a passing result. Measure human coordination effort and reporting overhead as well as whether the useful change reaches both agents.

This walkthrough establishes design expectations only. The protocol, adapter capability, user experience and runner behavior still need implementation-time validation. The architecture is ready for a more precise interaction/state specification; this exercise does not establish production readiness or market differentiation.

