# Planning baseline

These documents are Consort's design baseline. They come from planning, research and tabletop review. **None of it has been executed:** no client experiment, runtime, security, load or recovery test has run. Treat every behavior described here as a requirement or a proof obligation until an issue records an observation.

## Reading order

1. [ARCHITECTURE_BLUEPRINT.md](ARCHITECTURE_BLUEPRINT.md): architecture entry point, subscription constraint, boundaries and open decisions.
2. [FIRST_RELEASE_SPEC.md](FIRST_RELEASE_SPEC.md) v0.3: the two-developer journey, three screens, status language, release stages, AC01–AC13 and the six build slices.
3. [AGENT_CAPABILITY_MATRIX.md](AGENT_CAPABILITY_MATRIX.md): what Claude Code and Codex document, what is conditional, and the real-client tests T1–T10.
4. [COLLABORATION_PROTOCOL.md](COLLABORATION_PROTOCOL.md): question, handoff, reconciliation and verification transitions, plus protocol scenarios 1–9.
5. [ROOM_AGENT_CONTRACT.md](ROOM_AGENT_CONTRACT.md): foundational invariants (§2) and hardening rules H01–H12 (§4).
6. [ARCHITECTURE_STRESS_TEST.md](ARCHITECTURE_STRESS_TEST.md): findings F01–F12, the 64-row scenario matrix, compound cases and proof gates.
7. [MULTIPLAYER_COLLABORATION_MODEL.md](MULTIPLAYER_COLLABORATION_MODEL.md) and [MULTIPLAYER_WALKTHROUGH.md](MULTIPLAYER_WALKTHROUGH.md): the collaboration model and one concrete scenario.
8. [COMPETITIVE_AND_PROBLEM_VALIDATION.md](COMPETITIVE_AND_PROBLEM_VALIDATION.md): competitive overlap and the limits of the evidence. Its integration-first hypothesis is superseded as the overall product direction.

Then read [TRACEABILITY.md](TRACEABILITY.md) to find the issues that implement each requirement, and [../GLOSSARY.md](../GLOSSARY.md) for the terms.

## Precedence

- The **blueprint** is the architecture entry point.
- **FIRST_RELEASE_SPEC v0.3** sets the interaction and release scope.
- The **ROOM_AGENT_CONTRACT** invariants and hardening rules bind every other document.
- A newer or simpler document **never relaxes** an identity, authorization or recovery invariant. If two documents disagree, record the contradiction and resolve it explicitly in a decision record under [`docs/decisions/`](../decisions/).
- The literal name ROOM_AGENT_CONTRACT does not mean the product is a set of isolated one-agent rooms. A "room" in that document corresponds to one **work package** inside a feature room (decision record 0001).

## Changing these documents

These files were imported unchanged. Correct them only through a PR that links the decision record or issue justifying the change. Don't add parallel specifications whose authority is unclear: update the canonical document instead.

## Trace-ID convention

Issues, PRs and decision records cite the planning documents with these prefixes:

| Citation | Meaning |
|---|---|
| AC01–AC13 | Acceptance criteria, FIRST_RELEASE_SPEC §8 |
| T1–T10 | Real-client tests, AGENT_CAPABILITY_MATRIX §5 |
| invariant N | ROOM_AGENT_CONTRACT §2, numbered list |
| rule H01–H12 | Hardening rules, ROOM_AGENT_CONTRACT §4 |
| finding F01–F12 | "Findings that changed the contract" table, ARCHITECTURE_STRESS_TEST |
| stress A01–H08 | Scenario matrix rows, ARCHITECTURE_STRESS_TEST |
| trace step N, compound N | Primary failure trace and compound cases, ARCHITECTURE_STRESS_TEST |
| protocol scenario N | COLLABORATION_PROTOCOL §7 |
| walkthrough step N | MULTIPLAYER_WALKTHROUGH table |

"rule H04" and "stress H04" are different things, so always keep the prefix.
