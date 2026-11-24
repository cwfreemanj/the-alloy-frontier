# Design backlog

Ideas the owner wants, written down so they aren't lost. These are not tasks in progress. Before one
is started, it gets a design pass with the owner and, if it spans sessions, a handoff file
(see `AGENTS.md`).

## 1. Training perks and titles ("separate effects")

**Owner's intent (2026-11-24):** reward players for doing more than the normal path. Today,
trained levels and allocated stat points add up to one total (decided for now). Later, trained
growth should also unlock things points can't buy.

What exists to build on:
- Trained levels per attribute (`progression.attributes`), separate from allocated points
  (`progression.allocated`). The split is kept in the data, so perks can read it.
- Records in `SessionData.stats` (kills by enemy type, items forged, deaths, play time).

Open questions for the owner:
- Perks: passive bonuses (e.g. trained Strength 15 → heavy attacks cost less stamina), new
  actions, or both? Are they automatic or chosen?
- Titles: cosmetic only (shown above the name to other players), or with small effects?
- Which feats count: trained-level milestones, records (100 scavengers, 50 forges), first kills,
  doing things the hard way (masterwork only, no deaths)?

Implementation notes:
- Rules in `packages/game-rules` (a perk table keyed by condition) and awarded by the server,
  like attribute XP: only from things the server observes.
- Titles would need a field in `AvatarState` (protocol) so other players see them.

## 2. An adapting world

**Owner's intent (2026-11-24):** the world watches how players play and adapts. For example, if
lots of players farm one area with longswords, its enemies gain armor against that. If they
switch to axes or magic, the world shifts again.

What exists to build on:
- The server already observes every accepted hit: attack id, damage, and which enemy
  (`worldRoom.ts`, `hit`), plus kills per enemy and area (spawns in `packages/world`).
- Enemies now have attributes (`EnemyArchetype.attributes`) that contests compare against the
  player's, which gives the adaptation a set of values to adjust.

What's missing first:
- **Damage types and resistances.** Today there is only one weapon family (longsword) and no
  magic, so there is nothing to adapt *between*. A first step would add a damage type to
  attacks (slash / blunt / pierce / arcane...) and resistances to enemies.
- **Per-area enemy state that persists** (in Postgres, like characters), so adaptation survives
  restarts.

Sketch of the algorithm (to discuss):
1. For each area, keep a decaying tally of damage dealt by type, weapon family and attack
   (e.g. a 24-hour exponential moving average), and of kill rates.
2. Once a day (or every N kills), shift that area's enemy resistances and attributes a small
   step toward whatever is dominant, within bounds, and drift back toward the baseline when
   the pressure stops.
3. Show it in the world: a notice ("The scavengers of the Quarry have taken to wearing iron
   plates"), a visible armor variant (needs models from the partner), and new drops that
   reward the counter-strategy.

Risks to decide on:
- Griefing: a few players could deliberately push an area's adaptation. Weight by distinct
  players, and cap the step size.
- Fairness for new players: adapt per area, keep starter areas fixed, or scale by player level.
- Explainability: players should be able to see why the world changed.
