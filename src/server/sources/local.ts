import { exec, execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import type { CheckTally, CommitNote, RepoSignals } from '../../shared/types.ts';
import { InputError } from '../errors.ts';
import type { Source } from './types.ts';

const execFileP = promisify(execFile);
const HOUR = 3_600_000;
const TEST_EVERY_MS = 60_000;
const FORMAT = '--format=%x1e%H%x1f%an%x1f%ct%x1f%s';

const git = async (cwd: string, args: string[]) =>
  (await execFileP('git', ['-C', cwd, ...args], { maxBuffer: 64 * 1024 * 1024, windowsHide: true })).stdout;

/** Parses `git log --numstat` output produced with FORMAT. Binary files count as zero lines. */
export function parseLog(out: string): CommitNote[] {
  return out.split('\x1e').slice(1).map((chunk) => {
    const [header = '', ...rows] = chunk.split('\n');
    const [sha = '', author = '', ct = '0', message = ''] = header.split('\x1f');
    let lines = 0;
    for (const row of rows) {
      const m = /^(\d+|-)\t(\d+|-)\t/.exec(row);
      if (m) lines += (m[1] === '-' ? 0 : Number(m[1])) + (m[2] === '-' ? 0 : Number(m[2]));
    }
    return { sha, author, message, at: Number(ct) * 1000, lines };
  });
}

/** Reads "N passed" / "N failed" summaries (vitest, jest, pytest, ...), falling back to the exit code. */
export function tallyTestOutput(output: string, exitCode: number): CheckTally {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const last = (re: RegExp) => {
    let n: number | null = null;
    for (const m of clean.matchAll(re)) n = Number(m[1]);
    return n;
  };
  const passed = last(/(\d+)\s+passed/gi);
  const failed = last(/(\d+)\s+failed/gi);
  if (passed === null && failed === null) return { passed: exitCode === 0 ? 1 : 0, failed: exitCode === 0 ? 0 : 1, pending: 0 };
  return { passed: passed ?? 0, failed: failed ?? (exitCode === 0 ? 0 : 1), pending: 0 };
}

function runTests(cwd: string, cmd: string): Promise<CheckTally> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve(tallyTestOutput(`${stdout}\n${stderr}`, err ? 1 : 0)));
  });
}

/**
 * Watches a repository on disk. EKG_TEST_CMD is set by whoever starts the server (never by a request)
 * and is run in the repository at most once a minute to feed SpO2.
 */
export function localSource(dir: string, testCmd = process.env.EKG_TEST_CMD): Source {
  let root: string | null = null;
  let checks: CheckTally | null = testCmd ? { passed: 0, failed: 0, pending: 1 } : null;
  let lastTestAt = -Infinity;
  let testing = false;

  return {
    pollMs: 5_000,
    async read(): Promise<RepoSignals> {
      if (!root) {
        try {
          root = (await git(dir, ['rev-parse', '--show-toplevel'])).trim();
        } catch {
          throw new InputError(`Not a git repository: ${dir}`);
        }
      }
      const cwd = root;
      const now = Date.now();
      if (testCmd && !testing && now - lastTestAt >= TEST_EVERY_MS) {
        testing = true;
        lastTestAt = now;
        void runTests(cwd, testCmd).then((t) => { checks = t; }).finally(() => { testing = false; });
      }

      const since = `--since=${new Date(now - 24 * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z')}`;
      const log = (extra: string[]) => git(cwd, ['log', '--branches', '--remotes', '--numstat', FORMAT, ...extra]).catch(() => '');
      const [recentOut, dayOut, statusOut] = await Promise.all([
        log(['-n', '12']),
        log([since]),
        git(cwd, ['--no-optional-locks', 'status', '--porcelain']),
      ]);
      const recent = parseLog(recentOut);
      const day = parseLog(dayOut);
      const lines = day.map((c) => c.lines ?? 0);

      return {
        source: 'local',
        repo: basename(cwd),
        sampledAt: now,
        lastCommitAt: recent.length ? recent.reduce((m, c) => Math.max(m, c.at), 0) : null,
        commitsLastHour: day.filter((c) => c.at >= now - HOUR).length,
        commitsLast24h: day.length,
        linesChangedLast24h: lines.reduce((a, b) => a + b, 0),
        largestRecentDiff: lines.reduce((m, n) => Math.max(m, n), 0),
        checks,
        openPRs: null,
        openIssues: null,
        uncommittedFiles: statusOut.split('\n').filter(Boolean).length,
        recentCommits: recent,
        rateLimitRemaining: null,
      };
    },
  };
}
