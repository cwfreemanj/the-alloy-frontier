/**
 * Raids on Emberhold (AF-011): the rules, shared by the server (which runs raids) and the
 * browser. Design and the reasons for the numbers: docs/raids.md.
 */

export const RAID = {
  /** Readiness needed for a raid (about 30 minutes of one signed-in player's play). */
  readinessToRaid: 30,
  /** Readiness per minute for each signed-in player online, anywhere in the world. */
  perPlayerMinute: 1,
  /** Readiness for each forge, brew, purchase or sale made in the village. */
  perVillageActivity: 0.5,
  /** At least one signed-in player in the village must be this rank or higher. */
  minDefenderRank: 2,
  /** Minimum time between two raids. */
  cooldownMinutes: 45,
  /** Warning between the horn and the first wave. */
  warningSeconds: 60,
  /** The second wave (with the Captain) comes when the first is down, or after this long. */
  secondWaveAfterSeconds: 90,
  /** Time from the first wave's arrival to defeat the Captain. */
  timeLimitSeconds: 300,
  /** The village is lost when no living player has been in it this long. */
  abandonedSeconds: 30,
  minRaiders: 5,
  maxRaiders: 10,
  maxLevel: 4,
} as const;

export interface RaidSize {
  /** Raiders, not counting the Captain. */
  total: number;
  firstWave: number;
  /** Raiders in the second wave; the Captain comes with them. */
  secondWave: number;
}

/** 3 raiders plus 2 for each defender, from 5 to 10, in two waves (the first the larger half). */
export function raidSize(defenders: number): RaidSize {
  const total = Math.max(RAID.minRaiders, Math.min(RAID.maxRaiders, 3 + 2 * Math.max(0, Math.floor(defenders))));
  const firstWave = Math.ceil(total / 2);
  return { total, firstWave, secondWave: total - firstWave };
}

/** The raiders' level: the signed-in defenders' average adventurer rank minus 1, from 1 to 4. */
export function raiderLevel(defenderRanks: number[]): number {
  if (!defenderRanks.length) return 1;
  const avg = defenderRanks.reduce((a, b) => a + b, 0) / defenderRanks.length;
  return Math.max(1, Math.min(RAID.maxLevel, Math.round(avg) - 1));
}

export interface RaidTriggerInput {
  readiness: number;
  /** Minutes since the last raid ended (null: no raid yet). */
  minutesSinceLastRaid: number | null;
  /** Adventurer ranks of the living signed-in players in the village. */
  villageRanks: number[];
}

/** Whether a raid should start now (see RAID and docs/raids.md section 1). */
export function shouldStartRaid(i: RaidTriggerInput): boolean {
  if (i.readiness < RAID.readinessToRaid) return false;
  if (i.minutesSinceLastRaid !== null && i.minutesSinceLastRaid < RAID.cooldownMinutes) return false;
  return i.villageRanks.some((r) => r >= RAID.minDefenderRank);
}

/** The bonus for everyone who fought in a raid the village won (on top of kill rewards). */
export function raidReward(level: number): { coins: number; xp: number } {
  const l = Math.max(1, Math.min(RAID.maxLevel, Math.floor(level)));
  return { coins: 20 + 10 * l, xp: 50 + 25 * l };
}

/** Binding Flux the Raider Captain always drops for each player who helped defeat him. */
export const CAPTAIN_FLUX = 3;
