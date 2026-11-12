# Agent integration capability matrix

Official-documentation review — 11 November 2026. No agent was installed, launched, authenticated, controlled or experimentally tested. “Documented” describes an upstream capability, not a completed integration or permission to use every deployment pattern.

## 1. Verdict

The collaboration design has documented integration paths, but the adapters cannot promise identical control. Use an attached-session mode for Claude Code and a separate, explicitly managed-session mode for Codex where app-server control is required. Existing-session Codex MCP integration is another option for structured exchange. Arbitrary live-session takeover is not established by this review.

The core product remains a shared multiplayer development workspace. These differences affect delivery and execution controls, not the shared task, question, decision, handoff and evidence model.

## 2. Matrix

Legend: D = documented upstream mechanism; C = conditional/preview; U = not established for our intended integration. Every row still needs a test on the intended client version.

| Product need | Claude Code | Codex | Design consequence |
| --- | --- | --- | --- |
| User-owned model access | Own-client subscription authentication; third-party credential routing restricted [A4] | Subscription sign-in distinct from API-key access [O2] | Provider credentials stay with the client; platform pairing is separate. |
| Structured room reads/writes | D: MCP tools [A1] | D: MCP tools [O3] | Our server defines schemas and validates writes. Tool availability does not guarantee use. |
| Supply updated context | D: hook `additionalContext`, read on the next model request [A2] | D: managed `turn/start`; active `turn/steer` [O1] | Select delivery by session capability. Keep transport acceptance separate from acknowledgement. |
| Push into an open session | C: channels; research preview, opt-in and allowlist restrictions [A3] | D: managed app-server turn controls [O1] | Claude production push cannot depend on custom development-channel flags. |
| Wake idle work | U with ordinary MCP/hooks alone; channels conditional [A2,A3] | D: managed `turn/start` [O1] | Queue or dispatch according to capability and human policy. |
| Resume conversation | D: SessionStart covers resume and compaction [A2] | D: `thread/resume` [O1] | Restore our current task snapshot; do not inherit comprehension. |
| Observe activity | D: lifecycle/tool hooks [A2] | D: streamed thread/turn/item events [O1] | Activity is not semantic progress or task completion. |
| Cancel execution | U: remote cancellation through our attached-session adapter | D: managed `turn/interrupt` [O1] | Separate cancelling a request from interrupting execution. |
| Preserve runtime approval | Hook decision controls exist [A2]; our baseline leaves local approval with owner | D: client-facing approval requests [O1] | Room acceptance cannot silently approve commands or file access. |
| Control any already-running desktop/CLI conversation | U | U: managed-thread APIs alone do not prove arbitrary live attachment | Clearly label supported session origins. |
| Verify joint outcome | Requires separately collected check evidence | Requires separately collected check evidence | A response or completed turn is insufficient. |

Source statements above are deliberately narrow. Architectural consequences are our proposed design, not provider guarantees.

## 3. Source register

- **A1:** [Claude Code MCP](https://code.claude.com/docs/en/mcp). External tools can read and act on connected systems; local and remote connections are documented. Our proposed tools are `read_context`, `ask_question`, `answer_question`, `publish_plan`, `publish_handoff` and `attach_evidence`; these are our names, not built-in Claude tools.
- **A2:** [Claude Code hooks reference](https://code.claude.com/docs/en/hooks). Context injection occurs at lifecycle events and is read at a subsequent model request. SessionStart covers startup, resume and compaction. This does not establish arbitrary remote prompt submission. Avoid using Stop continuations as our reporting engine; the prior handoff identified their overhead.
- **A3:** [Claude Code channels](https://code.claude.com/docs/en/channels). Push requires an open session. Channels remain preview; custom channel distribution is constrained by the effective allowlist, with a development flag for testing. An organization's channel policy can also apply. A successful local development-channel experiment would not establish a general production distribution path.
- **A4:** [Claude Code product and credential conditions](https://code.claude.com/docs/en/legal-and-compliance). Official-client integrations must not be conflated with third-party subscription credential routing. The page separately describes conditions for offering Claude Code inside products. This review does not settle every packaging arrangement; our baseline connects user-installed clients without collecting provider tokens.
- **O1:** [Codex app-server](https://learn.chatgpt.com/docs/app-server). Managed thread/turn controls, streaming events and approval handling are documented. Steering requires the expected active turn; it fails without an active turn. We infer suitability for a locally managed adapter, not permission or technical ability to take over arbitrary other clients' sessions.
- **O2:** [Codex authentication](https://learn.chatgpt.com/docs/auth). ChatGPT sign-in provides subscription access; API-key sign-in is usage-based. Our design uses the user's supported client-managed authentication, not platform-held provider tokens.
- **O3:** [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp). Local clients support configured MCP servers, including local STDIO and Streamable HTTP. This provides an exchange surface; it does not by itself establish remote wake or live steering.

## 4. Adapter design decisions

### Shared core

Use one provider-neutral coordination protocol. Both adapters map native client observations to that protocol, preserving source and uncertainty. Our platform's project identity, permission checks and event log remain authoritative for collaboration state.

Each connection registers its client version, adapter/protocol version, session origin, tested capabilities and last observation. Distinguish documented, locally detected and experimentally verified capability; do not let a client's self-assertion grant server permissions.

Proposed capability flags: structured publishing, context retrieval, checkpoint delivery, optional push, managed turn start, active-turn steering, execution interruption and local approval presentation. Include disabled reason and relevant version/policy limitations. The interface must explain unavailable actions rather than silently choosing another mechanism.

### Claude baseline

User attaches our MCP tools and supported hooks to their own Claude Code environment. The adapter queues relevant updates; hooks retrieve bounded authoritative context at appropriate checkpoints. Semantic answers, plans and handoffs come from explicit agent tool calls. Mechanical lifecycle observations can come from hooks.

An unanswered request can remain waiting even while the adapter is online. Present “queued,” “waiting for client checkpoint,” “context supplied” and “agent replied” distinctly. Optional channel support is a separately gated enhancement. No fake completion, terminal keystroke injection or continual Stop-driven reporting is required by this design.

### Codex modes

For existing user sessions, provide MCP-based collaboration where supported and explicitly test the delivery path. For managed execution, a local adapter can use app-server under the user's account; identify these as platform-managed sessions. Do not promise that the two modes provide equal control or share a live conversation automatically.

Keep turn identity separate from our task/run identity. If a steer operation targets a stale turn, reconcile current state; never redirect the same message automatically to a different turn. Runtime approval requests go to the responsible human through a deliberately implemented path.

### Dispatch authorization

Add a per-human execution policy separate from task acceptance. It specifies eligible projects/runs, which events may start work, concurrency, exchange/turn bounds, and pause conditions. Default to explicit opt-in for managed automatic dispatch. A chat message cannot activate this policy.

The policy is our application control, not a provider quota guarantee. Agent reasoning consumes the user's allowance. Do not pool accounts, add hidden model calls, or fall back to separately billed APIs. Loss of sign-in, unavailable clients and rate limits produce waiting/blocker states. Unknown execution outcomes require reconciliation before retry.

## 5. Real-client proof plan

These are implementation-time tests, not work executed in this documentation review. Use the intended OS/client versions and each tester's own account. Core application code remains reserved for the permitted build period.

| Test | Procedure | Passing observation |
| --- | --- | --- |
| T1: Exchange | Attach scoped collaboration tools; request an actual cross-agent question/answer | Correct actor/run attribution and a schema-valid response, with no provider credentials in platform traffic/logs. |
| T2: Active delivery | Queue a unique versioned update while the agent is working | Identify the actual delivery checkpoint and later explicit acknowledgement; record latency and missed delivery. |
| T3: Idle/closed | Send a request when the session is idle, then closed | Honest waiting state; no claimed automatic wake where unsupported. |
| T4: Recovery | Disconnect, reconnect, resume and compact where supported | Current snapshot restored and duplicates suppressed; fresh acknowledgement correctly scoped. |
| T5: Managed Codex | Start controlled work, steer its identified active turn, then try an expired turn ID | Correct turn receives input; stale request fails without redirection. |
| T6: Runtime consent | Trigger an operation requiring local approval; reject it | Decision remains with responsible human and rejection is represented accurately. |
| T7: Handoff | Publish an accessible immutable artifact; adopt it from the other checkout | Actual retrieved content matches identity; inaccessible output becomes a blocker. |
| T8: Scoped checks | Assemble selected revisions and collect a check, then change one input | Old evidence preserved; new candidate does not inherit success. |
| T9: Budget and errors | Exercise small application exchange limits and controlled adapter/auth failures | Work pauses visibly; no hidden retry loop or API fallback. Do not deliberately exhaust paid allowances. |
| T10: Distribution | Validate clean-machine installation with supported production settings | No undisclosed preview bypass required for a claimed production capability. |

For each test retain client/adapter versions, environment, input IDs, observed states, logs with secrets removed and unresolved limitations. Baseline Claude collaboration must pass without custom push being assumed. Managed Codex controls are a separate gate, not a reason to delay honest MCP-only collaboration.

## 6. Decision

Proceed with a capability-driven adapter architecture. Keep Claude first as previously agreed, but define its initial experience as checkpoint-based collaboration unless a supported push path is established. Add Codex through a distinct adapter, with managed-session controls clearly labeled. The main remaining technical risk is timely intervention in real clients—not whether a shared-room data model can be written.

