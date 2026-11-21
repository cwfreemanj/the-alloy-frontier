/** NPC dialogue content keyed by quest step (creative text is placeholder for the Creative Director). */
import type { Session } from '../state/Session';

export interface DialogueSpec {
  lines: string[];
  options: Array<{ label: string; kind: 'talk' | 'forge' | 'close' | 'merchant'; primary?: boolean }>;
}

export function orlaDialogue(s: Session): DialogueSpec {
  const step = s.step();
  if (!step)
    return {
      lines: ['"The forge is yours whenever you want it. Try a hotter heat, a different temper — every blade teaches you something."'],
      options: [
        { label: 'Use the forge', kind: 'forge', primary: true },
        { label: 'Farewell', kind: 'close' },
      ],
    };
  switch (step.id) {
    case 'commission':
      return {
        lines: [
          '"You\'re the new apprentice. Good. The Survey has commissioned a blade for the Dormant Foundry, and I want you to make it."',
          '"Take this old training sword. Learn to fight on the Ironwood Trail — scavengers there will test you. Bring me iron ore and ironwood from the trail, and ironglass shards from the quarry."',
          '"Then we\'ll see what your hands can do with ordinary steel."',
        ],
        options: [{ label: 'Accept the commission (receive Worn Longsword)', kind: 'talk', primary: true }],
      };
    case 'first_blood':
      return {
        lines: ['"North gate, then the trail. Light attacks chain three times. Watch for the red glow on the ground — that\'s where a blow will land. Dodge through it or raise your guard."'],
        options: [{ label: 'On my way', kind: 'close', primary: true }],
      };
    case 'gather':
      return {
        lines: ['"Five iron ore, two ironwood, three ironglass. Look for veins with a blue shimmer — rich deposits make better steel. The quarry constructs raise shields: Guardbreaker (R) cracks them."'],
        options: [{ label: 'I\'ll be back', kind: 'close', primary: true }],
      };
    case 'return':
      return {
        lines: ['"Let me see… decent ore. Before you light the furnace, go look at Bram\'s stock. Know what coin buys, so you know what craft is worth."'],
        options: [{ label: 'Hand over the materials', kind: 'talk', primary: true }],
      };
    case 'compare':
      return { lines: ['"Bram\'s stall is across the square. Go on."'], options: [{ label: 'Of course', kind: 'close', primary: true }] };
    case 'quick_forge':
      return {
        lines: ['"Start with a Quick Forge: a standard pattern, reliable and plain. Then I\'ll show you the masterwork way."'],
        options: [
          { label: 'Use the forge', kind: 'forge', primary: true },
          { label: 'Later', kind: 'close' },
        ],
      };
    case 'masterwork':
      return {
        lines: [
          '"Now the real work. Heat the ingot, read the stress in the metal, and strike where it matters. A spread strike relieves a cross of metal; a focused strike drives deep into one spot. Never strike metal that\'s already relieved."',
          '"Ironglass in the alloy can wake something — if your forging is good enough."',
        ],
        options: [
          { label: 'Use the forge', kind: 'forge', primary: true },
          { label: 'Later', kind: 'close' },
        ],
      };
    case 'equip':
      return { lines: ['"A blade on the rack cuts nothing. Equip it (I)."'], options: [{ label: 'Right', kind: 'close', primary: true }] };
    case 'foundry':
      return {
        lines: [
          '"The Foundry Warden wakes when anyone nears its core. It sweeps wide, slams the ground and lunges across the hall. Read the glow, keep your stamina, and break its stance with heavy blows."',
          '"Shop steel would take you all night. Your edge won\'t."',
        ],
        options: [
          { label: 'Use the forge first', kind: 'forge' },
          { label: 'To the Foundry', kind: 'close', primary: true },
        ],
      };
    case 'report':
      return {
        lines: ['"You came back. And the Warden didn\'t. Let me see that blade."'],
        options: [{ label: 'Show Orla your weapon', kind: 'talk', primary: true }],
      };
    default:
      return { lines: ['"Mm?"'], options: [{ label: 'Farewell', kind: 'close' }] };
  }
}
