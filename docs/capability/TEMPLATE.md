# &lt;Test ID&gt;: &lt;short title&gt;

Copy this file to `docs/capability/<test-id>-<slug>.md`, for example `T1-exchange.md`. Write what was observed and nothing else. A result nobody saw is **Not observed** or **Inconclusive**, never a pass.

- **Issue:** #N
- **Tested by:** GitHub usernames
- **Date:** YYYY-MM-DD
- **Question:** the one thing this run tries to find out, in a sentence

## Environment

| | Tester A | Tester B |
|---|---|---|
| OS and version | | |
| Claude Code version (`claude --version`) | | |
| Launch context (terminal / IDE extension / desktop app; how it was started) | | |
| Model | | |
| Harness commit (`git rev-parse --short HEAD`) | | |
| Delivery settings (`SPIKE_DELIVER_ON`, `SPIKE_STOP_DELIVERY`, `SPIKE_ENABLE_LISTEN`) | | |
| Other relevant settings (hook deadline, relay host: same machine or two machines) | | |

Never paste tokens, account details or home paths. Run excerpts through `npm run redact -w @consort/spike-harness` first.

## Procedure

Numbered steps that another tester could repeat exactly. Record any human nudge **verbatim** (for example, "B typed: check your inbox"). A nudge is not copy-paste relay, but it limits what the product may claim.

1.
2.

## Observations

One row per step that matters. Times are as logged (ISO 8601). Item IDs come from the relay.

| Time | Who | Item ID @ version | What happened | Source (hook log / MCP log / relay / screen) |
|---|---|---|---|---|
| | | | queued | relay |
| | | | context supplied (hook event) | hooks.jsonl |
| | | | agent acknowledged / answered | mcp.jsonl |

### Excerpts

Redacted log lines or transcript fragments that show the key facts. Keep each excerpt short.

```
```

## Outcome

| Question | Outcome | Evidence (row or excerpt) |
|---|---|---|
| | Observed / Not observed / Inconclusive | |

## Limitations

What this run could not show, and why: one OS only, one client version, a nudge was needed, a delay was too short to separate causes, and so on.

## Consequence for the product

Which FIRST_RELEASE_SPEC §4 status labels or product promises this supports, which it contradicts, and what #16 should decide. If the result contradicts a planned promise, say so plainly. A failed observation changes the promise; it is not hidden.
