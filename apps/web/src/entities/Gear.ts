/**
 * 3D looks for forged gear (forge expansion, phase 1), made by the creative director's Model Workshop
 * generator (world/workshop/equipment.js). Looks only: an item's stats always come from @alloy/item-gen.
 *
 * - The generator is loaded on demand (its own chunk), the first time someone has such an item.
 * - Each blueprint + rarity is built once, merged per material, and shared by every wearer.
 * - Held items (maces) go in the right-hand frame: grip at the origin, head along local -Y.
 * - The shield and the helmet are placed the way the workshop fits its mannequin, using this
 *   character's own rest skeleton (T-pose), then parented to a bone so they follow the animation.
 *   The helmet is scaled from the mannequin's head to this character's.
 * - Chest and leg armor have no look on the character yet (phase 2: fitting to Maria and Exo).
 */
import * as THREE from 'three';
import { getBlueprint, type BlueprintDefinition } from '@alloy/item-gen';
import type { EquipmentMeta } from '../world/workshop/equipment.js';
import { buildModel, optimizeForGame } from '../world/workshop/core.js';
import { workshopBank } from '../world/WorkshopModels';
import { CharacterBody } from './models/Characters';
import type { Rig } from './Rig';

export interface GearLook {
  /** Template: clone it (geometry and materials are shared). */
  group: THREE.Group;
  meta: EquipmentMeta;
}

/** The workshop mannequin's head (body.js), for scaling helmets to other heads. */
const MANNEQUIN_HEAD = new THREE.Vector3(0, 1.5549, -0.0329);
const MANNEQUIN_HEAD_TOP = new THREE.Vector3(0, 1.7649, 0.0287);

const looks = new Map<string, Promise<GearLook | null>>();

type LookSpec = NonNullable<BlueprintDefinition['look']>;

/** A look in the short network form "type:shape:blend" (other players' found gear). */
export const lookToNet = (l: LookSpec | undefined): string | undefined => (l ? [l.type, l.shape ?? '', l.blend ?? ''].join(':') : undefined);
export function lookFromNet(s: string | undefined): LookSpec | undefined {
  if (!s) return undefined;
  const [type, shape, blend] = s.split(':');
  return type ? { type, ...(shape ? { shape } : {}), ...(blend ? { blend } : {}) } : undefined;
}

/**
 * The look of a blueprint at a rarity (null: no workshop look, or it failed to build). Found blueprints
 * aren't in the standard table, so their look is passed in.
 */
export function gearLook(blueprintId: string, rarity: string, given?: LookSpec): Promise<GearLook | null> {
  const look = given ?? getBlueprint(blueprintId)?.look;
  const key = `${blueprintId}|${rarity}|${lookToNet(look) ?? ''}`;
  let p = looks.get(key);
  if (!p) {
    p = !look
      ? Promise.resolve(null)
      : import('../world/workshop/equipment.js')
          .then(({ generateEquipment }) => {
            // The seed is the blueprint, so every copy of a blueprint looks alike at a given rarity.
            const recipe = generateEquipment(look.type, { seed: blueprintId, rarity, blend: look.blend, shape: look.shape });
            const group = optimizeForGame(buildModel(recipe, workshopBank()));
            group.traverse((o) => {
              if ((o as THREE.Mesh).isMesh) o.castShadow = true;
            });
            return { group, meta: recipe.meta };
          })
          .catch((e: unknown) => {
            console.warn(`No look for ${blueprintId}: ${(e as Error).message}`);
            return null;
          });
    looks.set(key, p);
  }
  return p;
}

/**
 * A held item in the right-hand frame: the workshop builds it standing on y = 0 with meta.grip and
 * meta.tip; the game holds the grip at the origin with the head along -Y.
 */
export function holdable(look: GearLook): { group: THREE.Group; reach: number } {
  const grip = new THREE.Vector3(...((look.meta.grip ?? look.meta.mount?.point ?? [0, 0.1, 0]) as [number, number, number]));
  const tip = new THREE.Vector3(...((look.meta.tip ?? [0, 0.8, 0]) as [number, number, number]));
  const inner = look.group.clone();
  inner.position.copy(grip).negate();
  const outer = new THREE.Group();
  outer.rotation.z = Math.PI; // +Y (toward the head) becomes -Y
  outer.add(inner);
  return { group: outer, reach: tip.distanceTo(grip) };
}

/** Rest (T-pose) bone transforms of a character in its model space, from the skin's bind data. */
function restBones(body: CharacterBody): { model: THREE.Object3D; bones: Map<string, { bone: THREE.Bone; rest: THREE.Matrix4 }> } | null {
  let skinned: THREE.SkinnedMesh | null = null;
  body.root.traverse((o) => {
    if (!skinned && (o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
  });
  const mesh = skinned as THREE.SkinnedMesh | null;
  if (!mesh) return null;
  const bones = new Map<string, { bone: THREE.Bone; rest: THREE.Matrix4 }>();
  mesh.skeleton.bones.forEach((bone, i) => {
    // boneInverse is the inverse of the bone's transform when the skin was bound: this is the bone's
    // rest (T-pose) transform in the skin's bind space. That space may be scaled differently from the
    // model now (the characters were bound at their own scale), so sizes are measured in it (bindScale).
    const rest = mesh.skeleton.boneInverses[i].clone().invert();
    bones.set(bone.name.replace(/^mixamorig:?/, ''), { bone, rest });
  });
  // The model node: the bones' common ancestor directly under the body root.
  let model: THREE.Object3D = mesh;
  while (model.parent && model.parent !== body.root) model = model.parent;
  return { model, bones };
}

const pos = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);

/**
 * Put a worn or strapped piece on a character: `placeMetres` gives the piece's transform in the
 * character's rest pose, in metres (model space × unit). Returns the object added (to remove later).
 */
function attachAtRest(body: CharacterBody, boneName: string, piece: THREE.Object3D, placeMetres: (restM: (name: string) => THREE.Vector3 | null) => THREE.Matrix4 | null): THREE.Object3D | null {
  const rb = restBones(body);
  const target = rb?.bones.get(boneName);
  if (!rb || !target) return null;
  // Bind units per metre: bones are unscaled in the model (1 model unit = body.unit metres), so a bone's
  // scale in bind space is bind units per model unit.
  const perModelUnit = new THREE.Vector3().setFromMatrixColumn(target.rest, 0).length();
  const f = perModelUnit / body.unit;
  const restM = (name: string) => {
    const b = rb.bones.get(name);
    return b ? pos(b.rest).divideScalar(f) : null;
  };
  const m = placeMetres(restM);
  if (!m) return null;
  // Metres -> bind space, then relative to the bone's rest transform (both in bind space).
  const bind = new THREE.Matrix4().makeScale(f, f, f).multiply(m);
  const local = target.rest.clone().invert().multiply(bind);
  local.decompose(piece.position, piece.quaternion, piece.scale);
  target.bone.add(piece);
  return piece;
}

/** A shield strapped along the outside of the left forearm (the workshop's shield mount). */
function wearShield(body: CharacterBody, look: GearLook): THREE.Object3D | null {
  const piece = look.group.clone();
  return attachAtRest(body, 'LeftForeArm', piece, (restM) => {
    const elbow = restM('LeftForeArm');
    const wrist = restM('LeftHand');
    if (!elbow || !wrist) return null;
    const Y = new THREE.Vector3(0, 0, 1);
    const X = new THREE.Vector3().crossVectors(Y, new THREE.Vector3(0, 1, 0));
    const Z = new THREE.Vector3().crossVectors(X, Y).normalize();
    const basis = new THREE.Matrix4().makeBasis(X, Y, Z);
    const at = elbow.lerp(wrist, look.meta.shape === 'buckler' ? 0.95 : 0.62).add(new THREE.Vector3(0, 0.068, 0));
    const point = new THREE.Vector3(...((look.meta.mount?.point ?? [0, 0, 0]) as [number, number, number])).applyMatrix4(new THREE.Matrix4().extractRotation(basis));
    return basis.setPosition(at.sub(point));
  });
}

/** A helmet, moved and scaled from the mannequin's head to this character's. */
function wearHelmet(body: CharacterBody, look: GearLook): THREE.Object3D | null {
  const piece = look.group.clone();
  return attachAtRest(body, 'Head', piece, (restM) => {
    const head = restM('Head');
    if (!head) return null;
    const top = restM('HeadTop_End');
    const k = top ? THREE.MathUtils.clamp(top.distanceTo(head) / MANNEQUIN_HEAD_TOP.distanceTo(MANNEQUIN_HEAD), 0.7, 1.4) : 1;
    return new THREE.Matrix4().makeTranslation(head.x, head.y, head.z).multiply(new THREE.Matrix4().makeScale(k, k, k)).multiply(new THREE.Matrix4().makeTranslation(-MANNEQUIN_HEAD.x, -MANNEQUIN_HEAD.y, -MANNEQUIN_HEAD.z));
  });
}

/** What a character wears that shows: off-hand and head (blueprint id and rarity of each). */
export interface WornGear {
  offhand?: { bp: string; rar: string; look?: LookSpec } | null;
  head?: { bp: string; rar: string; look?: LookSpec } | null;
}

/** Worn gear from the network form (AvatarState.gr). */
export function wornFromNet(gr: { o?: string; or?: string; ol?: string; h?: string; hr?: string; hl?: string } | undefined): WornGear {
  return {
    offhand: gr?.o ? { bp: gr.o, rar: gr.or ?? 'common', look: lookFromNet(gr.ol) } : null,
    head: gr?.h ? { bp: gr.h, rar: gr.hr ?? 'common', look: lookFromNet(gr.hl) } : null,
  };
}

/**
 * Keeps a character's worn gear (shield, helmet) on its body. Call set() when the gear changes and
 * refresh() after the body is swapped (a new character model).
 */
export class GearRack {
  private key = '';
  private gear: WornGear = {};
  private pieces: THREE.Object3D[] = [];
  private gen = 0;

  constructor(private body: () => Rig | CharacterBody) {}

  set(gear: WornGear): void {
    const key = JSON.stringify([gear.offhand ?? null, gear.head ?? null]);
    if (key === this.key) return;
    this.key = key;
    this.gear = gear;
    this.refresh();
  }

  /** Re-attach everything (after a body swap). */
  refresh(): void {
    for (const p of this.pieces) p.removeFromParent();
    this.pieces = [];
    const gen = ++this.gen;
    const wear = (g: WornGear['head'], put: (b: CharacterBody, l: GearLook) => THREE.Object3D | null) => {
      if (!g) return;
      void gearLook(g.bp, g.rar, g.look).then((look) => {
        const b = this.body();
        if (!look || gen !== this.gen || !(b instanceof CharacterBody)) return;
        const p = put(b, look);
        if (p) this.pieces.push(p);
      });
    };
    wear(this.gear.offhand, wearShield);
    wear(this.gear.head, wearHelmet);
  }
}
