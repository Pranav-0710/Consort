# Problem and competitive validation — interim findings

11 November 2026. Desk research and one firsthand team account; no competitor trials, repository inspection, or measured savings. This memo proposes a direction for discussion. It does not supersede the accepted architecture or first-release specification.

## Scope correction from the user

The user clarified that all three difficulties matter: conflicting code, disagreements about intended behavior, and diagnosing combined failures. These are examples of a broader coordination problem. The intended product is a multiplayer platform where teammates and their independently owned coding agents work together throughout development. It must support additional collaboration value beyond integration repair. The integration-first recommendation below was an overly narrow research hypothesis and is not the agreed product direction.

The working direction is shared planning, explicit responsibilities, cross-agent questions and handoffs, shared decisions, coordinated execution, and scoped verification inside a shared human workspace. Conflict repair is one workflow within it. Competitive overlap remains relevant, and differentiation must be demonstrated through useful collaboration rather than claimed from the presence of rooms or multiple agents.

## What the user has established

Six teammates use Claude and Codex. Work moves from issues to assigned implementation, PRs, and peer review. The team experienced more than 50 pending PRs with interdependencies, rebases, conflicts, and fragmented WhatsApp coordination. The user identifies resolving rebases, merge conflicts, and broken integration as the greatest pain.

This establishes a real reported workflow problem for one team, not its frequency, cost, root cause, or market prevalence. The user subsequently confirmed that conflicting code, conflicting intended behavior, and diagnosing combined failures all matter.

## Competitive findings

Capabilities below are documented claims, not independently tested. Absence from a page is not evidence that a product lacks a feature.

| Baseline or competitor | Relevant documented capability | Implication |
| --- | --- | --- |
| [Superconductor](https://www.superconductor.com/) | Shared agent sessions, teammate steering, reviewers asking the agent about a PR | Shared rooms alone are not a defensible novelty claim. |
| [First-tree](https://github.com/first-tree-ai/first-tree) | Shared context, agent work routing, human involvement and GitHub integration | Shared decisions and ownership also have close competition. |
| [Coshell](https://coshell.ai/product) | Collaborative agent workspace and overlap handling | Investigate actual coordination behavior before claiming differentiation. |
| [Amoeba](https://useamoeba.com/) | Shared sessions, agent visibility and persistent context | Local-agent collaboration is not an empty category. |
| [Planlog](https://github.com/depak7/planlog) | Agent-readable plans, human approval and persistent history | Approval records alone do not distinguish the product. |
| [GitHub stacked PRs](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-stacked-pull-requests) | Ordered merging of dependent PRs | Dependency ordering must be compared with the native baseline. |
| [GitButler](https://docs.gitbutler.com/features/branch-management/stacked-branches) | Stacked branches and PR workflows | Do not build a new tool merely to represent a stack. |
| [Graphite](https://www.graphite.com/) | Stacks, merge queue, PR inbox and chat-assisted CI fixes | Even AI-assisted PR repair is an occupied category. |

[Graphite's merge documentation](https://graphite.com/docs/merge-pull-requests) distinguishes stack-related conflicts it handles from conflicts requiring intervention. This suggests a useful investigation boundary, not proof of an unmet market. Availability and pricing must be checked before recommending any baseline for the user's free-tools constraint.

## Earlier integration-focused hypothesis — superseded as the overall product scope

Help teams identify which interdependent agent-written changes fail together, agree on the intended combined behavior, and coordinate a verified repair through their existing agents and PR workflow.

The shared room becomes a place to resolve a specific integration problem. Its useful output is an attributable decision, an assigned repair, and evidence about the repaired combination. A room, dependency graph, or activity feed by itself is insufficient.

Potential multiplayer value: affected authors and reviewers inspect the same failing combination; their agents contribute relevant intent and evidence; humans resolve consequential disagreements; the accepted decision reaches affected sessions. Whether this improves on GitHub discussion and existing tools remains untested.

## Architectural implications if this direction is accepted

- Model an integration attempt using repository identity, exact PR head revisions, target revision, application order, environment and check configuration.
- Keep declared or human-confirmed dependencies separate from agent suggestions and observed failures. File overlap does not establish a dependency or a bug.
- Separate clean application, successful build, passing selected tests and human acceptance. None establishes universal compatibility.
- Link a resolution task to the affected PRs, evidence, responsible human and agent session. GitHub remains authoritative for PR review and merge status; room decisions must not duplicate merge approval.
- Invalidate current-result claims when relevant revisions or check inputs change. Preserve historical evidence with its original scope.
- Start with selected PR clusters. Do not attempt every subset of 50 PRs; combinations grow too quickly. Unknown combinations remain untested.
- Treat code execution as a separate trust boundary. A worktree separates files but is not a security sandbox. Credentials, network access, timeouts, cancellation, cleanup and resource limits need explicit design before execution.
- Keep the existing permission, idempotency, disconnected-agent and version-fencing rules. Automatic merging or autonomous conflict resolution is not newly authorized by this hypothesis.
- Keep free infrastructure constraints visible: replaying integration checks consumes compute, and existing Claude access does not establish free inference. A local or user-controlled runner is a candidate, not a settled choice.

## Validation before expanding scope

1. Reconstruct one actual incident: affected PRs, where failure appeared, intended behavior, manual repair and evidence of recovery. Sanitized descriptions are sufficient initially.
2. Classify the dominant cause: stale branches/order, textual conflict, incompatible behavior, missing tests, or unclear ownership. Multiple causes may coexist.
3. Walk through the same incident with a simple baseline: explicit PR dependencies, GitHub discussion, named repair owner and relevant combined checks.
4. Compare with the proposed room: time to identify cause, repeated explanations, repair handoffs, stale decisions and successful verification. Count the reporting burden too.
5. Seek additional independent teams with similar incidents. Three to five interviews can guide discovery but do not establish market prevalence.

Continue if coordinated intent and evidence materially improve resolution beyond the baseline. Narrow or change direction if ordering, smaller PRs or existing tooling address most of the pain. Do not claim fewer conflicts, faster delivery, production readiness or unique capabilities before evidence supports them.

## Current verdict

The reported pain is concrete enough to guide discovery. Shared rooms have substantial competitive overlap. The user has explicitly retained the broader multiplayer coding-agent platform direction; integration repair is one of its use cases. The value of coordinated planning, decisions, handoffs and verification must be tested against practical alternatives. No source code or final architecture pivot was produced in this research step.

