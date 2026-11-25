#!/usr/bin/env node
// Add a dated entry to the top of a contributor's dev log (docs/devlog/<name>.md).
// Usage: npm run devlog -- "Title" [--as name] [--pr 29] [--asked ..] [--done ..] [--not-done ..] [--verified ..] [--notes ..]
// See docs/devlog/README.md.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIELDS = { pr: 'PR', asked: 'Asked for', done: 'Done', 'not-done': 'Not done / deferred', verified: 'Verified', notes: 'Notes' };
const ZONE = 'America/New_York'; // The team's time zone (docs/devlog/README.md).

export function parseArgs(argv) {
  const out = { title: '', as: '', fields: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out.title = out.title ? `${out.title} ${a}` : a;
      continue;
    }
    const key = a.slice(2);
    const value = argv[++i];
    if (value === undefined) throw new Error(`${a} needs a value`);
    if (key === 'as') out.as = value;
    else if (key in FIELDS) (out.fields[key] ??= []).push(value);
    else throw new Error(`Unknown option ${a}. Use --as, ${Object.keys(FIELDS).map((k) => `--${k}`).join(', ')}.`);
  }
  if (!out.title.trim()) throw new Error('Give the entry a title, e.g. npm run devlog -- "Playtested the forge"');
  return out;
}

/** "2026-11-25 14:41" in the team's time zone. */
export function stamp(date = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(date)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** A log's file name from a person's or agent's name: "Neal" -> "neal". */
export function slug(name) {
  const s = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // claude.md and agents.md would be the instruction files CLAUDE.md and AGENTS.md on Windows.
  return s === 'claude' ? 'claude-code' : s === 'agents' ? 'agents-log' : s;
}

export function entry({ title, fields }, date = new Date()) {
  const lines = [`## ${stamp(date)} — ${title.trim()}`];
  for (const [key, label] of Object.entries(FIELDS)) {
    const values = fields[key];
    if (!values?.length) continue;
    if (values.length === 1) lines.push(`- **${label}:** ${values[0]}`);
    else lines.push(`- **${label}:**`, ...values.map((v) => `  - ${v}`));
  }
  return lines.join('\n') + '\n';
}

/** Put the entry above the first existing entry (newest first), or create the log. */
export function insert(existing, text, who) {
  if (existing === undefined) {
    return `# Dev log: ${who}\n\nNewest first. Times are US Eastern. How to write entries: [README.md](README.md).\n\n${text}`;
  }
  const at = existing.search(/^## /m);
  if (at < 0) return existing.replace(/\s*$/, '\n\n') + text;
  return existing.slice(0, at) + text + '\n' + existing.slice(at);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let who = args.as;
  if (!who) {
    try {
      who = execSync('git config user.name', { encoding: 'utf8' }).trim();
    } catch {
      throw new Error('No git user name; pass --as <name>.');
    }
  }
  const name = slug(who);
  if (!name) throw new Error(`Can't make a file name from "${who}"; pass --as <name>.`);
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'devlog', `${name}.md`);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  writeFileSync(file, insert(before, entry(args), who));
  console.log(`${before === undefined ? 'Started' : 'Added to'} docs/devlog/${name}.md`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
