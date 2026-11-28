# Needed from people

Things only a person can do, which the project is waiting on. **AI agents: read this at the start of
every session, before any other work, and tell the person you're working with about their items**
(see "Before you start" in [AGENTS.md](../AGENTS.md)).

Most important first. When an item is done, remove it here in the same pull request as its result.

## Creative director (git name `cwfreemanj`)

1. **Performance report from your own computer. Top priority, about 5 minutes.**
   - **Why:** performance has only been measured on the technical director's laptop. A second machine
     shows how the game runs on different hardware, and M4 can't be signed off without it. It also
     decides whether the performance pass (AF-014) is needed.
   - **How:**
     1. Open https://alloy-frontier.onrender.com in a normal Chrome or Edge window, at your usual
        screen size. The first load can take about a minute while the server wakes.
     2. Leave the graphics preset on medium (the default) and play for a few minutes.
     3. Stand still on the Ironwood Trail for 15 seconds.
     4. Press **Esc**, then **Copy performance report**.
     5. Optional: switch to the low preset and repeat steps 3 and 4.
     6. Give the report to your AI agent, or send it to the technical director.
   - **For the agent:** you can't take this measurement yourself: it has to come from the person's own
     browser, since headless and automated numbers aren't reliable. Walk them through the steps, then
     save the report as `docs/perf/<date>-creative-director-<machine>.md`, fill in the creative director's
     row in section 2 of [M4.md](M4.md), and open a pull request.
2. **Play the game through once, from a new character to the quest summary**, and answer the five
   questions (F1–F5) in section 1 of [M4.md](M4.md). M4 needs three playthroughs in all, from anyone.
3. **Sign off gameplay feel and UI clarity**, after the playthroughs: section 3 of [M4.md](M4.md).
4. **Review the forge expansion (your area: item generation and looks).** The forge now makes maces, shields,
   helmets, chestplates and platelegs with starter stats, and uses your workshop generator for their looks.
   Check or change the numbers and looks: [forge-expansion.md](forge-expansion.md) lists what to look at.
   About 15 minutes.
5. **Review the proficiency tree:** [proficiency-tree.md](proficiency-tree.md). It builds on your three branches
   (Smithing, Crafting, Alchemy). The technical director approved it so building could start (step 1 is built);
   change anything you want, especially the perk list, which is your call. About 10 minutes.
6. **Agree the blueprint contract:** [blueprint-contract.md](blueprint-contract.md). It turns your blueprint design
   into what `generateBlueprint` returns and what the game does with it. The technical director has made the four
   open decisions (section 3: learned and the scroll stays, set pieces one at a time, duplicates, the fixed list
   stays). About 15 minutes. The game side is already built against a stand-in, so your next build step is the
   real `generateBlueprint` and drop table: replace them in `packages/item-gen/src/found.ts` (contract section 5).

## Technical director (git name `Neal`)

1. **Play the game through once, from a new character**, and fill in a row in section 1 of
   [M4.md](M4.md). Three playthroughs are needed in all.
2. **Tag the `v0.1.0` release** once the creative director has signed off (yours is done): section 4 of [M4.md](M4.md).
