# Blueprint contract: generated blueprints

**Status: the four open decisions were made by the technical director on 2026-11-27 (section 3); the creative
director reviews the whole contract. The game side (section 2) is built (2026-11-27) against a stand-in
generator (section 5).** This is the interface between the blueprint
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
current list), and grow into the **inherent blueprints** that come with blacksmithing levels. Generated ones
are the unique blueprints a player has to find (section 3).

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

/** One found blueprint: it teaches one item (a set piece is its own blueprint). */
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
  /** What it makes: one item, in the existing blueprint format. */
  piece: BlueprintDefinition;
  /**
   * A set piece names its set. Each piece of a set is a separate blueprint, found on its own; set bonuses
   * come later, after the 18th.
   */
  set?: { id: string; name: string; pieces: number };
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
- **Bounded:** names at most 48 characters, lore at most 600, a set of at most 8 pieces, numbers finite and
  within `LIMITS`. The game rejects anything outside these.
- **A set's pieces share the set's `id`**, so any piece found later is recognised as part of the same set.
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
- **Two lists on the character**, saved with it (older saves get empty ones):
  - **Scrolls** (`inventory.scrolls`, at most 200): blueprints the player carries. A scroll can be learned,
    sold, traded, given away or discarded, whether or not it has been learned.
  - **Learned** (`inventory.learned`, no practical limit): what the player can forge. Learning copies the
    blueprint here; **the scroll stays**, so the player can still sell, trade or give it away.
- **Duplicates:** learning a blueprint already learned changes nothing and says **"You've already learned this
  blueprint."** The scroll stays, to discard, sell or trade.
- **Forging from one:** the forge lists learned blueprints next to the standard ones, with their rarity, lore,
  worth and requirement. The player needs the materials, the flux and the required level (until the
  proficiency tree is built, Smithing uses blacksmithing mastery, and Crafting and Alchemy blueprints wait).
- **Inherent blueprints:** the standard patterns are learned automatically as blacksmithing levels up (each has
  its `masteryRequirement`, as today). More can be added to that list; the unique ones are only found.
- **Every forged item keeps a copy of its piece's definition** (`item.blueprint`, inside the item's
  integrity). The item then always knows its slot, family, damage type and look, whatever happens to the
  blueprint. All blueprint lookups go through one helper that checks, in order, the item's copy, then the
  character's learned blueprints, then the standard table.
- **Trading and giving** are not built yet. When they are, a scroll moves between characters through the
  server, which checks ownership. Selling a scroll to a merchant can come first (it has a worth).
- **Network:** the character data already carries the inventory, so owned blueprints travel with it. The
  browser never sends a blueprint, only its id.

## 3. Decisions (technical director, 2026-11-27)

1. **Learned, and the scroll stays.** A found blueprint is learned for good. Learning doesn't use the scroll up:
   the player can still sell it, trade it or give it to another player.
2. **Set pieces are forged one at a time.** Each piece is its own blueprint. A player can forge the pieces whose
   blueprints they have found and learned.
3. **Duplicates:** learning one already learned says "You've already learned this blueprint." The scroll can
   then be discarded, sold or traded.
4. **The fixed list stays.** The standard patterns are the inherent blueprints: learned automatically as
   blacksmithing levels up. Finding blueprints opens up the more unique ones.

## 4. Order of work

1. **Agree this contract** (both directors).
2. **Creative director:** `generateBlueprint`, `RESOURCE_RARITY` and the drop chances, with tests
   (determinism, bounds). A first version can use only today's five materials.
3. **Technical director:** scrolls and learned blueprints on the character, sealing and validation; learning
   (and the duplicate message); the blueprint lookup helper; the item's copy of its definition; server drops
   from enemies and chests; the forge's list of learned blueprints; discarding scrolls. This can start against
   a stand-in generator right away, then switch to the real one.
4. **Then:** selling scrolls, quest rewards, the proficiency requirement (after the tree), set bonuses,
   trading and giving between players.

## 5. Built: the game side, with a stand-in generator (2026-11-27)

Everything in section 2 except trading, giving and selling scrolls is built, against a **stand-in** generator, so
the creative director can drop in the real one without touching the rest.

**Where to plug in the real generator:** `packages/item-gen/src/found.ts`.
- Replace the body of `generateBlueprint(seed, ctx)` (same signature and return type).
- Replace `BLUEPRINT_DROP` (the chances per source).
- `sealBlueprint` and `validateBlueprint` stay: the game seals what the generator returns and checks it everywhere.
- The stand-in makes variations of the standard patterns found in each area, with rarity rising with the area's
  level, materials and level requirements rising with rarity, and one stand-in set per area.

**What the game does now:**
- **Drops:** about 5% of enemies (50% of elites, such as the Warden and the Raider Captain) drop a blueprint;
  chests 30%, trail caches 20%, barrels 2%.
  - The server rolls them for signed-in players; a guest's browser rolls them for guests.
  - Searches are seeded, so a retry finds the same thing.
- **Scrolls and learning:** found blueprints are scrolls in the bag (`inventory.scrolls`, at most 200). The
  inventory's Blueprints section shows each one's rarity, worth, base stat, requirement, set and lore, with
  **Learn** and **Discard**.
  - Learning keeps the scroll.
  - Learning one already learned says "You've already learned this blueprint."
  - Discarding a scroll keeps the blueprint learned.
- **Forging:** learned blueprints appear in the forge under their category, marked **Found**, with the rarity
  colour. The forge checks the level requirement against blacksmithing mastery.
- **Items:** an item forged from a found blueprint keeps a sealed copy of it (`item.blueprint`). Equipping,
  damage type, looks and validation use that copy (`blueprintOf(item)`), so the item works after the scroll is
  gone or the blueprint is traded.
- **Other players** see found weapons and shields: the avatar message carries their look (`wpn.lk`, `gr.ol`,
  `gr.hl`, optional and checked by the server).

**Not built yet:** selling, trading and giving scrolls; quest rewards; the proficiency branches (Crafting and
Alchemy blueprints wait for the tree); set bonuses.
