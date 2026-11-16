import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BeatScheduler, Heart, mulberry32, pqrst } from '../src/web/waveform.ts';

describe('BeatScheduler', () => {
  it('keeps sinus intervals within 2% of 60/bpm', () => {
    fc.assert(fc.property(fc.integer({ min: 40, max: 200 }), fc.nat(), (bpm, seed) => {
      const scheduler = new BeatScheduler(seed);
      for (let i = 0; i < 50; i++) {
        const beat = scheduler.next(bpm, 'sinus')!;
        expect(beat.kind).toBe('normal');
        expect(Math.abs(beat.interval - 60 / bpm)).toBeLessThanOrEqual((60 / bpm) * 0.02 + 1e-9);
      }
    }));
  });

  it('keeps the average rate for arrhythmia while varying beat to beat and inserting PVCs', () => {
    fc.assert(fc.property(fc.integer({ min: 40, max: 200 }), fc.nat(), (bpm, seed) => {
      const scheduler = new BeatScheduler(seed);
      const beats = Array.from({ length: 3000 }, () => scheduler.next(bpm, 'arrhythmia')!);
      const mean = beats.reduce((a, b) => a + b.interval, 0) / beats.length;
      expect(beats.every((b) => b.interval > 0)).toBe(true);
      expect(Math.abs(mean - 60 / bpm) / (60 / bpm)).toBeLessThan(0.05);
      expect(beats.some((b) => b.kind === 'pvc')).toBe(true);
    }), { numRuns: 25 });
  });

  it('produces no beats in asystole or v-fib', () => {
    const scheduler = new BeatScheduler(3);
    expect(scheduler.next(120, 'asystole')).toBeNull();
    expect(scheduler.next(120, 'vfib')).toBeNull();
    expect(scheduler.next(0, 'sinus')).toBeNull();
  });
});

describe('Heart', () => {
  const simulate = (heart: Heart, seconds: number) => {
    let beats = 0;
    for (let t = 0, prev = 0; t <= seconds; prev = t, t += 1 / 60) {
      heart.advance(t);
      beats += heart.beatsBetween(prev, t).length;
    }
    return beats;
  };

  it('beats at the requested rate', () => {
    const heart = new Heart(7);
    heart.bpm = 90;
    heart.rhythm = 'sinus';
    expect(simulate(heart, 20)).toBeGreaterThanOrEqual(28);
    expect(simulate(new Heart(7), 20)).toBe(0);
  });

  it('peaks at the R wave', () => {
    expect(pqrst(0)).toBeGreaterThan(0.95);
    expect(Math.abs(pqrst(-0.5))).toBeLessThan(1e-3);
  });

  it('stays near the baseline when flatlined', () => {
    const heart = new Heart(1);
    heart.advance(5);
    for (let t = 0; t < 5; t += 0.01) expect(Math.abs(heart.ecg(t))).toBeLessThan(0.05);
  });
});

describe('mulberry32', () => {
  it('is deterministic and stays in [0, 1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
