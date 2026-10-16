---
name: commit
description: >-
  Commits working-copy changes in ordered, shippable phases after lint, typecheck,
  and tests are green. Use when the user asks to commit, create a git commit, or
  split dirty work into commits.
---

# Commit

Commit working-copy changes in phases (git).

## Preflight (blocking)

Run these **in order**. After any fix, restart from step 1.

1. `bun run test:lint` — prefer `-- --write` first; re-run until clean.
2. `bun run typecheck`
3. `bun test:knip`
4. `bun test` — must end with `0 fail` (and a non-zero process exit if anything failed).

**Exit codes are SoT.** Do not treat a run as green from a truncated log or from
`| tail` / `| head` without `set -o pipefail` — bash otherwise reports `tail`’s
exit 0 and hides a failing `bun test` (including mid-suite `process.exit`). Prefer
unpiped commands, or `set -o pipefail` before any pipe. Confirm each step’s exit
code is 0 and that `bun test` printed `0 fail`.

Skim warnings on green runs; fix actionable ones even if pre-existing.

## Commit in phases

Split dirty work into ordered, shippable commits. Skip secrets and unrelated dirty
files. Put related docs/READMEs/`.cursor` skill edits in the **same** commit as
the code.

- One concern → one feature branch → preferably one commit (stack only if a single
  commit would be unwieldy; never leave a broken intermediate).
- Dependent features: stack branches; summarize merge order at the end.
- Each commit must pass preflight above.
- No half-wired imports or “fixed next commit” breakage.

Git safety: never update git config; never `--no-verify` unless asked; never
force-push; do not push unless asked. Stage **explicit paths**, then HEREDOC commit.

### Message style

```
chore: scaffold Bun workspace for qctl tooling
feat: release 0.1.0 of qctl (#1)
chore: extract shared init-tank guest-fatal wait helpers
```

- `feat:` / `chore:` / `docs:` / `fix:` / `ci:` — refactors are `chore:` (no `refactor:`)
- Imperative subject, no trailing period; optional short why body
- Do not invent `(#N)` — GitHub adds that on merge

### Loop

1. `git status` / `git diff` / `git log` → plan phases.
2. `git add` paths → HEREDOC `git commit`.
3. Repeat until intended work is gone.

```bash
git add path/a path/b
git commit -m "$(cat <<'EOF'
feat: short why-focused subject

optional description
EOF
)"
```

### End

List branches created and what each ships, in merge order (dependents after bases).
