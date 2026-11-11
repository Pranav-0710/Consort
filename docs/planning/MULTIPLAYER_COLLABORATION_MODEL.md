# Multiplayer collaboration model

Architecture refinement proposal — 11 November 2026.

This extends ROOM_AGENT_CONTRACT.md v0.2 and the first-release specification. It records the accepted product direction and proposes the mechanics below; it is not an implemented or tested protocol. The earlier integration-first research hypothesis does not define the product scope.

## 1. Product promise

Teammates and their independently owned coding agents work toward a shared development outcome. They plan connected work, exchange questions and usable outputs, adapt to accepted decisions, and establish what works together. Humans participate in the same rooms without taking over one another's terminals.

Conflict repair, review assistance and integration diagnosis are supported workflows within this broader collaboration model.

## 2. A concrete collaboration loop

1. A human creates a shared feature task with an outcome and acceptance criteria.
2. Participating agents propose work packages and dependencies. The responsible humans establish ownership and accept consequential scope or shared-interface decisions.
3. Each developer attaches their Claude run and separate checkout to the relevant work. Each run receives its assigned agreement and relevant shared context.
4. Agents work independently, ask addressed questions, and publish meaningful milestones. Routine questions and implementation steps within the agreement need no extra approval.
5. An agent publishes a versioned handoff: what is available, where to find it, what it assumes, and what evidence supports it. A consumer explicitly records which revision it uses.
6. When a question exposes a missing requirement, agents propose a change. The appropriate human accepts it; affected runs receive a reconciliation request and report adoption or a blocker.
7. The room gathers individual and combined evidence. Humans can see satisfied requirements, unresolved disagreements and untested combinations before normal PR review and merge.

Illustrative scenario: backend, frontend and test agents collaborate on checkout. Frontend asks about retry behavior. The test agent identifies a duplicate-order risk. A human accepts a shared retry contract. Backend and frontend adapt, the test agent checks their identified revisions together, and a reviewer inspects the decision and evidence. This is a design example, not a measured customer incident.

## 3. Coordination model

Keep one project coordinator as the authority for membership, task agreements, shared contracts, routing and durable event history. Agent sessions and tool execution remain outside it.

One feature room can contain several participating runs and separately owned work packages. Existing independent task rooms can instead link through explicit dependencies. A joint plan is a view of these accepted assignments and dependencies, not a second independently editable source of task scope.

Each work package identifies its responsible human, current participating run, required outputs and acceptance criteria. Human responsibility survives a run ending. Multiple runs can contribute evidence, but responsibility must not be inferred from whichever agent replied most recently.

The existing six record families remain the foundation:

| Collaboration need | Existing record or proposed extension |
| --- | --- |
| Shared outcome and responsibilities | Agreement plus explicit work-package ownership |
| Connected work | Plans plus typed dependency references |
| Agent-to-agent discussion | Addressed questions, answers and non-authoritative discussion |
| Consequential adaptation | Change requests and accepted agreement/contract revisions |
| Delivery and adoption | Acknowledgements scoped to run and revision |
| Usable handoff | Proposed artifact envelope referencing evidence and source revision |
| Combined result | Evidence identifying the artifact combination and check |

Do not create a separate approval system for each row. Handoffs publish outputs; they do not approve scope, PRs or merges.

## 4. Cross-agent communication

A request names its purpose, originating work, target work or participant, required input and relevant agreement/artifact revisions. Route through the coordinator so access controls and provenance apply. A recipient's name embedded in free text is not routing authority.

Keep request resolution separate from delivery observations. Resolution is open, answered, declined, cancelled or superseded. Delivery observations record queued, adapter received, context supplied and agent acknowledged. Expiry is an explicit unresolved outcome. An answer can supersede an earlier answer but does not erase it. Answering a question does not establish that its proposed behavior is approved or implemented.

Agents can exchange technical information within the accepted plan. Instructions received from another agent remain attributed input and cannot expand local tool permissions or override human-approved scope. Delivery happens at supported client checkpoints; online presence does not promise immediate model attention.

Bound automatic exchanges by per-task message, token and time budgets. Deduplicate retries; suppress echo loops; surface repeated unanswered questions and unproductive exchanges to the responsible human. Avoid requiring a model call for every activity event.

## 5. Handoffs, dependencies and change

A handoff identifies producer, work package, artifact type/location, immutable revision or content digest, applicable contract versions, known limitations and evidence. A branch name or “done” message alone is insufficient.

The receiving run may accept an identified output for use, request clarification or reject it with a reason. Adoption is per run and revision. New producer commits do not silently replace the consumer's dependency. The platform reports an available update and any resulting reconciliation obligation.

Distinguish a hard prerequisite from informational coordination or shared-contract alignment. Reject cycles in hard prerequisites or require humans to split the work into independently usable stages. Discussion links can be cyclic without blocking execution.

Agents may suggest affected work from repository analysis. Explicit references establish known dependencies; suggestions remain labeled and cannot support a claim that every affected task has been discovered.

## 6. Essential failure behavior

| Situation | Required behavior |
| --- | --- |
| Recipient offline | Persist the request; show pending delivery; let other independent work continue. |
| Run ends or is replaced | Preserve history; route pending work to its responsible human; replacement run establishes fresh context and adoption. Record retargeting explicitly; late replies from the old run cannot silently resolve a superseded request. Inspect uncertain prior execution before repeating it. |
| Two humans request incompatible behavior | Preserve both proposals; apply current ownership and version checks; surface the disagreement to the relevant owner. |
| Producer changes code after handoff | Retain evidence for the old revision; mark newer work separately; never transfer verification automatically. |
| Agent claims a fix without evidence | Display an attributed implementation report and the remaining verification gap. |
| Different repositories or projects | Do not route across project boundaries in the first release; later federation needs an explicit authorization design. |
| Shared decision changes mid-task | Notify affected work, preserve old versions and require explicit reconciliation; independent work may continue where compatible. |
| Consumer cannot use the artifact | Keep the dependency unresolved; create an addressed clarification or repair request. |
| Repeated questions or circular delegation | Enforce budgets, show the loop and return the unresolved item to a human. |

## 7. Scope and proof

First demonstrate two human-owned Claude sessions collaborating on one shared feature: a useful question, a consequential shared change, a revision-specific handoff and a relevant combined check. Include one disconnected participant and one stale handoff. Codex is part of the team's eventual workflow, but its adapter is not assumed to exist in the initial release.

The product succeeds when collaboration improves the shared outcome with acceptable human effort and inference overhead. Count avoided repeated explanations, time waiting for needed inputs, incorrect assumptions caught, stale handoffs and evidence gaps, alongside the cost of reporting. These are proposed evaluation measures, not current results.

Next design step: specify the request/handoff state transitions and walk through this feature scenario against the existing architecture stress cases. Additional platform features should follow demonstrated gaps in this loop.

