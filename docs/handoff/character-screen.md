# Handoff: attributes + character / inventory / skills window

Branch: `character-screen`. Read `AGENTS.md` first.

## Goal
One window (I or C) with three tabs that brings the character together:
- **Character:** equipment slots (paper doll), attributes, derived stats.
- **Inventory:** item grid + materials + coins.
- **Skills:** adventurer rank, weapon mastery, blacksmithing mastery, known attacks.

## Decisions (made by the owner, 2026-11-24; don't re-litigate)
- **Attributes grow by use**, no point spending.
- **Equipment:** show the full slot layout (head, chest, hands, legs, feet, main hand, off-hand,
  2 trinkets). Only the main hand works; the others are marked "coming soon" until armor items
  and models exist (models are the partner's area).
- **One tabbed window**, not separate windows.

## Attribute design (decided by the agent; change only with a recorded reason)
Rules live in `packages/game-rules/src/attributes.ts`; the character's state is in
`progression.attributes` (optional in old saves, filled on load). Level 1..30,
XP to next = 25 + 15 × level. XP comes only from things the server observes, so signed-in
players can't fake it; guests run the same code locally.

| Attribute | Grows from | Effect per level above 1 |
| --- | --- | --- |
| Strength | heavy, guardbreaker and storm-arc hits that land; mining ore and ironglass; forging | +1% damage |
| Dexterity | light hits that land; critical hits | +0.25 percentage points crit chance |
| Vitality | enemy hits aimed at you (server-sent raw hits); elite kills | +5 max health |
| Endurance | gathering anything; kills | +1.5 max stamina |

Notes:
- Vitality XP counts hits the server sends even if the client dodges or blocks them (the
  server can't see dodges). Accepted for now: XP is small and capped per hit.
- Health and stamina stay client-owned (as before); max values come from the shared rules.

## Stages
- [x] 1. Attribute rules + tests (`game-rules`), session hooks, `characterStats()` in `session`
- [x] 2. Server awards attribute XP (hits landed, hits sent to player, gathers, forges, kills)
- [x] 3. Client uses derived stats (damage, crit, max health, max stamina); guest awards
- [x] 4. Tabbed window: Character / Inventory / Skills (replaces `InventoryPanel`)
- [x] 5. e2e coverage for the window; typecheck, unit, build, e2e; PR

## Current state
Stages 1-2 done and verified: `npm run typecheck` clean, `npm test` passes (unit tests for
the rules in `packages/game-rules/test/attributes.test.ts`, session hooks in
`packages/session/test/actions.test.ts`, server awards in `apps/server/test/characters.test.ts`).
- Rules: `packages/game-rules/src/attributes.ts` (`ATTRIBUTE_XP` is the single list of sources).
- Session: `Session.attributes`, `bonuses()`, `gainAttributes()`; progress event kind `attribute`.
- Shared: `characterStats(s)` in `packages/session/src/actions.ts` (max health/stamina, damage
  bonus, weapon with crit bonus); `playerHit` uses it; `rewardHit(s, type, dmg, attackId, crit)`;
  `rewardHitTaken(s, raw)`.
- Server: `worldRoom.ts` passes attack/crit to `rewardHit` and calls `rewardHitTaken` when an
  enemy attack reaches a signed-in player.
No protocol bump: `char` data just gains an optional field; old clients ignore the new event kind.

Stages 3-4 done:
- Client (`Game.ts`): `applyCharacterStats()` sets max health/stamina from `characterStats`;
  combat uses the derived weapon and damage bonus; guests call `rewardHit` / `rewardHitTaken`.
- Window: `apps/web/src/ui/CharacterWindow.ts` replaces `InventoryPanel` (removed from
  `Panels.ts`). Keys: I = Inventory, O = Character, U = Skills (`core/Input.ts`); the same key
  again closes it. Styles under "Character window" in `ui/styles.css`.
- Checked by eye in the browser at 1366x800 and 800x600.
- e2e: "character window: tabs, attributes that grow by use, derived stats" in `tests/e2e/slice.spec.ts`.

Stage 5: `npm run test:e2e` ran 13 tests: 12 passed, 1 failed. The failure was
"two players share one world" (player B's name came out as the default guest name). That test
passed on 2 reruns, so it's a flake, probably the title-screen name race. The new character-window
e2e test passed.

Next: the owner reviews and merges the PR. On merge, remove this file and its README entry.
Follow-ups: armor items and slots (needs models), a speed check on movement (see
`docs/server-authority.md`).
