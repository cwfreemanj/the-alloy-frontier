# Design record: attributes and the character window

Merged in PR #10. This was the handoff file for the task; it is kept as the record of what was decided and why.

## Goal
One window (I or C) with three tabs that brings the character together:
- **Character:** equipment slots (paper doll), attributes, derived stats.
- **Inventory:** item grid + materials + coins.
- **Skills:** adventurer rank, weapon mastery, blacksmithing mastery, known attacks.

## Decisions (made by the owner, 2026-11-24; don't re-litigate)
- **Attributes grow by use**, no point spending. *(Superseded the same day, below.)*
- **Hybrid (owner, 2026-11-24, later the same day):** attributes have two layers that add up to
  **one total**: trained levels (by use) + allocated stat points. **3 points per adventurer
  rank**, **free respec** for now. Separate effects for training (perks, titles) are on the
  back burner: `docs/design-backlog.md`.
- **Enemies have attributes, and outcomes are contested** against the player's totals.
  An adapting world (enemies change with how players fight) is in the backlog.
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

## Stat points and contests (decided by the agent)
- `progression.allocated` stores points spent per attribute; unspent = 3 × (rank − 1) − spent,
  derived, so it can't get out of sync. At most 50 points per attribute (`ALLOCATED_MAX`).
- Actions `{k:'allocate', attr, n}` and `{k:'respec'}` go through `applyAction` (server for
  accounts). The protocol validates attr and n (1..100).
- Contests (`packages/game-rules/src/attributes.ts`):
  - stagger dealt × (1 + 2% × (your Str − their Str)), bounded 0.6..1.5
  - crit chance + 0.4 points × (your Dex − their Dex)
  - enemy hits on you × (1 + 1.5% × (their Str − your Vit)), bounded 0.7..1.3
- Enemy health and damage stay as tuned; their attributes only drive contests. Values:
  scavenger 2/3/2/2, sentinel 4/1/5/3, warden 6/3/8/6, training post 1/1/1/1 (Str/Dex/Vit/End).
- Incoming damage is scaled in the client (health is client-owned, as before). Outgoing contests
  run on the server for accounts (`playerHit(..., e.def.attributes)`), locally for guests.

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

### Hybrid round (stages 6-8)
- [x] 6. Stat points + respec (rules, session, actions, protocol, server test)
- [x] 7. Enemy attributes + contests (shared `hitAgainst`, server and client)
- [x] 8. Character sheet: unspent points, + buttons (Shift = 5), trained/allocated split, Reset;
  e2e steps added to the character-window test. Backlog written: `docs/design-backlog.md`.
