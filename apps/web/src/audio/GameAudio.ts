/**
 * Music and sound effects.
 *
 * Music: the owner's tracks (apps/web/public/audio/music, see ASSET_PROVENANCE.md), streamed
 * with <audio> elements and crossfaded through Web Audio gains. Sound effects are synthesized
 * in code (no files): short shaped noise and tones.
 *
 * Browsers only allow sound after a user gesture, so nothing plays until `unlock()` is called
 * from a click or key press.
 */
export type MusicTrack = 'town' | 'wilds' | 'combat' | 'boss';
export type Sfx =
  | 'swing'
  | 'swingHeavy'
  | 'hit'
  | 'crit'
  | 'guarded'
  | 'hurt'
  | 'block'
  | 'dodge'
  | 'kill'
  | 'chop'
  | 'treeFall'
  | 'mine'
  | 'crystal'
  | 'anvil'
  | 'coin'
  | 'levelUp'
  | 'uiOpen'
  | 'uiClose'
  | 'click';

const TRACKS: Record<MusicTrack, string> = {
  town: `${import.meta.env.BASE_URL}audio/music/town-mossheart-village.mp3`,
  wilds: `${import.meta.env.BASE_URL}audio/music/wilds-whispering-grove.mp3`,
  combat: `${import.meta.env.BASE_URL}audio/music/combat-goblin-banner-run.mp3`,
  boss: `${import.meta.env.BASE_URL}audio/music/boss-forge-warden.mp3`,
};
const FADE_SECONDS = 2.2;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private players = new Map<MusicTrack, { el: HTMLAudioElement; gain: GainNode }>();
  private current: MusicTrack | null = null;
  private wanted: MusicTrack | null = null;
  private musicVolume = 0.55;
  private sfxVolume = 0.8;
  /** Last time each sound played (avoids stacking the same sound many times in one frame). */
  private lastPlayed = new Map<Sfx, number>();

  get unlocked(): boolean {
    return this.ctx !== null;
  }

  /** Create the audio engine (call from a user gesture). Safe to call repeatedly. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicVolume;
    this.musicBus.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);
    // One second of white noise, shared by every noisy sound.
    this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.wanted) this.music(this.wanted);
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVolume = clamp01(music);
    this.sfxVolume = clamp01(sfx);
    if (this.ctx && this.musicBus && this.sfxBus) {
      this.musicBus.gain.setTargetAtTime(this.musicVolume, this.ctx.currentTime, 0.05);
      this.sfxBus.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.05);
    }
  }

  /** Crossfade to a track (null: fade out). Calling with the current track does nothing. */
  music(track: MusicTrack | null): void {
    this.wanted = track;
    if (!this.ctx || !this.musicBus || track === this.current) return;
    const now = this.ctx.currentTime;
    if (this.current) {
      const old = this.players.get(this.current)!;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      const el = old.el;
      const was = this.current;
      window.setTimeout(() => {
        if (this.current !== was) el.pause();
      }, FADE_SECONDS * 1000 + 100);
    }
    this.current = track;
    if (!track) return;
    let p = this.players.get(track);
    if (!p) {
      const el = new Audio(TRACKS[track]);
      el.loop = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      this.ctx.createMediaElementSource(el).connect(gain);
      gain.connect(this.musicBus);
      p = { el, gain };
      this.players.set(track, p);
    }
    // Combat and boss music start from the top; town and wilds resume where they left off.
    if (track === 'combat' || track === 'boss') p.el.currentTime = 0;
    void p.el.play().catch(() => undefined);
    p.gain.gain.cancelScheduledValues(now);
    p.gain.gain.setValueAtTime(p.gain.gain.value, now);
    p.gain.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);
  }

  /** State for automated tests: which track should play, and whether it is actually playing. */
  debug(): { unlocked: boolean; track: MusicTrack | null; playing: boolean; time: number; sfxPlayed: number } {
    const p = this.current ? this.players.get(this.current) : undefined;
    return { unlocked: !!this.ctx, track: this.current, playing: !!p && !p.el.paused, time: p ? +p.el.currentTime.toFixed(2) : 0, sfxPlayed: this.lastPlayed.size };
  }

  /** Play a synthesized sound. `volume` scales it (e.g. by distance). */
  sfx(name: Sfx, volume = 1): void {
    const c = this.ctx;
    if (!c || !this.sfxBus || volume <= 0.01) return;
    const t = c.currentTime;
    if ((this.lastPlayed.get(name) ?? -1) > t - 0.035) return;
    this.lastPlayed.set(name, t);
    const out = c.createGain();
    out.gain.value = volume;
    out.connect(this.sfxBus);
    const S = SOUNDS[name];
    S(new Synth(c, out, this.noise!, t));
  }
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Small helpers to build a sound from oscillators and filtered noise with envelopes. */
class Synth {
  constructor(
    readonly c: AudioContext,
    readonly out: AudioNode,
    private noiseBuf: AudioBuffer,
    readonly t: number,
  ) {}

  /** A gain envelope: attack to `peak`, then exponential decay over `decay` seconds. */
  env(at: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.c.createGain();
    const s = this.t + at;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), s + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, s + attack + decay);
    g.connect(this.out);
    return g;
  }

  tone(type: OscillatorType, f0: number, f1: number, at: number, peak: number, attack: number, decay: number): void {
    const o = this.c.createOscillator();
    o.type = type;
    const s = this.t + at;
    o.frequency.setValueAtTime(f0, s);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), s + attack + decay);
    o.connect(this.env(at, peak, attack, decay));
    o.start(s);
    o.stop(s + attack + decay + 0.05);
  }

  /** Filtered noise; the filter frequency sweeps from f0 to f1. */
  noise(filter: BiquadFilterType, f0: number, f1: number, q: number, at: number, peak: number, attack: number, decay: number): void {
    const src = this.c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = this.c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    const s = this.t + at;
    f.frequency.setValueAtTime(f0, s);
    if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), s + attack + decay);
    src.connect(f);
    f.connect(this.env(at, peak, attack, decay));
    src.start(s, Math.random() * 0.5);
    src.stop(s + attack + decay + 0.05);
  }
}

const SOUNDS: Record<Sfx, (s: Synth) => void> = {
  // Combat
  swing: (s) => s.noise('bandpass', 700, 2600, 1.4, 0, 0.35, 0.02, 0.16),
  swingHeavy: (s) => {
    s.noise('bandpass', 350, 1500, 1.1, 0, 0.45, 0.04, 0.3);
    s.tone('sine', 140, 70, 0, 0.12, 0.03, 0.25);
  },
  hit: (s) => {
    s.tone('sine', 150, 55, 0, 0.6, 0.005, 0.16);
    s.noise('highpass', 1800, 900, 0.7, 0, 0.35, 0.002, 0.06);
  },
  crit: (s) => {
    s.tone('sine', 180, 50, 0, 0.7, 0.005, 0.2);
    s.noise('highpass', 2500, 1200, 0.7, 0, 0.45, 0.002, 0.08);
    s.tone('triangle', 1250, 1180, 0.01, 0.18, 0.005, 0.35);
  },
  guarded: (s) => {
    s.tone('triangle', 620, 600, 0, 0.3, 0.002, 0.3);
    s.tone('triangle', 930, 900, 0, 0.22, 0.002, 0.25);
    s.noise('bandpass', 3000, 2000, 2, 0, 0.2, 0.002, 0.05);
  },
  hurt: (s) => {
    s.tone('sine', 110, 45, 0, 0.7, 0.005, 0.22);
    s.noise('lowpass', 900, 300, 0.8, 0, 0.4, 0.004, 0.14);
  },
  block: (s) => {
    s.tone('triangle', 520, 500, 0, 0.35, 0.002, 0.22);
    s.noise('bandpass', 2200, 1600, 3, 0, 0.25, 0.002, 0.07);
  },
  dodge: (s) => s.noise('bandpass', 500, 1400, 0.9, 0, 0.25, 0.05, 0.22),
  kill: (s) => {
    s.tone('sine', 120, 35, 0, 0.6, 0.01, 0.6);
    s.noise('lowpass', 1600, 200, 0.7, 0, 0.35, 0.01, 0.6);
  },
  // Gathering and crafting
  chop: (s) => {
    s.noise('bandpass', 520, 380, 4, 0, 0.7, 0.002, 0.12);
    s.tone('sine', 210, 150, 0, 0.35, 0.002, 0.1);
  },
  treeFall: (s) => {
    // A creak as it tips, then the crash of the trunk and branches.
    s.tone('sawtooth', 95, 62, 0, 0.08, 0.15, 0.75);
    s.noise('bandpass', 300, 180, 6, 0.05, 0.12, 0.2, 0.6);
    s.noise('lowpass', 1400, 120, 0.6, 0.95, 0.7, 0.01, 1.3);
    s.tone('sine', 70, 35, 0.95, 0.6, 0.01, 0.8);
    s.noise('highpass', 3000, 1500, 0.5, 1.0, 0.18, 0.02, 0.6);
  },
  mine: (s) => {
    s.tone('triangle', 1850, 1750, 0, 0.3, 0.001, 0.18);
    s.tone('triangle', 2700, 2600, 0, 0.18, 0.001, 0.12);
    s.noise('highpass', 3500, 2500, 0.7, 0, 0.25, 0.001, 0.05);
    s.tone('sine', 160, 90, 0, 0.25, 0.002, 0.08);
  },
  crystal: (s) => {
    s.tone('sine', 1320, 1320, 0, 0.18, 0.003, 0.6);
    s.tone('sine', 1760, 1760, 0.05, 0.14, 0.003, 0.55);
    s.tone('sine', 2640, 2640, 0.1, 0.1, 0.003, 0.5);
    s.noise('highpass', 4000, 3000, 0.7, 0, 0.12, 0.001, 0.05);
  },
  anvil: (s) => {
    for (const [f, p, d] of [
      [820, 0.35, 0.9],
      [1350, 0.22, 0.7],
      [2230, 0.14, 0.5],
      [3100, 0.08, 0.35],
    ] as const)
      s.tone('sine', f, f * 0.995, 0, p, 0.001, d);
    s.noise('highpass', 3000, 2000, 0.7, 0, 0.3, 0.001, 0.04);
  },
  coin: (s) => {
    s.tone('square', 1480, 1480, 0, 0.08, 0.002, 0.08);
    s.tone('square', 1975, 1975, 0.07, 0.08, 0.002, 0.2);
  },
  levelUp: (s) => {
    [523, 659, 784, 1047].forEach((f, i) => s.tone('triangle', f, f, i * 0.09, 0.22, 0.01, 0.45));
    s.tone('sine', 2093, 2093, 0.36, 0.1, 0.01, 0.8);
  },
  // UI
  uiOpen: (s) => s.tone('sine', 520, 780, 0, 0.12, 0.005, 0.12),
  uiClose: (s) => s.tone('sine', 700, 440, 0, 0.1, 0.005, 0.1),
  click: (s) => s.tone('triangle', 900, 880, 0, 0.08, 0.001, 0.05),
};
