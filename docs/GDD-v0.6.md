# Alloy Frontier: Game Design Document v0.6

**Crafting depth, raids and the proficiency tree.** An update to [GDD v0.5](GDD-v0.5.md) (25 Nov 2026), written
27 Nov 2026.

v0.5 recorded the vertical slice and listed the next tickets. Since then the team has built the first raid, a
wider forge, found blueprints and the proficiency tree. This document records those results, the design
decisions behind them, and what comes next.
- Everything v0.5 (and v0.4 through it) says that this document doesn't change stays in force.
- Section numbers like "v0.5 §2" refer to v0.5.

Status words as in v0.5: **CONFIRMED**, **ACCEPTED**, **PROVISIONAL**, **PROPOSED**, **BUILT** (in the live
game, with tests). Added here: **STAND-IN** (built so the rest can work, to be replaced by the owner's version).

---

## 1. Where the project stands

- **M4 (quality gate):** still in progress ([M4.md](M4.md)). The technical director has signed off builds and
  measured performance (27 Nov). Still needed: the creative director's performance report and sign-off, the
  three human playthroughs, then the `v0.1.0` tag.
- **Since v0.5, built and live:** pull requests #30 to #42.

| Area | What | PR |
| --- | --- | --- |
| Team process | A dev log per contributor; a to-do list for people (`docs/NEEDED.md`) that every AI agent raises first | #30, #33 |
| World | Saved world state (AF-013); raids on Emberhold (AF-011) | #31, #34 |
| Crafting | The forge makes a mace, shields, helmets, chestplates and platelegs; gear looks from the Model Workshop | #36 |
| Blueprints | The blueprint contract, and found blueprints (drops, scrolls, learning, forging) with a stand-in generator | #38, #39 |
| Proficiencies | The proficiency tree: three branches with Alchemy; perk choices | #37, #41, #42 |
| Fixes | Forge clicks blocked by a late mouse capture; Bram's shop unreadable; the camera turning on its own | #32, #35, #40 |

---

## 2. Decision register additions (v0.6)

| ID | Area | Decision | Status |
| --- | --- | --- | --- |
| D14 | Raids | **Raids on Emberhold** ([raids.md](raids.md)): readiness from play, a 60 s warning from the watchtower, two waves and the Raider Captain, 5 minutes to win. A win pays a bonus; a loss leaves the Captain camped on the trail. Off on the live server until `RAIDS=1` is set. | BUILT (#34); rules CONFIRMED 27 Nov |
| D15 | Forge families | The forge makes **maces (a second weapon family, blunt), shields, helmets, chestplates and platelegs**, iron and ironglass, beside the longswords ([forge-expansion.md](forge-expansion.md)). Armor gets **defense**, crafted like damage, and armor affixes. | BUILT (#36); numbers STAND-IN for the creative director |
| D16 | Gear looks | **The creative director's Model Workshop generator** makes the 3D looks of forged gear, loaded on demand. Looks only: stats always come from the item rules. Mace in hand, shield on the forearm, helmet on the head; chest and leg pieces don't show yet. | BUILT (#36) |
| D17 | Blueprints | **Found blueprints** ([blueprint-contract.md](blueprint-contract.md)): generated where they're found, with their own rarity, lore, materials, item or set piece, required proficiency and worth. They drop from enemies and are found in containers. | Game side BUILT (#39); generator STAND-IN |
| D18 | Learning | A found blueprint is **learned for good, and the scroll stays**, to sell, trade or give away. A duplicate says "You've already learned this blueprint." | CONFIRMED 27 Nov; BUILT (#39) |
| D19 | Sets | **Set pieces are forged one at a time.** Each piece is its own blueprint, found on its own; pieces of a set share the set's id. | CONFIRMED 27 Nov; set bonuses later |
| D20 | Standard patterns | **The fixed blueprints stay**, as the inherent blueprints learned with blacksmithing levels; finding blueprints opens the unique ones. | CONFIRMED 27 Nov |
| D21 | Proficiency tree | **Three branches** ([proficiency-tree.md](proficiency-tree.md)): **Smithing** (weapons and armor), **Crafting** (jewelry, capes, cosmetics, sets) and **Alchemy** (potions, food, enchanting), each rooted in a gathering proficiency (mining, woodcutting, herbalism). Updates D7. | CONFIRMED 27 Nov (technical director; creative director reviewing); steps 1–2 BUILT |
| D22 | Perks | **A choice of two perks every 10 levels** of a branch; re-picked at Orla's for a fee that doubles. Answers AF-017's perks; titles come later. | BUILT (#42) |
| D23 | Ownership | **Item generation (stats, blueprints, looks) is the creative director's area; mechanics are the technical director's** ([equipment-contract.md](equipment-contract.md), [blueprint-contract.md](blueprint-contract.md)). Where the game needed numbers first, they're marked STAND-IN for him to replace. | CONFIRMED |
| D24 | Camera | **Lock-on is on Tab and T only** (the middle mouse button locked on by accident), and glitched mouse jumps are ignored. | BUILT (#40) |

---

## 3. The creative director's blueprint design and proficiency vote: status

He asked for these on 27 Nov. All three are answered, and most of it is built.

### 3.1 Blueprint generation

| He asked for | Status |
| --- | --- |
| Blueprints with **their own rarity**, from the equipment they specify: rarer materials, rarer items and a higher proficiency make a rarer blueprint | **Built in the format.** Every blueprint has a `rarity` and a `requirement` (branch and level). **The rule that sets the rarity is his:** the stand-in raises rarity with the area's level, and raises materials and level with rarity. His **resource rarity tree** feeds the real rule. |
| A **resource rarity tree** | **Waiting on him.** The contract asks for it as data (`RESOURCE_RARITY`). New resources from it need adding to the game first: a material, where it's gathered, its quality. |
| A chance to be **for a set or an individual item** | **Built.** A blueprint teaches one item; a set piece also names its set (`set: { id, name, pieces }`). The stand-in makes one set per area. |
| **Lore, resources required, item or set type, proficiency required, estimated worth** | **Built**: `lore`, the piece's `materials`, its family and slot plus `set`, `requirement`, `worth`. All shown on the scroll in the inventory. |
| **Generated on the fly** from the area's resources, with a chance of a rarer one | **Built against a stand-in.** The server generates each blueprint where it drops, from the area, the source and the area's level. His generator replaces the stand-in in one file: `packages/item-gen/src/found.ts`. |
| **Dropped from enemies** | **Built:** about 5% of enemies, 50% of elites (the Warden, the Raider Captain). |
| **Found in chests, crates, the environment** | **Built for containers:** chests 30%, trail caches 20%, barrels 2%. Pick-ups in the open world aren't built yet (the `environment` source exists). |
| **Traded** | **Not built.** Scrolls stay after learning so they can be traded later. Selling scrolls to Bram comes first. |
| **Received from quests** | **Not built.** The `quest` source exists; it needs quest steps that give one. |

How it works for a player: a found blueprint is a **scroll** in the bag. **Learn** it in the inventory; the
scroll stays. The forge then lists it under its category, marked **Found**, in its rarity colour. Forged items
keep a sealed copy of their blueprint, so they keep working after the scroll is sold or traded.

### 3.2 The proficiency tree

Proposed as he voted, with gathering as the roots ([proficiency-tree.md](proficiency-tree.md)):

| Branch | Covers | Trained by | Root | Built |
| --- | --- | --- | --- | --- |
| **Smithing** | Weapons and armor | Forging | Mining | Yes (blacksmithing mastery, renamed) |
| **Crafting** | Jewelry, capes, cosmetics, sets | The workbench (to build) | Woodcutting | Level only; nothing trains it yet |
| **Alchemy** | Potions, food, enchanting | Brewing | Herbalism | Yes: brewing gives XP; each level makes stronger potions |

Perk choices are built for Smithing and Alchemy (§5). The perk list is his call.

### 3.3 Before the 18th

| Work | Status |
| --- | --- |
| Proficiency tree: three branches and Alchemy | **Done** (#41) |
| Perk choices | **Done** (#42) |
| Generated blueprints: game side, drops, scrolls, forging | **Done** (#39), against the stand-in |
| **His generator, drop table and resource rarity tree** | **Next, his side** |
| The Crafting branch: workbench and first jewelry and cape recipes | Next, after blueprints |
| Titles; selling scrolls to Bram | Next, small |
| Set bonuses, trading | After the 18th (as planned) |

---

## 4. What the game contains now (additions to v0.5 §3)

- **Weapons:** longswords (iron, tempered, ironglass) and **maces** (iron, ironglass). The mace hits blunt, so
  Quarry Sentinels take extra damage; it uses the sword's moves for now.
- **Armor:** **shields, helmets, chestplates, platelegs** (iron, ironglass). All equipped defense adds up; 100
  defense halves a hit.
- **The forge screen** has five tabs (Swords, Maces, Shields, Helmets, Body). Armor shows defense and is compared
  with the piece already in its slot.
- **Found blueprints:** scrolls from enemies and containers; a Blueprints section in the inventory.
- **Proficiencies screen:** the three branches with their roots and perk milestones.
- **Raids:** the watchtower horn, two waves, the Raider Captain, a banner with the countdown, the Captain's camp
  after a loss.
- **Shared looks:** other players see your mace, shield and helmet, found ones included.

---

## 5. Balance records (additions to v0.5 §5)

All in `packages/`, covered by unit tests. **STAND-IN** values are the creative director's to change.

**Raids** (`packages/game-rules/src/raid.ts`)
- **Readiness:** 1 point per signed-in player per minute, +0.5 per forge, brew or trade in the village. A raid
  starts at 30, with a rank-2+ signed-in player in the village, at least 45 minutes after the last.
- **Size:** 3 raiders + 2 per defender, from 5 to 10, in two waves, plus the Captain. Raider level: the
  defenders' average rank minus 1, from 1 to 4.
- **Winning:** within 5 minutes; a loss also when nobody is in the village for 30 s. Win bonus 20 + 10 per level
  coins, 50 + 25 per level XP; the Captain drops 3 Binding Flux.

**Armor and the mace** (STAND-IN, `packages/item-gen/src/blueprints.ts`)

| Piece | Iron | Ironglass |
| --- | --- | --- |
| Mace | 22 damage, 0.90× speed, 30 stagger | 23 damage, 0.95× speed, 28 stagger |
| Shield | 14 defense | 20 defense |
| Helmet | 8 defense | 12 defense |
| Chestplate | 18 defense | 26 defense |
| Platelegs | 12 defense | 17 defense |

Armor affixes: +8% defense, +12 max health, +10 max stamina, +1 Vitality, +1 Endurance; at mythic, +15% defense
and +20 max health.

**Found blueprints** (STAND-IN, `packages/item-gen/src/found.ts`)
- **Drop chances:** enemies 5%, elites 50%, chests 30%, trail caches 20%, barrels 2%.
- **Rarity** rises with the area's level (and a little in chests). Each rarity tier above Common adds +5% damage
  or +6% defense, +3 required mastery, and more materials.

**Proficiency tree** (`packages/game-rules/src/progression.ts`, `perks.ts`)
- **Alchemy:** 6 XP per potion brewed; +0.4% potion quality per level above 1 (+40% at 100).
- **Perks offered now:**

| Level | Smithing | Alchemy |
| --- | --- | --- |
| 10 | Weaponsmith: forged weapons +5% damage · Armorsmith: forged armor +8% defense | Brewer: potions 15% stronger · Distiller: +1 potion per brew |
| 20 | Flux Saver: 1 less flux · Masterwork Eye: rarer results more often | Quick Hands: potion cooldown −2 s · Herbal Lore: +1 herb per pick |
| 30 | Ironglass Adept: ironglass recipes 3 levels sooner · Steady Hands: masterwork quality +5% | Cook / Enchanter (coming soon) |

- **Re-picking:** 50 coins, doubling each time (at most 6,400).

**To tune with real players** (as in v0.5, plus): raid size and timing, armor and mace values, blueprint drop
rates, perk strengths.

---

## 6. Next tickets (updates v0.5 §6)

| ID | Ticket | Status / needs |
| --- | --- | --- |
| AF-010 | M4 close-out | In progress: the creative director's report and sign-off, 3 playthroughs, the `v0.1.0` tag |
| AF-011 | Raid on Emberhold | **BUILT** (#34). Turning it on live (`RAIDS=1` in Render) is the technical director's call |
| AF-012 | Protection fee after a lost raid | Needs a decision: is the "daily" fee every real day, or a shorter in-game day? |
| AF-013 | Saved world state | **BUILT** (#31) |
| AF-014 | Performance pass | Waits on the creative director's performance report |
| AF-015 | Enterable cottages | The creative director's agreement (his models) |
| AF-016 | Emberwake goal | Design |
| AF-017 | Perks and titles | **Perks BUILT** (#42); titles to build |
| AF-018 | Movesets and ranged attacks | The creative director's weapons and animations. The mace exists; it uses the sword's moves |
| AF-019 | Password recovery | Needs an email service: new infrastructure, owner approval |
| AF-020 | **The real blueprint generator**: `generateBlueprint`, the drop table, `RESOURCE_RARITY` | The creative director. Replaces the stand-in in `packages/item-gen/src/found.ts` |
| AF-021 | **The Crafting branch**: the workbench in the forge, the first jewelry and cape recipes, Crafting perks | **BUILT** (#44): four recipes (two rings, a pendant, a cloak; STAND-IN values), Crafting XP and level gate, Jeweler and Tailor. Not yet: looks on the character, found Crafting blueprints |
| AF-022 | **Selling scrolls** to Bram, at their worth | Small; the technical director |
| AF-023 | **Trading and giving** scrolls (and later items) between players | After AF-022; server-checked ownership |
| AF-024 | **Set bonuses** | After AF-021 and the creative director's set design |
| AF-025 | **Quest-reward blueprints** and blueprints found in the open world | Quest steps and world pick-ups |
| AF-026 | **Armor on the character, phase 2**: chest and leg pieces fitted to Maria and Exo | The creative director's area (fitting from the workshop's body measurements) |
| AF-027 | **Titles** at a branch's top milestone, shown to other players | Protocol field; after AF-017 |

---

## 7. Open decisions (updates v0.5 §7)

- **Resolved since v0.5:** raid rules (D14), blueprint learning, sets, duplicates and the standard list
  (D18–D20), the proficiency tree's shape (D21).
- **Still open:**
  - **AF-012:** what a "day" is for the protection fee.
  - **The creative director's review** of the forge numbers and looks (D15, D16), the proficiency tree and its
    perk list (D21, D22), and the blueprint contract (D17).
  - **Cooking:** under Alchemy (as proposed) or Crafting?
  - **Branch names:** Smithing, Crafting and Alchemy, or names in the setting's voice?
  - **Meshy commercial licence** and **target hardware for 60 FPS**, as in v0.5.
