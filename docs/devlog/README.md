# Dev logs

A detailed, timestamped record of the work on Alloy Frontier: what was asked for, what was built,
what was left out and why, and how it was checked. Pull requests show the code. The dev logs
show the story around it.

**One log per contributor**, human or AI:

| Log | Who |
| --- | --- |
| [neal.md](neal.md) | Neal: technical director, backend |
| [cwfreemanj.md](cwfreemanj.md) | Neal's partner: creative director; models, animation, world art |
| [claude-code.md](claude-code.md) | Claude (AI agent, Claude Code) |

Another AI agent, such as Codex, or a new teammate starts its own file, `<name>.md`, and adds a row here.

## Writing an entry

- **Newest entry at the top**, just under the file's introduction.
- **Times are US Eastern** (the team's time zone), written `YYYY-MM-DD HH:MM`.
- **Write it when it happens:** at each checkpoint, when a pull request opens or merges, and when you stop for the day.
  A log written days later from memory is less useful.
- **Say what was not done**, as well as what was. A deferred idea, a failed approach, or a test that was
  skipped belongs in the log.
- **Only facts.** Test results only if you ran them and saw them pass (AGENTS.md hard rule 1).
- **No secrets:** no passwords, connection strings, keys or email addresses.

Entry shape (leave out lines that don't apply; human entries can be shorter):

```
## 2026-11-25 14:41 — Character names, separate from the account name
- **PR:** #29 `character-names` · merged 14:41
- **Asked for:** what was wanted, in plain words
- **Done:** what was actually built
- **Not done / deferred:** what was left out, and why
- **Verified:** which tests or checks ran, and their results
- **Notes:** decisions made, problems hit and how they were fixed
```

### The helper

`npm run devlog` adds a dated entry to the top of your log, so you don't have to work out the time:

```
npm run devlog -- "Playtested the forge" --notes "Hammering felt slow on the second blade"
npm run devlog -- "Character names" --as claude-code --pr 29 --done "Unique names per character" --not-done "Renaming"
```

- **Whose log:** your git user name picks the file (`git config user.name`, lower-cased). `--as <name>` picks another.
  AI agents always pass `--as <agent>`, such as `--as claude-code` or `--as codex`.
  The name `claude` is turned into `claude-code`: on Windows a `claude.md` file would be the same file as
  `CLAUDE.md`, which Claude Code reads as instructions.
- **Fields:** `--pr`, `--asked`, `--done`, `--not-done`, `--verified`, `--notes`. Each one can be repeated,
  and every use becomes a bullet.
- **New log:** if the file doesn't exist yet, the helper creates it.
- **Edit by hand afterwards:** the file is plain Markdown.
