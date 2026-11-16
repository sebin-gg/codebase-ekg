---
inclusion: always
---

# Product: Codebase EKG

A bedside patient monitor for git repositories, built for Kiroween 2026 (Frankenstein category).
It stitches together three things that were never meant to meet: git internals, clinical
patient-monitoring conventions (ECG morphology, pulse-ox tones, IEC 60601-1-8 style alarm
priorities) and HL7 FHIR healthcare interoperability.

## Who it is for

- Maintainers and team leads who want an ambient, glanceable signal of repo health on a wall screen.
- Developers who want an alarm when they land a giant commit, break CI, or leave work uncommitted.

## The clinical mapping (source of truth)

| Monitor | Repository signal |
|---|---|
| HR (bpm) | Commits in the last 24h, last hour weighted 3x, log curve clamped to 40-200 |
| Rhythm | Asystole = no commits for 30 days; V-fib = one commit >= 2000 lines in 24h; irregular + PVCs = failing checks; brady < 60; tachy > 120 |
| SpO2 | Pass rate of completed CI checks / local test runs, mapped to 70-99% |
| NIBP | Systolic = open PRs, diastolic = open issues (log scale) |
| TEMP | Lines churned in 24h (log scale), 36.6-41.0 C |
| BLEED | Uncommitted files (local repos only) |

Thresholds live in `LIMITS` in `src/shared/vitals.ts`. Change them there and nowhere else.

## Tone

Clinical precision delivered with dry gallows humor. Diagnoses read like a tired night-shift doctor
("Unsettlingly healthy."). Spooky, never gory. No emoji anywhere in the UI or copy.

## Non-goals

- Not a code-quality or static-analysis tool: we watch activity and CI, not code.
- No accounts, no database, no telemetry. The server keeps state in memory only.
