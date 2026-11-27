# Blueprint contract: generated blueprints

**Status: draft for both directors to agree** (2026-11-27). This is the interface between the blueprint
**generator** (the creative director's side, in `packages/item-gen`) and everything around it (the technical
director's side: storage, drops, the server, forging, the screens). It works like
[equipment-contract.md](equipment-contract.md): change it here first, then tell the other side.

The creative director's design, as he described it (2026-11-27):
- A blueprint has **its own rarity**, from what it specifies: rarer materials and a higher proficiency make a
  rarer blueprint. A **resource rarity tree** is coming.
- A blueprint is for **one item or a set**, with **lore**, **resources required**, an **item or set type**, a
  **proficiency required** and an **estimated worth**.
- Blueprints are **generated on the fly** from the resources in the area, with a chance of a rarer one. They
  **drop from enemies**, are **found** in chests, crates and the environment, are **traded**, and are
  **quest rewards**.

## What changes, and why a contract is needed

Today blueprints are a fixed table in code (`BLUEPRINTS`, 17 of them). Every item stores a `blueprintId`, and
the game looks the blueprint up for the item's slot, family, damage type, look and validation (about 20
places). A generated blueprint exists only because someone found it, so:

- it has to be **stored** with the character who owns it;
- it has to be **made only by the server**, which owns drops (a browser can't invent one; hard rule 5);
- **an item forged from it must still make sense** after the blueprint is used up, traded or lost;
- the browser and the server must **read it the same way**.

The fixed blueprints stay as the **standard patterns** (the starter longsword, Bram's stock, the forge's
current list). Generated ones are added alongside them.

## 1. What the generator returns (creative director's side)

One function, in `packages/item-gen`, pure and deterministic (same inputs, same blueprint):

```ts
export function generateBlueprint(seed: string, ctx: BlueprintContext): GeneratedBlueprint;

/** Where and why a blueprint is being made. The server fills this in. */
export interface BlueprintContext {
  /** The area it was found in: its resources and level shape the blueprint. */
  area: 'village' | 'trail' | 'quarry' | 'foundry';
  source: 'enemy' | 'chest' | 'environment' | 'quest' | 'trade';
  /** The enemy type, chest id or quest step (for tables and lore). */
  sourceId: string;
  /** The area's current enemy level (adaptive world), 1-10. */
  level: number;
}

export interface GeneratedBlueprint {
  /** 'gbp_' + a hash of the generator version, seed and context. Unique and stable. */
  id: string;
  generator: { name: string; version: number };
  seed: string;
  context: BlueprintContext;
  /** The blueprint's own rarity (the creative director's rules). */
  rarity: Rarity;
  name: string;
  /** At most 600 characters. */
  lore: string;
  /** A single item, or a set of pieces. */
  kind: 'item' | 'set';
  /** What it makes: one definition, or one per set piece (at most 8). */
  pieces: BlueprintDefinition[];
  /** For sets: the set's id and name (set bonuses come later, after the 18th). */
  set?: { id: string; name: string };
  /** See docs/proficiency-tree.md: the branch and level needed to make it. */
  requirement: { branch: 'smithing' | 'crafting' | 'alchemy'; level: number };
  /** Estimated worth in coins (merchants can use it later). */
  worth: number;
}
```

Rules for the generator:

- **Pieces use the existing format** (`BlueprintDefinition`): family, `equip` slot, base stats or
  `baseDefense`, materials, flux, modes, `look`. So the forge, equipping and looks work for them without
  special cases.
- **Materials must be ones the game has** (`MaterialId`: iron ore, ironwood, ironglass, binding flux,
  emberleaf). A new resource from the rarity tree has to be added to the game first (a material, where it is
  gathered, and its quality), which is the technical director's side. The rarity tree should list which
  resources exist now and which are planned.
- **Deterministic:** no `Math.random`, no clock; use the seed (`Rng` in `rng.ts`).
- **Bounded:** names at most 48 characters, lore at most 600, at most 8 pieces, numbers finite and within
  `LIMITS`. The game rejects anything outside these.
- **Version it:** bump `generator.version` whenever the same seed would give a different blueprint.
- Also wanted from the generator: `RESOURCE_RARITY` (each material's rarity) and the **drop chances** per source,
  so the server can roll them. A plain table is enough, for example `{ enemy: 0.08, chest: 0.35 }`, scaled by rarity.

## 2. What the game does with it (technical director's side)

- **The server rolls drops.** When an enemy dies, a chest or crate is searched, something in the world is
  picked up, or a quest step pays out, the server decides whether a blueprint drops (the generator's chances),
  makes it with `generateBlueprint`, seals it, and gives it to the player. Guests (offline) do the same in
  their browser, as for their other loot.
- **Sealed, like items:** a blueprint carries an `integrity` hash. A changed blueprint fails validation, and
  saves reject it.
- **Owned blueprints are stored on the character**, in a new `blueprints` part of the inventory
  (at most 200), saved with the character. Older saves get an empty list.
- **Forging from one:** the forge lists owned blueprints next to the standard ones, with their rarity, lore,
  worth and requirement. The player needs the materials, the flux and the required level (until the
  proficiency tree is built, Smithing uses blacksmithing mastery, and Crafting and Alchemy blueprints wait).
- **Every forged item keeps a copy of its piece's definition** (`item.blueprint`, inside the item's
  integrity). The item then always knows its slot, family, damage type and look, whatever happens to the
  blueprint. All blueprint lookups go through one helper that checks, in order, the item's copy, then the
  character's blueprints, then the standard table.
- **Trading** is not built yet. When it is, a blueprint moves between characters through the server, which
  checks ownership.
- **Network:** the character data already carries the inventory, so owned blueprints travel with it. The
  browser never sends a blueprint, only its id.

## 3. Decisions to agree

1. **Used up or learned?** When a player forges from a found blueprint:
   - **(a) learned:** reading it once teaches it for good, like a recipe book;
   - **(b) single use:** each blueprint makes one item (or one set), and is used up;
   - **(c) charges:** a few uses, more for rarer blueprints.

   Recommended: **(a) learned, with the scroll kept** until the player chooses to learn it, so unlearned
   scrolls can still be traded or sold. It rewards finding rare ones without making them throwaway.
2. **Set pieces:** forge each piece separately (recommended: fits the forge as it is), or the whole set at once?
3. **Duplicates:** a blueprint the player already knows drops again: turn it into coins at its worth
   (recommended), or keep a second scroll to trade?
4. **The forge's fixed list:** keep the standard patterns forever (recommended for the starter quest), or retire
   them once generated blueprints cover the same items?

## 4. Order of work

1. **Agree this contract** (both directors).
2. **Creative director:** `generateBlueprint`, `RESOURCE_RARITY` and the drop chances, with tests
   (determinism, bounds). A first version can use only today's five materials.
3. **Technical director:** storage, sealing and validation; the blueprint lookup helper; the item's copy of its
   definition; server drops from enemies and chests; the forge's list of owned blueprints. This can start
   against a stand-in generator right away, then switch to the real one.
4. **Then:** quest rewards, the proficiency requirement (after the tree), set bonuses, trading.
