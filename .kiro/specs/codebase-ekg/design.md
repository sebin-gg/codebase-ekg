# Design Document

## Overview

A single Node process serves the monitor UI and a small API. Data sources poll a repository and
produce `RepoSignals`; one pure function, `assess()`, turns signals into `Vitals`; the browser
renders vitals as a live monitor and synthesizes waveforms locally from heart rate and rhythm.

## Architecture

```
            +-------------------+        +------------------+
 local repo | sources/local.ts  |        | sources/github.ts| GitHub REST API
 git CLI -->| execFile git, 5s  |        | ETags, 20s / 5m  |<-- (conditional requests)
            +---------+---------+        +--------+---------+
                      \                          /
                       v                        v
                  sources/index.ts  (validate input, memoize, share reads)
                              |
                         RepoSignals
                              v
                   shared/vitals.ts  assess()  -- pure
                              |
                           Vitals
              +---------------+----------------+
              v               v                v
       /api/stream (SSE)  /api/reading     /api/fhir -> shared/fhir.ts
              |
              v
   web/main.ts --> web/waveform.ts (Heart: beats, PQRST, PVC, pleth, V-fib)
               --> web/sweep.ts (canvas sweep)   --> web/audio.ts (beeps, alarms)
```

## Components and Interfaces

- `Source { pollMs; read(): Promise<RepoSignals> }`: implemented by the local and GitHub sources.
- `openSource(kind, target, allowLocal)`: validates admission input (throws `InputError`), caches
  up to 32 open sources and memoizes reads for half a poll interval.
- `assess(signals): Vitals`: the complete clinical mapping. Thresholds in `LIMITS`.
- `toFhirBundle(reading)`: FHIR R4 Bundle builder.
- `Heart`: owns a seeded `BeatScheduler`, schedules beats 600 ms ahead so P waves render before
  their R peak, and exposes `ecg(t)` and `pleth(t)` as continuous functions of time.
- `SweepTrace`: renders any `(t) => number` as a sweeping trace with an erase bar.

### HTTP API

| Route | Response |
|---|---|
| `GET /api/health` | `{ ok, allowLocal, githubToken }` |
| `GET /api/reading?source=&target=` | `Reading` JSON; 400 on bad input, 502 on upstream failure |
| `GET /api/stream?source=&target=` | SSE: `reading` events, `fault` events `{ message, fatal }` |
| `GET /api/fhir?source=&target=` | `application/fhir+json` Bundle |

## Data Models

See `src/shared/types.ts`. `RepoSignals` uses `null` for anything a source cannot measure (for
example GitHub has no uncommitted files; local repos have no pull requests).

## Correctness Properties

Each property is executable as a fast-check test in `test/vitals.test.ts` or `test/waveform.test.ts`.

- **P1 Range**: for all signals, `0 <= bpm <= 200`, and `bpm == 0` exactly when rhythm is asystole. _Validates: 2.1, 2.2_
- **P2 Death**: rhythm is asystole exactly when there is no commit or the last commit is at least 30 days old. _Validates: 2.2_
- **P3 Fibrillation**: for living repositories, rhythm is V-fib exactly when the largest recent diff is at least 2000 lines. _Validates: 2.3_
- **P4 Monotonic pulse**: adding commits never lowers heart rate. _Validates: 2.1_
- **P5 Oxygen**: SpO2 is within 70-99 and non-decreasing in passed checks, or null when nothing completed. _Validates: 3.1_
- **P6 Temperature**: temperature is within 36.6-41.0 and non-decreasing in churn. _Validates: 3.3_
- **P7 Alarm priority**: lethal rhythms always produce a critical alarm, and critical alarms precede warnings. _Validates: 4.1, 4.3_
- **P8 Rhythm timing**: sinus RR intervals stay within 2% of 60/bpm; irregular rhythms keep the mean rate within 5% and include PVCs; asystole and V-fib schedule no beats. _Validates: 5.1_

## Error Handling

- Bad admission input and unknown repositories raise `InputError`: SSE sends a fatal `fault` and closes.
- Transient failures (network, 5xx, rate limit) send a non-fatal `fault`; polling continues.
- Missing optional data (check runs, commit stats) degrades to `null` instead of failing the reading.
- An empty GitHub repository (HTTP 409) is treated as a patient with no commits: asystole, "never born".

## Testing Strategy

- Property-based tests for every pure mapping (P1-P8).
- GitHub source tested against a fake `fetch`, including ETag reuse on 304 and 404 handling.
- Local source tested against a real temporary git repository with known commits and diffs.
- FHIR output checked for LOINC codes, UCUM units and omission of unmeasured vitals.
