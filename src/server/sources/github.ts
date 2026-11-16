import type { CheckTally, CommitNote, RepoSignals } from '../../shared/types.ts';
import { InputError } from '../errors.ts';
import type { Source } from './types.ts';

const API = 'https://api.github.com';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PASSING = new Set(['success', 'neutral', 'skipped']);

interface GhCommit {
  sha: string;
  author: { login: string } | null;
  commit: { message: string; author: { name: string; date: string } | null; committer: { date: string } | null };
}
interface GhRepo { open_issues_count: number }
interface GhCheckRuns { check_runs: { status: string; conclusion: string | null }[] }
interface GhStatus { statuses: { state: string }[] }
interface Fetched<T> { body: T; link: string | null }

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function parseGithubTarget(input: string): string | null {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(input.trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Total item count from a per_page=1 Link header, e.g. `<...&page=57>; rel="last"`. */
export function lastPage(link: string | null): number | null {
  const m = link ? /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link) : null;
  return m ? Number(m[1]) : null;
}

export function tallyChecks(runs: GhCheckRuns | null, status: GhStatus | null): CheckTally | null {
  const t = { passed: 0, failed: 0, pending: 0 };
  for (const r of runs?.check_runs ?? []) {
    if (r.status !== 'completed') t.pending++;
    else if (PASSING.has(r.conclusion ?? '')) t.passed++;
    else t.failed++;
  }
  for (const s of status?.statuses ?? []) {
    if (s.state === 'success') t.passed++;
    else if (s.state === 'pending') t.pending++;
    else t.failed++;
  }
  return t.passed + t.failed + t.pending > 0 ? t : null;
}

/**
 * Watches a GitHub repository's default branch through the REST API. Conditional requests (ETags)
 * keep authenticated polling nearly free; commit stats are immutable and cached by SHA.
 */
export function githubSource(slug: string, token = process.env.GITHUB_TOKEN, fetchImpl: typeof fetch = fetch): Source {
  const etags = new Map<string, { etag: string; hit: Fetched<unknown> }>();
  const linesBySha = new Map<string, number>();
  const detailBudget = token ? 30 : 4;
  let remaining: number | null = null;

  const describe = (status: number, path: string, left: string | null) => {
    if (status === 404) return `Patient ${slug} not found${token ? '' : ' (private? set GITHUB_TOKEN)'}`;
    if (status === 401) return 'GITHUB_TOKEN was rejected';
    if ((status === 403 || status === 429) && left === '0') return `Insurance denied: GitHub rate limit exhausted${token ? '' : ' (set GITHUB_TOKEN)'}`;
    return `GitHub answered ${status} for ${path}`;
  };

  async function get<T>(path: string, cache = true): Promise<Fetched<T>> {
    const cached = cache ? etags.get(path) : undefined;
    const res = await fetchImpl(API + path, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'codebase-ekg',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(cached ? { 'If-None-Match': cached.etag } : {}),
      },
    });
    const left = res.headers.get('x-ratelimit-remaining');
    if (left !== null) remaining = Number(left);
    if (res.status === 304 && cached) return cached.hit as Fetched<T>;
    if (!res.ok) throw new HttpError(res.status, describe(res.status, path, left));
    const fetched: Fetched<T> = { body: (await res.json()) as T, link: res.headers.get('link') };
    const etag = res.headers.get('etag');
    if (cache && etag) etags.set(path, { etag, hit: fetched });
    return fetched;
  }

  const missingPatient = (e: unknown): never => {
    throw e instanceof HttpError && e.status === 404 ? new InputError(e.message) : e;
  };

  return {
    pollMs: token ? 20_000 : 300_000,
    async read(): Promise<RepoSignals> {
      const now = Date.now();
      const [repo, commits, prs] = await Promise.all([
        get<GhRepo>(`/repos/${slug}`).catch(missingPatient),
        get<GhCommit[]>(`/repos/${slug}/commits?per_page=100`).then((r) => r.body, (e: unknown) =>
          e instanceof HttpError && e.status === 409 ? [] : missingPatient(e)),
        get<unknown[]>(`/repos/${slug}/pulls?state=open&per_page=1`).catch(missingPatient),
      ]);

      const head = commits[0]?.sha;
      const [runs, status] = head
        ? await Promise.all([
          get<GhCheckRuns>(`/repos/${slug}/commits/${head}/check-runs?per_page=100`).then((r) => r.body, () => null),
          get<GhStatus>(`/repos/${slug}/commits/${head}/status`).then((r) => r.body, () => null),
        ])
        : [null, null];

      const notes: CommitNote[] = commits.map((c) => ({
        sha: c.sha,
        author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
        message: c.commit.message.split('\n', 1)[0] ?? '',
        at: Date.parse(c.commit.committer?.date ?? c.commit.author?.date ?? '') || 0,
        lines: null,
      }));
      await Promise.all(notes.slice(0, detailBudget).filter((n) => !linesBySha.has(n.sha)).map((n) =>
        get<{ stats?: { total: number } }>(`/repos/${slug}/commits/${n.sha}`, false)
          .then((r) => { linesBySha.set(n.sha, r.body.stats?.total ?? 0); }, () => {})));
      for (const n of notes) n.lines = linesBySha.get(n.sha) ?? null;

      const day = notes.filter((n) => n.at >= now - DAY);
      const dayLines = day.map((n) => n.lines ?? 0);
      const openPRs = lastPage(prs.link) ?? prs.body.length;

      return {
        source: 'github',
        repo: slug,
        sampledAt: now,
        lastCommitAt: notes.length ? notes.reduce((m, n) => Math.max(m, n.at), 0) : null,
        commitsLastHour: day.filter((n) => n.at >= now - HOUR).length,
        commitsLast24h: day.length,
        linesChangedLast24h: dayLines.reduce((a, b) => a + b, 0),
        largestRecentDiff: dayLines.reduce((m, n) => Math.max(m, n), 0),
        checks: tallyChecks(runs, status),
        openPRs,
        openIssues: Math.max(0, repo.body.open_issues_count - openPRs),
        uncommittedFiles: null,
        recentCommits: notes.slice(0, 12),
        rateLimitRemaining: remaining,
      };
    },
  };
}
