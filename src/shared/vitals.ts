import type { Alarm, CheckTally, RepoSignals, Rhythm, Vitals } from './types.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const LIMITS = {
  flatlineMs: 30 * DAY,
  vfibDiffLines: 2000,
  feverC: 38.5,
  hypertensionSystolic: 160,
  desatPercent: 90,
  criticalDesatPercent: 80,
  hemorrhageFiles: 25,
  minBpm: 40,
  maxBpm: 200,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`;

/** Commits in the last 24h, with the last hour weighted 3x, on a log curve: 0 -> 48, 1 -> 70, 7 -> 114, 63 -> 180. */
export function heartRate(commitsLast24h: number, commitsLastHour: number): number {
  const activity = Math.max(0, commitsLast24h) + 3 * Math.max(0, commitsLastHour);
  return Math.round(clamp(48 + 22 * Math.log2(1 + activity), LIMITS.minBpm, LIMITS.maxBpm));
}

/** Pass rate of completed checks mapped onto 70-99%. Unknown while nothing has finished. */
export function oxygen(checks: CheckTally | null): number | null {
  const done = checks ? checks.passed + checks.failed : 0;
  return checks && done > 0 ? Math.round(70 + 29 * (checks.passed / done)) : null;
}

/** Systolic tracks open PRs (review backlog), diastolic tracks open issues. */
export function bloodPressure(openPRs: number | null, openIssues: number | null): Vitals['bp'] {
  if (openPRs === null && openIssues === null) return null;
  return {
    systolic: Math.round(clamp(100 + 12 * Math.log2(1 + (openPRs ?? 0)), 90, 220)),
    diastolic: Math.round(clamp(60 + 6 * Math.log2(1 + (openIssues ?? 0)), 50, 130)),
  };
}

/** Lines churned in 24h: up to 100 lines is 36.6 C, 10k lines is a 39.0 C fever, capped at 41.0 C. */
export function temperature(linesChanged: number): number {
  const fever = clamp(1.2 * (Math.log10(1 + Math.max(0, linesChanged)) - 2), 0, 4.4);
  return Math.round((36.6 + fever) * 10) / 10;
}

export function rhythmOf(s: RepoSignals, bpm: number): Rhythm {
  if (s.lastCommitAt === null || s.sampledAt - s.lastCommitAt >= LIMITS.flatlineMs) return 'asystole';
  if (s.largestRecentDiff >= LIMITS.vfibDiffLines) return 'vfib';
  if (s.checks && s.checks.failed > 0) return 'arrhythmia';
  if (bpm < 60) return 'bradycardia';
  if (bpm > 120) return 'tachycardia';
  return 'sinus';
}

const DIAGNOSIS: Record<Rhythm, string> = {
  sinus: 'Normal sinus rhythm. Unsettlingly healthy.',
  bradycardia: 'Bradycardia. The repo is resting... for now.',
  tachycardia: 'Tachycardia. Someone is shipping fast, or panicking.',
  arrhythmia: 'Arrhythmia. CI keeps skipping beats.',
  vfib: 'Ventricular fibrillation. Something enormous just landed. Charge the paddles.',
  asystole: 'Asystole. Only a fresh commit can resurrect this patient.',
};

function alarmsFor(s: RepoSignals, v: Omit<Vitals, 'alarms' | 'diagnosis'>): Alarm[] {
  const alarms: Alarm[] = [];
  const add = (level: Alarm['level'], code: string, message: string) => alarms.push({ level, code, message });

  if (v.rhythm === 'asystole') {
    add('critical', 'ASYSTOLE', s.lastCommitAt === null
      ? 'Asystole: no commits on record'
      : `Asystole: no commits for ${plural(Math.floor((s.sampledAt - s.lastCommitAt) / DAY), 'day')}`);
  }
  if (v.rhythm === 'vfib') add('critical', 'VFIB', `V-fib: one commit changed ${plural(s.largestRecentDiff, 'line')}`);
  if (s.checks && s.checks.failed > 0) add('warning', 'ARRHYTHMIA', `Irregular rhythm: ${plural(s.checks.failed, 'failing check')}`);
  if (v.spo2 !== null && v.spo2 < LIMITS.desatPercent) {
    add(v.spo2 < LIMITS.criticalDesatPercent ? 'critical' : 'warning', 'DESAT', `SpO2 ${v.spo2}%: CI pass rate collapsing`);
  }
  if (v.bp && v.bp.systolic >= LIMITS.hypertensionSystolic) add('warning', 'HYPERTENSION', `Hypertension: ${plural(s.openPRs ?? 0, 'open pull request')}`);
  if (v.temp >= LIMITS.feverC) add('warning', 'FEVER', `Fever: ${plural(s.linesChangedLast24h, 'line')} churned in 24h`);
  if ((s.uncommittedFiles ?? 0) >= LIMITS.hemorrhageFiles) add('warning', 'HEMORRHAGE', `Hemorrhage: ${plural(s.uncommittedFiles ?? 0, 'uncommitted file')}`);

  return alarms.sort((a, b) => Number(b.level === 'critical') - Number(a.level === 'critical'));
}

export function assess(s: RepoSignals): Vitals {
  const measured = heartRate(s.commitsLast24h, s.commitsLastHour);
  const rhythm = rhythmOf(s, measured);
  const base = {
    bpm: rhythm === 'asystole' ? 0 : measured,
    rhythm,
    spo2: oxygen(s.checks),
    bp: bloodPressure(s.openPRs, s.openIssues),
    temp: temperature(s.linesChangedLast24h),
  };
  return { ...base, alarms: alarmsFor(s, base), diagnosis: DIAGNOSIS[rhythm] };
}
