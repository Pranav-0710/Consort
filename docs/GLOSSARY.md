# Glossary

Plain-English meanings of the terms used in issues, code and the [planning baseline](planning/README.md). Use these words consistently in UI text, code identifiers and PRs.

## People, work and scope

- **Project.** The boundary for membership, authority, shared contracts and feature rooms. One project coordinator holds all of it. Nothing is routed across projects in the first release.
- **Member.** A person with access to a project. Readers can view, contributors can ask, discuss and propose, and owners can accept consequential changes to what they own.
- **Feature room.** The shared place for one development outcome. It shows the goal, its owned work packages, conversation, decisions, handoffs and evidence. It *references* package records and never keeps its own editable copy of their scope.
- **Work package.** One owned part of a feature, such as backend or frontend. It has one responsible human, a task agreement, dependencies and its participating runs. Reconciliation obligations, contract pins and acknowledgements attach to work packages.
  - Where ROOM_AGENT_CONTRACT says "room", it means what is here called a work package.
- **Task agreement.** What a work package must achieve: goal, requirements with stable IDs, exclusions, acceptance criteria, owner and pinned shared-contract versions. It is versioned, and only its current owner accepts changes to it.
- **Plan.** How one run intends to meet its task agreement. The agent publishes and revises its own plan inside accepted scope. A plan is never the agreement.
- **Shared contract.** A separately owned, versioned decision used by several work packages, for example "retries carry a request ID". Accepting a new revision sets a new **target**. It does not silently change any task's **pin**.
- **Pin.** The shared-contract version a task agreement currently uses.
- **Change request.** A proposal to change a task agreement or shared contract. Its states are proposed, accepted, rejected, withdrawn or superseded. Agents may propose; only the current human owner accepts.
- **Reconciliation.** The work-package owner's explicit decision on how their task adapts to a newly accepted shared target: accept the change, record a blocker, or propose something else.

## Agents and connections

- **Run.** One agent execution identity bound to a human, a work package, a context generation and a checkout. A restarted or replacement agent is a **new run** and inherits task history, not understanding.
- **Connection.** One registered local adapter, authenticated to a human and an authorized project. Each reconnect creates a new **connection generation**, and an older generation can no longer change run state. This is called fencing.
- **Context generation.** A counter that changes whenever the agent's context may have been reset or restored, for example at startup, resume or compaction. Acknowledgements are tied to a generation.
- **Checkout identity.** Repository, worktree, branch, known commit and dirty state. A branch name alone does not identify code.
- **Adapter.** The local component that links a person's own agent client (Claude Code first) to the coordinator. It uses MCP tools and supported hooks, with a durable local inbox and outbox. It never handles provider credentials.
- **Checkpoint.** A point the client supports where queued context can be supplied to the agent, for example a hook event. Being online does not mean the agent is paying attention.
- **Inbox item.** One of a closed set of things routed to an agent:
  - an addressed question
  - an answer to its own question
  - an accepted revision affecting it
  - a reconciliation obligation
  - a handoff published, replaced or withdrawn for a declared consumer

  General room chat is never forwarded.

## The six separate facts

These are never collapsed into one status such as "synced" or "done":

1. **Delivery.** The adapter received an item.
2. **Context supplied.** The adapter or hook gave the item to the agent at a checkpoint.
3. **Acknowledgement.** The agent explicitly reported recognizing the exact versions. This is not proof of understanding.
4. **Adoption.** A consumer run explicitly declared that it uses a specific handoff revision.
5. **Reported implementation.** The agent says it applied something. This is a report, not proof.
6. **Verification.** A named check of an identified artifact against a named criterion, with its source recorded.

## Handoffs and evidence

- **Handoff.** An immutable publication of an output. In v1 it is a commit SHA pushed to the shared remote, plus its assumptions, limitations and evidence. Corrections are new publications that link to what they replace.
- **Retrieval.** An observation that a consumer fetched the handoff and the content matched its identity. A mismatch or an inaccessible artifact is a blocker.
- **Combined candidate.** An identified combination of selected inputs: a baseline plus chosen SHAs, assembled in a stated order and environment. Two separately passing checks are not a combined check.
- **Evidence.** A scoped observation about an identified artifact and criterion. Its **source class** is set by the server from the submitting credential and is one of:
  - agent-reported
  - participant-collected
  - human review
  - independent collector (later)
- **Checked (participant-collected).** The label for a combined check run on a team member's local runner. It never means "independently verified". The criterion counts as satisfied only when its human owner records acceptance of that evidence.
- **Freshness / applicability.** Whether evidence still applies to the current inputs and requirements. Any changed input makes the new combination unverified, while the old result stays as history.

## Reliability terms

- **Command window.** A server-issued, time-limited permission to submit commands. Within it, retrying the same request ID with the same payload returns the original outcome instead of repeating the effect. The same ID with a different payload is rejected.
- **Outcome unknown.** A timed-out command has not failed. Query or reconcile it before retrying, and never repeat an external effect blindly.
- **Outbox.** Durable records of notifications to send, committed in the same transaction as the change they announce. WebSocket delivery is transport, not storage.
- **Recovery epoch.** An identifier for one incarnation of a project's coordination state. A restore creates a new epoch, so old credentials, cursors and commands cannot silently resume.
- **Cursor.** An opaque, scope-bound position in a project's event stream. A cursor never grants access.
- **Attention item.** One unresolved obligation that needs a specific person, together with why and what they can do. Repeated events are grouped under it, and reading it does not resolve it.
