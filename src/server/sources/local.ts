import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { CheckTally, CommitNote, RepoSignals } from '../../shared/types.ts';
import { InputError, messageOf } from '../errors.ts';
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

/** Resolves `file` on PATH; returns it directly, or via ComSpec for .cmd/.bat
 *  shims which cannot be spawned without a shell on Windows. */
function resolveCmd(file: string, cwd: string): { file: string; shell: boolean } | null {
  if (process.platform !== 'win32') return { file, shell: false };
  const shellExts = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD')
    .split(';').map((e) => e.toLowerCase());
  const asResult = (full: string) => ({ file: full, shell: ['.cmd', '.bat'].includes(extname(full).toLowerCase()) });
  // Path-qualified names (absolute or containing separators) resolve against the repo cwd.
  if (/[/\\]/.test(file)) {
    const full = resolve(cwd, file);
    if (existsSync(full)) return asResult(full);
    for (const ext of shellExts) {
      if (existsSync(full + ext)) return asResult(full + ext);
    }
    return null;
  }
  // Windows resolves directory-major; PATH entries may carry quotes.
  const dirs = (process.env.PATH ?? '').split(';').map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of ['', ...shellExts]) {
      const full = join(dir, file + ext);
      if (existsSync(full)) return asResult(full);
    }
  }
  return null;
}

function runTests(cwd: string, cmd: string): Promise<CheckTally> {
  // Tokenize without a shell: the env var is trusted input, but keeping it
  // out of shell interpretation removes an injection surface entirely.
  const argv = (cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [])
    .map((t) => (t.length > 1 && t[0] === t[t.length - 1] && (t[0] === '"' || t[0] === "'") ? t.slice(1, -1) : t));
  const [file, ...args] = argv;
  return new Promise((resolve) => {
    if (!file) {
      process.stderr.write(`ekg: EKG_TEST_CMD is empty or unparseable: ${JSON.stringify(cmd)}\n`);
      return resolve({ passed: 0, failed: 1, pending: 0 });
    }
    const resolved = resolveCmd(file, cwd) ?? { file, shell: false };
    // cmd.exe needs the whole command line as one string after /c. %VAR% in args
    // still expands under cmd, but EKG_TEST_CMD is operator-supplied input.
    const [bin, argv2] = resolved.shell
      ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${resolved.file}"${args.map((a) => ` "${a.replace(/"/g, '""')}"`).join('')}`]]
      : [resolved.file, args];
    execFile(bin, argv2, {
      cwd, timeout: 180_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      // The /c payload is a hand-quoted command line; Node's default re-quoting
      // would escape the embedded quotes as \" which cmd.exe can't parse.
      windowsVerbatimArguments: resolved.shell,
    }, (err, stdout, stderr) =>
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
      const log = (extra: string[]) => git(cwd, ['log', '--branches', '--remotes', '--numstat', FORMAT, ...extra])
        .catch((e: unknown) => { process.stderr.write(`ekg: git log failed in ${cwd}: ${messageOf(e)}\n`); return ''; });
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
