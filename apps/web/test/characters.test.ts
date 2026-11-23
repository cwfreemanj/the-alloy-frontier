/**
 * Character models + animation library: the files exist, every clip the game asks for is in the
 * library, attack strike frames land inside the rules' active window, and the real loader /
 * retargeter / body run in Node (no GPU needed) without producing NaN poses.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { ATTACKS } from '@alloy/game-rules';
import { ENEMIES } from '@alloy/game-rules';
import { CharacterBody, clipMeta, createBody, loadCharacters, phaseClipTime, PLAYER_CHARACTERS } from '../src/entities/models/Characters';
import { ENEMY_ANIMS, NPC_ANIMS, playerAnims, type RoleAnims } from '../src/entities/models/animSets';
import { playerAnimRequest } from '../src/entities/Player';

const MODELS = resolve(__dirname, '../public/models');
const manifest = JSON.parse(readFileSync(resolve(MODELS, 'manifest.json'), 'utf8')) as { characters: Record<string, { file: string }>; anims: { file: string }; clips: Record<string, { duration: number; peak: number }> };

function clipsOf(r: RoleAnims): string[] {
  return [...Object.values(r.loco), ...Object.values(r.attacks).map((a) => a.clip), r.stagger, r.death, r.guard, r.block, r.dodge, r.jump, r.gather].filter((x): x is string => !!x);
}

describe('character asset manifest', () => {
  it('lists files that exist', () => {
    for (const c of Object.values(manifest.characters)) expect(existsSync(resolve(MODELS, c.file))).toBe(true);
    expect(existsSync(resolve(MODELS, manifest.anims.file))).toBe(true);
  });
  it('has every clip the game uses', () => {
    const roles = [playerAnims('maria'), ...Object.values(ENEMY_ANIMS).filter((r): r is RoleAnims => !!r)];
    const used = new Set([...roles.flatMap(clipsOf), ...Object.values(NPC_ANIMS).map((n) => n.idle)]);
    for (const id of used) expect(manifest.clips[id], id).toBeTruthy();
    for (const r of roles) expect(manifest.characters[r.model], r.model).toBeTruthy();
    for (const n of Object.values(NPC_ANIMS)) expect(manifest.characters[n.model], n.model).toBeTruthy();
  });
  it('covers every player attack and every modelled enemy attack', () => {
    const p = playerAnims('exo');
    for (const id of Object.keys(ATTACKS)) expect(p.attacks[id], id).toBeTruthy();
    for (const [type, r] of Object.entries(ENEMY_ANIMS)) for (const a of ENEMIES[type].attacks) expect(r!.attacks[a.id], `${type}.${a.id}`).toBeTruthy();
  });
});

describe('runtime loader, retargeting and bodies', () => {
  beforeAll(async () => {
    // Serve /models/* from disk and stub the browser image path (textures aren't needed here).
    // three's FileLoader builds a Request from a relative URL, which Node rejects; keep just the URL.
    (globalThis as Record<string, unknown>).Request = class {
      constructor(readonly url: string) {}
    };
    (globalThis as Record<string, unknown>).ProgressEvent ??= class {
      constructor(
        readonly type: string,
        init: Record<string, unknown> = {},
      ) {
        Object.assign(this, init);
      }
    };
    globalThis.fetch = (async (input: unknown) => {
      const url = typeof input === 'object' && input && 'url' in input ? String((input as { url: string }).url) : String(input);
      const path = resolve(MODELS, url.replace(/^.*\/models\//, '').replace(/\?.*$/, ''));
      const buf = readFileSync(path);
      return new Response(buf, { status: 200, headers: { 'content-type': path.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
    }) as typeof fetch;
    (globalThis as Record<string, unknown>).self = globalThis;
    (globalThis as Record<string, unknown>).Image = class {
      width = 1;
      height = 1;
      onload?: () => void;
      set src(_v: string) {
        setTimeout(() => this.onload?.());
      }
    };
    THREE.TextureLoader.prototype.load = function (_url: string, onLoad?: (t: THREE.Texture) => void) {
      const t = new THREE.Texture();
      setTimeout(() => onLoad?.(t));
      return t;
    } as typeof THREE.TextureLoader.prototype.load;
    delete (globalThis as Record<string, unknown>).createImageBitmap;
    expect(await loadCharacters()).toBe(true);
  }, 60_000);

  it('places each attack strike frame inside the active window', () => {
    const roles = [playerAnims('maria'), ...Object.values(ENEMY_ANIMS).filter((r): r is RoleAnims => !!r)];
    for (const r of roles)
      for (const a of Object.values(r.attacks)) {
        const peak = clipMeta(a.clip)!.peak;
        const a0 = phaseClipTime(a.clip, 'active', 0, a.shape);
        const a1 = phaseClipTime(a.clip, 'active', 1, a.shape);
        expect(peak, a.clip).toBeGreaterThanOrEqual(a0);
        expect(peak, a.clip).toBeLessThanOrEqual(a1);
        // Monotonic through the phases.
        expect(phaseClipTime(a.clip, 'windup', 0, a.shape)).toBeLessThanOrEqual(phaseClipTime(a.clip, 'windup', 1, a.shape));
        expect(phaseClipTime(a.clip, 'windup', 1, a.shape)).toBeCloseTo(a0, 5);
        expect(phaseClipTime(a.clip, 'recovery', 0, a.shape)).toBeCloseTo(a1, 5);
      }
  });

  it('animates both player characters through every combat state without NaNs', () => {
    for (const { id } of PLAYER_CHARACTERS) {
      const a = playerAnims(id);
      const body = createBody(a.model, a.heightM, a.loco)!;
      expect(body).toBeInstanceOf(CharacterBody);
      const base = { alive: true, deadTime: 0, gatherK: null, phase: 'idle', attackId: null, k: 0, t: 0, blocking: false, airTime: null, speed: 0, dirX: 0, dirZ: 1 };
      const states = [
        base,
        { ...base, speed: 4.6 },
        { ...base, speed: 7.6 },
        { ...base, speed: 3, dirX: 0, dirZ: -1 },
        { ...base, speed: 3, dirX: 1, dirZ: 0 },
        ...Object.keys(ATTACKS).flatMap((atk) => (['windup', 'active', 'recovery'] as const).map((phase) => ({ ...base, phase, attackId: atk, k: 0.5 }))),
        { ...base, phase: 'dodge', k: 0.5 },
        { ...base, phase: 'stagger', t: 0.2 },
        { ...base, blocking: true },
        { ...base, airTime: 0.3 },
        { ...base, gatherK: 0.9 },
        { ...base, alive: false, deadTime: 1.5 },
      ];
      const hand = new THREE.Vector3();
      for (const s of states) {
        for (let i = 0; i < 4; i++) body.update(1 / 30, playerAnimRequest(s));
        body.root.updateMatrixWorld(true);
        body.rHand.getWorldPosition(hand);
        expect(Number.isFinite(hand.x + hand.y + hand.z), JSON.stringify(s)).toBe(true);
        expect(hand.length()).toBeLessThan(5);
      }
      // The hand attachment works in metres regardless of the model's units.
      const ws = new THREE.Vector3();
      body.rHand.getWorldScale(ws);
      expect(ws.x).toBeCloseTo(1, 3);
    }
  });

  it('builds enemies and NPCs at their intended heights', () => {
    for (const r of [...Object.values(ENEMY_ANIMS).filter((x): x is RoleAnims => !!x)]) {
      const body = createBody(r.model, r.heightM, r.loco)!;
      body.update(1 / 30, { kind: 'loco', speed: 0 });
      body.root.updateMatrixWorld(true);
      const box = new THREE.Box3();
      body.root.traverse((o) => {
        if ((o as THREE.Bone).isBone) box.expandByPoint(o.getWorldPosition(new THREE.Vector3()));
      });
      expect(box.max.y).toBeGreaterThan(r.heightM * 0.75);
      expect(box.max.y).toBeLessThan(r.heightM * 1.1);
    }
    for (const n of Object.values(NPC_ANIMS)) expect(createBody(n.model, n.heightM, { idle: n.idle, walk: n.idle, run: n.idle })).toBeTruthy();
  });
});
