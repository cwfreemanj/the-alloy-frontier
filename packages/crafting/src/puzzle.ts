/**
 * Masterwork Forge puzzle (GDD 4.13): turn-based, reasoning-first, no timing required.
 *
 * Heating  - choose a heat level: more strikes vs. harsher overwork penalties.
 * Hammering - spend a finite number of strikes on a stress grid. A focused strike removes 2
 *             stress from one cell; a spread strike removes 1 from a cell and its 4 neighbours.
 *             Striking metal that is already relieved (0) "overworks" it.
 * Tempering - choose a cooling strategy (stat tradeoff, see TEMPERS in item-gen).
 *
 * The board is derived from a server/authority seed; the client submits only its strike
 * list as evidence and the authority replays it to compute the score.
 */
import { Rng, clamp01, type HeatLevel } from '@alloy/item-gen';

export const HEAT_LEVELS: Record<HeatLevel, { name: string; strikes: number; overworkPenalty: number; description: string }> = {
  dull: { name: 'Dull Red', strikes: 6, overworkPenalty: 0, description: '6 strikes. Forgiving: overworking costs nothing.' },
  cherry: { name: 'Cherry Red', strikes: 8, overworkPenalty: 1, description: '8 strikes. Each overwork costs 1 stress.' },
  bright: { name: 'Bright Yellow', strikes: 10, overworkPenalty: 2.5, description: '10 strikes. Hot metal moves fast: overworks cost 2.5 stress.' },
};

export const BOARD_SIZE = 5;
export const MAX_CELL_STRESS = 3;

export type StrikeKind = 'focused' | 'spread';
export interface Strike {
  x: number;
  y: number;
  kind: StrikeKind;
}

export interface HammerBoard {
  seed: string;
  size: number;
  cells: number[];
}

export function createHammerBoard(seed: string, size = BOARD_SIZE): HammerBoard {
  const rng = new Rng(`hammer:${seed}`);
  const cells: number[] = [];
  for (let i = 0; i < size * size; i++) {
    const r = rng.next();
    cells.push(r < 0.3 ? 0 : r < 0.65 ? 1 : r < 0.9 ? 2 : 3);
  }
  // Guarantee a meaningful puzzle: at least 18 stress.
  let total = cells.reduce((a, b) => a + b, 0);
  let i = 0;
  while (total < 18 && i < 200) {
    const idx = rng.int(0, cells.length - 1);
    if (cells[idx] < MAX_CELL_STRESS) {
      cells[idx]++;
      total++;
    }
    i++;
  }
  return { seed, size, cells };
}

export function strikesAllowed(heat: HeatLevel, mastery: number): number {
  const bonus = Number.isFinite(mastery) && mastery > 0 ? Math.min(6, Math.floor(mastery / 25)) : 0;
  return HEAT_LEVELS[heat].strikes + bonus;
}

export interface HammerState {
  cells: number[];
  strikesAllowed: number;
  strikesUsed: number;
  overworks: number;
  log: Strike[];
}

export function startHammering(board: HammerBoard, heat: HeatLevel, mastery: number): HammerState {
  return { cells: board.cells.slice(), strikesAllowed: strikesAllowed(heat, mastery), strikesUsed: 0, overworks: 0, log: [] };
}

export function strikeTargets(size: number, s: Strike): Array<[number, number]> {
  if (s.kind === 'focused') return [[s.x, s.y]];
  const t: Array<[number, number]> = [[s.x, s.y]];
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = s.x + dx;
    const ny = s.y + dy;
    if (nx >= 0 && ny >= 0 && nx < size && ny < size) t.push([nx, ny]);
  }
  return t;
}

export function isValidStrike(size: number, s: unknown): s is Strike {
  if (!s || typeof s !== 'object') return false;
  const k = s as Strike;
  return (
    Number.isInteger(k.x) && Number.isInteger(k.y) && k.x >= 0 && k.y >= 0 && k.x < size && k.y < size && (k.kind === 'focused' || k.kind === 'spread')
  );
}

/** Apply one strike. Returns null if the strike is invalid or no strikes remain. */
export function applyStrike(state: HammerState, size: number, s: Strike): { state: HammerState; relieved: number; overworked: number } | null {
  if (!isValidStrike(size, s) || state.strikesUsed >= state.strikesAllowed) return null;
  const cells = state.cells.slice();
  let relieved = 0;
  let overworked = 0;
  const amount = s.kind === 'focused' ? 2 : 1;
  for (const [x, y] of strikeTargets(size, s)) {
    const i = y * size + x;
    if (cells[i] === 0) {
      overworked++;
      continue;
    }
    const r = Math.min(cells[i], amount);
    cells[i] -= r;
    relieved += r;
    // A focused strike on a cell with only 1 stress partly hits relieved metal.
    if (r < amount && s.kind === 'focused') overworked++;
  }
  return {
    state: { cells, strikesAllowed: state.strikesAllowed, strikesUsed: state.strikesUsed + 1, overworks: state.overworks + overworked, log: [...state.log, s] },
    relieved,
    overworked,
  };
}

export interface HammerEvaluation {
  ok: boolean;
  score: number;
  initialStress: number;
  remainingStress: number;
  overworks: number;
  strikesUsed: number;
  strikesAllowed: number;
}

export function scoreState(board: HammerBoard, heat: HeatLevel, state: HammerState): number {
  const initial = board.cells.reduce((a, b) => a + b, 0);
  const remaining = state.cells.reduce((a, b) => a + b, 0);
  if (initial <= 0) return 1;
  return clamp01(1 - (remaining + HEAT_LEVELS[heat].overworkPenalty * state.overworks) / initial);
}

/**
 * Greedy one-step hint (accessibility aid and test helper): the strike with the best
 * immediate net relief. Not guaranteed optimal, so planning ahead still matters.
 */
export function suggestStrike(state: HammerState, size: number, heat: HeatLevel): Strike | null {
  if (state.strikesUsed >= state.strikesAllowed) return null;
  const penalty = HEAT_LEVELS[heat].overworkPenalty;
  let best: Strike | null = null;
  let bestValue = -Infinity;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      for (const kind of ['spread', 'focused'] as StrikeKind[]) {
        const r = applyStrike(state, size, { x, y, kind });
        if (!r) continue;
        const v = r.relieved - penalty * r.overworked - (penalty === 0 ? r.overworked * 0.01 : 0);
        if (v > bestValue) {
          bestValue = v;
          best = { x, y, kind };
        }
      }
  return bestValue > 0 ? best : null;
}

/** Authority-side replay of client evidence. Invalid evidence never yields a score. */
export function evaluateHammerEvidence(board: HammerBoard, heat: HeatLevel, strikes: unknown, mastery: number): HammerEvaluation {
  const initial = board.cells.reduce((a, b) => a + b, 0);
  const bad: HammerEvaluation = {
    ok: false,
    score: 0,
    initialStress: initial,
    remainingStress: initial,
    overworks: 0,
    strikesUsed: 0,
    strikesAllowed: 0,
  };
  if (!Object.prototype.hasOwnProperty.call(HEAT_LEVELS, heat) || !Array.isArray(strikes)) return bad;
  let state = startHammering(board, heat, mastery);
  if (strikes.length > state.strikesAllowed) return { ...bad, strikesAllowed: state.strikesAllowed };
  for (const s of strikes) {
    const r = applyStrike(state, board.size, s as Strike);
    if (!r) return { ...bad, strikesAllowed: state.strikesAllowed };
    state = r.state;
  }
  return {
    ok: true,
    score: scoreState(board, heat, state),
    initialStress: initial,
    remainingStress: state.cells.reduce((a, b) => a + b, 0),
    overworks: state.overworks,
    strikesUsed: state.strikesUsed,
    strikesAllowed: state.strikesAllowed,
  };
}
