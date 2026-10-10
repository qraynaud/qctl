---
name: implement
description: >-
  Implements plan todos one at a time with a user testing gate between each.
  Use when implementing, starting, or completing plan todos, working the next
  item in `.cursor/plans/`, or when the user asks to start the next plan item.
---

# Implement

Work the frontmatter todos **strictly one at a time**. Never implement two items in the same pass.

1. Mark **exactly one** todo as `in_progress` (all others stay `pending` or `completed`).
2. Implement only that item.
3. Give a concrete **testing protocol** (what to run, click, or check) and wait.
4. Mark the todo item as **completed** once validated.
5. Propose to commit. If the user says yes, follow the [commit](../commit/SKILL.md) skill.
