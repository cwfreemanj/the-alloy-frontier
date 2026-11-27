# Dev log: Neal

Technical director; owns the backend (server, accounts, persistence, protocol and authority).
Newest first. Times are US Eastern. How to write entries: [README.md](README.md).

The code written under Neal's git name was written by Claude, at Neal's direction; that work is logged
in detail in [claude-code.md](claude-code.md). This log is for Neal's own work: playtests, decisions, approvals and reviews.

## 2026-11-27 07:09 — Signed off builds and measured performance (M4)
- **Notes:** Signed the technical director's M4 row: builds and run commands are reproducible and performance passes on my laptop. Still waiting on the creative director's performance report, playthroughs and sign-off.

## 2026-11-25 14:47 — Asked for dev logs
- **Notes:** Asked for a detailed, timestamped dev log for each contributor, human and AI, alongside the PRs (#30).

## 2026-11-25 14:41 — Merged character names (#29)
- **Notes:** Asked for each character to have its own name, separate from the account name, so the two
  characters on one account can be told apart. Approved and merged #29.

## 2026-11-25 14:18 — Performance reports on my laptop
- **Done:** Took in-game performance reports on all three presets (Intel Arc 140V, Chrome).
- **Verified:** high 143 FPS average (1% low 69), medium 264 (154), low 245 (144). All clear the 60 FPS target.
  Recorded in [perf/2026-11-25-technical-director-laptop.md](../perf/2026-11-25-technical-director-laptop.md).

## 2026-11-25 14:01 — Merged the M4 close-out (#27) and character slots (#28)
- **Notes:** Asked for two character slots per account, so the first character is kept for a fresh M4
  playthrough, with a highlighted, typed confirmation before deleting a character.

## 2026-11-25 11:55 — Merged authored models for the forge and the area (#26)
- **Notes:** Decided the area is done with procedurally generated scenery. Approved Meshy-generated models
  for the full forge set and the full area set at game-ready quality, and asked for Emberwake to be redone.
  Asked for screens without scrollbars (#25).
