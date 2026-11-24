/**
 * Small line icons for the character screens, drawn as inline SVG (no external assets).
 * 24×24, stroked with currentColor so CSS colours them.
 */
const P: Record<string, string> = {
  // Equipment slots
  head: 'M5 14a7 7 0 0 1 14 0v3H5z M8 17v3 M16 17v3 M9 11h6',
  shoulders: 'M3 12c2-4 5-5 9-5s7 1 9 5 M5 12v4 M19 12v4 M9 9l3 3 3-3',
  neck: 'M7 4c0 5 2 8 5 8s5-3 5-8 M12 12v3 M10 15h4l-2 5z',
  cape: 'M8 4h8l3 16-7-3-7 3z M10 4l2 3 2-3',
  chest: 'M7 4l-3 4 2 3v9h12v-9l2-3-3-4-3 2h-2z M12 8v12',
  belt: 'M3 10h18v4H3z M10 9h4v6h-4z M12 11v2',
  hands: 'M8 21v-7l-2-3V6h2v5 M8 11V4h2v7 M10 11V3h2v8 M12 11V4h2v8 M14 12V6h2v8l-2 7',
  legs: 'M7 3h10l-1 18h-3l-1-11-1 11H8z',
  feet: 'M8 3v11l-4 3v3h14v-3l-4-2V3z',
  ring: 'M12 9a6 6 0 1 0 0.01 0z M10 3h4l1 3H9z',
  tool: 'M4 20l9-9 M10 4c4-1 8 1 10 5-3-2-6-2-8 0 M12 9l3 3',
  weapon: 'M14 3h7v7L9 22l-3-3z M5 15l4 4 M3 21l3-3',
  offhand: 'M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z M12 7v10',
  // Screens
  character: 'M12 3a4 4 0 1 0 0.01 0z M4 21c1-5 4-7 8-7s7 2 8 7',
  inventory: 'M6 8h12l1 13H5z M9 8V6a3 3 0 0 1 6 0v2 M9 12h6',
  proficiencies: 'M12 3l2.5 6 6.5.5-5 4.3 1.6 6.4L12 17l-5.6 3.2L8 13.8 3 9.5 9.5 9z',
  skills: 'M13 2L4 14h7l-1 8 9-12h-7z',
  close: 'M6 6l12 12 M18 6L6 18',
  coin: 'M12 4a8 8 0 1 0 0.01 0z M12 8v8 M9.5 10h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4',
  emblem: 'M12 2l3 6 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z M12 8v6',
  // Stats
  health: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  stamina: 'M13 2L5 13h6l-1 9 8-12h-6z',
  defense: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  damage: 'M14 3h7v7L9 22l-3-3z',
  crit: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 9a3 3 0 1 0 0.01 0z',
  speed: 'M4 12h10 M4 7h7 M4 17h7 M15 6l5 6-5 6',
  stagger: 'M4 18c4-2 4-10 8-12s4 10 8 12',
  strength: 'M5 14c0-4 3-7 7-7 2 0 3 1 3 3h3c1 0 2 1 2 3v5H9a4 4 0 0 1-4-4z',
  dexterity: 'M3 18c5 0 7-3 9-7s4-7 9-7 M15 4h6v6',
  vitality: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z M8 11h2l1-2 2 4 1-2h2',
  endurance: 'M13 2L5 13h6l-1 9 8-12h-6z',
  // Records and proficiencies
  enemies: 'M5 4l14 16 M19 4L5 20 M4 7l3-3 M17 20l3-3',
  forge: 'M3 10h14l-2 4H7l-1 3h8 M17 10l4-3 M9 17v3h6v-3',
  deaths: 'M12 3a7 7 0 0 0-7 7v4l2 2v4h10v-4l2-2v-4a7 7 0 0 0-7-7z M9 11h.01 M15 11h.01',
  time: 'M12 3a9 9 0 1 0 0.01 0z M12 7v5l3 3',
  rank: 'M12 2l3 6 6 1-4 4 1 7-6-3-6 3 1-7-4-4 6-1z',
  mining: 'M4 20l9-9 M10 4c4-1 8 1 10 5-3-2-6-2-8 0 M12 9l3 3',
  woodcutting: 'M5 20l8-8 M11 5l7 1 1 7-4-1-3-3z',
  herbalism: 'M12 21v-8 M12 13c-5 0-7-4-7-9 5 0 7 3 7 9z M12 15c4 0 6-3 6-7-4 0-6 2-6 7z',
  smithing: 'M3 10h14l-2 4H7l-1 3h8 M17 10l4-3 M9 17v3h6v-3',
  slash: 'M4 20L20 4 M14 4h6v6',
  heavy: 'M5 19l9-9 M12 4l8 8-3 3-8-8z',
  guard: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z M9 12l2 2 4-4',
  storm: 'M12 3a9 9 0 1 0 0.01 0z M13 6l-4 7h4l-2 5',
  lock: 'M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3',
  info: 'M12 3a9 9 0 1 0 0.01 0z M12 11v6 M12 7h.01',
};

export type IconName = keyof typeof P;

export function icon(name: string, cls = ''): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ico ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', P[name] ?? P.info);
  svg.append(path);
  return svg;
}
