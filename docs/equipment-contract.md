# Equipment contract: what an item must carry

**Who owns what (agreed 2026-11-24):**
- **Item generation** (families, recipes, materials, stat formulas, rarity, names) belongs to the
  partner, in `packages/item-gen`.
- **Equipment mechanics** (slots, equipping, gear stats in character stats, tools for gathering,
  UI) belong to Neal's side, in `packages/crafting`, `packages/session`, the server and
  `apps/web/src/ui`.

This file is the interface between the two. If something here doesn't fit the algorithm, change it
here first and tell the other side.

## Where an item goes: on the blueprint

Items are sealed (`integrity` hashes the item's stats, blueprint and creation record), and an item is
only valid if its blueprint exists. So **slot information lives on the blueprint**, not on the item:

```ts
// BlueprintDefinition (packages/item-gen/src/blueprints.ts)
equip?: {
  slot: 'weapon' | 'offhand' | 'head' | 'shoulders' | 'neck' | 'cape' | 'chest' | 'belt'
      | 'hands' | 'legs' | 'feet' | 'ring' | 'tool';
  /** Weapons only. 2 = two-handed: also occupies the off-hand. Default 1. */
  hands?: 1 | 2;
  /** Tools only: which gathering it allows, and how good it is (1 = basic). */
  tool?: { kind: 'mining' | 'woodcutting'; power: number };
};
```

- A blueprint without `equip` counts as a one-handed main-hand weapon (every item made so far).
- `'ring'` fits either ring slot. The character has two.
- Two-handed weapons (greatswords, staffs, bows) empty the off-hand when equipped. While one is
  equipped, nothing can go in the off-hand.

### Slots on the character
Head, Shoulders, Neck, Cape, Chest, Belt, Hands, Legs, Feet, Ring ×2, Main hand, Off-hand, Tool.

In `InventoryState.equipped` the keys are: `weapon` (main hand, kept for old saves), `offhand`,
`head`, `shoulders`, `neck`, `cape`, `chest`, `belt`, `hands`, `legs`, `feet`, `ring1`, `ring2`, `tool`.

Suggested mapping of the planned families:

| Family | slot | hands |
| --- | --- | --- |
| Short swords, longswords, axes (as weapons), maces, daggers | weapon | 1 |
| Greatswords, staffs, bows | weapon | 2 |
| Shields | offhand | |
| Helmets/hats | head | |
| Chests/chestplates | chest | |
| Pants/platelegs | legs | |
| Boots/greaves | feet | |
| Gloves/gauntlets | hands | |
| Rings | ring | |
| Necklaces | neck | |
| Capes | cape | |
| Pickaxes | tool (mining) | |
| Woodcutting axes | tool (woodcutting) | |

An axe can't be both a weapon and a tool, because each blueprint has one slot. Make a battle-axe
blueprint and a woodcutting-axe blueprint.

## What an item's stats mean: `item.result`

`result` is inside the integrity hash, so these are fixed at creation.

**Weapons** use the existing fields: `damage`, `attackSpeed`, `stagger`, `staminaCostMultiplier`,
`critChance`, plus `rating`, `rarity`, `affixes`, `imbuements`.

**Armor, jewellery, capes, shields** add two optional fields. They can keep the weapon fields at
neutral values (e.g. `damage: 1`), because only main-hand items are used for attacks.

```ts
// ItemResult (packages/item-gen/src/types.ts)
/** Flat armor. All equipped defense adds up; incoming hits use mitigate(damage, defense). */
defense?: number;
/** Flat bonuses while equipped. Attribute keys: strength, dexterity, vitality, endurance. */
bonuses?: { maxHealth?: number; maxStamina?: number; attributes?: Record<string, number> };
```

- `mitigate(d, defense) = d × 100 / (100 + defense)`, so 100 defense halves a hit.
- Attribute bonuses from gear are added to the attribute totals and shown separately on the sheet
  ("6 trained + 3 allocated + 2 gear").

**Tools** use `blueprint.equip.tool.power`. Power 1 gathers as before. Each point above 1 adds a 25%
chance of one extra unit per gather.

## Placeholders to replace
These exist only so the mechanics can be built and tested before the algorithm lands. Replace or
rebalance them freely:
- `worn_pickaxe` and `worn_hatchet` blueprints (power 1). Every character gets them in a starter
  kit, because gathering now needs the right tool. The last tool of a kind can't be discarded.
