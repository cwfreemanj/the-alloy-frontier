# Adaptive world

The world reacts to how it is played. This is the first piece: the server observes the world
area by area, and areas where much stronger players linger get tougher enemies.

## The world observer (server)

`apps/server/src/worldObserver.ts`, owned by the world room.

- **Tallies per area** (the four zones in `@alloy/world` `ZONES`):
  - players there now, and the highest rank among them;
  - time spent there, kills, deaths, gathers and searches.
- **The tallies fade:** they halve every 20 minutes of real time (`ADAPT.halfLifeSec`), so the
  world reacts to recent play, and keeps fading while the server is empty.
- **Who counts:** only signed-in characters, because the server knows their rank. Guests keep
  their character in their browser.
- **Updates:** the observer updates every 2 seconds while anyone is online.
- **Watching it:** `GET /world-info` includes `areas` with the rounded tallies and each area's
  current level. It contains no names.

## Area pressure → enemy levels

Rules in `packages/game-rules/src/adaptive.ts`, shared by the server and the browser.

- **Each area has a level:** village 1, trail 1, quarry 2, foundry 4 (`Zone.level`).
- **Over-levelled players:** a player counts as over-levelled for an area when their adventurer
  rank is more than 2 above the area's level.
- **Pressure builds** from two sources:
  - the time an over-levelled player spends there, multiplied by how far over they are;
  - each kill they take part in, which adds 45 × how far over they are.
- **Levels from pressure:** every 900 pressure raises the area's enemies one level, up to +3. A
  level drops only once the pressure falls 20% below its threshold, so levels don't flicker.
- **How fast it happens:**
  - A rank-8 player on the trail raises it to the maximum (+3) in about 10 minutes.
  - Once they leave, it settles back over the next hour or two.
  - A player of the area's own rank never moves it.
- **What a level changes** (`scaledArchetype`), for each level above the enemy's own:
  - health +30%, damage +15%, defense +10% and poise +15%;
  - +1 to each attribute;
  - XP +35% and coins +25%.
- **When the change takes effect:** only when the enemy is out of a fight at full health, or when
  it respawns. An enemy never changes level mid-fight.
- **The server decides everything:** it applies the level to its own enemies, which covers damage
  and rewards, and sends `lv` in the enemy state. Browsers use the same rule, so the "Lv" plate
  and health bars match.
- **Announcements:** online players get a `notice` when an area's level changes, for example
  "Word of a seasoned fighter spreads through the Ironwood Trail. Its foes grow bolder (level 3)."
  Older clients ignore the message.

## Next: events (design notes, not built)

The observer's tallies are meant to drive world events:

- **Raids on Emberhold:**
  - A lookout on the watchtower raises the alarm.
  - 5 to 10 raiders and an elite Raider Captain attack the village, scaled to how many players
    are in it and where they are.
- **If the village loses:**
  - It pays a protection fee every in-game day, in coins or in forged equipment, until someone
    defeats the Captain.
  - The forged gear goes to the raiders, making their next attacks stronger.
- **Saving the tallies (built, AF-013):** the free server restarts when it sleeps or redeploys, so the
  tallies and area levels are kept in the accounts storage (Postgres on the live server), in one
  row, `world:observer` (`apps/server/src/worldState.ts`).
  - **Loaded at start-up**, before anyone joins. Enemies start at their area's restored level.
  - **Faded by the downtime:** on loading, the tallies fade by the time the server was down, as if
    it had stayed up with nobody playing. A long sleep can bring an area's level back down.
  - **Written at most once a minute**, and only when players were in the world or something happened.
    An empty world isn't written at all, so the database can sleep too (free plan). Also written when
    the server stops.
  - **Bad saved data, or the database being down,** never stops the world: it starts fresh, logs the
    problem, and tries the write again next minute.
