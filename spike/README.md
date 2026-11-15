# Capability spike

`spike/harness` is a **throwaway** tool for the real-client tests #5, #6 and #7. It answers what real Claude Code sessions actually do with an MCP server and hooks:
- how items reach an agent
- when items reach an agent
- whether the MCP server can be tied to a session

Product code is designed from its observations and never grown out of it. No product workspace may import it, and ESLint enforces that.

The team confirmed on 2026-11-12 that coding may start. Use only your own Claude account and the official client, in a **scratch repository**. Never point the harness at real project data.

## What's in it

| Part | Run as | Purpose |
|---|---|---|
| Relay | `npm run relay -w @consort/spike-harness` | Stores items (id, version, from, to, body) and observations durably in `raw/relay-items.jsonl`, and serves them over HTTP |
| MCP server | registered with `claude mcp add` (below) | Tools `spike_whoami`, `spike_read_inbox`, `spike_ask`, `spike_answer`, `spike_ack`, plus `spike_listen` (option c, off by default) |
| Hook script | registered in `.claude/settings.local.json` (below) | One script for SessionStart, UserPromptSubmit, PostToolUse and Stop. Always logs the redacted payload. Delivers items only when configured. |
| `npm run settings` | prints your settings | Generates the settings JSON and the MCP command with absolute paths, so you never edit harness code |
| `npm run redact` | before sharing logs | Removes tokens, emails and home paths from any captured text |

Delivery modes, all off by default:
- **Option (a)** `SPIKE_DELIVER_ON=SessionStart,UserPromptSubmit,PostToolUse`: those hooks return pending items as `additionalContext`. Each item is supplied once per session.
- **Option (b)** `SPIKE_STOP_DELIVERY=1`: the Stop hook may block once to hand over pending items. It never blocks while `stop_hook_active` is true, and it's capped by `SPIKE_STOP_MAX_PER_SESSION`. This is delivery, not Stop-hook reporting, which stays banned.
- **Option (c)** `SPIKE_ENABLE_LISTEN=1`: registers `spike_listen`, which waits for a pending item for up to `SPIKE_LISTEN_MAX_SECONDS`.

Options (b) and (c) start model turns without a fresh human prompt. In the product they need per-human opt-in under a bounded policy (#40), and the spike only measures them.

## Set up

From the Consort repo:

```bash
npm ci && npm run build
```

**1. Start the relay** on the machine that hosts it:

```bash
npm run relay -w @consort/spike-harness
```

It listens on `127.0.0.1:47300`. For a two-machine run, bind it to the network **and** require a token. The relay refuses to bind beyond loopback without one. Keep the token file outside any git repo:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))" > ~/consort-spike-token
```

```bash
SPIKE_RELAY_HOST=0.0.0.0 SPIKE_TOKEN_FILE=~/consort-spike-token npm run relay -w @consort/spike-harness
```

Copy the token file to the other tester over a private channel. Use this only on a network you trust, and stop the relay when the session ends.

**2. Generate your settings.** Each tester does this inside their own scratch checkout. Use your participant name (`A` or `B`) and the delivery options under test:

```bash
npm run settings -w @consort/spike-harness -- A --deliver SessionStart,UserPromptSubmit,PostToolUse
```

Add `--relay http://<host>:47300 --token-file <path>` for two machines, and `--stop-delivery` or `--listen` for options (b) and (c). It prints three things:
- the JSON to save as `.claude/settings.local.json` in the scratch checkout. Claude Code keeps that file out of git.
- the `claude mcp add consort-spike --scope local ...` command to run from inside the checkout.
- the matching remove commands.

**3. Start Claude Code** in the scratch checkout. Run `/mcp` to confirm `consort-spike` is connected, and ask the agent to call `spike_whoami`.

## Remove

From inside the scratch checkout:

```bash
claude mcp remove consort-spike --scope local
```

Then delete `.claude/settings.local.json`, and stop the relay.

## Settings reference

| Variable | Default | Meaning |
|---|---|---|
| `SPIKE_PARTICIPANT` | `unnamed` | Your name as sender and addressee |
| `SPIKE_RELAY_URL` | `http://127.0.0.1:47300` | Where the relay is |
| `SPIKE_TOKEN` / `SPIKE_TOKEN_FILE` | none | Shared relay token. Prefer the file, kept outside git |
| `SPIKE_DELIVER_ON` | empty (observe only) | Hook events that return items as `additionalContext` |
| `SPIKE_STOP_DELIVERY` | off | Option (b) |
| `SPIKE_STOP_MAX_PER_SESSION` | `1` | Option (b) cap |
| `SPIKE_ENABLE_LISTEN` | off | Option (c) |
| `SPIKE_LISTEN_MAX_SECONDS` | `120` | Longest `spike_listen` wait |
| `SPIKE_HOOK_DEADLINE_MS` | `1500` | Hooks fail open after this. It's a harness setting, not a target |
| `SPIKE_LOG_DIR` | `spike/harness/raw/` | Logs and relay store. Git ignores `spike/**/raw/` |
| `SPIKE_RELAY_HOST` / `SPIKE_RELAY_PORT` / `SPIKE_RELAY_STORE` | `127.0.0.1` / `47300` / `<log dir>/relay-items.jsonl` | Relay only |

## Logs and records

Every hook payload, tool call and relay change is appended, already redacted, to `raw/{hooks,mcp,relay,errors}.jsonl`. Raw files never leave your machine. Before quoting anything in a record, run it through the redactor and read it yourself:

```bash
npm run redact -w @consort/spike-harness -- raw/hooks.jsonl excerpt.jsonl
```

Write results in `docs/capability/` using [TEMPLATE.md](../docs/capability/TEMPLATE.md). Record Observed, Not observed or Inconclusive for each question, never an expected result.

## What the harness does not prove

The plumbing is covered by unit tests: redaction, store durability, and the source never touching Claude credentials. That says nothing about Claude itself. The harness has **not** shown whether any of these happen:
- a hook's `additionalContext` reaches the model
- an agent acts on supplied context
- the MCP server can be tied to a Claude session

#5, #6 and #7 exist to find out.

The harness never reads Claude's credential or config files. `spike_whoami` reports the *names* of `CLAUDE*` environment variables but never their values, except for `CLAUDE_CODE_SESSION_ID`.
