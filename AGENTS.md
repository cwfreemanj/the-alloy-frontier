# AGENTS.md — Alloy Frontier

Instructions for AI coding agents (Codex, Claude Code, others) working in this repo.
Read this file first, then `docs/NEEDED.md` and `docs/handoff/README.md`.

## Before you start: things people need to do

The project is waiting on some things only a person can do, such as a performance report from their
own computer. They're listed in [`docs/NEEDED.md`](docs/NEEDED.md). At the start of every session,
**before any other work**, including the task you were given:

1. Read `docs/NEEDED.md`. Work out who you're working with from `git config user.name`, and ask if it
   doesn't match a name there.
2. If they have items, tell them first, most important first: what's needed, why, and roughly how long it
   takes. Then ask: **"Do you want to do this now, or continue with your work?"**
3. If they choose to do it, help them through it. If they choose to continue, don't ask again this
   session.

## What this is

A browser 3D action RPG / small MMO prototype ("The First Forge" vertical slice).

- **Stack:** TypeScript, Three.js, Vite, Vitest, Playwright, Node 22, in an npm-workspaces monorepo.
- **Multiplayer:** one shared world. The Node server (`apps/server`) serves the built game and a
  `/world` WebSocket; every player who opens the link joins the same world.
- **Live:** https://alloy-frontier.onrender.com, on Render's free plan. It auto-deploys from `main`
  using `render.yaml`. The free server sleeps after ~15 minutes idle, so the first load takes about a minute.
- **Accounts and saves:** stored in Neon Postgres (free plan) through `apps/server/src/accounts`. Without
  `DATABASE_URL`, the server falls back to a local JSON file. That's fine for development.

### Who owns what

- **Neal** owns the backend: the server, accounts, persistence, protocol and authority.
- **His partner** owns models, animation and world art.
- Keep changes inside your task's area. See the area table in `CONTRIBUTING.md`.
- `apps/web/src/game/Game.ts` is shared and busy: keep edits there small.

## Layout

```
apps/web/        game client (Three.js scene, UI, input, entities, networking)
apps/server/     world server: worldServer.ts (HTTP + WS), worldRoom.ts (shared world sim),
                 characters.ts (signed-in characters the server owns and saves),
                 accounts/ (KV storage, account service, HTTP API), worldMain.ts (entry)
packages/        plain TypeScript, no rendering, shared by client and server
  game-rules/    combat, stamina, enemy AI, progression, quest
  item-gen/      seeded item generation, materials, blueprints
  crafting/      inventory, forge transactions (idempotent, evidence-replayed), merchant
  save/          save format + validation (used by browser and server)
  session/       the character (Session) + the rules for changing it: applyAction, rewardKill, playerHit
  protocol/      network message types + validation (world.ts is the live protocol)
  world/         layout, terrain, colliders, enemy movement (EnemySim)
tests/e2e/       Playwright browser tests
docs/handoff/    in-progress task notes for agent handoffs (see below)
docs/devlog/     one dev log per contributor, human or AI (see below)
tools/           asset pipeline; devlog.mjs (npm run devlog)
```

`apps/server/src/room.ts`, `server.ts`, `main.ts` and `client.ts` are an older proof-of-concept
server (`npm run netproof`). They are not the live server. The live server is `worldMain.ts`.

## Commands

```
npm ci                      install
npm run typecheck           tsc, no emit
npm test                    vitest: all unit/integration tests (packages + server)
npm run build               typecheck + production build of the web client into apps/web/dist
npm run test:e2e            Playwright browser tests (starts its own preview on :4178 and world server on :2569)
npm run world               build the client, then run the world server on :2568 (open http://localhost:2568)
npm run dev                 Vite dev server for the client only (offline play)
npm run devlog -- "Title" --as <agent> [--pr N --asked .. --done .. --not-done .. --verified .. --notes ..]
                            add a dated entry to the top of docs/devlog/<agent>.md
```

Before saying a change works, run `npm run typecheck`, `npm test` and `npm run build`. If you changed
gameplay, UI, networking or accounts, also run `npm run test:e2e` locally. In CI the browser tests are
informational: GitHub's GPU-less runners are too slow for them.

## Hard rules

1. **Report test results truthfully.** Never claim a test passes unless you ran it and saw it pass. If you
   skipped something or it failed, say so, and include the failing output.
2. **No secrets in the repo or in browser code.**
   - `.env.local` holds the Neon connection strings. It is git-ignored: never print, commit or copy its values.
   - Nothing under `apps/web` may contain keys or tokens; the browser bundle is public.
   - Tests use synthetic data. `playwright.config.ts` forces `DATABASE_URL=''` so browser tests never touch
     the real database: keep it that way.
3. **No paid services, no new infrastructure, no deploys** without the owner's explicit approval. That
   includes changing Render or Neon settings and adding cloud services.
4. **Git:**
   - Work on a branch and open a pull request against `main`. Never push to `main` directly or force-push shared branches.
   - Use the repo's configured git identity; don't change it.
   - End commit messages with a `Co-Authored-By:` line for the agent.
   - Merging into `main` deploys to the live server, so only merge when the owner says to.
5. **Server authority:**
   - The server must not trust client-reported results, such as damage, loot, coins, crafted items or quest progress.
   - Clients send *intents*. The server validates them against its own state, such as position, range,
     cooldowns, quest step and owned materials, and returns the result.
   - Keep game rules in `packages/` so client and server share one implementation.
6. **Assets:**
   - Don't copy assets from commercial games.
   - Record the source and license of every new asset in `ASSET_PROVENANCE.md`.
   - Commit only converted files the game loads, never raw source packs (see `CONTRIBUTING.md`).
7. Keep the protocol backward-tolerant where cheap: old clients can be connected while the server
   redeploys. Bump `WORLD_PROTOCOL` in `packages/protocol/src/world.ts` when a change is incompatible.

## Dev log

Every contributor keeps a detailed, timestamped log in `docs/devlog/<name>.md`; format and rules are in
`docs/devlog/README.md`. AI agents log their work too: Claude in `claude-code.md` (never `claude.md`: on Windows it is the same
file as `CLAUDE.md`), Codex in `codex.md`, and so on.

- **Add an entry** at every checkpoint, when you open or update a pull request, and before you stop.
  Use `npm run devlog -- "Title" --as <agent> ...` so the time is right (US Eastern).
- **Cover:** what was asked for, what you did, what you did **not** do or deferred (and why), and what you
  verified. Only facts: test results you saw (hard rule 1).
- **Commit the log entry with the work it describes**, in the same pull request.
- The log never holds secrets, connection strings or email addresses.

## Handoffs between agents

Work may be split across agents because of usage limits.

- `docs/handoff/README.md` lists any task in progress, with its branch and handoff file.
- Each in-progress task has a handoff file with the goal, the design decisions already made, a
  checklist of stages, what's done, what's next, and how to verify.
- **When you pick up a task:**
  - Check out its branch.
  - Read the handoff file.
  - Run the tests to confirm the stated state before changing anything.
  - Don't re-litigate decisions recorded there unless they turn out to be wrong. If one is wrong, record why.
- **At every checkpoint** (a stage done, or before you stop):
  - Update the checklist and the "Current state" section with what is actually verified.
  - Commit the code and the updated handoff together.
  - Push the branch.
- **When the task's PR merges:** remove its entry from `docs/handoff/README.md` and delete its handoff file.
