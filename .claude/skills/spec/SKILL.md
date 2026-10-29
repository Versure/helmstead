---
name: spec
description: Interview the owner about a feature, fix or chore until it can be specified without guessing, then write and commit an approved spec in docs/specs/ that /build can implement autonomously.
argument-hint: <idea in a few words>
disable-model-invocation: true
---

The owner wants to start new work: $ARGUMENTS

Your job is to turn this into a spec that `/build` can implement without asking anything, by interviewing the owner. Do not write code in this skill.

## 1. Learn what the repo already answers

Before the first question, read what bears on the idea: `docs/plan.md` (the relevant sections and the phase in §8), `docs/adr/`, earlier specs in `docs/specs/`, `docs/sdlc.md`, and the code it would touch. Note the mockups or design-system links the owner has mentioned. Anything you can find yourself is not a question for the owner.

Run `git fetch origin` and check that no open PR or existing spec already covers this (`gh pr list`, `docs/specs/`). If one does, tell the owner and ask how to proceed.

## 2. Interview

Use the AskUserQuestion tool, at most four questions per round, multiple choice, your recommended option first and marked "(Recommended)". Each option says what it means in practice. Keep going round by round until you could write every acceptance criterion and every decision without guessing. Typical ground to cover, skipping what is already clear:

- who this is for and the outcome they notice
- the behaviour, including empty, loading, error and offline states
- edge cases and limits (sizes, counts, timeouts, concurrency)
- what is explicitly out of scope for now
- how each criterion will be checked (test, screenshot against the mockup, manual)

Spend more questions where the work is high risk (see the table in `docs/sdlc.md`): permissions and trust, what crosses the shell/core/agent boundaries, what gets stored, kept or deleted, new dependencies. Those are the owner's calls; the build will not be allowed to guess them. Spend fewer on details a sensible default settles; propose the default instead.

If the idea is too big for one PR (more than roughly a day of work or 1000 changed lines), propose a split into several specs and interview for the first one only.

## 3. Write the spec

Copy `docs/specs/000-template.md` to `docs/specs/NNN-slug.md`, where NNN is the next free number (three digits) and slug is a few lowercase words. Fill every section. Acceptance criteria are numbered, testable and each names its check. The risk forecast names each high-risk area and the specific part the owner will want to look at, or says `none`. Open questions must be empty.

## 4. Approve

Show the owner a short summary: outcome, the acceptance criteria, out of scope and the risk forecast. Ask with AskUserQuestion: "Approve and build (Recommended)", "Change something". Loop until approved.

On approval:

1. Set `status: approved` and the `branch:` field.
2. Create the branch from the latest main: `git switch -c feat/NNN-slug origin/main` (use `fix/` or `chore/` to match the type; use `main` if `origin/main` doesn't exist yet). If the working tree has unrelated changes, use `git worktree add` instead of switching.
3. Commit only the spec: `docs(spec): NNN short name`.
4. Push the branch: `git push -u origin feat/NNN-slug`.

Then tell the owner how to start the build in a fresh session, which is how it should run:

```bash
claude -w NNN-slug "/build NNN"
```

Offer to start the build in this session instead, if they'd rather not open a new one.
