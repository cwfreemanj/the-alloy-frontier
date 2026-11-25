import type { MaterialDefinition, MaterialId } from './types';

/** First-slice materials (GDD 4.7, 4.10, 4.12). */
export const MATERIALS: Record<MaterialId, MaterialDefinition> = {
  iron_ore: {
    id: 'iron_ore',
    name: 'Iron Ore',
    kind: 'primary',
    description: 'Accessible, economical, balanced. Purity varies by vein.',
    traitNames: ['purity', 'density'],
  },
  ironwood: {
    id: 'ironwood',
    name: 'Ironwood',
    kind: 'secondary',
    description: 'Dense frontier timber used for grips and cores.',
    traitNames: ['grain'],
  },
  ironglass: {
    id: 'ironglass',
    name: 'Ironglass Shard',
    kind: 'catalyst',
    description: 'Lightweight fantasy-tech alloy crystal. Conductive; may awaken arc abilities.',
    traitNames: ['conductivity', 'brittleness'],
  },
  binding_flux: {
    id: 'binding_flux',
    name: 'Binding Flux',
    kind: 'buffer',
    description: 'Common stabilising powder. Extra flux always helps, with diminishing returns.',
    traitNames: [],
  },
  emberleaf: {
    id: 'emberleaf',
    name: 'Emberleaf',
    kind: 'herb',
    description: 'A frontier herb whose leaves hold a faint warmth. Brewed into salves and tonics.',
    traitNames: ['potency'],
  },
  healing_salve: {
    id: 'healing_salve',
    name: 'Healing Salve',
    kind: 'consumable',
    description: 'Emberleaf paste. Restores health; stronger salves come from better leaves.',
    traitNames: [],
  },
  stamina_tonic: {
    id: 'stamina_tonic',
    name: 'Stamina Tonic',
    kind: 'consumable',
    description: 'A bitter emberleaf brew. Restores stamina.',
    traitNames: [],
  },
};

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[];

export function isMaterialId(id: unknown): id is MaterialId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MATERIALS, id);
}

export function materialName(id: MaterialId): string {
  return MATERIALS[id]?.name ?? id;
}
