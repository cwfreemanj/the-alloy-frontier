# Server-authoritative characters (design record)

Merged in PR #8. This file records the design, the decisions and the known limitations, for
whoever works on the server next. Kept from the handoff notes the work was built from.

## Goal

For **signed-in players**, the server, not the browser, decides everything that changes a character.
This covers gathering, buying, forging, equipping, discarding, quest progress, kill rewards (coins,
XP, loot) and the damage of the player's hits. A modified browser must not be able to give itself
items, coins, XP, quest progress or extra damage.

**Guests stay as they are:** local saves in the browser, applying the same rules locally. A guest
can cheat their own local save, which is acceptable. Guests are labelled "(guest)" in the world.

## Why (current holes, verified by reading the code)

- `apps/web/src/state/Session.ts` applies every change in the browser, and the account save is uploaded
  as a whole by `PUT /api/save`. The server only validates the format and checksums (`@alloy/save`
  `deserialize`), and the checksums can be recomputed because the code is public.
- On a kill, `Game.onEnemyKilled` rolls coins, flux drops and XP with `Math.random()` in the browser.
- For hits, the browser sends `damage`. `worldRoom.hit` accepts anything up to 200 and only checks range and rate.

## Design (decided; don't redo unless it proves wrong)

### 1. Shared rules package: `packages/session` (`@alloy/session`)

- Move `Session`, `newSessionData`, `PLAYER_ID` and the `SessionEvent` type out of
  `apps/web/src/state/Session.ts` into this package.
- Move the node rules out of `apps/web/src/entities/WorldObjects.ts` into it too:
  `nodeTraits`, `nodeYield`, `NODE_MAX_CHARGES`, `NODE_RESPAWN_SECONDS`, `NodeRuntime`.
  `WorldObjects.ts` keeps only rendering and imports these.
- Add the interaction ranges as constants: NPC 3 m, anvil 2.8 m, node 2.6 m, all from `Game.nearestInteractable`.
  The server allows `RANGE_SLACK = 1.5` m extra for latency.
- Add one dispatcher used by **both** the server (authoritative) and the browser in guest mode:
  ```ts
  applyAction(session: Session, action: CharAction, ctx: ActionContext): ActionResult
  // ctx: { now: number; pos: {x,z} | null; rng: () => number; playTime: number; mastery etc. from session }
  // ActionResult: { ok: true; events: SessionEvent[] } | { ok: false; error: string; message: string }
  ```
  Each action's range and quest-gate checks live in `applyAction`, so guests and accounts behave the same.
- Kill rewards become a function in the package: `rewardKill(session, enemyType, rng)`. It does
  coins in `def.coins`, adventurer XP, the 50% scavenger flux drop and `recordKill`. Hit damage is
  `computeOutgoingHit` + `weaponMasteryDamageBonus` from `@alloy/game-rules`, as in `Game.resolvePlayerHits`.
- `apps/web/src/state/Session.ts` becomes a re-export so imports elsewhere keep working.

### 2. Protocol (`packages/protocol/src/world.ts`, bump `WORLD_PROTOCOL` to 2)

```ts
type CharAction =
  | { k: 'gather'; node: string }
  | { k: 'buy'; stock: string; qty: number }
  | { k: 'forge'; req: ClientForgeRequest }   // ForgeRequest minus maker/createdAt (server fills those)
  | { k: 'equip'; item: string }
  | { k: 'discard'; item: string }
  | { k: 'talk'; npc: 'orla' }
  | { k: 'event'; ev: 'open_merchant' };
// client -> server
{ t: 'act'; id: number; a: CharAction }
// server -> client
{ t: 'actResult'; id: number; ok: boolean; error?: string; message?: string; item?: ItemInstance }
{ t: 'char'; data: SessionData; events: SessionEvent[] }   // authoritative character after changes
```

- Validate every `CharAction` field in `parseWorldClientMsg`, with string lengths, integer ranges and known
  kinds. The forge request is checked further by `planForge`.
- `hit` keeps its shape for compatibility. For account players the server **ignores** the client's
  `damage`, `stagger` and `crit` and computes them itself. For guests the current clamp stays.

### 3. Server: character host (`apps/server/src/characters.ts`)

- When a signed-in player says `hello`, load their save from `AccountService.getSave` and `deserialize`
  it. With no save, use `newSessionData`. Keep one `Session` per account in memory, attached to the world member.
- `act` → `applyAction` with `pos` = the member's last `state` position, server time and server RNG.
  Reply `actResult`, and send `char` if anything changed.
- **Gather:** the node must exist and be in range. Charges and respawn are tracked in the
  character's `world.nodes` using server play time, and there is a minimum of 0.9 s between gathers (the client
  channels for 1 s). Quantity comes from `nodeYield` and quality from `nodeTraits`; the client never sends them.
- **Forge:** must be within anvil range and past the `commission` quest step. `maker.mastery` comes from the server-side
  session, `createdAt` is server time, and the hammer evidence is replayed by `planForge` as it is today.
- **Kill:** for each contributor in `worldRoom.kill` who has a character, call `rewardKill` and send
  `char`. Broadcast `kill` as today, so clients still play effects.
- **Hit:** compute the damage from the equipped weapon in the server-side inventory. Grant weapon XP
  (`weaponXpForHit`) server-side, and coalesce `char` updates to at most 4 per second.
- **Deaths:** count a death when the member's `state.ph` changes to `'dead'`.
- **Play time and position:** play time advances on the server clock while the player is joined; the save's
  `player` position, yaw and health come from the latest `state`.
- **Persistence:** the server writes the save itself (a new `AccountService.serverPutSave(accountId, data)`, which
  bumps the revision without a client base revision). It writes at most every 5 s while changed, and
  immediately on leave or disconnect.

### 4. Locking down the HTTP save API

- `PUT /api/save` stops accepting arbitrary saves. Replace it with:
  - `POST /api/character/new`: the server creates `newSessionData` itself, overwriting after the confirm.
  - `POST /api/character/import`: accepts a guest save once, only if the account has no character
    yet. It's validated with `deserialize` and **capped**: coins ≤ 500 and an item count no higher than what's reachable.
    - **Known, accepted gap:** a guest save can be crafted offline and imported. This is documented,
      not fixed. Removing import is the full fix, if the owner decides to.
- `GET /api/save` stays (read-only) so the title screen knows whether there's a character to continue.

### 5. Client (account mode)

- Add `apps/web/src/net/CharacterLink.ts`. In account mode, Game, ForgePanel, MerchantPanel and
  InventoryPanel call `link.act(action)` instead of mutating `Session`.
  - On `char`, replace `session.data`, replay the `events` through the existing `Session` listener (toasts,
    level-ups, equip visuals), and re-render any open panel.
  - In guest mode, `link.act` calls `applyAction` locally.
- The 1 s gather channel stays client-side for feel. The result arrives from the server about 100 ms later.
- Forge: the panel waits for `actResult` (show "Forging…"), then shows the item from the reply.
- In account mode the browser no longer uploads saves (`CloudSaver` is used only for guest import), and
  `Game.onEnemyKilled` only plays effects and toasts.
- Debug hooks `__alloy.give` and `__alloy.coins` must not work on account characters. They're localhost-only already;
  in account mode, make them refuse.

## Checklist

- [x] Stage 1: `@alloy/session` created (Session and node rules moved; `applyAction`, `rewardKill`, `playerHit` and `rewardHit` added; `packages/session/test/actions.test.ts` has 9 tests). The web client imports through `apps/web/src/state/Session.ts` (a re-export) and still applies changes itself. It is routed through `applyAction` in stage 5.
- [x] Stage 2: protocol v2 (`WORLD_PROTOCOL = 2`). `act`, `actResult` and `char` were added, and `charAction` validates every field. A `hello` with any other protocol number gets `error: 'outdated_client'`. Parser rejection is tested in `apps/server/test/characters.test.ts`.
- [x] Stage 3: `apps/server/src/characters.ts` (CharacterHost, plus a store backed by account saves via `AccountService.serverPutSave`). `worldRoom.ts` handles `act`, kill rewards, weapon XP, server-side damage, play time, position and deaths. `worldServer.ts` opens the character before join, saves every second if it's been due for 5 s, and saves everything on close. `worldMain.ts` saves on SIGTERM/SIGINT. Tests: `apps/server/test/characters.test.ts` (9), plus one end-to-end test in `accounts.test.ts`.
- [x] Stage 4: `PUT /api/save` now returns 410 `server_owned`. `POST /api/character/new` makes the server build a fresh character. `POST /api/character/import` takes a guest save once, validated, with coins capped at `MAX_IMPORT_COINS` = 1000. Both return 409 `in_world` while the character is loaded in the world. `AccountService.putSave` was replaced by `importCharacter`. Tests are updated in `accounts.test.ts`.
- [x] Stage 5: client. `Game.act(action)` is the single entry point: in account mode it calls `Online.act` (protocol `act`, 8 s timeout); for guests it runs `applyAction` locally. `Game.characterUpdate` adopts the server's `char` and replays its events through `Session.notify`. The Inventory, Merchant and Forge panels take callbacks that go through `act`. `CloudSaver` and `writeSave` are removed; the title screen uses `newCharacter` and `importCharacter`. Kill rewards, weapon XP and death counting are guest-only in the browser. The debug `give`/`coins` hooks refuse account characters, and `__alloy.act` was added for tests. Outdated clients are shown a reload message. (The handoff plan named a separate `CharacterLink.ts`; it ended up as `Game.act` + `Online.act`.)
- [x] Stage 6: `tests/e2e/accounts.spec.ts` now goes through real actions. The cheat test checks that the debug grants refuse, that local edits are overwritten by the server's copy, that out-of-range actions are refused, and that `PUT /api/save` gets 410. The second-device sign-out became its own test. After a teleport, tests retry `act` until the server has the new position (`actWhenThere`).
- [x] Stage 7: README and AGENTS updated; PR opened (not merged).

## State at merge

- All stages are done and merged.
- **Verified on this branch:**
  - typecheck passes
  - `npm test` passes (139 tests)
  - `npm run build` passes
  - `npm run test:e2e` passes (12/12, run locally in Chrome)
- **Not verified in a browser:**
  - The forge panel's account path (asking the server, waiting, showing the item). It's covered by the server tests (`characters.test.ts`) and the shared-rules tests, but no e2e test forges as a signed-in player.
  - A signed-in kill in the browser. Server tests cover the rewards; `world.spec.ts` covers guests.
- **Known limitations:**
  - A guest save can be edited before it's imported into an account; only coins are capped (1000).
  - If the final save on leave fails (database down), that change is logged and lost.
  - The player's own movement is still client-reported, but since PR #13 the server runs a speed check on every `state` message (`packages/game-rules/src/movement.ts`, `WorldRoom.guardMove`):
    - **Budget:** distance allowance refills at 8.5 m/s (above sprint 7.6 and dodge 8) and banks up to 12 m for lag.
    - **Refused moves:** the server keeps the last accepted position, which is what others see and what range checks use, and sends the browser a `correct` message (at most two a second).
    - **Exceptions:** respawning at the respawn point after a death. A signed-in player's first position after connecting must be within 5 m of the saved position.
    - **Tests:** the local browser-test server sets `ALLOW_TELEPORT=1` for the debug teleport; a hosted server never does (`RENDER` overrides it).
    - **Height:** every reported position must be at most 1.6 m above and 1 m below the terrain (`heightOk`, the same `terrainHeight` the browser uses). Players walk on the terrain and a jump peaks about 1 m up. A refused position is corrected like a speed violation and shown to others on the ground (`WorldStats.heightRejected`).
- **On deploy:** players with the old page open get "A new version of the game is out. Reload the page."
  Old browser saves are unaffected. Account characters already in the database keep working (same save format).

## How to verify

```
npm run typecheck && npm test && npm run build
npm run test:e2e
```

Manual check: run `npm run world`, open http://localhost:2568 and sign in. Then gather, forge, kill a
scavenger and reload: everything persists. In devtools, `__alloy.coins(999)` must be refused.
