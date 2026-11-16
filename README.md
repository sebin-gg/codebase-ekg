# Codebase EKG

A bedside patient monitor for git repositories. Built for Kiroween 2026 (Frankenstein).

Commits are heartbeats. CI is oxygen. The pull-request backlog is blood pressure. Land a
2,500-line commit and the patient goes into ventricular fibrillation; leave a repo alone for 30
days and it flatlines, with a time of death. Every reading is also available as an HL7 FHIR
Bundle, so repository health can flow into real healthcare tooling.

## Vital signs

| Monitor | Repository signal | Alarm |
|---|---|---|
| HR | Commits in the last 24h (last hour weighted 3x), 40-200 bpm | |
| Rhythm | Sinus / brady / tachy from HR | Asystole: no commits for 30 days. V-fib: one commit >= 2000 lines. Irregular + PVCs: failing checks |
| SpO2 | CI check pass rate (GitHub) or `EKG_TEST_CMD` results (local) | < 90% warning, < 80% critical |
| NIBP | Open PRs / open issues | Systolic >= 160 |
| TEMP | Lines churned in 24h | >= 38.5 C |
| BLEED | Uncommitted files (local) | >= 25 |

The pulse-ox beep drops in pitch as SpO2 falls, alarms follow IEC 60601-1-8 style priority bursts,
and the defibrillator tells you what would actually save the patient.

## Run it

Requires Node.js 22.18 or newer (TypeScript runs natively) and pnpm.

```sh
pnpm install
pnpm dev            # http://127.0.0.1:1313
```

Then admit a patient, or link straight to one:
`http://127.0.0.1:1313/?source=github&target=vitejs/vite` or
`http://127.0.0.1:1313/?source=local&target=D:\git\my-repo`.

Optional environment:

| Variable | Effect |
|---|---|
| `GITHUB_TOKEN` | GitHub polling every 20s instead of every 5 min, and private repos. e.g. `GITHUB_TOKEN=$(gh auth token) pnpm dev` (PowerShell: `$env:GITHUB_TOKEN = gh auth token; pnpm dev`) |
| `EKG_TEST_CMD` | Command run in a local patient's repo at most once a minute to feed SpO2, e.g. `pnpm test` |
| `HOST`, `PORT` | Bind address (default `127.0.0.1:1313`) |
| `EKG_ALLOW_LOCAL` | Set to `1` to allow local admissions when bound to a public interface |

Production: `pnpm build && pnpm start`.

### Demo the alarms on a local repo

```sh
seq 1 3000 > monolith.txt && git add monolith.txt && git commit -m "Land the monolith"   # V-fib
git reset --hard HEAD~1                                                                  # recovers
```

## API

| Route | Returns |
|---|---|
| `GET /api/reading?source=github&target=owner/repo` | Signals + vitals as JSON |
| `GET /api/stream?source=...&target=...` | Server-Sent Events (`reading`, `fault`) |
| `GET /api/fhir?source=...&target=...` | HL7 FHIR R4 Bundle of LOINC-coded vital-sign Observations |

## Development

`pnpm check` runs the typechecker and the test suite (property-based tests for the clinical
mapping and rhythm generator, a real-git integration test, and a faked GitHub API). Specs,
steering and hooks live in [`.kiro/`](.kiro).

## License

MIT
