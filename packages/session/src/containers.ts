/**
 * Searching barrels, chests and trail caches. Each character has its own loot: a container it
 * searched refills after the container's `refill` seconds of that character's play time.
 * The loot roll is seeded by the character, the container and how often it was searched, so
 * the server and a guest's browser roll the same way and a retry can't re-roll.
 */
import { BLUEPRINT_DROP, Rng, generateBlueprint, type BlueprintArea, type MaterialId } from '@alloy/item-gen';
import { containerDef, zoneAt, type ContainerKind } from '@alloy/world';
import type { Session } from './session';

export interface ContainerState {
  /** Play time (s) when it can be searched again. */
  readyAt: number;
  /** Times searched (seeds the next roll). */
  n: number;
}

export interface Loot {
  coins: number;
  items: Array<{ material: MaterialId; qty: number; quality: number }>;
}

type Roll = (r: Rng) => Loot;
const q = (r: Rng, lo: number, hi: number) => Math.round((lo + r.next() * (hi - lo)) * 100) / 100;

const TABLES: Record<ContainerKind, Roll> = {
  barrel: (r) => {
    const x = r.next();
    if (x < 0.35) return { coins: 0, items: [] };
    if (x < 0.6) return { coins: r.int(2, 6), items: [] };
    if (x < 0.8) return { coins: 0, items: [{ material: 'emberleaf', qty: r.int(1, 2), quality: q(r, 0.4, 0.7) }] };
    if (x < 0.92) return { coins: 0, items: [{ material: 'binding_flux', qty: 1, quality: 0.5 }] };
    return { coins: 0, items: [{ material: 'healing_salve', qty: 1, quality: q(r, 0.35, 0.55) }] };
  },
  chest: (r) => {
    const items: Loot['items'] = [{ material: 'binding_flux', qty: 2, quality: 0.5 }];
    if (r.next() < 0.3) items.push({ material: 'healing_salve', qty: 1, quality: q(r, 0.45, 0.65) });
    return { coins: r.int(8, 15), items };
  },
  cache: (r) => {
    const x = r.next();
    const items: Loot['items'] =
      x < 0.3
        ? [{ material: 'iron_ore', qty: r.int(2, 3), quality: q(r, 0.6, 0.85) }]
        : x < 0.55
          ? [{ material: 'ironglass', qty: r.int(1, 2), quality: q(r, 0.55, 0.8) }]
          : x < 0.85
            ? [{ material: 'healing_salve', qty: r.int(1, 2), quality: q(r, 0.5, 0.75) }]
            : [{ material: 'stamina_tonic', qty: 1, quality: q(r, 0.5, 0.75) }];
    if (r.next() < 0.15) items.push({ material: 'binding_flux', qty: 2, quality: 0.5 });
    return { coins: r.int(12, 30), items };
  },
};

/** The roll for a character's n-th search of a container (pure). */
export function rollLoot(kind: ContainerKind, characterSeed: string, containerId: string, n: number): Loot {
  return TABLES[kind](new Rng(`search:${characterSeed}:${containerId}:${n}`));
}

/** Seconds until a container can be searched again by this character (0 = ready). */
export function containerCooldown(s: Session, id: string): number {
  const st = s.data.world.containers?.[id];
  return st ? Math.max(0, st.readyAt - s.data.playTime) : 0;
}

/** Search a container (range is checked by the caller). */
export function searchContainer(s: Session, id: string): { ok: true; loot: Loot } | { ok: false; error: string; message: string } {
  const def = containerDef(id);
  if (!def) return { ok: false, error: 'unknown_container', message: 'Nothing to search here.' };
  const wait = containerCooldown(s, id);
  if (wait > 0) return { ok: false, error: 'searched', message: `Already searched. Check back in ${Math.ceil(wait / 60)} min.` };
  const map = (s.data.world.containers ??= {});
  const n = map[id]?.n ?? 0;
  const loot = rollLoot(def.kind, String(s.data.createdAt), id, n);
  for (const it of loot.items) s.gather(`search:${id}`, it.material, it.qty, it.quality, {});
  // Sometimes a blueprint (STAND-IN chances), seeded like the rest of the roll so a retry can't re-roll.
  const r = new Rng(`search-blueprint:${String(s.data.createdAt)}:${id}:${n}`);
  if (r.next() < BLUEPRINT_DROP[def.kind]) {
    const area = zoneAt(def.pos).id as BlueprintArea;
    s.addBlueprint(generateBlueprint(`search:${String(s.data.createdAt)}:${id}:${n}`, { area, source: 'chest', sourceId: id, level: 1 }));
  }
  if (loot.coins > 0) s.addCoins(loot.coins);
  map[id] = { readyAt: s.data.playTime + def.refill, n: n + 1 };
  const names: Record<string, string> = { iron_ore: 'Iron Ore', ironglass: 'Ironglass Shard', emberleaf: 'Emberleaf', binding_flux: 'Binding Flux', healing_salve: 'Healing Salve', stamina_tonic: 'Stamina Tonic' };
  const parts = [...(loot.coins ? [`${loot.coins} coins`] : []), ...loot.items.map((i) => `${i.qty}× ${names[i.material] ?? i.material}`)];
  const empty = def.kind === 'barrel' ? 'Just sawdust and old rags.' : 'Empty.';
  s.notify({ type: 'searched', id, found: parts.length > 0 });
  s.notify({ type: 'toast', text: parts.length ? `Found ${parts.join(', ')}` : empty, tone: parts.length ? 'good' : 'info' });
  return { ok: true, loot };
}
