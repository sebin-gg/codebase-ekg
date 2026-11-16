export type SourceKind = 'local' | 'github';

export interface CommitNote {
  sha: string;
  author: string;
  message: string;
  /** Commit time, epoch ms. */
  at: number;
  /** Additions + deletions, or null when the source could not afford to look. */
  lines: number | null;
}

export interface CheckTally {
  passed: number;
  failed: number;
  pending: number;
}

/** Raw, source-agnostic observations about a repository at one instant. */
export interface RepoSignals {
  source: SourceKind;
  repo: string;
  sampledAt: number;
  lastCommitAt: number | null;
  commitsLastHour: number;
  commitsLast24h: number;
  linesChangedLast24h: number;
  largestRecentDiff: number;
  checks: CheckTally | null;
  openPRs: number | null;
  openIssues: number | null;
  uncommittedFiles: number | null;
  recentCommits: CommitNote[];
  rateLimitRemaining: number | null;
}

export type Rhythm = 'sinus' | 'bradycardia' | 'tachycardia' | 'arrhythmia' | 'vfib' | 'asystole';
export type AlarmLevel = 'warning' | 'critical';

export interface Alarm {
  level: AlarmLevel;
  code: string;
  message: string;
}

export interface Vitals {
  bpm: number;
  rhythm: Rhythm;
  spo2: number | null;
  bp: { systolic: number; diastolic: number } | null;
  temp: number;
  alarms: Alarm[];
  diagnosis: string;
}

export interface Reading {
  signals: RepoSignals;
  vitals: Vitals;
}
