/**
 * Damage types, weapon families and enemy resistances.
 *
 * Each weapon family deals one damage type by default (a blueprint can override it). Enemies
 * resist or are weak to types with a multiplier, applied after defense. The server counts
 * damage by type and family, which an adapting world can later react to.
 */
import type { DamageType, WeaponFamily } from '@alloy/item-gen';

export const DAMAGE_TYPES: readonly DamageType[] = ['slash', 'pierce', 'blunt', 'magic'];

export const WEAPON_FAMILIES: Record<WeaponFamily, { name: string; damageType: DamageType; hands: 1 | 2 }> = {
  longsword: { name: 'Longsword', damageType: 'slash', hands: 1 },
  shortsword: { name: 'Short sword', damageType: 'slash', hands: 1 },
  greatsword: { name: 'Greatsword', damageType: 'slash', hands: 2 },
  axe: { name: 'Axe', damageType: 'slash', hands: 1 },
  mace: { name: 'Mace', damageType: 'blunt', hands: 1 },
  dagger: { name: 'Dagger', damageType: 'pierce', hands: 1 },
  staff: { name: 'Staff', damageType: 'magic', hands: 2 },
  bow: { name: 'Bow', damageType: 'pierce', hands: 2 },
};

export const isWeaponFamily = (f: string): f is WeaponFamily => f in WEAPON_FAMILIES;

/** The damage type a weapon deals: the blueprint's override, else its family's default. */
export function damageTypeOf(family: string, override?: DamageType): DamageType {
  if (override && DAMAGE_TYPES.includes(override)) return override;
  return isWeaponFamily(family) ? WEAPON_FAMILIES[family].damageType : 'blunt';
}

/** Multiplier for a damage type against resistances (missing = x1). Bounded 0.25..2. */
export function resistanceMultiplier(resist: Partial<Record<DamageType, number>> | undefined, type: DamageType): number {
  const v = resist?.[type];
  return Number.isFinite(v) ? Math.max(0.25, Math.min(2, v as number)) : 1;
}

export const DAMAGE_TYPE_NAMES: Record<DamageType, string> = { slash: 'Slash', pierce: 'Pierce', blunt: 'Blunt', magic: 'Magic' };
