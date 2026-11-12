# Contributing to Consort

Four people build Consort, each with their own coding agent. This file is the shared workflow for humans and agents. Agents also follow [AGENTS.md](../AGENTS.md).

## Where things are decided

- **Design baseline:** [docs/planning/](planning/README.md). Start there, then use the [traceability map](planning/TRACEABILITY.md) and the [glossary](GLOSSARY.md).
- **Decisions:** [docs/decisions/](decisions/), one numbered record per decision, using the [template](decisions/0000-template.md).
- **Work:** GitHub issues. Every issue has Goal, Acceptance criteria, Scope, Do not touch and Notes, plus `Depends on` and `Traces to` lines.

## One issue, one branch, one PR

1. Pick an issue whose dependencies are merged, and assign yourself.
2. Branch from an up-to-date `main`: `type/<issue#>-short-slug`, for example `feat/21-device-pairing`.
3. Commit with Conventional Commits: `type: short description`, under 72 characters. Types are `feat`, `fix`, `chore`, `docs`, `refactor` and `test`. Write messages that say what changed, never "update files".
4. Stage only files inside the issue's **Scope**. Never `git add .` or `git add -A`.
5. Open a PR with:
   - a Conventional Commits title under 72 characters (it becomes the squash commit)
   - `Closes #N` in the body
   - every section of the PR template filled in
6. Request review from the area reviewer (see CODEOWNERS). One approval is needed. Resolve every conversation.
7. **Squash-merge** once checks pass. Delete the branch.

Never push to `main`, force-push a shared branch, or merge your own PR without its approval. Don't add `Co-authored-by` trailers or tool attribution to commits, PR text, issues or files.

If an issue turns out bigger than about three days, split it: open a follow-up issue and link it, instead of growing the PR.

## Writing "observed" and "not checked"

Consort's whole design depends on not claiming things that weren't observed. Apply the same rule to our own work:

- In the PR's **How it was checked**, list the commands you ran, their result and the OS. For behavior in a real Claude Code session, add the client version.
- In **What was not checked**, name what you didn't verify, with the reason. "Not checked: Windows; no Windows machine available" is a good answer, and leaving it blank is not.
- Spike issues record **Observed**, **Not observed** or **Inconclusive** for each question, never a hoped-for result.
- A test named for a behavior proves that behavior. Fixtures and mocks prove nothing about real clients, so slice exits need real paired runs.

## Credentials and data

- Never paste platform credentials, provider credentials, OAuth secrets or pairing codes into issues, PRs, commits, logs or agent conversations.
- Provider (Claude or ChatGPT) sign-in stays inside the official client. Consort never reads, stores or forwards it.
- Use `.env.local` or Wrangler secrets for local secrets. Both are git-ignored.
- Sample data is fictional. Never use real project data in spikes or fixtures.

## Changing the planning documents

The files in `docs/planning/` are the canonical baseline. Change them only through a PR that links the decision record or issue justifying the change. Never weaken an identity, authorization or recovery invariant without an explicit decision record that says so. Update `TRACEABILITY.md` whenever an issue starts or stops covering a requirement.

## Labels and milestones

**Area labels** (the first label on every issue):

| Label | Area | Directories |
|---|---|---|
| `coordinator` | Coordinator and protocol | `apps/coordinator/`, `packages/protocol/` |
| `adapter` | Agent adapter and capability | `packages/adapter-claude/`, `spike/`, `docs/capability/` |
| `web` | Web experience | `apps/web/`, `packages/client/` |
| `infra` | Platform, evidence and release | root config, `.github/`, `tools/`, `docs/` |

Areas are file boundaries, not job titles: anyone can pick up any issue.

**Topic labels:** `protocol`, `checks`, `docs`, `spike`, `security`, `ux`.

**Milestones:** M0–M6 follow the six build slices in FIRST_RELEASE_SPEC §9, then Pilot gate, Launch gate and Later.

`node .github/scripts/bootstrap-repo.mjs` prints the label and milestone set. Run it with `--apply` to create anything missing.

## Repository settings (admin)

Apply these settings to `main` on GitHub, under Settings → Rules or Branch protection:

- Require a pull request before merging, with **1 approval**. Dismiss stale approvals when new commits are pushed.
- Require review from Code Owners, once CODEOWNERS names real people.
- Require status checks to pass. The checks are added by #3 (CI and PR hygiene).
- Require conversation resolution before merging.
- Block force pushes and deletions.
- Allow **squash merging only**. Use the PR title as the commit message, and delete head branches automatically.
