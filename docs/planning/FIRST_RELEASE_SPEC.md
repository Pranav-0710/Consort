# First-release product specification — multiplayer development

Version 0.3 — 11 November 2026. Proposed interaction specification; no implemented product or passed runtime tests are claimed. Replaces the intervention-centered v0.2 journey with the accepted multiplayer workflow. Previous version: work/FIRST_RELEASE_SPEC.v0.2.md.

This is the current interaction and release-scope specification. ARCHITECTURE_BLUEPRINT.md is the architecture entry point. COLLABORATION_PROTOCOL.md supplies transitions; AGENT_CAPABILITY_MATRIX.md supplies documented client limits and unexecuted tests. Foundational identity, authority, evidence and recovery rules in ROOM_AGENT_CONTRACT.md remain binding.

## 1. Promise and first success

People and their coding agents build a shared feature together: agree how work connects, ask questions, exchange usable outputs, adapt to accepted decisions and establish what works together.

Initial audience: small teams already working in separate agent sessions/checkouts. The user reported six teammates using Claude and Codex, fragmented coordination, and more than 50 pending interdependent PRs. Conflicting code, incompatible behavior and combined failures are important use cases within the broader collaboration platform.

First value: a useful agent-to-agent exchange changes or unblocks connected work without a human forwarding the conversation. The complete initial journey also includes an accepted shared decision, an adopted artifact and scoped combined evidence. A room or activity feed alone is insufficient.

The goal is a published production application. The hackathon is the first milestone, followed by pilot and public-launch gates. Users bring their own subscribed clients; separately billed model APIs and hidden server-side inference are excluded. The first adapter is Claude Code. Codex remains part of the intended product, subject to its own capability gates.

## 2. One complete two-developer journey

Illustrative checkout feature, excluding real payments. This scenario is not a measured incident or a complete payment protocol. Alex owns backend work and the shared checkout contract; Blair owns frontend work. Each has their own Claude session and checkout.

One feature room contains two owned work packages. Each package references its authoritative task agreement. The joint view does not duplicate scope or require another manually maintained tracker. Existing issue/PR links can provide context without requiring automatic GitHub ingestion.

| Step | Experience and behavior | Observable outcome |
| --- | --- | --- |
| Start together | Alex creates a shared feature, criteria and an invitation; Blair authenticates and accepts. | Shared goal and authorized participants. |
| Divide connected work | Humans establish backend/frontend ownership and contract C1; agents may suggest the plan. | Named responsibilities, criteria and explicit dependency. |
| Connect | Each pairs a local adapter after reviewing identity and sharing scope. Agents retrieve current context and acknowledge it. | Correct person/project/package/checkout bindings; acknowledgement distinct from connection. |
| Work | Agents publish concise plans and meaningful milestones within accepted scope. | Attributed current reports with timestamps, not inferred progress percentages. |
| Collaborate | Frontend asks backend whether retries are safe. Backend receives the question at a supported checkpoint, answers and proposes a missing requirement. | Real addressed exchange; proposal remains distinct from approved scope. |
| Decide | Alex reviews before/after behavior and accepts shared contract C2. | New target and known affected work; task pins remain unchanged. |
| Adapt | Each owner reconciles their task agreement. Blair's adapter is temporarily disconnected. | Accepted human changes visible; online acknowledgement and offline pending state differ. |
| Reconnect | Blair resumes locally; current context refreshes before current adoption is claimed. | Explicit frontend acknowledgement or blocker, with missed work preserved. |
| Hand off | Backend publishes B1 with immutable identity, assumptions and evidence. Frontend retrieves it and declares its selected input. | Publication, retrieval and adoption separately inspectable. |
| Handle change | Backend publishes B2. Frontend evaluates and adopts it or reports incompatibility. | B1 remains selected until explicit change; historical evidence preserved. |
| Check together | A designated local runner assembles selected outputs and performs agreed checks. | Identified combined candidate, inputs, requirements, environment, result and source. |
| Review | Humans inspect criteria, evidence and unresolved work before normal PR review. | Useful shared review context; GitHub retains approval/merge authority. |

A response can leave work blocked. Agents can continue unaffected work while consequential decisions are pending. Feature coordination does not grant control over another person's task or terminal.

## 3. Three screens and their actions

### Project overview

Default: Needs your attention, then active features. Each feature shows goal, responsible people, participating agents, last meaningful report, unresolved decisions/dependencies and evidence summary. Presence is separate from progress.

Actions: create feature, open room, invite where authorized, connect agent, filter owned/watched work. Browsing and watching do not change authority. Each attention item explains why the person is involved and what action is possible. Group repeated events under their unresolved obligation; reading an alert does not resolve it.

Empty state: start one meaningful shared feature and connect the first agent. A second person can join later. First-release notifications are in-app; external channels follow later.

### Shared feature room

| Area | Content | Actions |
| --- | --- | --- |
| Outcome | Goal, criteria, ownership and accepted constraints | Propose change; accept where authorized. |
| Work and agents | Packages, concise plans, dependencies, last reported step, capability/status | Inspect package, connect own run, inspect blocker. |
| Conversation | Attributed discussion and addressed questions | Discuss, ask a named person/agent, respond, follow up. |
| Decisions | Before/after change, responsible owner, declared impact, current versions | Propose, accept/reject, reconcile owned work. |
| Handoffs | Output revision, producer, assumptions, access and consumption | Publish, inspect, retrieve/adopt, report incompatibility. |
| Evidence | Criterion, candidate, result/source, freshness | Attach report/check, inspect provenance, request verification. |

A compact joining brief uses stored records: goal, ownership, constraints, last reported activity, questions and recent accepted changes. No separate inference call is required. Default conversation is discussion; an explicit addressed action sends a question to an agent. Forwarding all chat is excluded.

Keep everyday labels concrete: Waiting for backend answer; Blair needs to review this change; Checked against an older revision. Versions, receipts and internal identities belong in details. Asking a useful question should not require navigating contract administration.

### Connection/setup panel

Show project, work package, repository/worktree, associated user, client/adapter versions, sharing scope and available capabilities before pairing. Repository identification does not establish repository permission or project membership.

Proposed baseline: expiring single-use pairing, scoped local credential, explicit consent and detach/revoke. Authentication implementation remains an engineering choice. Provider subscription credentials stay with the official client; platform credentials are separate. Do not paste long-lived secrets into model conversations or commit them to repositories.

Disclose shared material: short plans, questions, proposals, milestones and artifact/evidence references. Full transcript/source upload is off by default; explicitly published messages may still contain code. Explain the visibility boundary.

Claude baseline is MCP plus supported checkpoint hooks. Optional preview push is not a prerequisite. For later Codex integration, managed app-server sessions and exchange through existing clients must be labeled as distinct modes.

## 4. Status language

| Label | Meaning and next action |
| --- | --- |
| Not connected | No adapter attached; connect one. |
| Connected; task acknowledgement pending | Adapter registered; reach a supported checkpoint or inspect the local session. |
| Current task acknowledged | Run explicitly acknowledged the displayed bundle; inspect its plan. This is not correctness verification. |
| Waiting for client checkpoint | Update queued; context delivery not established. Continue/resume locally as appropriate. |
| Context supplied; response pending | Adapter reports context insertion; explicit agent response is absent. |
| Disconnected | Transport lost or connection observation expired; reconnect and refresh state. |
| Connection needs attention | Specific observed authentication/version/scope problem with a corrective action. |
| Decision needed | Appropriate human owner must review a proposal or task reconciliation. |
| Input blocked | Named unanswered question, incompatible artifact or unavailable dependency. |
| Evidence missing or outdated | Required check absent or tied to older relevant inputs. |

These describe separate dimensions, not one universal linear state. Display the relevant combination. When only silence is observed, say awaiting response; do not invent a quota failure or local permission prompt. Delivery, acknowledgement, adoption, reported implementation and verification remain distinct.

## 5. Keep collaboration lightweight

Humans establish outcomes, ownership and consequential changes. Routine questions, answers, plan revisions within scope and handoff acknowledgements need no additional human approval. Contract acceptance and each affected task reconciliation are separate clear actions in the hackathon slice. A future combined action must list effects and validate all authorities atomically.

Generate the joint view from package records. Ask agents for an initial plan and meaningful milestones during existing work, rather than continuous narration. One structured submission may explicitly acknowledge context and publish a plan; retain both facts separately.

Mechanical observations come from adapters. Missing semantic reports remain unknown/stale, with a correction path. No per-event model call, hidden summary model or Stop-hook loop for cosmetic reporting. Context uses bounded relevant snapshots/deltas with retrieval references; incomplete necessary context is visible. Measure reporting turns, tokens, latency and stale reports before expanding scope.

## 6. Essential failure and recovery behavior

| Situation | Presentation and recovery |
| --- | --- |
| Wrong identity/checkout paired | Explain mismatch; cancel/detach and pair correctly. |
| Accepted change while offline | Human decision visible; agent adoption pending, delivery intent retained. |
| Proposal stale or owner changed | Show changed target/authority; deliberate review rather than generic retry. |
| Late answer after cancellation | Preserve as attributed history; do not reopen question. |
| Handoff inaccessible or mismatched | Retrieval blocker; do not claim access or use. |
| New output available | Show replacement and applicability; preserve selected consumer revision. |
| Code/requirements change after checks | Historical result retained; new relevant combination unverified. |
| Agent replaced | Fresh identity and acknowledgement/adoption; explicit request retargeting. |
| Runtime permission needed | If observable, route to responsible local developer; room acceptance is separate. |
| Prior action uncertain | Inspect existing effects before retrying. |
| Observed usage/auth failure | Pause and explain recovery; no separately billed API fallback. |
| Owner unavailable | Pending decision; explicit authorized administrative recovery with attribution. |
| Circular/repeated exchange | Apply bounds; show unresolved summary to responsible human. |

Detach/revoke prevents future platform access under that credential. It does not erase downloaded context or guarantee interruption of external processes.

## 7. Scope by release stage

| Stage | Required scope |
| --- | --- |
| Hackathon demonstration | One project/repository; two humans and Claude runs; one feature room/two owned packages; one shared contract; questions, owner acceptance/reconciliation, checkpoint delivery, immutable handoff, imported/local collected combined evidence, in-app attention and reconnect/stale handling. |
| Controlled pilot | Independent team use; repeatable install/uninstall; supported-version documentation; measured reporting burden; sustained replay/reconnect tests; operational limits and recovery guidance. |
| Before public launch | Pilot gates plus secure identity/invitations/pairing, cross-project isolation and revocation, safe content rendering, credential handling, race/idempotency checks, backup/restore rehearsal, retention/deletion and privacy controls, monitoring/support, update/distribution compatibility and measured capacity/cost. |
| Later expansion | Codex after adapter proof; supported production push; richer GitHub/CI ingestion; additional repositories; external notifications and richer dependency analysis. |

Test multi-project isolation even if the demo displays one project. A successful demonstration is insufficient for broad public signup. Free hosting allowances are an initial constraint, not a promise of free operation at arbitrary scale.

Hosted agent runtimes, custom merge queues, terminal takeover, universal semantic-conflict discovery and autonomous central control are outside the first slice. Managed automatic dispatch, if added, requires separate per-human bounded authorization. Existing subscription access does not establish unlimited usage.

## 8. Observable acceptance criteria

| ID | Required observation |
| --- | --- |
| AC01 Identity | Correct human/project/package/run/checkout binding; substituted project/run IDs rejected. |
| AC02 Joining | A teammate identifies outcome, owners, constraints, last reported work and open questions without reconstructing a transcript. |
| AC03 Collaboration | Real agent question reaches another agent; attributed response has a useful effect or explicit remaining blocker, without human copy-paste relay. |
| AC04 Authority | Agent may propose but cannot accept consequential changes; current appropriate human owner and versions are checked. |
| AC05 Reconciliation | Shared acceptance creates known dependent obligations without silently changing task pins. |
| AC06 Delivery | Receipt, context supply and agent acknowledgement are separate; offline work never appears current by inference. |
| AC07 Recovery | Reconnect/resume restores current context; duplicate deliveries create no duplicate authoritative mutations. |
| AC08 Handoff | Accessible immutable output is published/retrieved/adopted; replacement cannot silently move a consumer. |
| AC09 Joint result | Combined candidate, specification, check and source identified; new inputs cannot inherit success. |
| AC10 Capability | Unsupported controls explained/unavailable; connection does not imply arbitrary session control. |
| AC11 Cost | No required separately billed inference; exchange bounds stop loops; unavailable reasoning remains pending. |
| AC12 Usability | Participants complete and explain the journey; record confusion, manual effort, overhead and stale reports. |
| AC13 Review | Room acceptance cannot approve/merge a PR or satisfy local runtime permissions. |

These are requirements, not test results. AC02/AC12 require observed human use. The capability matrix and stress matrix add client, concurrency, recovery and security obligations.

## 9. Build slices derived from the journey

| Order | End-to-end deliverable | Completion evidence |
| --- | --- | --- |
| 1 | Identity/invite, feature/package, one paired agent and refreshed context | Correct scope and explicit initial acknowledgement in the room. |
| 2 | Second owner/run and useful addressed exchange | Correct routing, attribution and unresolved status visible to both humans. |
| 3 | Shared proposal/acceptance and task reconciliation | Target, pins and actual acknowledgements shown, including an offline participant. |
| 4 | Publish/retrieve/adopt an output | Exact input tracked with inaccessible and replacement cases. |
| 5 | Combined check and scoped outcome summary | Identified candidate and evidence freshness. |
| 6 | Harden full loop and attention view | Permission failures, races, reconnect, uncertain outcomes and overhead exercised. |

Complete a human-visible vertical slice before expanding dashboards. Adjust the experience if the actual client cannot meet its promised intervention point. Estimates follow capability proof and confirmed event time; team members can work across responsibilities.

## 10. Evaluation and demo

Compare comparable tasks against ordinary agent sessions plus GitHub and team chat. Count manual forwarding, repeated explanations, time waiting for inputs, stale assumptions, human decisions and missing reports. Include added tokens/turns and reporting effort. An organized room alone does not prove value or differentiation.

Three-minute rehearsal target: 0–30s shared goal/two agents; 30–65s real question/answer; 65–110s accepted change and owner reconciliation; 110–145s handoff/adoption; 145–180s scoped evidence and remaining work. Offline/stale recovery also belongs in the longer technical walkthrough. Model latency may require reducing task size. Never represent simulated or prerecorded results as live completion.

Prepare connections and permitted demo task before presenting. Core code/task setup must follow confirmed event rules. This file is textual planning; no application code, polished UI assets, deployments or external communications were produced.

## 11. Remaining engineering choices

Select authentication/pairing implementation, artifact access across machines, designated check runner/environment and operational bounds. Validate clean-machine adapter installation and delivery on intended versions. Claude Pro and ChatGPT Plus access is confirmed by the user; production compatibility still depends on supported integration paths and provider conditions.

Resolve contradictions explicitly against the detailed protocol and foundational invariants. Product simplicity must not conceal stale authority, missing acknowledgement or unverified work.

