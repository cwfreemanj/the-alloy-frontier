import { describe, expect, it } from 'vitest';
import { boardFor, startHammering, suggestStrike, applyStrike } from '@alloy/crafting';
import { SAVE_KEY, MemoryStore, SaveSystem, deserialize, serialize } from '../src/state/Save';
import { Session, newSessionData } from '../src/state/Session';

function playThrough(): Session {
  const s = new Session(newSessionData(1));
  s.talk('orla');
  s.recordKill('scavenger');
  s.gather('ore-t1', 'iron_ore', 6, 0.7, { purity: 0.7 });
  s.gather('wood-t1', 'ironwood', 3, 0.5, {});
  s.gather('glass-q1', 'ironglass', 3, 0.8, {});
  s.talk('orla');
  s.quest({ type: 'event', event: 'open_merchant' });
  const q = s.forge({ txId: 'tx-q', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2 });
  if (!q.ok) throw new Error(q.message);
  const board = boardFor(s.inventory, 'ironglass_longsword');
  let st = startHammering(board, 'cherry', s.smithMastery);
  for (;;) {
    const k = suggestStrike(st, board.size, 'cherry');
    if (!k) break;
    st = applyStrike(st, board.size, k)!.state;
  }
  const m = s.forge({ txId: 'tx-m', blueprintId: 'ironglass_longsword', mode: 'masterwork', bufferQuantity: 3, specialization: 'heavy', temper: 'oil', evidence: { heat: 'cherry', strikes: st.log } });
  if (!m.ok) throw new Error(m.message);
  s.equip(m.item.itemId);
  return s;
}

describe('session quest integration', () => {
  it('runs the full quest chain through the authority layer', () => {
    const s = playThrough();
    expect(s.step()?.id).toBe('foundry');
    s.recordKill('warden');
    s.talk('orla');
    expect(s.data.quest.completed).toBe(true);
    expect(s.data.summary?.itemId).toBe(s.equipped()?.itemId);
    expect(s.smithMastery).toBeGreaterThan(10);
  });

  it('crafted weapon outperforms the merchant sword', () => {
    const s = playThrough();
    expect(s.equipped()!.result.damage).toBeGreaterThan(20);
    expect(s.equipped()!.result.rating).toBeGreaterThan(245);
  });

  it('keeps partial gather progress so the tracker can show it', () => {
    const s = new Session(newSessionData(1));
    s.talk('orla');
    s.recordKill('scavenger');
    expect(s.step()?.id).toBe('gather');
    const toasts: string[] = [];
    s.on((e) => e.type === 'toast' && toasts.push(e.text));
    s.gather('n1', 'iron_ore', 2, 0.6, {});
    expect(s.data.quest.progress.iron_ore).toBe(2);
    s.gather('n2', 'ironglass', 1, 0.7, {});
    expect(s.data.quest.progress).toMatchObject({ iron_ore: 2, ironglass: 1 });
    expect(toasts.some((t) => t.includes('Iron Ore 2/5'))).toBe(true);
    expect(s.step()?.id).toBe('gather');
  });

  it('gates quest events out of order (equip before step is retro-credited)', () => {
    const s = new Session(newSessionData(1));
    s.quest({ type: 'event', event: 'craft_quick' });
    expect(s.step()?.id).toBe('commission');
  });
});

describe('save/load integrity (M3 #6)', () => {
  it('round-trips equipment, inventory, progression and quest exactly', () => {
    const s = playThrough();
    const store = new MemoryStore();
    const saves = new SaveSystem(store);
    expect(saves.save(s.data, 5).ok).toBe(true);
    const r = saves.load();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual(s.data);
    const restored = new Session(r.data);
    expect(restored.equipped()?.itemId).toBe(s.equipped()?.itemId);
    expect(restored.equipped()?.result).toEqual(s.equipped()?.result);
  });

  it('rejects tampered or corrupted saves and falls back to the backup', () => {
    const s = playThrough();
    const store = new MemoryStore();
    const saves = new SaveSystem(store);
    saves.save(s.data, 1);
    saves.save(s.data, 2); // creates backup of the first
    const raw = JSON.parse(store.getItem(SAVE_KEY)!);
    const id = raw.data.inventory.itemOrder[0];
    raw.data.inventory.items[id].result.damage = 9999;
    store.setItem(SAVE_KEY, JSON.stringify(raw));
    expect(deserialize(store.getItem(SAVE_KEY)!).ok).toBe(false);
    const r = saves.load();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.source).toBe('backup');
    store.setItem(SAVE_KEY, '{not json');
    expect(deserialize('{not json').ok).toBe(false);
  });

  it('refuses saves from a newer format', () => {
    const s = new Session(newSessionData(1));
    const env = JSON.parse(serialize(s.data, 1));
    env.format = 99;
    const r = deserialize(JSON.stringify(env));
    expect(r.ok).toBe(false);
  });

  it('cannot duplicate items by replaying a forge after load', () => {
    const s = playThrough();
    const store = new MemoryStore();
    new SaveSystem(store).save(s.data, 1);
    const r = new SaveSystem(store).load();
    if (!r.ok) throw new Error(r.reason);
    const again = new Session(r.data);
    const count = again.inventory.itemOrder.length;
    const rep = again.forge({ txId: 'tx-q', blueprintId: 'iron_longsword', mode: 'quick', bufferQuantity: 2 });
    expect(rep.ok && rep.duplicate).toBe(true);
    expect(again.inventory.itemOrder.length).toBe(count);
  });
});
