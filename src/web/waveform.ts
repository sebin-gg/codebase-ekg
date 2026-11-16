import type { Rhythm } from '../shared/types.ts';

export type BeatKind = 'normal' | 'pvc';

export interface Beat {
  /** Time of the R peak, seconds. */
  at: number;
  kind: BeatKind;
}

/** Small deterministic PRNG so rhythms are reproducible in tests. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bump = (x: number, mu: number, sigma: number, amp: number) => amp * Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));

/** One normal P-QRS-T complex; dt is seconds relative to the R peak. */
export const pqrst = (dt: number) =>
  bump(dt, -0.2, 0.025, 0.12) + bump(dt, -0.035, 0.008, -0.12) + bump(dt, 0, 0.011, 1) +
  bump(dt, 0.035, 0.01, -0.28) + bump(dt, 0.26, 0.05, 0.28);

/** Premature ventricular contraction: no P wave, wide bizarre QRS, inverted T. */
export const pvc = (dt: number) => bump(dt, 0, 0.04, 1.25) + bump(dt, 0.08, 0.035, -0.45) + bump(dt, 0.32, 0.07, -0.3);

/** Plethysmograph pulse arriving after the R peak, with a dicrotic notch. */
export const pulse = (dt: number) => bump(dt, 0.3, 0.07, 1) + bump(dt, 0.55, 0.09, 0.35);

export const fibrillation = (t: number) =>
  (0.55 + 0.35 * Math.sin(0.9 * t)) *
  (0.45 * Math.sin(2 * Math.PI * 4.7 * t + 2 * Math.sin(1.1 * t)) +
    0.3 * Math.sin(2 * Math.PI * 6.3 * t + 1.7 * Math.sin(0.7 * t + 1)) +
    0.15 * Math.sin(2 * Math.PI * 2.9 * t));

const wander = (t: number) =>
  0.02 * Math.sin(2 * Math.PI * 0.21 * t) + 0.012 * Math.sin(2 * Math.PI * 0.53 * t + 1) + 0.006 * Math.sin(2 * Math.PI * 23.7 * t);

/** Decides when the next beat lands. PVCs come early and are followed by a compensatory pause. */
export class BeatScheduler {
  private rand: () => number;
  private compensate = false;

  constructor(seed = 1) {
    this.rand = mulberry32(seed);
  }

  next(bpm: number, rhythm: Rhythm): { interval: number; kind: BeatKind } | null {
    if (rhythm === 'asystole' || rhythm === 'vfib' || bpm <= 0) return null;
    const rr = 60 / bpm;
    if (this.compensate) {
      this.compensate = false;
      return { interval: rr * 1.4, kind: 'normal' };
    }
    if (rhythm === 'arrhythmia') {
      if (this.rand() < 0.18) {
        this.compensate = true;
        return { interval: rr * 0.6, kind: 'pvc' };
      }
      return { interval: rr * (0.75 + this.rand() * 0.5), kind: 'normal' };
    }
    return { interval: rr * (0.98 + this.rand() * 0.04), kind: 'normal' };
  }
}

/** Continuous ECG and pleth signal generator driven by the current bpm and rhythm. */
export class Heart {
  bpm = 0;
  rhythm: Rhythm = 'asystole';
  /** 0-1 pleth amplitude, driven by SpO2. */
  perfusion = 0.8;
  private scheduler: BeatScheduler;
  private beats: Beat[] = [];
  private horizon = 0;
  private shockAt = -Infinity;

  constructor(seed = 1) {
    this.scheduler = new BeatScheduler(seed);
  }

  /** Schedules beats a little ahead of t so P waves can be drawn before their R peak. */
  advance(t: number): void {
    if (this.horizon < t - 1) this.horizon = t;
    while (this.horizon < t + 0.6) {
      const next = this.scheduler.next(this.bpm, this.rhythm);
      if (!next) {
        this.horizon = t + 0.6;
        break;
      }
      this.horizon += next.interval;
      this.beats.push({ at: this.horizon, kind: next.kind });
    }
    this.beats = this.beats.filter((b) => b.at > t - 3);
  }

  beatsBetween(t0: number, t1: number): Beat[] {
    return this.beats.filter((b) => b.at > t0 && b.at <= t1);
  }

  shock(t: number): void {
    this.shockAt = t;
  }

  ecg(t: number): number {
    let v = wander(t);
    const s = t - this.shockAt;
    if (s >= 0 && s < 0.4) v += s < 0.05 ? 1.8 * Math.sin(s * 140) : 0.6 * Math.exp(-(s - 0.05) * 12);
    if (this.rhythm === 'vfib') return v + fibrillation(t);
    for (const b of this.beats) {
      const dt = t - b.at;
      if (dt > -0.35 && dt < 0.6) v += b.kind === 'pvc' ? pvc(dt) : pqrst(dt);
    }
    return v;
  }

  pleth(t: number): number {
    if (this.rhythm === 'vfib') return 0.04 * Math.sin(2 * Math.PI * 1.3 * t);
    let v = 0;
    for (const b of this.beats) {
      const dt = t - b.at;
      if (dt > 0 && dt < 1.1) v += pulse(dt) * (b.kind === 'pvc' ? 0.35 : 1);
    }
    return v * this.perfusion;
  }
}
