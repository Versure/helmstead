# How work gets built

Helmstead is built by Claude Code. The owner decides *what* gets built and reviews only the changes that carry real risk. Everything else is specified, built, checked and merged without the owner.

```
/spec  ──► interview ──► docs/specs/NNN-slug.md (approved) ──► branch feat/NNN-slug
/build NNN ──► tests first ──► implement ──► verify ──► independent reviewers ──► PR
risk gate (CI) ──► low risk: auto-merge
               └─► high risk: waits for the owner, who reviews only the listed parts
```

## 1. Spec: the interview (`/spec`)

Claude reads the plan, the ADRs, earlier specs and the code that the idea touches, then interviews the owner with multiple-choice questions until it could write the spec without guessing. It skips anything the repo already answers and asks more about anything in a high-risk area. The spec (template: `docs/specs/000-template.md`) holds testable acceptance criteria, what is out of scope, the decisions taken in the interview, and a risk forecast. After the owner approves it, it is committed on `feat/NNN-slug`.

## 2. Build: autonomous (`/build NNN`)

Start the build in a fresh session so it begins with a clean context and only the spec as its definition of done:

```bash
claude -w NNN-slug "/build NNN"
```

The build writes a failing test per acceptance criterion, implements until it passes, runs `node scripts/sdlc/verify.mjs`, and then hands the diff to read-only reviewers that never saw it being written (`.claude/agents/`): `spec-reviewer` always, plus `security-reviewer`, `architecture-reviewer` and `data-reviewer` when their area is touched. It fixes what they confirm (correctness, not style), opens the PR and stops.

## 3. Risk

A change is **high risk** when it touches one of these areas. The exact paths are in `scripts/sdlc/risk-paths.json`.

| Area | Examples |
|---|---|
| Security & permissions | Tauri shell and capabilities, sidecar session token, agent runtime and tool permissions, MCP, secrets and keychain, anything handling untrusted input |
| Architecture & contracts | Domain model, API contracts, ACP/IPC/sidecar boundaries, new projects, ADRs and the plan |
| Data & storage | Migrations, persistence, SQL, retention, anything that deletes or reshapes stored data |
| Dependencies & pipeline | Packages and lock files, CI workflows, `.claude/`, `scripts/sdlc/`, `CLAUDE.md`, this file |
| Size | More than 1000 changed lines (lock files and docs excluded) |

Three things can make a change high risk, and nothing can make it low risk again:

1. **Paths.** The risk gate classifies the diff itself, using the rules from `main`, so a PR can't loosen its own rules.
2. **Reviewers and the build.** A `<!-- risk:raise security -->` marker in the PR description adds a category.
3. **The owner.** The `needs-owner-review` label forces high risk.

## 4. Review

**Low risk.** The PR carries the AI review result. Once `ci` and `risk-gate` are green, GitHub squash-merges it. The owner reads it in the history if they want to.

**High risk.** The PR description opens with **Owner review focus**: a short list of `file:lines` ranges, each with why it is risky and the one question to answer. Everything else is under **Safe to skim**. The owner reviews those ranges, then:

- adds the `human-approved` label to approve (the gate goes green and auto-merge takes over), or
- comments on the PR and runs `/build NNN` again, telling it to address the comments.

A new commit removes `human-approved`, so an approval always covers the code that actually merges.

## 5. What is enforced, and where

| Rule | Enforced by |
|---|---|
| Claude never merges, approves, pushes to `main`, force-pushes or changes branch protection | PreToolUse hook `scripts/sdlc/hooks/guard-shell.mjs` |
| A change in `apps/` or `libs/` is not done until lint, test and build pass | Stop hook `scripts/sdlc/verify.mjs --hook`, and the `ci` check |
| High-risk changes wait for the owner | `risk-gate` status (`.github/workflows/risk-gate.yml`) plus branch protection on `main` |
| Nothing reaches `main` without a PR and green checks, admins included | Branch protection, set up by `scripts/sdlc/setup-github.sh` |

Claude opens PRs with the owner's GitHub account, and GitHub does not let anyone approve their own PR. That is why approval is a label, not a GitHub review. To make approval a real review, give Claude its own GitHub account and require code-owner review for the high-risk paths.

## 6. Running without watching

A build can run unattended in headless mode. The hooks, the gate and branch protection still apply:

```bash
claude -p "/build NNN" --permission-mode auto --max-turns 200
```
