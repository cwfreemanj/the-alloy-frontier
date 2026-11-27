# Raids on Emberhold (AF-011)

**Status: approved and built (2026-11-27, PR #34). Off on the live server until the server setting
`RAIDS=1` is turned on.** The technical director approved the rules below as proposed. The GDD
(AF-011) asked for approval of three things: **what triggers a raid, how big it is, and what winning
or losing does** (sections 1–3). Section 4 lists the smaller choices, section 5 how it is built, and
section 7 how to try it.

This is part 2 of the [adaptive world](adaptive-world.md): the world observer already keeps per-area
tallies, saved across restarts (AF-013). The protection fee after a lost raid is AF-012, built after this.

## How a raid plays (recommended)

1. **Warning.** The lookout on the watchtower (north-east of the village, by the trail) sounds the horn.
   Everyone online gets a notice: *"The lookout's horn! Raiders on the Ironwood Trail, coming for
   Emberhold."* A 60-second countdown shows on the HUD, so players can get back to the village and gear up.
2. **First wave.** When the countdown ends, about half the raiders come down the trail into the village and
   fight whoever is there.
3. **Second wave.** When the first wave is down, or 90 seconds after it arrived, the rest come in with the
   **Raider Captain**.
4. **The end.** Defeat every raider and the Captain within 5 minutes of the first wave arriving and the
   village wins. Otherwise it loses (section 3).

## 1. Trigger (needs approval)

**Recommended:**

- **Raid readiness.** The village builds up readiness as people play: one point per minute for each
  signed-in player online, anywhere in the world. Gathering, forging and selling in the village add a
  little more, so a busy, prosperous village draws raiders sooner.
- **A raid starts when all of these hold:**
  - readiness has reached **30** (about 30 minutes of solo play, or 10 minutes with three players);
  - at least one signed-in player is **in the village**, so somebody can defend it;
  - at least one of them is **rank 2 or higher**, so a brand-new player's first visit isn't a raid;
  - the last raid was **at least 45 minutes ago**.
- **Readiness resets** to 0 after each raid. It's saved with the world state, so a server restart doesn't
  reset it.
- **For testing only:** a command that starts a raid at once, available only on a local development server
  (like the existing debug hooks).

**Alternatives considered:** a fixed timer (e.g. every hour) is simpler but ignores how the world is
played, which is the point of the adaptive world. A random chance per minute is less predictable for
playtesters.

## 2. Size and strength (needs approval)

**Recommended:**

- **Defenders** are the living players in the village when the countdown ends, guests included.
- **Number of raiders:** 3 + 2 × defenders, from 5 to 10. Plus the Captain.

  | Defenders | 1 | 2 | 3 | 4 or more |
  | --- | --- | --- | --- | --- |
  | Raiders | 5 | 7 | 9 | 10 |
  | First wave / second wave | 3 / 2 | 4 / 3 | 5 / 4 | 5 / 5 |

- **Level:** the raiders' level follows the defenders: the average adventurer rank of the signed-in
  defenders minus 1, from level 1 to 4. It uses the same scaling as the area levels (health +30%,
  damage +15% and so on per level).
- **Raiders:** the Scavenger's moves and stats (90 health, a fast slash and a heavy chop), as a new
  **Ember Raider** enemy. They chase the nearest player in the village and don't leave it.
- **Raider Captain:** an elite, about 4 times a raider's health, with heavy poise (hard to stagger), the
  raider's two attacks plus a wide **Torch Sweep**, and worth much more XP and coins.

**Why waves:** five raiders at once would overwhelm a solo player. Two smaller waves keep a solo raid
winnable, while four players still face ten raiders and a Captain.

## 3. Outcomes (needs approval)

**Recommended:**

- **The village wins** when every raider and the Captain are defeated within 5 minutes of the first wave
  arriving.
  - Everyone who fought gets the normal kill rewards, plus a raid reward: bonus coins and XP, and the
    Captain's guaranteed drop of Binding Flux.
  - Notice: *"Emberhold holds! The raiders scatter into the Ironwood."*
- **The village loses** if the 5 minutes run out with the Captain still standing, or if no living player has
  been in the village for 30 seconds (everyone fell or ran).
  - The raiders withdraw. Notice: *"Emberhold has fallen. The Raider Captain will be back for tribute."*
  - **The Captain sets up camp** on the Ironwood Trail, where any player can hunt him down. Defeating him
    there ends the matter.
  - The loss, and whether the Captain is still at large, are saved with the world state.
  - **The tribute itself is AF-012**, built next: while the Captain is at large, the village pays a protection
    fee, and the tribute gear makes the raiders stronger.
- **Dying in a raid** works as it does now: players respawn in the village square, right back in the fight.
- **Nothing in the village is damaged.** No buildings break and no one loses items in AF-011.

## 4. Smaller choices (defaults unless you say otherwise)

- **Looks:** to start, raiders reuse the Scavenger model with an ember-red tint, and the Captain is the
  same model 1.3 times bigger. Proper raider and Captain models are the creative director's call, and can
  replace these later without code changes.
- **Names:** "Ember Raider" and "Raider Captain".
- **Orla and Bram** stay where they are and keep working during a raid.
- **A server restart during a raid** cancels it, with no outcome either way. Readiness and the cooldown stay
  saved.
- **Turned off until approved:** raids sit behind a server setting, off by default, so nothing changes on the
  live server until you say so.

## 5. How it is built

- **Rules** in `packages/game-rules/src/raid.ts` (`RAID`, `raidSize`, `raiderLevel`, `shouldStartRaid`,
  `raidReward`), shared by the server and the browser. The **Ember Raider** and **Raider Captain** are in
  `ENEMIES` (`enemy.ts`); the entry, patrol route and camp points are `RAID_POINTS` in `@alloy/world`.
- **The raid** runs on the server: `RaidDirector` in `apps/server/src/raids.ts`, owned by the world room.
  Raiders are server enemies like the others (the server does the damage, kill credit and rewards), with
  three differences: they are added and removed during play, they keep the raid's level instead of the
  area's, and they never respawn. Their home is the village square, so they never leave the village.
- **Rewards:** normal kill rewards; the win bonus (`raidReward`) for every signed-in player who hit a raider;
  the Captain's Binding Flux (`CAPTAIN_FLUX`) for everyone who helped defeat him. Guests roll their own kill
  rewards as before and get no win bonus.
- **Network** (`WORLD_PROTOCOL` 3, so older browsers are asked to reload): `spawn` and `despawn` add and remove
  raiders, `raid` carries the phase, raiders left and seconds left for the HUD, and `welcome` includes both
  for a player who joins mid-raid.
- **Browser:** raiders are created and removed as the server says (`Online.ts`), with an ember-red tint
  (`Enemy.ts`); a banner at the top shows the countdown and raiders left (`Hud.ts`). Horn and arrival are
  announced with the existing notices; there is no horn sound yet.
- **Saved state:** readiness, the last raid time, the raid count and the Captain's camp go into the existing
  `world:observer` row, under `raid`. No new rows and nothing that costs money.
- **Server setting:** `RAIDS=1` lets raids start on their own. Without it nothing starts by itself.
- **Tests:** `packages/game-rules/test/raid.test.ts` (rules); `apps/server/test/raids.test.ts` (on a fake clock:
  readiness and the horn, a full win with both waves and rewards, losses by abandonment and by time, the
  camp, saving); `apps/server/test/worldState.test.ts` (the raid state survives a restart);
  `tests/e2e/world.spec.ts` (in a real browser: the banner, three raiders, a kill, a loss and the camp).

## 6. Open questions for later (not needed to start)

- **"Daily" protection fee (AF-012):** the game has no in-game day yet. A real day (24 hours), or a shorter
  game day, needs deciding before AF-012.
- **Should guests count toward raid size?** They do in this proposal, since they fight the raiders too.

## 7. Trying it

- **On your machine:** `npm run world`, open http://localhost:2568/?debug, start a game, then in the browser
  console run `__alloy.raid(5)` (a raid with a 5-second warning). This needs `ALLOW_TELEPORT=1` (local only),
  like the other test hooks. To have raids start on their own, also set `RAIDS=1`.
- **On the live server:** add the setting `RAIDS=1` in Render's Environment settings (a settings change on the
  hosting, so the owner does it). Raids then start on their own as in section 1. The test command never
  works there.
