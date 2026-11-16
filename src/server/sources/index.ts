import { resolve } from 'node:path';
import type { RepoSignals } from '../../shared/types.ts';
import { InputError } from '../errors.ts';
import { githubSource, parseGithubTarget } from './github.ts';
import { localSource } from './local.ts';
import type { Source } from './types.ts';

export type { Source } from './types.ts';

const MAX_OPEN = 32;
const open = new Map<string, Source>();

/** Shares one in-flight read between concurrent monitors of the same patient. */
function memoize(source: Source): Source {
  let last: { at: number; reading: Promise<RepoSignals> } | null = null;
  return {
    pollMs: source.pollMs,
    read() {
      const now = Date.now();
      if (!last || now - last.at >= source.pollMs / 2) {
        const entry = { at: now, reading: source.read() };
        entry.reading.catch(() => { if (last === entry) last = null; });
        last = entry;
      }
      return last.reading;
    },
  };
}

export function openSource(kind: string, target: string, allowLocal: boolean): Source {
  let key: string;
  let create: () => Source;
  if (kind === 'github') {
    const slug = parseGithubTarget(target);
    if (!slug) throw new InputError('GitHub patients look like owner/repo or https://github.com/owner/repo');
    key = `github:${slug.toLowerCase()}`;
    create = () => githubSource(slug);
  } else if (kind === 'local') {
    if (!allowLocal) throw new InputError('Local admissions are disabled on this server');
    if (!target.trim()) throw new InputError('Give the path to a local git repository');
    const dir = resolve(target.trim());
    key = `local:${dir}`;
    create = () => localSource(dir);
  } else {
    throw new InputError(`Unknown source "${kind}" (use github or local)`);
  }

  let source = open.get(key);
  if (!source) {
    source = memoize(create());
    open.set(key, source);
    if (open.size > MAX_OPEN) open.delete(open.keys().next().value as string);
  }
  return source;
}
