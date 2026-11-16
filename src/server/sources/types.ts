import type { RepoSignals } from '../../shared/types.ts';

export interface Source {
  pollMs: number;
  read(): Promise<RepoSignals>;
}
