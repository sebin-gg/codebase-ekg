import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { RepoSignals } from '../src/shared/types.ts';
import { assess, heartRate, LIMITS, oxygen, temperature } from '../src/shared/vitals.ts';

const NOW = Date.UTC(2026, 9, 31, 12);
const DAY = 86_400_000;

const signals: fc.Arbitrary<RepoSignals> = fc.record({
  source: fc.constantFrom('local' as const, 'github' as const),
  repo: fc.constant('patient'),
  sampledAt: fc.constant(NOW),
  lastCommitAt: fc.option(fc.integer({ min: NOW - 400 * DAY, max: NOW }), { nil: null }),
  commitsLastHour: fc.nat(50),
  commitsLast24h: fc.nat(500),
  linesChangedLast24h: fc.nat(2_000_000),
  largestRecentDiff: fc.nat(10_000),
  checks: fc.option(fc.record({ passed: fc.nat(200), failed: fc.nat(200), pending: fc.nat(20) }), { nil: null }),
  openPRs: fc.option(fc.nat(5000), { nil: null }),
  openIssues: fc.option(fc.nat(50_000), { nil: null }),
  uncommittedFiles: fc.option(fc.nat(500), { nil: null }),
  recentCommits: fc.constant([]),
  rateLimitRemaining: fc.constant(null),
});

const healthy: RepoSignals = {
  source: 'local',
  repo: 'patient',
  sampledAt: NOW,
  lastCommitAt: NOW - 3_600_000,
  commitsLastHour: 0,
  commitsLast24h: 4,
  linesChangedLast24h: 120,
  largestRecentDiff: 80,
  checks: { passed: 10, failed: 0, pending: 0 },
  openPRs: 2,
  openIssues: 5,
  uncommittedFiles: 1,
  recentCommits: [],
  rateLimitRemaining: null,
};

describe('assess: correctness properties', () => {
  it('P1: heart rate stays within monitor range and is zero exactly when flatlined', () => {
    fc.assert(fc.property(signals, (s) => {
      const v = assess(s);
      expect(v.bpm).toBeGreaterThanOrEqual(0);
      expect(v.bpm).toBeLessThanOrEqual(LIMITS.maxBpm);
      expect(v.bpm === 0).toBe(v.rhythm === 'asystole');
    }));
  });

  it('P2: flatlines exactly when there is no commit or the last one is past the threshold', () => {
    fc.assert(fc.property(signals, (s) => {
      const dead = s.lastCommitAt === null || s.sampledAt - s.lastCommitAt >= LIMITS.flatlineMs;
      expect(assess(s).rhythm === 'asystole').toBe(dead);
    }));
  });

  it('P3: a living repo fibrillates exactly when one commit is huge', () => {
    fc.assert(fc.property(signals, (s) => {
      const v = assess(s);
      if (v.rhythm !== 'asystole') expect(v.rhythm === 'vfib').toBe(s.largestRecentDiff >= LIMITS.vfibDiffLines);
    }));
  });

  it('P4: more commits never slow the heart', () => {
    fc.assert(fc.property(fc.nat(2000), fc.nat(2000), fc.nat(200), fc.nat(200), (a, b, h1, h2) => {
      expect(heartRate(Math.min(a, b), Math.min(h1, h2))).toBeLessThanOrEqual(heartRate(Math.max(a, b), Math.max(h1, h2)));
    }));
  });

  it('P5: SpO2 is 70-99 and monotonic in pass rate, or unknown when nothing finished', () => {
    fc.assert(fc.property(fc.nat(300), fc.nat(300), fc.nat(10), (passed, failed, pending) => {
      const spo2 = oxygen({ passed, failed, pending });
      if (passed + failed === 0) {
        expect(spo2).toBeNull();
        return;
      }
      expect(spo2).toBeGreaterThanOrEqual(70);
      expect(spo2).toBeLessThanOrEqual(99);
      expect(oxygen({ passed: passed + 1, failed, pending })!).toBeGreaterThanOrEqual(spo2!);
    }));
    expect(oxygen(null)).toBeNull();
  });

  it('P6: temperature stays within 36.6-41.0 C and never drops as churn rises', () => {
    fc.assert(fc.property(fc.nat(10_000_000), fc.nat(10_000_000), (a, b) => {
      const [lo, hi] = [temperature(Math.min(a, b)), temperature(Math.max(a, b))];
      expect(lo).toBeGreaterThanOrEqual(36.6);
      expect(hi).toBeLessThanOrEqual(41);
      expect(lo).toBeLessThanOrEqual(hi);
    }));
  });

  it('P7: lethal rhythms always raise a critical alarm and critical alarms come first', () => {
    fc.assert(fc.property(signals, (s) => {
      const { rhythm, alarms } = assess(s);
      if (rhythm === 'asystole' || rhythm === 'vfib') expect(alarms[0]?.level).toBe('critical');
      const firstWarning = alarms.findIndex((a) => a.level === 'warning');
      if (firstWarning >= 0) expect(alarms.slice(firstWarning).every((a) => a.level === 'warning')).toBe(true);
    }));
  });
});

describe('assess: examples', () => {
  it('reads a healthy repo as sinus rhythm with no alarms', () => {
    const v = assess(healthy);
    expect(v.rhythm).toBe('sinus');
    expect(v.bpm).toBe(99);
    expect(v.spo2).toBe(99);
    expect(v.alarms).toEqual([]);
  });

  it('reads a quiet but living repo as bradycardia', () => {
    const v = assess({ ...healthy, commitsLast24h: 0, lastCommitAt: NOW - 5 * DAY });
    expect(v).toMatchObject({ rhythm: 'bradycardia', bpm: 48 });
  });

  it('turns failing CI into arrhythmia and desaturation', () => {
    const v = assess({ ...healthy, checks: { passed: 1, failed: 3, pending: 0 } });
    expect(v.rhythm).toBe('arrhythmia');
    expect(v.alarms.map((a) => a.code)).toEqual(['DESAT', 'ARRHYTHMIA']);
    expect(v.alarms[0]?.level).toBe('critical');
  });

  it('reports days since death on a flatline', () => {
    const v = assess({ ...healthy, lastCommitAt: NOW - 45 * DAY });
    expect(v.alarms[0]).toMatchObject({ code: 'ASYSTOLE', message: 'Asystole: no commits for 45 days' });
  });
});
