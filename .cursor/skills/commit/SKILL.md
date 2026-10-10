---
name: commit
description: >-
  Commits working-copy changes in ordered, shippable phases after lint, typecheck,
  and tests are green. Use when the user asks to commit, create a git commit, or
  split dirty work into commits.
---

# Commit

Commit the current working-copy changes in phases (git).

## Preflight

1. Run `bun run test:lint`. Prefer `bun run test:lint -- --fix` first, then fix
   anything left (mind warnings). Re-run until green with no actionable warnings
   (or ask if clearly unrelated / out of scope).
2. Run `bun run typecheck`. Fix failures (mind warnings) and re-run until green
   (or ask if clearly unrelated / out of scope).
3. Run `bun test:knip`. Fix failures.
4. Run `bun test`. Fix failures and re-run until green (or ask if clearly
   unrelated / out of scope).
5. When green but warnings appear, skim them. Fix actionable ones even if you did
   not introduce them (deprecations, lint noise, …).

Note: after any fix in a step, restart from step 1.

## Commit in phases

Split dirty files into ordered, shippable commits until intended work is gone.
Skip secrets (`.env`, credentials) and dirty files that are **not** part of the work.

**Include related docs in the same commit**, not a follow-up:

- `README.md` / `docs/` when they changed with that work
- package READMEs when they match that commit
- `.cursor/` rules or skills when they match that commit

Each commit must leave the tree working:

- Prefer small commits (one concern). Do not split a single feature across commits
  if that would leave it half-wired — one larger commit is better.
- Larger is fine when a split would break build, types, or runtime.
- No half-wired imports or “fixed in the next commit” breakage.

Follow the repo git safety rules: never update git config; never `--no-verify`
unless asked; never force-push; do not push unless asked. Stage only the paths for
the current phase (`git add` those paths), then commit with a HEREDOC message.

### Loop

1. In parallel: `git status` / `git diff` (staged + unstaged) / recent `git log`
   (message style) — group paths into phases.
2. Stage and commit one phase with an **explicit path list** and a HEREDOC message
   focused on why, 1–2 sentences, matching this repo’s style.
3. Re-check status; repeat until nothing intended remains. Do not push unless asked.

Example:

```bash
git add path/a path/b
git commit -m "$(cat <<'EOF'
Short why-focused subject.

EOF
)"
```
