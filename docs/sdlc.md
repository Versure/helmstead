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

The build writes a failing test per acceptance criterion, implements until it passes, runs `node scripts/sdlc/verify.mjs`, and then reviews the diff with read-only agents that never saw it being written (`.claude/agents/`):

1. **Find.** `spec-reviewer` and `bug-hunter` always, plus `security-reviewer`, `architecture-reviewer` and `data-reviewer` when their area is touched, in parallel. Each finding needs a `path:line` and the evidence for it; `REVIEW.md` says what counts.
2. **Vote.** Exact duplicates are merged; the build filters nothing else. Every finding goes to three `finding-verifier` agents, each checking it from a different angle (trace the path, look for what prevents it, describe the failing test or the contradicting line). Two `real` votes confirm it, two `not-real` reject it, anything else leaves it disputed. A security finding rated `blocker` or `major` by its reviewer is not rejected while any voter calls it real. Whether a finding is new is always decided against the whole branch, so a later round cannot pass off the branch's own bug as pre-existing.
3. **Fix.** Confirmed findings the branch introduced are fixed, together with every other instance of the same mistake. Pre-existing bugs are listed in the PR, not fixed. A disputed new `blocker` or `major`, and every disputed security finding, goes to the owner: it is listed under Owner review focus and raises the `review` category, so the PR waits for the owner. Other disputed findings are listed.
4. **Review the fixes.** Every round that commits fixes is followed by a round on those fix commits only (`bug-hunter` always, plus the reviewers that raised confirmed findings), with the ledger of decided findings so nothing unchanged is raised twice. At most three rounds; what round 3 still confirms goes to the owner instead of another patch.

Then it opens the PR and stops. The PR description carries the counts, the full findings ledger and, as its last lines, the markers: the last commit the review covered (`ai-review-head`), and `ai-review: pass <sha>` only when every commit up to that sha was reviewed and nothing is left for the owner. When the build withholds the pass, it raises `review` instead, so the PR waits for the owner rather than getting stuck. Three voters per finding make the review cost more agents on large changes, and it keeps unfounded findings from costing a fix round or reaching the owner.

## 3. Risk

A change is **high risk** when it touches one of these areas. The exact paths are in `scripts/sdlc/risk-paths.json`.

| Area | Examples |
|---|---|
| Security & permissions | Tauri shell and capabilities, sidecar session token, agent runtime and tool permissions, MCP, secrets and keychain, anything handling untrusted input |
| Architecture & contracts | Domain model, API contracts, ACP/IPC/sidecar boundaries, new projects, ADRs and the plan |
| Data & storage | Migrations, persistence, SQL, retention, anything that deletes or reshapes stored data |
| Dependencies & pipeline | Packages and lock files, CI workflows, `.claude/`, `scripts/sdlc/`, `CLAUDE.md`, `REVIEW.md`, this file |
| Size | More than 1000 changed lines (lock files and docs excluded) |
| AI review needs the owner | Raised by the build only: a new `blocker` or `major` or a security finding that the voters split on, a confirmed finding still open after three rounds, or any other reason the build withholds the AI review pass |

Three things can make a change high risk, and nothing can make it low risk again:

1. **Paths.** The risk gate classifies the diff itself, using the rules from `main`, so a PR can't loosen its own rules.
2. **Reviewers and the build.** A `<!-- risk:raise security -->` marker in the PR description adds a category (`review` when the AI review needs the owner).
3. **The owner.** The `needs-owner-review` label forces high risk.

## 4. Review

**Low risk.** The PR ends with `<!-- ai-review: pass <sha> -->`. The gate accepts it only as one of the description's last lines, and only when `<sha>` is the PR head, or an ancestor with nothing but spec files changed after it. Any later push needs a new review. Once `ci` and `risk-gate` are green, GitHub squash-merges it. The owner reads it in the history if they want to.

**High risk.** The PR description opens with **Owner review focus**: a short list of `file:lines` ranges, each with why it is risky and the one question to answer. Everything else is under **Safe to skim**. The owner reviews those ranges, then:

- adds the `human-approved` label to approve (the gate goes green and auto-merge takes over), or
- comments on the PR and runs `/build NNN` again, telling it to address the comments. That round reviews only the commits since the last review, skips findings already decided (the ledger in the PR description), and answers every comment where it was made: what it changed, or why not. Its replies end with a hidden `<!-- build-reply: <id> -->` marker naming the comment they answer, so the next round knows what is still open. It acts only on comments by the PR's author (the owner's account); the repository is public, so comments by anyone else are only listed for the owner, and their markers do not count.

Only the owner resolves review threads; the build is blocked from doing it. A PR merges only when every thread is resolved, so resolving a thread is the owner saying the answer is good enough.

A new commit removes `human-approved`, so an approval always covers the code that actually merges. The label works at any risk: it also releases a low-risk PR that the gate holds back because its AI review pass is missing or stale.

## 5. What is enforced, and where

| Rule | Enforced by |
|---|---|
| Claude never merges, approves, pushes to `main`, force-pushes or changes branch protection | PreToolUse hook `scripts/sdlc/hooks/guard-shell.mjs` |
| A change in `apps/` or `libs/` is not done until lint, test and build pass | Stop hook `scripts/sdlc/verify.mjs --hook`, and the `ci` check |
| High-risk changes wait for the owner | `risk-gate` status (`.github/workflows/risk-gate.yml`) plus branch protection on `main` |
| Claude never resolves a review thread | `guard-shell.mjs` (the GraphQL mutation, any `/resolve` REST route, any GraphQL write, and GraphQL queries it cannot read) and a deny rule for the GitHub MCP tool in `.claude/settings.json`. Claude acts with the owner's account, so this guards against mistakes, not against a determined agent. |
| Nothing reaches `main` without a PR, green checks and every review thread resolved, admins included | Branch protection, set up by `scripts/sdlc/setup-github.sh` (re-run it after changing it; the thread rule applies from then on) |

Claude opens PRs with the owner's GitHub account, and GitHub does not let anyone approve their own PR. That is why approval is a label, not a GitHub review. To make approval a real review, give Claude its own GitHub account and require code-owner review for the high-risk paths.

## 6. Running without watching

A build can run unattended in headless mode. The hooks, the gate and branch protection still apply:

```bash
claude -p "/build NNN" --permission-mode auto --max-turns 200
```
