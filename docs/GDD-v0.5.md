# Alloy Frontier: Game Design Document v0.5

> **Updated by [GDD v0.6](GDD-v0.6.md)** (27 Nov 2026): raids, the wider forge, found blueprints and the
> proficiency tree. This document stays as the record of v0.5.

**Implementation results and next tickets.** An update to *MMORPG GDD v0.4: Browser-First
Development Blueprint* (21 Nov 2026).

GDD v0.4 section 14.3 said what v0.5 should do: record the prototype results, turn the
architecture into issue-ready tickets, and update the forge interface and balance records. This
document does that.
- Everything v0.4 says and this document doesn't change stays in force: identity, world, pillars,
  progression layers, the full crafting vision, and the long-term systems.
- Section numbers like "v0.4 §5.5" refer to v0.4.

Status words as in v0.4: **CONFIRMED** (director decision), **ACCEPTED** (endorsed direction),
**PROVISIONAL** (agreed approach awaiting tests), **PROPOSED** (needs validation). Added here:
**BUILT** (in the live game, with tests).

---

## 1. Where the project stands

| v0.4 gate (§8) | Exit test | Result |
| --- | --- | --- |
| M0: Alignment | Both partners run the scaffold; first hosted build | **Passed.** Repo, CI, asset provenance, live build. |
| A / M1: Combat proof | §8.2 criteria 1–6 | **Passed.** Unit tests cover attack, block, dodge, telegraphs, stamina, and no double hits (`SwingTracker`). |
| B / M2: Crafting proof | §8.3 criteria 1–6 | **Passed.** Deterministic forge transactions, replay and dupe tests, generated stats feed combat. |
| C: Network proof | Two-player authoritative room, reconnect, validation | **Passed, then extended** into the live shared world (§3). |
| D / M3: The First Forge | §8.4 criteria 1–6 | **Passed.** The automated full-loop browser test plays new game → quest summary. |
| M4: Quality | §8.5 criteria 1–6 + sign-off | **In progress.** Criteria and evidence: [M4.md](M4.md). |

**Tickets AF-001 to AF-009 (§14.1) are all done.** AF-007 was met with the project's own
authoritative WebSocket server instead of Colyseus (decision D2 below).

**The slice went past its own scope.** v0.4 §5.5 excluded dedicated servers, a persistence
backend, alchemy and multiple weapon families from the slice. All of these are now built, as
foundations. Each was added only after the core loop passed its gate, so it stays within §5.6
change control.

**v0.4 §12 success criteria:**
- **Met in the build:** 1–9. The world is coherent and connected; there's a longsword moveset;
  skill and equipment win fights; you gather while exploring; crafting is understandable, with a
  meaningful specialization, a visible effect, the final challenge, and save/resume.
- **Waits for human playthroughs:** 10 (finishing and wanting more). See M4.

---

## 2. Decision register additions (v0.5)

| ID | Area | Decision | Status |
| --- | --- | --- | --- |
| D1 | Slice mode | The First Forge is played in **one shared online world**: everyone who opens the link plays together. Offline guest play remains. Replaces v0.4 §5.1 "standalone, single-player". | BUILT |
| D2 | Multiplayer | **Our own Node.js + WebSocket server** (`apps/server/worldRoom.ts`) instead of Colyseus. It runs the enemies, hits, rewards and checks. Revisit Colyseus only for multi-room scaling. | BUILT; PROVISIONAL for the MMO |
| D3 | Hosting | **Render (free web service) + Neon (free Postgres)** instead of Railway. Auto-deploys from `main`. Resolves v0.4 §11 item 8 for the prototype; cost review required before any paid tier. | BUILT; PROVISIONAL |
| D4 | Persistence | **Accounts and server-owned characters**: sign-in tokens and hashed passwords in Postgres; the server decides crafting, inventory, rewards and damage for signed-in players (`docs/server-authority.md`). **Two character slots per account**, each with its own **character name** (unique, separate from the account name, shown to other players). Deleting one needs a typed confirmation and keeps a trash copy on the server. | BUILT |
| D5 | Authority | Clients send intents only. Server checks: range, height, speed (`MoveGuard`), cooldowns, quest gates, idempotent forge transactions, seeded loot. | BUILT |
| D6 | Progression | Hybrid **attributes** (trained by use + stat points per adventurer rank), contested against enemy attributes (`docs/attributes.md`). | BUILT; tuning PROPOSED |
| D7 | Professions | **Proficiencies** (mining, woodcutting, herbalism, blacksmithing) are separate from combat **skills** (unlocked by weapon mastery, on a 1–4 bar). | BUILT |
| D8 | Damage | **Weapon families and damage types** with enemy resistances and per-family mastery (`docs/damage-types.md`). Groundwork for v0.4's "multiple weapon families". | BUILT (longsword content only) |
| D9 | Equipment | Full **equipment slots** and tools (`docs/equipment.md`), ready for the partner's equipment generator. | BUILT |
| D10 | Alchemy (narrow) | One herb (Emberleaf) → healing salve and stamina tonic, brewed from the Inventory and used with keys 5 and 6. A narrow first piece of v0.4 §4.16; not the full tree. | BUILT |
| D11 | Adaptive world (part 1) | The server **observes** each area (fading tallies) and raises enemy levels while players ranked well above the area farm it (`docs/adaptive-world.md`). Damage-type adaptation (design backlog §2) comes later. | BUILT |
| D12 | Enemy level | Each enemy shows its level, coloured against the player's adventurer rank: Scavenger 1, Sentinel 2, Warden 4. Levels scale health, damage, defense and rewards. | BUILT |
| D13 | Assets | **Authored models generated with Meshy** (image → 3D, game-ready topology), optimized by `tools/asset-pipeline/meshy.mjs`. They replace placeholder forge props and area scenery. Provenance is recorded per model. Commercial rights depend on the Meshy plan: **confirm before a public release**. | BUILT; licence check open |

---

## 3. What the slice contains now

v0.4 §5.4 required content, as built:

| v0.4 requirement | Built |
| --- | --- |
| One humanoid protagonist | Two selectable characters (Maria, Exo Gray), seen by other players |
| Longsword; comparative master-forged quality; optional one item ability | Longsword with Quick and Masterwork forging; Storm Arc imbuement (the stretch goal); two learnable skills (Lunging Thrust, Final Slash) |
| One melee, one construct, one elite enemy | Ironwood Scavenger, Quarry Sentinel, Foundry Warden (elite, two phases) |
| Three gatherables; one procedural deposit | Iron ore, ironwood, ironglass with procedural deposit traits (the stretch goal); plus Emberleaf herbs |
| Three weapon recipes | Iron, Tempered Steel and Ironglass Longsword |
| Quick Forge + puzzle Masterwork + buffer | Built. The forge screen was redesigned to the mockup, with step-by-step guidance (see §4) |
| Inventory, equipment, comparisons | Full-screen Character / Inventory / Proficiencies / Skills screens; equipment slots; comparisons everywhere |
| Blacksmith, merchant, quest giver | Orla (blacksmith and quest giver) and Bram (merchant) |
| One quest chain | "The Edge You Make", 10 steps |
| HUD, inventory, forge, tracker, comparison | All built; enemy level plates; minimap |
| Small mastery gains | Weapon mastery per family, blacksmithing mastery, proficiencies, adventurer rank |
| One continuous region | Emberhold Village → Ironwood Trail → Ironglass Quarry → Dormant Foundry, one map, no loading |
| Local save, reliable restart | Local save for guests; server-side save for accounts |

**Additions beyond the slice:**
- **The forge:** walk in, with a loft and stairs, and examine Orla's masterwork Emberwake.
- **Searching:** barrels, the loft chest and six hidden trail caches. The loot is per character,
  rolled by the server.
- **Feedback:** music and sound effects; trees fall when felled and ore shrinks as it's mined.
- **Performance tools:** the in-game performance report (Esc menu) and the build version on screen.

---

## 4. Forge interface (updates v0.4 §7.3)

The forge screen follows the team mockup.
- **Left column:** blueprints, materials with quality, blacksmithing mastery.
- **Centre:** Quick and Masterwork tabs; the blade on an anvil; the step track (Prepare → Heat →
  Hammer → Temper); then the controls for the current step.
- **Right column:** the projection against the equipped weapon (▲ better / ▼ worse), the quality
  breakdown, "same steel, different hands", and what the forge consumes.

Changes made because of playtest feedback ("slightly overwhelming at first"):
- **Orla's guidance:** one plain sentence per step on what to do and why. Highlighted for new
  smiths; it can be hidden.
- **Tooltips:** every number explains itself on hover; the formulas live there, not on the page.
- **Hammering feedback:** strike buttons say what they do, strikes left show as pips, and struck
  cells flash with sparks (a red shake on a wasted strike).
- **No scrolling:** the screen is laid out at a fixed size and scaled to the window, so nothing
  ever scrolls.

**Still open:** "understandable at first use" will be confirmed or refuted by the M4 playthroughs
(question F2).

---

## 5. Balance records (v0.4 §14.3 "measured balance worksheets")

All numbers live in `packages/` and are covered by unit tests. Current values:

**Stamina**
- Sprinting from full lasts about 5 minutes. A test checks it (v0.3 confirmed target).
- Combat drains depend on the action.

**Masterwork quality**
- Damage multiplier ×0.95 at 0% structure quality, ×1.25 at 100%.
- The buffer factor has diminishing returns and never makes the result worse. The "monotonic and
  diminishing" test passes (v0.4 §5.6).
- With the same steel, a novice makes about 26 damage and Master Orla about 54, versus Bram's shop
  steel at 20. That's the v0.3 "20 → 40+" promise, shown in the forge's "same steel, different
  hands" table.

**Enemy levels**

| Enemy | Level | Health | Notes |
| --- | --- | --- | --- |
| Scavenger | 1 | 90 | |
| Sentinel | 2 | 210 | |
| Warden | 4 | 760 | elite |

Each level above an enemy's own adds:
- health +30%, damage +15%, defense +10%, poise +15%;
- +1 to each attribute;
- XP +35%, coins +25%.

**Area pressure (adaptive world)**
- A player counts as over-levelled for an area at more than 2 ranks above its level.
- Every 900 pressure raises the area one level, up to +3.
- Tallies halve every 20 minutes.

**To tune with real players:** combat damage values, potion strength, loot tables and adaptive
thresholds.

---

## 6. Next tickets (issue-ready)

Continuing v0.4's numbering. Ordered by the recommended sequence; each lands as its own PR.

| ID | Ticket | Pass criterion | Needs |
| --- | --- | --- | --- |
| AF-010 | **M4 close-out**: 3 human playthroughs, a report from each partner's machine, sign-offs, `v0.1.0` tag | Every row in `docs/M4.md` filled; release published | Both partners |
| AF-011 | **Raid on Emberhold**, adaptive world part 2: watchtower lookout, 5–10 raiders and a Raider Captain, scaled to players in town; win or lose outcomes | A raid triggers, plays out and resolves on the live server; tested in the world room | **BUILT** (#34): rules approved 2026-11-27; off on the live server until `RAIDS=1` is set ([raids.md](raids.md)) |
| AF-012 | **Protection fee**: after a lost raid, a daily tribute in coins or forged items until the Captain is defeated; tribute gear strengthens the raiders | Fee charged and stopped correctly; raiders' gear visible; persists across restarts | AF-011; tallies saved to Postgres |
| AF-013 | **Saved world state**: observer tallies and area levels kept in Postgres | They survive a server restart; free-plan limits respected | **BUILT** (#31): one row, written at most once a minute while players are on ([adaptive-world.md](adaptive-world.md)) |
| AF-014 | **Performance pass**: lower-detail trees and cliffs, shadows from distant scenery off on medium | Target machines hold 60 FPS average with steady 1% lows on medium | Target-machine reports (AF-010) |
| AF-015 | **Enterable cottages**: interiors and stairs, as in the forge | Walk in and up a floor; server height check accepts it | The partner's agreement (their models) |
| AF-016 | **Emberwake goal**: a quest or mastery milestone to forge a blade worthy of Emberwake | Reachable after the main quest; tested end to end | Design |
| AF-017 | **Perks and titles** (design backlog §1) | Perks awarded by the server; titles visible to other players | Design |
| AF-018 | **Movesets and ranged attacks** for further weapon families | A second weapon family playable | The partner's weapons and animations |
| AF-019 | **Password recovery** | Reset by email | An email service: new infrastructure, owner approval |

---

## 7. Open decisions (updates v0.4 §11)

- **Resolved for the prototype:** item 8 (hosting and persistence): Render + Neon (D3).
- **Still open:** items 1–7, 9 and 10 of v0.4 §11. Plus:
  - **Raid rules:** trigger, size, outcome, fee (AF-011, AF-012).
  - **Target hardware for the 60 FPS goal:** each partner's machine is the working assumption.
  - **Meshy commercial licence:** confirm before any public release.
  - **The partner's Model Workshop scene and the authored models:** which scenery the partner
    keeps authoring, and which comes from the Meshy pipeline.
