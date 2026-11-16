import { describe, expect, it } from 'vitest';
import { InputError } from '../src/server/errors.ts';
import { githubSource, lastPage, parseGithubTarget, tallyChecks } from '../src/server/sources/github.ts';

describe('parseGithubTarget', () => {
  it('accepts slugs and URLs and rejects junk', () => {
    expect(parseGithubTarget('vitejs/vite')).toBe('vitejs/vite');
    expect(parseGithubTarget(' https://github.com/vitejs/vite.git/ ')).toBe('vitejs/vite');
    expect(parseGithubTarget('https://www.github.com/a-b/c.d_e')).toBe('a-b/c.d_e');
    expect(parseGithubTarget('vite')).toBeNull();
    expect(parseGithubTarget('../../etc/passwd')).toBeNull();
    expect(parseGithubTarget('a/b?x=1')).toBeNull();
  });
});

describe('lastPage', () => {
  it('reads the last page from a Link header', () => {
    const link = '<https://api.github.com/repositories/1/pulls?state=open&per_page=1&page=2>; rel="next", <https://api.github.com/repositories/1/pulls?state=open&per_page=1&page=57>; rel="last"';
    expect(lastPage(link)).toBe(57);
    expect(lastPage(null)).toBeNull();
  });
});

describe('tallyChecks', () => {
  it('merges check runs and commit statuses', () => {
    expect(tallyChecks(
      { check_runs: [{ status: 'completed', conclusion: 'success' }, { status: 'completed', conclusion: 'failure' }, { status: 'in_progress', conclusion: null }, { status: 'completed', conclusion: 'skipped' }] },
      { statuses: [{ state: 'success' }, { state: 'error' }] },
    )).toEqual({ passed: 3, failed: 2, pending: 1 });
    expect(tallyChecks({ check_runs: [] }, { statuses: [] })).toBeNull();
  });
});

describe('githubSource', () => {
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const commit = (sha: string, msAgo: number) => ({
    sha,
    author: { login: `dev-${sha}` },
    commit: { message: `Commit ${sha}\n\nbody`, author: { name: 'x', date: iso(msAgo) }, committer: { date: iso(msAgo) } },
  });

  function fakeFetch(routes: Record<string, { status?: number; body?: unknown; headers?: Record<string, string> }>) {
    const calls: { path: string; headers: Record<string, string> }[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input).replace('https://api.github.com', '');
      calls.push({ path, headers: (init?.headers ?? {}) as Record<string, string> });
      const route = routes[path] ?? { status: 404, body: { message: 'Not Found' } };
      const status = route.status ?? 200;
      return new Response(status === 304 ? null : JSON.stringify(route.body ?? {}), { status, headers: { 'x-ratelimit-remaining': '4999', ...route.headers } });
    }) as typeof fetch;
    return { impl, calls };
  }

  it('maps repo, commits, PRs and checks into signals', async () => {
    const { impl } = fakeFetch({
      '/repos/acme/app': { body: { open_issues_count: 12 } },
      '/repos/acme/app/commits?per_page=100': { body: [commit('a1', 10 * 60_000), commit('b2', 5 * 3_600_000), commit('c3', 3 * 86_400_000)] },
      '/repos/acme/app/pulls?state=open&per_page=1': { body: [{}], headers: { link: '<https://api.github.com/x?per_page=1&page=4>; rel="last"' } },
      '/repos/acme/app/commits/a1/check-runs?per_page=100': { body: { check_runs: [{ status: 'completed', conclusion: 'failure' }] } },
      '/repos/acme/app/commits/a1/status': { body: { statuses: [{ state: 'success' }] } },
      '/repos/acme/app/commits/a1': { body: { stats: { total: 2400 } } },
      '/repos/acme/app/commits/b2': { body: { stats: { total: 30 } } },
      '/repos/acme/app/commits/c3': { body: { stats: { total: 7 } } },
    });
    const s = await githubSource('acme/app', 'token', impl).read();
    expect(s).toMatchObject({
      source: 'github',
      repo: 'acme/app',
      commitsLastHour: 1,
      commitsLast24h: 2,
      linesChangedLast24h: 2430,
      largestRecentDiff: 2400,
      openPRs: 4,
      openIssues: 8,
      checks: { passed: 1, failed: 1, pending: 0 },
      rateLimitRemaining: 4999,
    });
    expect(s.recentCommits[0]).toMatchObject({ sha: 'a1', author: 'dev-a1', message: 'Commit a1', lines: 2400 });
  });

  it('sends ETags back and reuses cached bodies on 304', async () => {
    let round = 0;
    const routes = (): Parameters<typeof fakeFetch>[0] => ({
      '/repos/acme/app': round ? { status: 304 } : { body: { open_issues_count: 3 }, headers: { etag: '"r1"' } },
      '/repos/acme/app/commits?per_page=100': { body: [] },
      '/repos/acme/app/pulls?state=open&per_page=1': { body: [] },
    });
    let fetcher = fakeFetch(routes());
    const impl = ((...args: Parameters<typeof fetch>) => fetcher.impl(...args)) as typeof fetch;
    const source = githubSource('acme/app', 'token', impl);
    await source.read();
    round = 1;
    fetcher = fakeFetch(routes());
    const s = await source.read();
    expect(fetcher.calls.find((c) => c.path === '/repos/acme/app')?.headers['If-None-Match']).toBe('"r1"');
    expect(s).toMatchObject({ openIssues: 3, openPRs: 0, lastCommitAt: null, checks: null });
  });

  it('treats an unknown repository as bad patient details', async () => {
    const { impl } = fakeFetch({});
    await expect(githubSource('ghost/repo', undefined, impl).read()).rejects.toBeInstanceOf(InputError);
  });
});
