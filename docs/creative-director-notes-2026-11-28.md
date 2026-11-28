# The creative director's notes on GDD v0.6: answers (28 Nov 2026)

The creative director (cwfreemanj, they/them) reviewed [GDD v0.6](GDD-v0.6.md) on 28 Nov 2026. This document
answers each note. It says what the game does today, what changed because of the note, and a recommendation
where a decision is still open.

**Decided by the notes, now recorded in the GDD:**
- **D21:** the proficiency tree is confirmed.
- **D22:** the perks are approved.
- **D17:** blueprint drop sources are quests, NPCs, enemies, chests and similar places.
- **D19:** set blueprints are rare. The stand-in now makes 1 found armor blueprint in 20 a set piece, down from
  about 1 in 3.

**Their answers to the three open questions (later on 28 Nov):**
- **Estimated stats on scrolls: yes.** Built: a scroll shows "Estimated 24–31 damage" (§4).
- **Materials and equipment paths: the plan sounds good.** Materials have three jobs: gate, scale, flavor. The
  crafting branches (Smithing, Crafting, Alchemy) train the equipment paths; gathering doesn't. Every kind of
  equipment is available to craft, and the crafts for each get more advanced as the branch levels (§6). The
  curve's numbers are still a stand-in for them to set.
- **Trading:** good, but not the main way to get materials; it's one option. Materials come mainly from
  mining, woodcutting, quests and similar (§7).

---

## 1. What is Emberhold?

**Emberhold is the village where every player starts, and the name of the first area.** It holds Orla's forge,
Bram's shop, the watchtower and the cottages.

The area is one continuous map (GDD v0.5): **Emberhold Village → Ironwood Trail → Ironglass Quarry → Dormant
Foundry**. In the code, "Emberhold" is the name of the world built from the Model Workshop bake
(`packages/world/src/Emberhold.ts`).

Only the name and the layout exist. **No lore is written yet**: who founded it, why it's called that, what the
embers are. That story is the creative director's to write, if they want one.

## 2. The raids: who made them?

**Claude did, at the technical director's request.** The raid was ticket AF-011 in GDD v0.5, part 2 of the
"adaptive world": the world reacts to how it's played.

1. Neal asked to start it.
2. Claude wrote the proposal, [raids.md](raids.md).
3. Neal approved the rules on 27 Nov.
4. Claude built it (PR #34).

**How it plays:**
- Village activity slowly builds "readiness".
- When readiness is high enough, the watchtower horn gives 60 seconds' warning.
- Two waves of raiders and the Raider Captain attack Emberhold, scaled to the number of defenders.
- Players have 5 minutes to win.
  - **A win** pays everyone who helped.
  - **A loss** leaves the Captain camped on the Ironwood Trail until someone defeats him.

**Raids are off on the live server.** They start only when `RAIDS=1` is set in Render. Every number is in
`packages/game-rules/src/raid.ts`. A review is welcome: the rules can still change, or the whole idea can.

## 3. Classes of weapons and equipment, and the item rules

### What exists, and what's reserved

| Class | Families built | Families named but not built | Slot |
| --- | --- | --- | --- |
| **Weapons** | Longsword, mace | Shortsword, greatsword, axe, dagger, staff, bow | Main hand |
| **Armor** | Shield, helmet, chestplate, platelegs | — | Offhand, head, chest, legs |
| **Accessories** | Ring, necklace, cape | — | Ring (two slots), neck, cape |
| **Tools** | — | Tool | — |

Smithing makes weapons and armor; Crafting makes accessories (D21). The family list is in
`packages/item-gen/src/types.ts`. Adding a family is cheap. Each new weapon family also needs its moves and
animations (AF-018).

### How an item is made today

Every item comes from a **blueprint**. A blueprint gives:
- the item's family, slot and tier (Iron, Ironglass);
- its base stats (damage, speed and stagger for weapons; defense or bonuses for the rest);
- the materials it needs;
- the proficiency level it needs.

**Crafting turns the base into the item.** Four factors multiply the base stat:

| Factor | What sets it | Range |
| --- | --- | --- |
| **Skill** | The maker's branch level | ×1.0 at level 0, ×1.4 at 20, ×2.1 at 100 |
| **Material quality** | The quality of the gathered materials | ×0.8 to ×1.2 |
| **Craft** | Quick (always ×1.0) or Masterwork (the forge puzzle score) | Masterwork ×0.95 to ×1.25 |
| **Flux** | Extra binding flux | Up to about ×1.03 |

**Rarity is a separate roll**, set by craft, materials, skill and luck. Quick crafts are capped at Uncommon.
Rarity decides the number of affixes, the extra effects. **Rating** is one number that sums up an item's power.

The creative director's note says the crafting process should change the outcome whatever the materials. **It
already does:** the Craft factor and the rarity roll depend on how well the piece was made.

## 4. D17: should a blueprint show estimated stats?

**Today the scroll doesn't show stats.** It shows the rarity, the worth, the item type, the level needed, the
set and the lore. After the blueprint is learned, the forge shows the exact item the player would make with
their current materials and skill.

The note calls this "make or break". **Recommendation: show a range on the scroll**, for example "about 24–31
damage". The range would run from the worst craft to the best craft at the level the blueprint needs.
- **For it:** players can judge, price and trade a scroll before learning it. That matters once trading exists
  (AF-023).
- **Against exact numbers:** a range keeps some gamble, and the maker's skill still matters.

**Answer: yes (28 Nov). Built:** each scroll in the inventory shows "Estimated low–high damage" (or defense),
from the worst craft to the best at the level the blueprint needs, before rarity affixes and perks. One shared
function, `estimateStats` in `packages/item-gen/src/estimate.ts`, uses the same formulas as the forge, and a test
checks that real forged items fall inside the range.

## 5. D17 and D19: where blueprints come from, and how rare sets are

**Sources, as the note lists them:**

| Source | Built? |
| --- | --- |
| Enemies (about 5%) and elites (50%) | Yes |
| Chests (30%), trail caches (20%), barrels (2%) | Yes |
| **Quests** | Not yet (AF-025) |
| **NPCs**, giving or selling blueprints | Not yet: new, added to AF-025 |
| Found in the open world | Not yet (AF-025) |
| Trading and giving between players | Not yet (AF-023) |

These rates are the stand-in's. The creative director's drop table (AF-020) replaces them.

**Set pieces are now rare.** The stand-in used to make about 35% of found armor blueprints a set piece. It now
makes 5% a set piece (`SET_CHANCE` in `packages/item-gen/src/found.ts`). The real number is the creative
director's.

## 6. D21: a base level curve for equipment

The proficiency tree is confirmed. The note asks for a **base curve**: a power level for equipment that tells
us how the equipment paths and the branches progress. Below are answers to the note's four questions, then a
proposed curve.

### Answers to the four questions

**What system is creative, cool and addicting?** Three chases that feed each other:
- **Better rolls:** rarity, affixes, masterwork scores.
- **New recipes:** found blueprints, sets.
- **Higher skill:** levels, perks, titles.

Each chase should always have a visible next step. That's why we recommend the estimate on scrolls (§4).

**The longsword or the greatsword: which comes first?** Neither. The curve comes first:
- Every level has a **power budget**.
- Each family **spends the budget its own way**. A greatsword at level 20 has the same budget as a longsword at
  level 20, spent on more damage and stagger and less speed.
- So families are styles, not steps. A family can still unlock later, as a design choice; the greatsword could
  need Smithing 10. Balancing doesn't force it.

**Does a resource add something, or does it allow a craft?** Recommendation: a resource has three jobs, kept
apart.
- **Gate:** the material's tier decides what can be made, and at what level. Today iron needs level 0 to 3 and
  ironglass 5 to 8; later tiers would need more.
- **Scale:** the material's quality, set when it's gathered, scales the result (the ×0.8 to ×1.2 above).
- **Flavor:** a special material adds one trait, such as an affix or an element. **"This resource adds this to
  that"** lives here. The resource rarity tree (AF-020) decides which materials carry traits.

**What decides a resource's value, and its effect on an item?**
- **Its value:** where it's found, how rare it is in the resource rarity tree, and its quality roll.
- **Its effect:** the three jobs above.
- **The crafting process** still moves the result whatever the material, through the Craft factor and the
  rarity roll (§3). We recommend keeping that.

### A proposed curve (STAND-IN, to tune)

- **Item level** is the level the blueprint needs: 1 to 100.
- **Power budget:** `P(L) = 20 + 1.5·L + 0.015·L²`. That gives:

| Item level | 1 | 10 | 25 | 50 | 75 | 100 |
| --- | --- | --- | --- | --- | --- | --- |
| Budget | 22 | 37 | 67 | 133 | 217 | 320 |

- **Each family has a share** of the budget. For example: longsword 1.0 damage, greatsword 1.4 damage at 0.75×
  speed, helmet 0.4 defense, chestplate 0.9 defense. Iron pieces already sit close to the curve: an iron
  longsword is 20 damage against a budget of 22. Ironglass sits below it: its longsword is 21 against 28 at
  level 5, so it would get a little stronger.
- **Each branch unlocks a material tier every 10–15 levels**, so the branch's level and its equipment rise
  together. The perk milestones are every 10 levels (D22).

**Their answer (28 Nov):** the materials plan sounds good, and the crafting branches, not gathering, train the
equipment paths. Every kind of equipment is available to craft, and each gets more advanced as its branch levels.

**Next step:** with the shape agreed, Claude can write the curve into `packages/item-gen` as one
function. Then every blueprint, standard or found, takes its base stats from the curve instead of hand-set
numbers. The creative director sets the shares and the curve's numbers.

## 7. Section 3.2: does gathering train the branches?

**No, and that's deliberate.**
- Gathering trains only its own proficiency: Mining, Woodcutting or Herbalism.
- Each gathering proficiency is the **root** of one branch, through materials:
  - Mining feeds Smithing's ore.
  - Woodcutting feeds Crafting's wood.
  - Herbalism feeds Alchemy's herbs.
- Mining doesn't train Alchemy. An alchemist who needs ore buys it from a miner, or mines it and gains Mining,
  not Alchemy.

**How realistic should it be?** Recommendation: **gameplay first, realism only for flavor.**

The goal is a world where players **need each other**: a miner sells to a smith, a herbalist to an alchemist.
Keeping gathering apart from the branches does that. It also gives a player who only gathers a progression of
their own: their root's level, and its perk at 50.

**Their answer (28 Nov):** trading is good, but **not the main route**: it's one more way to get materials.
Gathering means collecting materials, and that happens mainly through mining, woodcutting, quests and similar.

That's how the game works today, so nothing changes: gathering trains only its own proficiency, and gathering
gives no XP to the branches.

---

## Changes made with this document

- **Pronouns:** documents now use they/them for the creative director, and `AGENTS.md` tells every agent to.
- **GDD v0.6:** D17, D19, D21 and D22 updated, and §8 points here.
- **Set pieces:** the stand-in's set chance is now 5%.
