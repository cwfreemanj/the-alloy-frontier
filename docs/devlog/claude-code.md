# Dev log: Claude (AI agent)

Detailed record of the work Claude did on Alloy Frontier. Newest first. Times are US Eastern. How to write entries: [README.md](README.md).
Entries up to PR #29 (2026-11-25 14:41) were backfilled from pull requests and git history; later entries are written as the work happens.

## 2026-11-27 11:22 — Forge expansion, phase 1: a mace, shields and armor
- **PR:** 36
- **Asked for:** Neal: analyze the creative director's Model Workshop, then expand the forge with helmets, chest armor, legs, shields and a second weapon; he approved phase 1 of the plan.
- **Done:**
  - Item generation (starter values; the creative director owns this area per equipment-contract.md): ArmorFamily, 10 blueprints (iron and ironglass mace, shield, helmet, chestplate, platelegs), baseDefense crafted like damage, ARMOR_AFFIXES, armorRating, a look spec per blueprint. Sword generation unchanged.
  - Forge screen: five category tabs; armor shows defense and compares with the piece in its own slot; 2D previews per type. Fixed: the result's Equip button only knew the weapon slot. The quest counts only weapons.
  - Looks: vendored the workshop generator (equipment.js, resources.js, body.js, updated core.js), loaded on demand (48 KB gz chunk). Mace in the right hand; shield on the left forearm and helmet on the head, placed on each character's own rest skeleton (measured in the skin's bind space) and scaled to the head. Other players see them (optional gr field, server-validated).
- **Not done / deferred:** Chest and leg armor don't show on the character yet (phase 2: fitting to Maria and Exo). No new movesets: the mace uses the sword's. Numbers and looks await the creative director's review (added to docs/NEEDED.md).
- **Verified:** npm run typecheck pass; npm test 262/262 (7 new: armor generation and forging, server armor and gear relay); npm run build pass; npm run test:e2e 21/21 including a new forge-expansion test. Checked in the browser on Maria and Exo: mace in hand, shield on the forearm, helmet on the head; the village still renders with the updated core.js.
- **Notes:** First placement attempt made gear 100x too large: the characters' skins were bound at a different scale (about 0.0114) than the model uses now (0.01). The pieces are now placed in the skin's bind space, with the scale measured from the bones.

## 2026-11-27 10:58 — Fixed Bram's shop display
- **PR:** 35
- **Asked for:** Neal: the merchant shop displays very weirdly; the items can't be seen.
- **Done:**
  - Cause: the line-icon styles (size, outline) existed only inside the character window and the forge screen. The shop reuses the item stat table, so each stat's icon drew as a huge filled black shape and pushed the items off screen. Added a default .ico style (16 px outline) that those screens still override, and a default colour for stat icons.
  - Second bug on the same screen: Healing Salve showed Binding Flux's description and owned count. Each material now shows its own.
- **Verified:** Opened the shop in the production build: icons 16x16, all three items visible, Healing Salve reads 'Restores health. Drink it with key 5. Owned: 0'. npm run typecheck, npm test (255/255), npm run build pass; the full-loop browser test passes.

## 2026-11-27 10:00 — Built raids on Emberhold (AF-011)
- **PR:** 34
- **Asked for:** Neal approved the raid proposal as written: build it.
- **Done:**
  - Rules in game-rules raid.ts; Ember Raider and Raider Captain enemies; RAID_POINTS (entry, village patrol, camp) checked clear of colliders.
  - Server: RaidDirector (apps/server/src/raids.ts) in the world room: readiness, the horn, a 60 s warning, two waves and the Captain, a 5-minute limit, a loss when nobody defends the village for 30 s, the Captain's camp on the trail. Win bonus and the Captain's Binding Flux. Raid state saved in the world:observer row. Off unless the server setting RAIDS=1; a debugRaid test command only on local test servers.
  - Protocol 3: spawn, despawn and raid messages; welcome includes raiders and the raid. Browser: raiders created and removed, ember-red tint, a raid banner with the countdown; toasts move below it.
  - Game.ts: 19 changed lines (hooks, the Warden-only 'falls silent' toast, the raid test hook).
- **Not done / deferred:** Not on in the live game: needs RAIDS=1 in Render's settings, which is the owner's call. No horn sound, no raider models of their own (the Scavenger's, tinted). The protection fee is AF-012.
- **Verified:**
  - npm run typecheck pass; npm test 28 files, 255 tests pass (13 new for raids); npm run build pass.
  - npm run test:e2e: 19 passed, 1 failed: the full-loop test at line 262 (pressing E at Orla didn't open her dialog, the known flake in M4.md; offline, no raids). It passed when rerun alone. The new raid browser test passed (3 raiders, a kill, the loss, the camp).
- **Notes:** A first version of the browser test 'left' to the quarry; the sentinels killed the player, who respawned in the village and so kept defending it. The server was right; the test now waits on a quiet part of the trail.

## 2026-11-27 07:18 — Raid proposal for approval (AF-011)
- **PR:** 34
- **Asked for:** Start AF-011 with the raid proposal: the trigger, size and outcomes need design approval before building.
- **Done:**
  - docs/raids.md: how a raid plays (watchtower horn, 60 s warning, two waves, the Raider Captain, a 5-minute limit) and recommended rules for the three things needing approval. Trigger: readiness from play time and village activity, at 30 with a signed-in rank-2+ player in the village, 45 min apart. Size: 3 + 2 per defender (5 to 10) plus the Captain, level from the defenders' ranks. Outcomes: win rewards; a loss puts the Captain in a camp on the trail and sets up AF-012's tribute.
  - Smaller defaults (reuse the Scavenger model tinted, raids off by default behind a server setting), the build plan, and open questions. Linked from adaptive-world.md and the GDD AF-011 row.
- **Not done / deferred:** No code: building waits for approval. The rule numbers are first guesses to tune in play.
- **Verified:** Docs only. Numbers checked against the code: watchtower at (19, 22), Scavenger stats, the respawn point in the village square. npm run typecheck, npm test (242/242) and npm run build pass.

## 2026-11-27 07:09 — Recorded the technical director's M4 sign-off
- **Asked for:** Put Neal's name and date on his M4 sign-off row.
- **Done:** docs/M4.md: technical director row signed (Neal, 2026-11-27), status row now Partly. docs/NEEDED.md: Neal's sign-off item removed; the v0.1.0 tag now waits only on the creative director's sign-off. Entry in neal.md.
- **Not done / deferred:** Creative director's sign-off, performance report and the playthroughs are still open.
- **Verified:** Docs only; the earlier checks on this branch (typecheck, 242/242 tests, build) still apply.

## 2026-11-27 06:53 — A to-do list for people that every agent brings up first
- **Asked for:** Make sure the creative director's AI tells him, before any other work, what's needed from him (above all the performance report from his machine), and asks whether to do it now or continue.
- **Done:**
  - New docs/NEEDED.md: each person's items, most important first; the creative director's performance report is first, with the steps and why a second machine matters.
  - AGENTS.md (read by Codex, and by Claude through CLAUDE.md): a 'Before you start' section at the top telling agents to read NEEDED.md, find who they're working with from git config user.name, list that person's items and ask 'do this now, or continue with your work?', once per session.
  - M4.md links to NEEDED.md.
- **Not done / deferred:** No code changes. The partner's agent only sees this once he pulls main after this merges.
- **Verified:** npm run typecheck, npm test (242/242) and npm run build pass. Docs only, so no browser tests.

## 2026-11-25 18:46 — Forge button 'covered': a late pointer lock, not the layout
- **Asked for:** Find and fix why the full-loop browser test sometimes times out clicking Quick Forge, with Playwright reporting that .forge-center intercepts pointer events.
- **Done:** Found the cause in the original failing log: the preliminary hit test passed every retry; the real mousedown was the one intercepted. Closing a menu (Esc on Bram's shop) asks for pointer lock, which the browser grants asynchronously. The forge opened ~200 ms later; setModal's exitPointerLock did nothing because the lock wasn't granted yet. When it arrived, the canvas held the mouse over the forge, so every click went to the canvas with frozen coordinates that land on the centre column. Fix in apps/web/src/core/Input.ts: remember whether a lock is still wanted (requestPointerLock sets it, exitPointerLock clears it) and release a lock that is granted after it was cancelled. Players could hit the same bug by closing one menu and quickly opening another. Tests: new e2e test that delays the browser's lock grant by 600 ms, closes and reopens the inventory, and checks the lock is released; the full loop now also checks there is no pointer lock and that elementFromPoint at the Forge button's centre is the button.
- **Not done / deferred:** No forge layout or CSS changes: the layout was fine (the centre column has ~300 px to spare at 1920x1080). Game.ts untouched. The known 'talk to Orla' flake is unrelated and still there.
- **Verified:** npm run typecheck, npm test (235/235), npm run build pass. New test fails 2/2 without the fix (lock still held) and passes with it. --repeat-each 5 on the new test + full loop: 9 passed, 1 failed with the known Orla talk flake (line 262, after the forge steps); the forge click passed all 5 times. Full npm run test:e2e: 19/19 passed.

## 2026-11-25 18:20 — Saved world state (AF-013)
- **PR:** #31 `saved-world-state`
- **Asked for:** Start AF-013: keep the world observer's tallies and area levels across server restarts.
- **Done:**
  - The observer's tallies and area enemy levels are saved in one storage row (world:observer), Postgres on the live server
  - Loaded at start-up, before anyone joins; enemies start at their area's restored level
  - On loading, tallies fade by the time the server was down, so a long sleep can bring a level back down
  - Written at most once a minute and only when players were on or something happened; an empty world writes nothing, so Neon can sleep. Also written when the server stops
  - Bad saved data or a database error never stops the world: it starts fresh or retries next minute
  - Browser tests start from an empty data file each run, so no saved world state carries over
- **Not done / deferred:**
  - The raid and protection fee (AF-011, AF-012) that will read this state
  - No admin tool to reset an area's level; deleting the world:observer row does it
- **Verified:**
  - typecheck, build pass; npm test 242 passed (7 new: save/restore, fading, bad data, restart of a real server, no writes when idle, database failure)
  - npm run test:e2e: 17 passed, 1 failed (full loop: the forge screen's middle column covered the Quick Forge button); the same test passed alone on a rerun
- **Notes:** The full-loop failure is a forge-screen layout flake, separate from the known 'talk to Orla' one. Not caused by this change (server only).

## 2026-11-25 14:46 — Dev logs for every contributor
- **PR:** #30 `dev-log`
- **Asked for:** A detailed, timestamped dev log for each contributor, human and AI, showing when things were and weren't implemented.
- **Done:**
  - docs/devlog/: one log per contributor (neal, cwfreemanj, claude-code) and a README with the format and rules
  - npm run devlog: adds a dated entry (US Eastern) to the top of your log; picks the file from your git name or --as
  - Backfilled this log from all 29 pull requests and the first day's commits; backfilled the partner's log from their PRs #3 to #5
  - AGENTS.md and CONTRIBUTING.md: agents and people add an entry at each checkpoint, in the same PR as the work
- **Not done / deferred:**
  - Neal's log has only today's decisions; older ones weren't recorded anywhere to backfill from
  - No CI check that a PR adds a log entry; it's a rule in AGENTS.md for now
- **Verified:**
  - typecheck, build pass; npm test 235 passed (5 new for the helper)
  - Live check after #29 deployed: names unique on the real server (409 name_taken); slots, accounts and world join pass
- **Notes:** The AI log is claude-code.md, never claude.md: on Windows that is the same file as CLAUDE.md, which Claude Code loads as instructions. The helper maps 'claude' to 'claude-code'.

## 2026-11-25 14:41 — Character names, separate from the account name
- **PR:** #29 `character-names` · opened 14:38 · merged 14:41
- **Asked for:** characters with their own names, so other players see the character's name instead of the account name.
- **Done:**
  - Each new character gets a name, typed under its slot before **Create character**. The button stays disabled until the name is valid, and a hint says what's wrong.
  - Name rules: 3–16 characters, letters with single spaces, apostrophes or hyphens, starting with a letter. NPC and staff-like names are reserved.
  - Names are unique across all accounts, ignoring case. The server reserves each name (`cname:<name>`); deleting a character frees it.
  - The name shows to other players, on the HUD, on the character screen, in slot titles and in the delete warning ("⚠ Delete Brann (Character 2)?").
  - Characters made before names get a name box and **Save name**, usable once (`POST /api/character/name`).
  - Guests carry their guest name as the character name.
  - One shared name check in `@alloy/session`, used by the browser and the server.
  - Added the technical director's three performance reports (`docs/perf/2026-11-25-technical-director-laptop.md`): all three presets pass the 60 FPS target, with 1% lows of 69–154 FPS. M4 criterion 5 updated.
- **Not done / deferred:** M4 criterion 5 still needs a report from the creative director's machine.
- **Verified:** typecheck, build pass. `npm test` 230 passed. `npm run test:e2e` 18/18 (invalid name keeps Create disabled, duplicate name refused, other players see the character's name, delete warning names the character). Checked by hand with screenshots on a local world server.

## 2026-11-25 14:01 — Two character slots per account, with a carefully confirmed delete
- **PR:** #28 `character-slots` · opened 14:00 · merged 14:01 · built on #27
- **Asked for:** a way to run fresh M4 playthroughs without replacing the first character.
- **Done:**
  - Two character slots per account. Slot 1 is the existing character in its same storage record, so nothing needed migrating.
  - The title screen shows both slots: rank, blacksmithing, weapon mastery, coins, play time and quest progress, with **Play** and **Delete…**.
  - An empty slot offers **Create new character**, and **Bring this browser's character here** when the browser has a guest character.
  - Nothing overwrites a character any more: new and import only fill an empty slot (otherwise 409 `slot_taken`).
  - Only one character per account is in the world at a time. The slot travels in the world `hello`; older clients get slot 1.
  - Delete is deliberately hard: a red card, every stat that would be lost highlighted, a warning that it can't be undone, and the button stays disabled until **DELETE** is typed exactly.
  - The server also requires the confirmation (400 `not_confirmed`), refuses while the character is in the world (409 `in_world`), and moves the record to a dated trash key instead of erasing it.
  - New API: `GET /api/characters`, `GET /api/save?slot=N`, `POST /api/character/new`, `/import`, `/delete`.
  - M4.md, GDD v0.5 and PLAYTEST.md updated to use Character 2 for fresh playthroughs.
- **Not done / deferred:** Nothing stated.
- **Verified:** typecheck, build pass. `npm test` 226/226. `npm run test:e2e` 18/18, with a new test for both slots, the red card, "delete" vs "DELETE", Cancel and the deletion notice. Screenshots checked.

## 2026-11-25 14:01 — M4 close-out: versioned build, in-game performance report, M4 tracker, GDD v0.5
- **PR:** #27 `m4-closeout` · opened 12:53 · merged 14:01
- **Asked for:** close out what code can do for M4, the last gate of GDD v0.4 (quality acceptance), and write GDD v0.5.
- **Done:**
  - The build version shows on the title screen and in the pause menu, for example `v0.1.0 (6ff3324, 2026-11-25)`.
  - **Esc → Copy performance report:** build, browser, GPU, CPU threads, screen, preset, area, and the last ~10 s of FPS, 1% low, worst frame, draw calls and triangles. If the clipboard is blocked, the report is shown to copy by hand.
  - Warm-up for the authored models: textures upload and shaders compile when they load. The first trail visit on low went from 24 to 161 FPS average.
  - `docs/M4.md`: each M4 criterion with status and evidence, a 3-playthrough form, how to capture a report, a sign-off table and release steps.
  - `docs/perf/2026-11-25-dev-laptop.md`: 3 presets × 4 areas at 1920×1080. Averages 84–242 FPS on low and medium, 48–99 FPS on high.
  - `docs/GDD-v0.5.md`: gate results, decisions D1–D13, slice content, forge interface and balance records, tickets AF-010 to AF-019, open decisions.
  - PLAYTEST.md and the README status section updated.
- **Not done / deferred (needs people, not code):**
  - Three fresh human playthroughs to the ending.
  - A performance report from each partner's machine.
  - Sign-offs from the creative director and the technical director.
  - Then the `v0.1.0` tag and release.
- **Verified:** typecheck, build pass. `npm test` 224/224. `npm run test:e2e` 17/17, including a new test for the build label and the performance report.
- **Notes:** 1% lows measured in the headless environment were unreliable; real numbers must come from the target machines.

## 2026-11-25 11:55 — Authored models (Meshy) for the forge and the area; shader fire; no trees on cliff walls
- **PR:** #26 `authored-assets` · opened 11:33 · merged 11:55 · built on #25
- **Asked for:** authored models for the forge and the area. The owner approved the set, quality and designs before any 3D credits were spent.
- **Done:**
  - 25 models, each from a design image (nano-banana-2-1) to 3D (meshy-t2.5 smart topology, meshy-7 PBR textures). About 475 credits in total.
  - `tools/asset-pipeline/meshy.mjs` takes them from 210 MB raw to 4.4 MB: WebP textures, meshopt geometry, grounded origin, repaired zero-length normals.
  - Forge interior: authored hearth with copper hood, anvil on a stump, bellows, quench trough, sword rack, a new workbench, grindstone and coal bin. Colliders and the rack's inspect point moved to match.
  - New Emberwake design with a molten ember crack; coals and Emberwake glow and pulse.
  - A noise-based flame shader on the hearth's coal bed.
  - Area scenery swapped for authored variants: pines, new ironwood in the choppable groves (still fall and regrow), autumn and golden trees, boulders, slabs, shrubs and ferns.
  - Loose scenery on steep hillsides outside the playable area (slope over 0.6) is no longer drawn, which removes the "trees stuck on a wall" look. Node ids are unchanged.
  - Cliff and rock-wall faces line the valley edge, with colliders in the browser.
  - Chests and caches use the authored chest, which turns dark while searched.
  - Everything loads in the background; if a model fails, the previous version stays.
  - Every model's Meshy tasks are listed in `ASSET_PROVENANCE.md`.
- **Not done / deferred:**
  - Pine foliage looks blocky up close; higher face counts would fix it for more credits.
  - These models replace parts of the partner's Model Workshop scene; worth showing them.
  - The Meshy commercial licence depends on the account's plan; confirm before a public release.
  - Triangle counts rose (for example village 0.5 M → 1.3 M) with no FPS change on the dev machine; weaker GPUs not checked.
- **Verified:** typecheck, build pass. `npm test` 224/224. `npm run test:e2e`: first full run 15/16; the full-loop test failed at the final "talk to Orla" step (known flake). Five reruns of that test: 1 failed, 4 passed. Screenshots checked.
- **Notes:** Meshy exported some zero-length normals; they became NaN in the lighting shader and the bloom pass spread that across the whole screen. The pipeline now repairs them.

## 2026-11-25 11:54 — Forge screen fits the window: no scrollbars
- **PR:** #25 `forge-fit` · opened 10:11 · merged 11:54
- **Asked for:** a forge screen with no scrollbars.
- **Done:**
  - The forge screen is laid out at a fixed 1640×900 and scaled to fit the window, centred, up to 1.35× on large screens.
  - Every column shows in full at every stage. Measured at 1366×768, 1464×882, 1920×945 and 2560×1300.
  - "vs equipped" cells showed two arrows. The old CSS direction arrow is removed, leaving the better/worse arrow. This also affects the inventory screens.
  - The full-loop browser test now asserts that no forge column overflows.
- **Not done / deferred:** Nothing.
- **Verified:** typecheck, build pass. `npm test` 224/224. `npm run test:e2e` 16/16; the full-loop test was rerun on its own after the overflow check and passed.

## 2026-11-25 09:54 — Adaptive world, part 1: world observer and area enemy levels
- **PR:** #24 `world-observer` · opened 09:39 · merged 09:54
- **Asked for:** the first piece of the adapting world from the design backlog: the world watches how it is played and reacts.
- **Done:**
  - A world observer on the server (`apps/server/src/worldObserver.ts`) keeps per-area tallies: players there and their top rank, time, kills, deaths, gathers and searches.
  - Tallies halve every 20 minutes. Only signed-in characters count.
  - `/world-info` now includes `areas`, with rounded tallies and levels, and no player names.
  - Area levels: village 1, trail 1, quarry 2, foundry 4.
  - Players more than 2 ranks above an area build pressure by staying and killing there. Every 900 pressure raises its enemies one level, up to +3, with hysteresis so it doesn't flicker.
  - Each level: health +30%, damage +15%, defense +10%, poise +15%, +1 to every attribute, XP +35%, coins +25%.
  - An enemy changes level only out of combat at full health, or on respawn.
  - The server applies levels to its own enemies; the browser only shows the `lv` it receives.
  - Everyone online gets a notice when an area's level changes.
  - Shared rules in `packages/game-rules/src/adaptive.ts`; design in `docs/adaptive-world.md`.
- **Not done / deferred:**
  - Raids, the watchtower lookout, the Raider Captain and protection fees: design notes only (tickets AF-011, AF-012).
  - The tallies are in memory only and don't survive a restart (ticket AF-013).
  - Adapting resistances to damage types (design backlog §2) comes later.
- **Verified:** typecheck, build pass. `npm test` 224/224 (rules, observer, world room, rewards). `npm run test:e2e` 16/16. A local world server returned the new `areas` block.
- **Notes:** Protocol adds optional `lv` and a `notice` message; `WORLD_PROTOCOL` unchanged.

## 2026-11-25 09:10 — Forge screen redesign: mockup styling, Orla's guidance, clearer hammering
- **PR:** #23 `forge-screen` · opened 08:59 · merged 09:10 · built on #22
- **Asked for:** a forge that is easier to learn. It felt "a bit overwhelming the first time": walls of numbers and nothing saying what to do next.
- **Done:**
  - Restyled to the Emberhold Forge mockup: framed panel, gold titles with icons, blueprint thumbnails, material icons, chevron Quick/Masterwork tabs, the blade over an anvil.
  - A four-step track: Prepare, Heat, Hammer, Temper.
  - Orla's guidance line: one sentence per step on what to do and why. It can be hidden (remembered per browser) and is highlighted for new smiths.
  - On the first forges, "How hammering works" starts open.
  - Every stat has an icon and a plain-language tooltip. Differences from your weapon show as green ▲ or red ▼.
  - Strike buttons say what they do. Strikes left show as pips, with stress and quality meters.
  - A struck cell flashes and throws sparks; a wasted strike shakes red.
  - The finished blade's card glows in its rarity colour, with Orla's closing line.
- **Not done / deferred:** Forging rules and server calls are unchanged on purpose. Whether it is understandable at first use waits for the M4 playthroughs.
- **Verified:** typecheck, build pass. `npm test` 215/215. `npm run test:e2e` 16/16; the full-loop test now checks Orla's guidance line and passed on its own. Screenshots of every stage checked.

## 2026-11-25 09:09 — Walk-in forge, Emberwake, searchable containers, enemy levels
- **PR:** #22 `explorable-forge` · opened 08:06 · merged 09:09
- **Asked for:** a forge you can walk into, things to examine and search, and enemy levels.
- **Done:**
  - Forge roof fixed (both slopes were tilted inward). The chimney rises through the back slope.
  - The hearth sits against the back wall, with Orla's anvil in front of it, inside.
  - The open front lets you walk in. A loft over the back is reached by a 10-step staircase.
  - The roof, awning and sign hide from the camera while you're inside.
  - Colliders can now be floors (stairs, loft) or overhead. The player falls when walking off an edge.
  - The server's height check now measures from the highest floor within 4 m.
  - **Examine (E):** Orla's masterwork **Emberwake** on the wall, with lore and a hint at a future goal; the watch's sword rack.
  - **Search (E):** three barrel stacks, the loft chest and six hidden trail caches.
  - The server checks search range and height from its own copy of the player's position.
  - Loot is seeded by character, container and search count, so a retry can't re-roll it.
  - Each character has its own copy of each container, refilling after 10, 20 or 30 minutes of play time (`world.containers` in the save, optional).
  - Enemy levels: "Lv N" above enemies from 28 m. Scavenger 1, Sentinel 2, Warden 4 (ELITE). Coloured against your rank.
- **Not done / deferred:**
  - The other buildings aren't enterable; the cottages are the partner's models (ticket AF-015).
  - Upgrading assets with Meshy (paid credits, partner's area). Later done in #26 with the owner's approval.
  - The adaptive world and raids. The adaptive world part 1 followed in #24.
  - Making the forge screen easier to learn (done next, in #23).
- **Verified:** typecheck, build pass. `npm test` 215/215. `npm run test:e2e` 16/16, with a new test for Emberwake, the barrels and "Lv 1". Screenshots checked.
- **Notes:** The anvil position is overridden at load, because the baked scene file must not be edited by hand. Protocol only adds a `search` intent.

## 2026-11-25 06:49 — Fix the pause menu opening after closing a menu with Esc; steadier browser tests
- **PR:** #21 `reliable-tests` · opened 2026-11-24 23:05 · merged 06:49
- **Asked for:** fix the pause menu popping up after closing a menu, and steady the flaky browser tests.
- **Done:**
  - Closing a menu with Esc re-grabs the mouse; the browser could release it a moment later, which the game read as "Esc while playing". Mouse releases within 0.6 s of the grab no longer open the pause menu. A real Esc still pauses.
  - Movement test: walk until 2 m are covered (up to 6 s) instead of a fixed 1.2 s.
  - Full-loop test: press E again at Orla if a slow frame missed it.
- **Not done / deferred:** The "talk to Orla" flake is not fixed. The cause wasn't found; it only got rarer.
- **Verified:** typecheck passes. Movement and full-loop tests alone 3/3. Full suite runs: 15/15, then 14/15 three times, then 15/15 three times in a row.

## 2026-11-25 06:48 — Server-side height check: no flying or sinking
- **PR:** #20 `height-check` · opened 2026-11-24 22:36 · merged 06:48
- **Asked for:** finish the movement checks from #13 by also checking height.
- **Done:**
  - A reported position must be within 1.6 m above and 1 m below the terrain (a jump peaks about 1 m up). Rule: `heightOk` in `packages/game-rules/src/movement.ts`.
  - The server uses the same deterministic `terrainHeight` as the browser.
  - A refused height is handled like a speed violation: the browser is sent back to the last accepted spot.
  - Refusals are counted in `WorldStats.heightRejected`. `docs/server-authority.md` updated.
- **Not done / deferred:** Nothing.
- **Verified:** `npm test` 206 passed (new: a jump is accepted, flying 12 m up and sinking 8 m down are refused). Build passes. `npm run test:e2e` 15 passed (these don't exercise the check, since the test server allows teleports). End to end with checks on: sprinting, jumping and dodging from the village to the quarry gave 0 corrections; a position 25 m in the air was corrected.

## 2026-11-25 06:48 — A proper forge building at the anvil
- **PR:** #19 `forge-building` · opened 2026-11-24 22:30 · merged 06:48
- **Asked for:** "a visually appealing forge building instead of just a stall". The forge used the Model Workshop's plain `forge_hall` shed.
- **Done:**
  - A smithy built in code (`apps/web/src/world/ForgeBuilding.ts`) at the same spot, facing and collider box, so the anvil, Orla, interactions and collisions are unchanged.
  - Stone plinth and lower walls, half-timbered upper walls, an open front on braced posts, a steep shingled roof, an awning over the anvil.
  - A tall stone chimney with smoke and embers; a stone hearth with glowing coals under an iron hood. The fire light now sits in the hearth.
  - Props: bellows, quench trough, weapon rack with three swords, coal pile, grindstone, tongs and hammer, two lanterns, a hanging "Emberhold · Forge" sign.
  - Textures drawn on canvases at start-up, so no image files. Recorded in `ASSET_PROVENANCE.md`.
- **Not done / deferred:** This is world art, the partner's area. It's built so a modeled forge can replace it later.
- **Verified:** typecheck, build pass. `npm test` 205 passed (one run alongside a preview server reported 199/205; failing tests weren't captured; three clean runs since gave 205/205). `npm run test:e2e` 15 passed. Checked visually from four angles.

## 2026-11-24 21:51 — Herbs and potions; force-close replaced connections; name-box fix
- **PR:** #18 `herbs-potions` · opened 21:50 · merged 21:51
- **Asked for:** something for Herbalism to gather, and a first piece of alchemy.
- **Done:**
  - **Emberleaf**, a new herb, in 16 patches along the trail. Placement is deterministic, so every browser and the server agree.
  - Picked by hand (no tool), with a rustle and leaf motes. Trains Herbalism. Shows as orange dots on the minimap.
  - **Healing Salve** (2 Emberleaf, heals 60–120, key 5) and **Stamina Tonic** (3 Emberleaf, 50–90 stamina, key 6).
  - Potions stack; quality is the average of the herbs used, best first.
  - Brewing on the Inventory screen's new Alchemy section (Brew 1 / Brew 5, Use). Bram sells Healing Salves for 8 coins.
  - One potion per 8 s of play time, so the server enforces it for signed-in players.
  - HUD potion slots 5 and 6 with counts and a cooldown sweep.
  - **Fix:** a replaced connection (second-device sign-in) never finished closing through Render's proxy. It's now cut after 2 s.
  - **Fix:** the title-screen redraw could append a typed name to the old one. The redraw now moves the same name box into the new title.
  - **Fix:** the minimap's "nearby only" filter from #15 compared against 60² and still drew every node. It now shows only nodes within 60 m.
- **Not done / deferred:** Health and stamina stay browser-owned; the rules decide the amount and the browser applies it.
- **Verified:** `npm test` 205 passed. Build passes. `npm run test:e2e` 15 passed, including a new herbs-and-potions test. Account and two-player tests passed 3/3 after the name-box fix.

## 2026-11-24 20:38 — Combat skills: learned at mastery milestones, used from a 1-4 skill bar
- **PR:** #17 `skills` · opened 20:33 · merged 20:38 · built on #15 and #16
- **Asked for:** combat skills, per the owner's choices: unlocked at weapon mastery milestones, used from a skill bar on keys 1–4.
- **Done:**
  - **Lunging Thrust** (Longsword 3): a 4 m piercing lunge, ×1.6, 6 s cooldown, 4 stamina.
  - **Final Slash** (Longsword 6): a slow heavy finisher, ×3.0, ×1.5 more on staggered enemies or ones below 30% health, 15 s cooldown, 7 stamina.
  - Skills are learned automatically at the mastery level, with a "New skill · key N" notice, and go into the first free bar slot.
  - A skill needs its weapon family in hand.
  - The Skills screen shows unlock levels and lets you put a skill on keys 1–4 or take it off.
  - HUD skill slots with name, stamina cost, cooldown sweep and an in-use highlight.
  - Effects: a blue thrust trail; a wide ember arc, shockwave ring and camera shake.
  - Server: the bar only changes through a `skillbar` action. Unlearned skills or the wrong weapon are refused. Every cooldown attack is limited to one use per cooldown, with 1 s of slack. Finisher damage is computed on the server.
- **Not done / deferred:** Dedicated animations. Both skills reuse the light-3 and heavy clips until new ones exist (partner's area).
- **Verified:** `npm test` 199 passed. Build passes. The new skills browser test passes. Last two full e2e runs: 13/14 each (full loop out of time on the Warden, before the budget increase; then the movement-distance timing flake).
- **Notes:** Browser tests now run silent (`?noaudio`) except the boot test. With audio on, the scripted Warden fight failed 2 of 3 runs on this machine; with it off, 3 of 3 passed. The Warden fight's attack budget rose from 500 to 900 inputs.

## 2026-11-24 20:38 — Music, sound effects and gathering effects; fix the title-screen name race
- **PR:** #16 `audio` · opened 20:09 · merged 20:38 · built on #15
- **Asked for:** music and sound, with four tracks from the owner's Aitubo library (downloaded with the owner's OK).
- **Done:**
  - Music by situation: Mossheart Village in Emberhold, Whispering Grove elsewhere, Goblin Banner Run in combat, Forge Warden for the boss.
  - Tracks stream and crossfade over about 2 s. Combat and boss music restart; town and wilds resume.
  - Each track loudness-normalised to −16 LUFS, 96 kbps MP3, metadata stripped. Recorded in `ASSET_PROVENANCE.md`.
  - Sound effects synthesized in code (`GameAudio.ts`), no files: combat, gathering, crafting, level-up and UI sounds.
  - Visual effects: wood chips, a leaf-and-dust burst and camera shake when a tree falls, mining sparks and rock chips, cyan glints from ironglass, a golden level-up ring.
  - Music and sound volume sliders in the pause menu.
  - **Fix:** a guest name typed while the title screen redrew could be lost. This caused the frequent two-player test failure.
- **Not done / deferred:** How it sounds was not verified; it needs a human listen. The owner should check none of the four tracks has vocals.
- **Verified:** `npm test` 189 passed. Build passes; music files are in `dist/audio/music`. `npm run test:e2e` 13 passed; the two-player test passed 3 times in a row after the name fix. In a headless browser: town theme plays, combat music takes over, no console errors.

## 2026-11-24 20:38 — Every ironwood tree is choppable; trees fall over, ore shrinks per gather
- **PR:** #15 `gather-feel` · opened 19:28 · merged 20:38
- **Asked for:** the owner noticed most ironwood trees couldn't be chopped (291 trees, 4 nodes). Also asked for trees to fall over and disappear, and for ore to shrink as it's mined.
- **Done:**
  - Every ironwood tree in the scenery is now a node, with stable ids `wood-g<n>`.
  - Node state is stored only once a node has been gathered, and old saves are tidied on load, so saves stay small with 300+ nodes.
  - Trees shake on each chop, fall over on the last one, sink away leaving a stump, and grow back on respawn.
  - Grove trees animate their own instance in the bulk-drawn scenery, with no extra draw calls.
  - Ore and ironglass shrink a step per gather, squash on each hit, and go dark when depleted.
  - The minimap was meant to show only nodes within 60 m (it was drawing all 322).
- **Not done / deferred:** Nothing stated.
- **Verified:** `npm test` 189 passed. Build passes. `npm run test:e2e` full run 11 passed, 2 failed: the full loop (known pause-menu flake; passed the next 2 runs) and the character window (a missed gather key; the test now retries; it then failed twice without the error captured, then passed 5 times in a row). Checked visually in a headless browser.
- **Notes:** The 60 m minimap filter had a bug and still drew every node; fixed in #18.

## 2026-11-24 18:52 — Full-screen character screens; proficiencies separate from skills
- **PR:** #14 `character-screens` · opened 18:46 · merged 18:52
- **Asked for:** the character window rebuilt as full-screen screens in the style of the owner's mockup.
- **Done:**
  - A top bar with the brand, your name, tabs and coins; dark panels with ember and gold trim.
  - **I** opens Character and closes the window. Tabs or **Q / E** switch screens. O and U are gone.
  - **Character:** name, level and XP bar, a live 3D model of your character with the equipped weapon (drag to turn), 14 equipment slots, attributes, stats and records.
  - **Inventory:** item grid, materials and lots, and item details with Equip/Unequip and Discard.
  - **Proficiencies** (new): weapon masteries, blacksmithing, mining, woodcutting, herbalism.
  - **Skills:** combat abilities only, with key, damage, cooldown and description.
  - Gathering proficiencies: 5 XP per gather, levels 1–100, +1% extra-unit chance per level. Awarded by the server.
  - Icons are inline SVG. The 3D view has its own small renderer; the screen works without WebGL.
- **Not done / deferred:**
  - No herbs in Emberhold yet, so herbalism stays at level 1 (herbs added in #18).
  - Armor on the portrait waits for the partner's armor models.
- **Verified:** typecheck, build pass. `npm test` 180 passed. `npm run test:e2e` 12 passed, 1 failed (full loop: the Warden wasn't killed within the attack budget; passed on 2 reruns). Checked in a browser at 1280×720.

## 2026-11-24 18:48 — Server-side movement speed check
- **PR:** #13 `speed-check` · opened 18:21 · merged 18:48
- **Asked for:** the next step of server authority: check that reported positions are possible.
- **Done:**
  - Each player has a distance budget refilling at 8.5 m/s (just above sprint and dodge), banking up to 12 m for lag spikes.
  - Too far: the server keeps the last accepted position and sends a `correct` message (at most twice a second); the browser snaps back.
  - Allowed: respawning, and a signed-in player's first position within 5 m of the saved spot.
  - The test world server sets `ALLOW_TELEPORT=1`; a hosted server ignores it, and the server warns when the check is off.
  - Movement speeds moved into `@alloy/game-rules` so client and check share them.
- **Not done / deferred:** Height (flying), because the server would need terrain heights. Done in #20.
- **Verified:** typecheck, build pass. `npm test` 185 passed. `npm run test:e2e` 12 passed, 1 failed (two-player test, known guest-name race; passed on rerun). End to end: 34 m of sprinting and dodging gave 0 corrections; a 50 m teleport gave 1 correction.

## 2026-11-24 18:00 — Weapon families and damage types: resistances and mastery per family
- **PR:** #12 `damage-types` · opened 17:42 · merged 18:00
- **Asked for:** combat ready for the partner's weapon families. Damage types were the backlog's first step toward an adapting world.
- **Done:**
  - Damage types slash, pierce, blunt and magic. Each family has a default (longsword, short sword, axe, greatsword, mace, dagger, staff, bow); blueprints can override it. Fists are blunt.
  - Enemy resistances after defense: Scavenger, Quarry Sentinel and Foundry Warden each have their own. Starter quest balance is unchanged.
  - Hits show "WEAK SPOT" or "RESISTED".
  - Mastery per weapon family. Unarmed hits give no weapon XP (before, they counted as longsword).
  - The HUD shows the family in hand; the Skills tab lists trained and untrained families.
  - The server counts damage by type and family (`WorldStats.damageByType`, `damageByFamily`).
- **Not done / deferred:**
  - Distinct movesets, and bows and staffs that shoot. They need animations and projectiles; every family uses the longsword moveset (ticket AF-018).
  - The damage tallies aren't stored between restarts.
- **Verified:** typecheck, build pass. `npm test` 178 passed. `npm run test:e2e` 12 passed, 1 failed (full loop: Orla's dialog didn't open; passed on 2 reruns).

## 2026-11-24 16:49 — Equipment slots and gear mechanics
- **PR:** #11 `equipment-slots` · opened 16:37 · merged 16:49
- **Asked for:** the mechanics side of equipment, ready to plug into the partner's item-generation algorithm.
- **Done:**
  - `docs/equipment-contract.md`: the interface between the two (where an item goes, what its stats mean).
  - 14 slots, from Head to Tool. Equip/unequip goes through the shared rules, so the server checks it.
  - Rules: each item in its own slot, rings fill the first empty ring slot, two-handed weapons keep the off-hand empty, equipped items and your last tool of a kind can't be discarded.
  - Tampered equipment layouts are rejected on load.
  - Armor `defense` reduces incoming hits; gear `bonuses` add health, stamina and attributes.
  - Tools are required for ore, ironglass and ironwood. Pressing E at a node equips the right tool first. Better tools can give an extra unit.
  - Every character gets a worn pickaxe and hatchet.
  - Small item-gen changes in the partner's area: optional `equip`, `defense` and `bonuses` fields, an `ItemFamily` type, two placeholder tool blueprints.
  - **Fix:** PR #10's window styles were global and stretched the HUD ability bar, which covered the Forge button. Now scoped under `.charwin`.
- **Not done / deferred:** The starter tools are placeholders for the partner's real tools. Armor items themselves don't exist yet.
- **Verified:** typecheck, build pass. `npm test` 173 passed. `npm run test:e2e` 13 passed on the final run (earlier runs hit the style leak and known timing flakes). Checked in a browser with an old guest save.

## 2026-11-24 15:46 — Hybrid attributes, contested enemy stats, and a tabbed character window
- **PR:** #10 `character-screen` · opened 14:58 · merged 15:46
- **Asked for:** attributes that grow by use plus stat points, and one window for character, inventory and skills.
- **Done:**
  - Strength, Dexterity, Vitality and Endurance = trained level (grows by use, 1–30) + allocated points.
  - 3 stat points per adventurer rank, at most 50 in one attribute, free respec for now.
  - Enemies have the four attributes. Stagger, crit chance and how hard their hits land are contested against your totals.
  - One tabbed window (I / O / U): Character, Inventory, Skills.
  - Server: attribute XP only from things it observes; unspent points derived from rank, so they can't drift; `allocate` / `respec` checked.
  - `docs/design-backlog.md` records two ideas: training perks and titles, and an adapting world.
- **Not done / deferred:**
  - Only the main-hand slot worked; the rest said "Coming soon" until armor exists (built in #11).
  - Incoming damage is scaled in the client, because health is client-owned.
  - Perks and titles: backlog only (ticket AF-017).
- **Verified:** typecheck, build pass. `npm test` 163 passed. `npm run test:e2e` 13 passed (the two-player test failed once on an earlier run, then passed). Checked by eye at 1366×800 and 800×600.

## 2026-11-24 14:32 — Tolerate quoted database settings; never log the connection string
- **PR:** #9 `fix-database-url` · opened 14:26 · merged 14:32
- **Asked for:** fix the live deploys. Render's `DATABASE_URL` was saved with quotation marks, so every deploy after PR #1 crashed with `Invalid URL` and Render kept serving the old version. The error also printed the connection string into the deploy log.
- **Done:**
  - `cleanDbUrl()` strips surrounding spaces and one matching pair of quotes.
  - A bad connection string now gives an error that names the setting but never includes its value.
  - A blank or quotes-only setting falls back to the local file store.
- **Not done / deferred:** Outside the code: reset the Neon database password (it appeared in the deploy logs), then update Render and `.env.local`.
- **Verified:** typecheck, build pass. `npm test` 142 passed (3 new). `npm run test:e2e` not run: server startup configuration only.

## 2026-11-23 19:53 — Server-authoritative characters
- **PR:** #8 `server-transactions` · opened 19:49 · merged 19:53
- **Asked for:** the next authority step from PR #1: the server decides what changes a signed-in character, instead of trusting the browser.
- **Done:**
  - For signed-in players the server decides gathering, buying, forging, equipping, discarding, quest progress, kill rewards, weapon XP and hit damage. Guests are unchanged.
  - The character and its rules moved into a shared `packages/session` (`applyAction` checks range, quest step and ownership).
  - Protocol v2: the browser sends `act`; the server replies `actResult` and sends the updated `char`. Old tabs are told to reload.
  - The server loads, keeps and saves characters itself (after changes, on leave, on shutdown).
  - `PUT /api/save` is gone (410). Guest import still works once per account, validated, with coins capped at 1000.
  - Also added `AGENTS.md`, `CLAUDE.md` and `docs/handoff/` (extending #7).
- **Not done / deferred:**
  - A guest save can be edited before import (only coins are capped).
  - Movement is still reported by the browser, so range checks trust it. A speed check was the next step (#13).
  - No browser test for forging or killing as a signed-in player; server tests cover both.
- **Verified:** typecheck, build pass. `npm test` 139 passed (19 new). `npm run test:e2e` 12 passed, including a new cheat test.

## 2026-11-23 18:54 — Add AGENTS.md and the handoff process (closed without merging)
- **PR:** #7 · opened 18:54 · closed without merging
- **Asked for:** instructions for AI coding agents, so Codex or another Claude session can pick up where the last one stopped.
- **Done (on the branch):** `AGENTS.md` (project, ownership, commands, hard rules), `CLAUDE.md` pointing to it, and `docs/handoff/README.md` listing tasks in progress. Documentation only.
- **Not done / deferred:** Not merged on its own. PR #8 says its branch extends #7, and the same files shipped with #8.
- **Verified:** No tests stated (documentation only).

## 2026-11-23 15:46 — CI: remove browser-test workarounds that didn't help (closed without merging)
- **PR:** #6 · opened 15:46 · closed without merging
- **Asked for:** a follow-up to #2: remove the CI-only workarounds that didn't make browser tests reliable on GitHub's GPU-less runners.
- **Done (on the branch):** removed half device scale, the CI-only low graphics preset and the full-Chromium channel. Kept the Linux-safe GPU flags, Playwright's own browser in CI and the empty database settings.
- **Not done / deferred:** Not merged. The sources don't say why.
- **Verified:** No tests stated. The browser-test job is informational.

## 2026-11-23 14:35 — Add GitHub Actions CI
- **PR:** #2 `add-ci-workflow` · opened 2026-11-21 15:50 · merged 14:35
- **Asked for:** run the checks automatically on every pull request into `main` and every push to `main`.
- **Done:**
  - `.github/workflows/ci.yml`: a checks job (`npm ci`, typecheck, `npm test`, build) and an e2e job that uploads the Playwright report on failure. Ubuntu, Node 22, no secrets.
  - The e2e job is informational (`continue-on-error`), because GitHub's runners have no GPU. Typecheck, tests and build stay blocking.
  - CI uses Playwright's full Chromium (new headless); the default headless shell didn't deliver enough frames.
  - `playwright.config.ts`: bundled Chromium in CI, Windows GPU flags only on Windows, `DATABASE_URL: ''` for the test world server.
  - README says PRs run the checks.
- **Not done / deferred:** Browser tests don't block merges; CONTRIBUTING.md asks for local e2e runs before gameplay or UI merges.
- **Verified:** No test counts stated. No game code changed.
- **Notes:** Commits on 2026-11-21 tried half device scale and the low preset in CI; a later commit (2026-11-23 10:11) made the job informational.

## 2026-11-23 09:47 — Player accounts with server-side saves (Neon Postgres) + A/D fix
- **PR:** #1 `player-accounts` · opened 2026-11-21 15:47 · merged 09:47
- **Asked for:** accounts, so a character can be continued from any computer or browser.
- **Done:**
  - Title screen: Sign in / Create account, Continue, New character, and a one-time import of the browser's guest character.
  - Guests still play, saved in the browser only, and show as `Name (guest)`.
  - One device at a time: signing in elsewhere returns the first device to the title screen.
  - Neon Postgres (free plan) through `node-postgres`; local file fallback without `DATABASE_URL`.
  - Passwords stored only as salted scrypt hashes; sign-in tokens random, stored as SHA-256 hashes, 30-day expiry.
  - Sign-in attempts limited per address; 5 wrong passwords lock the account for a minute. Calls from other websites refused.
  - Every upload checked with the game's own save validation; a revision number refuses stale writes.
  - The save format moved into `packages/save`, shared by browser and server.
  - **Fix:** A and D strafing were swapped.
- **Not done / deferred:** Crafting results and combat damage were still calculated in the browser (done next, in #8). The two Render environment variables had to be added by the owner before merge.
- **Verified:** `npm test` 114 passed (16 new). `npm run test:e2e` 10 passed in Chrome. Checked against the real Neon database through the running server; test data removed afterwards.
- **Notes:** The partner's PRs #3–#5 (character models, the Emberhold world, an A/D fix) were merged into this branch on 2026-11-23 08:15 before it merged.

## 2026-11-21 14:28 — Shared world, README and contributing rules
- **Commits:** `622d168` 14:23 · `e38d611` 14:24 · `ff2360f` 14:27 · `8425168` 14:28 (no PR)
- **Asked for:** one shared world that everyone who opens the link joins.
- **Done:**
  - New `@alloy/world` package: layout, terrain, colliders and `EnemySim`, shared by browser and server.
  - World server (`worldRoom`, `worldServer`, `worldMain`): serves the game and a `/world` WebSocket on one address.
  - The server runs every enemy, validates hits (reach, rate, caps), shares kill credit among everyone who hit in the last 30 s, and respawns enemies.
  - It checks page origin, cleans names and drops dead connections.
  - The browser finds the world automatically and joins with no code. Other players show with name tags, health, weapon and animations. Offline fallback.
  - Title-screen name field, online status pill, player markers on the minimap.
  - The Vercel copy of the game may join the hosted world.
  - Merged the shared repository's initial commit; added README, CONTRIBUTING, asset rules and `ASSET_PROVENANCE.md`.
  - **Fix:** offline enemies now respawn after death.
- **Not done / deferred:** Nothing stated.
- **Verified:** 9 world-server tests over real sockets and a two-player Chrome test, as stated in the commit message.

## 2026-11-21 13:54 — First session: rule packages, Three.js client, network proof
- **Commits:** `d38edb7` 10:04 · `8076306` 10:29 · `56659e2` 12:32 · `190b4b5` 13:51 · `fd22560` 13:54 (no PR)
- **Asked for:** the first vertical slice, "The First Forge" (tickets AF-001 to AF-008).
- **Done:**
  - Pure TypeScript rule packages with tests:
    - `game-rules`: long-duration stamina, longsword combat state machine, enemy AI, progression, quest.
    - `item-gen`: seeded item generation, the GDD mastery and buffer formulas, rating, rarity, imbuement.
    - `crafting`: atomic, idempotent inventory and forge transactions, and the masterwork hammer puzzle.
    - `protocol`: versioned commands and validation.
  - A Three.js client: the First Forge region, combat, forge UI, quest and save.
  - A network proof, session and save tests, Playwright browser tests and balance fixes.
  - The quest tracker shows live gather progress (3/5-style counts), with a regression test.
  - The hammer stage explains stress, spread and focused strikes, overwork and the quality formula, and shows the live damage multiplier.
  - Debug hooks locked to localhost; a playtest guide added.
- **Not done / deferred:** Nothing stated.
- **Verified:** The commit for `190b4b5` says the full Playwright run passed 5/5. Other commits state no counts.
