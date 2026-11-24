# Handoff: weapon families and damage types

Branch: `damage-types`. Read `AGENTS.md` and `docs/equipment-contract.md` first.

## Goal
Get combat ready for the partner's weapon families: damage types and enemy resistances,
mastery per weapon family, and a server tally the adapting world can use later.

## Decisions
- Owner (2026-11-24): do weapon families and damage types next.
- Agent:
  - Families: longsword, shortsword, greatsword, axe, mace, dagger, staff, bow.
  - Damage types: slash, pierce, blunt, magic. Each family has a default type
    (`WEAPON_FAMILIES` in `packages/game-rules/src/damage.ts`); a blueprint may override it
    with `damageType`.
  - Resistances are multipliers per enemy type, applied after defense. Starter-quest balance:
    scavengers and the Warden take the longsword's slash at x1.0. The Quarry Sentinel (not
    required by the quest) resists slash.
  - Mastery is per family; the damage bonus and XP follow the equipped weapon's family.
    Unarmed hits give no weapon XP. `weaponMastery.longsword` always exists (save validation
    and old saves rely on it).
  - Movesets and ranged/magic attacks are out of scope (need animations and projectiles): every
    family uses the longsword moveset for now.
  - The server counts damage dealt by type and family (`WorldStats`), for the adapting world.

## Stages
- [x] 1. Types + damage rules + resistances (tests)
- [x] 2. Mastery per family (session, events, save compatibility)
- [x] 3. Server applies resistances and tallies damage
- [x] 4. Client + UI (guest hits, Skills tab per family, damage type shown)
- [x] 5. Tests (unit, server, e2e); PR

## Current state
All stages done; PR open.
- Rules: `packages/game-rules/src/damage.ts` (`WEAPON_FAMILIES`, `damageTypeOf`,
  `resistanceMultiplier`, `DAMAGE_TYPE_NAMES`); `EnemyArchetype.resist`; blueprint `damageType`.
- Session: `weaponFamily`, `masteryOf(f)`, `weaponLevel` (the family in hand), `gainWeaponXp`
  to the family in hand. Shared `weaponDamageType(s)` and `damageAgainst(s, raw, enemy)` in
  `packages/session/src/actions.ts`.
- Server: signed-in hits use `damageAgainst`; `WorldStats.damageByType` / `damageByFamily`.
- Client: guest hits use `damageAgainst`; "WEAK SPOT" / "RESISTED" hints; the HUD shows the
  in-hand family's mastery; Skills lists trained families; a Damage type stat.
- Unarmed is blunt (fists) and gives no weapon XP; this changed two server tests on purpose.
- Tests: `npm test` 178 passed. `npm run test:e2e`: 12 passed, 1 failed on the full run (the
  full-loop test: Orla's dialog didn't open after the Warden, a missed key press). That test
  passed on 2 reruns.

Next: owner review and merge; then close out this handoff.
