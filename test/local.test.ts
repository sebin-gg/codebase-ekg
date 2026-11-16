import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InputError } from '../src/server/errors.ts';
import { localSource, parseLog, tallyTestOutput } from '../src/server/sources/local.ts';

describe('parseLog', () => {
  it('parses headers and sums numstat, counting binary files as zero', () => {
    const out = '\x1eabc\x1fAda\x1f1700000000\x1fAdd engine\n\n10\t2\tsrc/a.ts\n-\t-\tlogo.png\n\x1edef\x1fGrace\x1f1700000100\x1fEmpty\n';
    expect(parseLog(out)).toEqual([
      { sha: 'abc', author: 'Ada', message: 'Add engine', at: 1_700_000_000_000, lines: 12 },
      { sha: 'def', author: 'Grace', message: 'Empty', at: 1_700_000_100_000, lines: 0 },
    ]);
    expect(parseLog('')).toEqual([]);
  });
});

describe('tallyTestOutput', () => {
  it('reads the final vitest summary through ANSI colors', () => {
    const out = ' Test Files  \x1b[31m1 failed\x1b[39m | 3 passed (4)\n      Tests  \x1b[31m2 failed\x1b[39m | 40 passed (42)\n';
    expect(tallyTestOutput(out, 1)).toEqual({ passed: 40, failed: 2, pending: 0 });
  });

  it('falls back to the exit code', () => {
    expect(tallyTestOutput('ok', 0)).toEqual({ passed: 1, failed: 0, pending: 0 });
    expect(tallyTestOutput('boom', 2)).toEqual({ passed: 0, failed: 1, pending: 0 });
    expect(tallyTestOutput('12 passed', 1)).toEqual({ passed: 12, failed: 1, pending: 0 });
  });
});

describe('localSource (real git)', () => {
  let dir = '';
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'commit.gpgsign=false', ...args], {
    env: { ...process.env, GIT_AUTHOR_NAME: 'Patient Zero', GIT_AUTHOR_EMAIL: 'zero@example.com', GIT_COMMITTER_NAME: 'Patient Zero', GIT_COMMITTER_EMAIL: 'zero@example.com' },
    stdio: 'pipe',
  });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ekg-'));
    git('init', '-q', '-b', 'main');
    await writeFile(join(dir, 'small.txt'), 'a\nb\nc\n');
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'Small start');
    await writeFile(join(dir, 'huge.txt'), Array.from({ length: 2500 }, (_, i) => `line ${i}`).join('\n'));
    git('add', '.');
    git('commit', '-q', '--no-verify', '-m', 'Land the monolith');
    await writeFile(join(dir, 'wip.txt'), 'unsaved');
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('reads commits, churn, the biggest diff and uncommitted files', async () => {
    const s = await localSource(dir, '').read();
    expect(s).toMatchObject({
      source: 'local',
      commitsLast24h: 2,
      commitsLastHour: 2,
      linesChangedLast24h: 2503,
      largestRecentDiff: 2500,
      uncommittedFiles: 1,
      checks: null,
    });
    expect(s.recentCommits.map((c) => c.message)).toEqual(['Land the monolith', 'Small start']);
    expect(Date.now() - s.lastCommitAt!).toBeLessThan(60_000);
  });

  it('rejects paths that are not repositories', async () => {
    await expect(localSource(tmpdir(), '').read()).rejects.toBeInstanceOf(InputError);
  });
});
