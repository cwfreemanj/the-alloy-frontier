# Handoff: full-screen character screens, skills vs proficiencies

Branch: `character-screens`. Read `AGENTS.md` first.

## Goal
Rebuild the character window as full-screen tabbed screens in the style of the owner's mockup
(dark panels, ember/gold trim, icons, a top bar with name, tabs and coins), and separate
**Proficiencies** from **Skills**.

## Decisions (owner, 2026-11-24)
- **I opens the Character screen**; I again closes. Switch screens with the top tabs (and Q / E
  while the window is open). The O and U keys are removed.
- Each screen is **full screen**: Character, Inventory, Proficiencies, Skills (more later).
- **Proficiencies** = everything that improves by doing it: weapon masteries, blacksmithing,
  mining, woodcutting, herbalism. **Skills** = combat abilities only (light/heavy attacks,
  Guardbreaker, Storm Arc, later ones like "Final Slash").
- The Character screen shows the **live 3D character model** (Maria / Exo) with the equipped
  weapon; drag to turn it.

## Decisions (agent)
- Gathering proficiencies (`progression.professions.mining/woodcutting/herbalism`, optional in old
  saves): level 1-100, XP to next = 20 + 6 × level, 5 XP per gather. Each level above 1 adds 1% to
  the extra-unit chance (on top of tool power). Herbalism has no herbs to gather yet.
- Icons are inline SVG drawn in code (no external assets or fonts).
- The 3D preview uses its own small WebGLRenderer, created when the Character screen opens and
  disposed when it closes.
- Test ids from the old window are kept where the element still exists.

## Stages
- [x] 1. Proficiency rules (shared, server-awarded) + tests
- [x] 2. Full-screen shell (top bar, tabs, keys)
- [x] 3. Character screen + live 3D model
- [x] 4. Inventory, Proficiencies, Skills screens
- [x] 5. Browser check, tests (unit, e2e), PR

## Current state
All stages done; PR open.
- Rules: gathering proficiencies in `packages/game-rules/src/progression.ts`; awarded in the shared
  gather action (server for accounts).
- UI: `apps/web/src/ui/CharacterWindow.ts` (full-screen shell + 4 screens), `CharacterPreview.ts`
  (live 3D model, own renderer, disposed on close), `icons.ts` (inline SVG). Styles: the
  "Character screens" block in `ui/styles.css`, all under `.cs`.
- Game: I opens on Character and closes; `setModal` disposes the window and hides the
  world-status pill while it's open. O/U bindings removed.
- Checked in a browser at 1280x720: all four screens, the model, Q/E switching.
- Tests: `npm test` 180 passed. `npm run test:e2e`: 12 passed, 1 failed (full loop: the Warden
  wasn't killed in time). That test passed on 2 reruns. The character-window test covers all
  four screens, Q/E and the 3D preview.

Next: owner review; then close out this handoff.
