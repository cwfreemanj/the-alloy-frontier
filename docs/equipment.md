# Design record: equipment slots and gear mechanics

Merged in PR #11. This was the handoff file for the task; it is kept as the record of what was decided and why. The interface with item generation is `docs/equipment-contract.md`.

## Goal
Make every equipment slot real: equip/unequip anything into the right slot (checked by the
server for signed-in players), gear stats count toward the character, tools are required for
gathering, and the character sheet shows live slots.

## Decisions (owner, 2026-11-24)
- **Split:** the partner builds the item-generation algorithm (`packages/item-gen`); this task
  builds the mechanics around it. The interface is `docs/equipment-contract.md`.
- **Slots:** Head, Shoulders, Neck, Cape, Chest, Belt, Hands, Legs, Feet, Ring ×2, Main hand,
  Off-hand, plus a **Tool** slot.
- **Tools are required:** ore and ironglass need a mining tool, ironwood a woodcutting tool, in
  the tool slot. Better tools gather more.

## Decisions (agent)
- Slot info lives on the blueprint (`equip`), since items are sealed by `integrity`.
- `equipped.weapon` stays the main-hand key, so old saves and old clients keep working.
- Gathering with the right tool in the bag: the browser equips it first (an `equip` action),
  then gathers. The rule stays strict, and the player doesn't have to swap tools by hand.
- Starter kit: a worn pickaxe and hatchet (placeholders) for new and existing characters,
  granted on load if missing. The last tool of a kind can't be discarded (no soft-lock).
- Incoming damage: contest first, then `mitigate(damage, total defense)`, in the browser
  (health is client-owned).

## Stages
- [x] 1. Contract fields (blueprint `equip`, result `defense`/`bonuses`), placeholder tools
- [x] 2. Inventory: slots, equipItem/unequip, discard and validation rules, save migration
- [x] 3. Session + actions + protocol: equip {item, slot?}, unequip {slot}; tool gate on gather;
      gear in characterStats; starter tools
- [x] 4. Client: defense on incoming hits, auto-equip tool on gather, live slots in the window
- [x] 5. Tests (unit, server, e2e); PR

## Current state
Stages 1-3 done; typecheck clean, `npm test` passes.
- Contract types in `packages/item-gen/src/types.ts` (`EquipInfo`, `ItemFamily`, `GearBonuses`,
  `ItemResult.defense/bonuses`); placeholder blueprints `worn_pickaxe`, `worn_hatchet`.
- Inventory (`packages/crafting/src/inventory.ts`): `EQUIP_SLOTS`, `equipItem`, `unequip`,
  `equipInfo`, `slotsFor`, `slotOf`, `equippedItems`, `toolPower`, `normalizeEquipped`;
  discard and validation rules. Tests: `packages/crafting/test/equipment.test.ts`.
- Session: `equip(id, slot?)`, `unequip(slot)`, `gear()`, `toolPower(kind)`, `gearAttributes()`,
  starter tools on load; the `equip` event now carries the main-hand weapon or null.
- Actions: `equip {item, slot?}`, `unequip {slot}`; gather needs the right tool (`toolFor`).
  `characterStats` has `defense`, plus gear max health/stamina.
- Server test: "checks equipment changes and the tool requirement on the server".

Stages 4-5 done:
- Client: incoming hits are mitigated by gear defense; gathering equips the right tool from the
  bag first (`Game.readyTool`); the window has 14 live slots, Equip/Unequip with the slot name,
  a gear line for armor and tools, and a Defense stat. Weapon statistics are hidden for non-weapons.
- Fixed a style leak: the window's `.slot`, `.tab` and other rules are now scoped under `.charwin`.
  The HUD ability bar also uses `.slot`, and the leaked rule (shipped in PR #10) stretched it.
- Tests: `npm test` passes (173). `npm run test:e2e`: 13 passed on the final run. The character-window
  test covers the tool slot, the automatic hatchet swap, and Unequip/Equip.
- Checked in a browser: an old guest save got the starter tools; the tool slot equips and
  unequips; ironwood swaps in the hatchet.

Next: owner review and merge. On merge, remove this file and its README entry, and tell the
partner about `docs/equipment-contract.md`.

## Verify
`npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
