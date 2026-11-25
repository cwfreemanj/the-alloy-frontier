import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs tool without type declarations
import { entry, insert, parseArgs, slug, stamp } from '../devlog.mjs';

describe('dev log helper', () => {
  it('stamps US Eastern time, including daylight saving', () => {
    expect(stamp(new Date('2026-11-25T19:41:00Z'))).toBe('2026-11-25 14:41');
    expect(stamp(new Date('2026-07-01T12:05:00Z'))).toBe('2026-07-01 08:05');
  });

  it('reads the title and repeatable fields', () => {
    const a = parseArgs(['Character names', '--as', 'claude', '--pr', '29', '--done', 'Names', '--done', 'HUD']);
    expect(a).toEqual({ title: 'Character names', as: 'claude', fields: { pr: ['29'], done: ['Names', 'HUD'] } });
    expect(() => parseArgs(['--done', 'x'])).toThrow(/title/);
    expect(() => parseArgs(['T', '--bogus', 'x'])).toThrow(/Unknown option/);
  });

  it('writes one bullet per field, nesting repeats', () => {
    const text = entry({ title: 'Names', fields: { done: ['A', 'B'], notes: ['N'] } }, new Date('2026-11-25T19:41:00Z'));
    expect(text).toBe('## 2026-11-25 14:41 — Names\n- **Done:**\n  - A\n  - B\n- **Notes:** N\n');
  });

  it('puts new entries above older ones, and starts a log when there is none', () => {
    const log = '# Dev log: Neal\n\nIntro.\n\n## 2026-11-24 10:00 — Older\n- **Notes:** x\n';
    const out = insert(log, '## 2026-11-25 14:41 — Newer\n', 'Neal');
    expect(out.indexOf('Newer')).toBeLessThan(out.indexOf('Older'));
    expect(out.startsWith('# Dev log: Neal\n\nIntro.\n\n## 2026-11-25')).toBe(true);
    expect(insert(undefined, '## e\n', 'Codex')).toMatch(/^# Dev log: Codex\n[\s\S]*## e\n$/);
  });

  it('turns names into file names', () => {
    expect(slug('Neal')).toBe('neal');
    expect(slug(' Claude Code ')).toBe('claude-code');
    // Never claude.md / agents.md: on Windows those are the instruction files CLAUDE.md / AGENTS.md.
    expect(slug('Claude')).toBe('claude-code');
    expect(slug('AGENTS')).toBe('agents-log');
  });
});
