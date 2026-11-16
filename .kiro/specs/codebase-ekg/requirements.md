# Requirements Document

## Introduction

Codebase EKG is a bedside patient monitor for git repositories. A repository is admitted as a
patient; its commit activity, CI results, review backlog, churn and uncommitted work are rendered as
live vital signs with clinically faithful waveforms, sounds and alarms. Readings can be exported as
HL7 FHIR so repository health can flow into any tool that speaks healthcare interoperability.

## Glossary

- **Patient**: a repository being monitored (local path or GitHub `owner/repo`).
- **Signals**: raw observations about a patient at one instant (`RepoSignals`).
- **Vitals**: the clinical interpretation of signals (`Vitals`): HR, rhythm, SpO2, NIBP, TEMP, alarms.
- **Reading**: signals plus vitals.

## Requirements

### Requirement 1: Admission

**User Story:** As a developer, I want to admit a local or GitHub repository, so that I can watch its health live.

#### Acceptance Criteria

1. WHEN the user submits a GitHub target as `owner/repo` or a `https://github.com/owner/repo` URL THEN the system SHALL stream readings for that repository's default branch.
2. WHEN the user submits a local path THEN the system SHALL verify it is inside a git work tree and stream readings for it.
3. IF the target is malformed, unknown, or not a git repository THEN the system SHALL raise a LEADS OFF alarm with the reason AND SHALL stop retrying.
4. IF a reading fails for a transient reason (network, rate limit) THEN the system SHALL raise a LEADS OFF alarm AND SHALL keep polling.
5. WHEN the page is opened with `source` and `target` query parameters THEN the system SHALL admit that patient without showing the admission dialog.
6. WHERE the server is bound to a non-loopback interface the system SHALL refuse local admissions unless `EKG_ALLOW_LOCAL=1`.

### Requirement 2: Heart rate and rhythm

**User Story:** As a maintainer, I want commit activity shown as a heartbeat, so that I can feel the pace of the project at a glance.

#### Acceptance Criteria

1. The system SHALL compute heart rate as `48 + 22 * log2(1 + commits24h + 3 * commits1h)`, rounded and clamped to 40-200 bpm.
2. WHEN a repository has no commits OR its last commit is at least 30 days old THEN the rhythm SHALL be asystole AND heart rate SHALL be 0.
3. WHEN a living repository has a single commit in the last 24 hours touching at least 2000 lines THEN the rhythm SHALL be ventricular fibrillation.
4. WHEN any CI check or local test is failing THEN the rhythm SHALL be irregular with premature ventricular contractions.
5. OTHERWISE the rhythm SHALL be bradycardia below 60 bpm, tachycardia above 120 bpm, and sinus in between.

### Requirement 3: Other vital signs

**User Story:** As a team lead, I want CI health, review backlog, churn and uncommitted work as familiar vitals, so that I can triage without reading dashboards.

#### Acceptance Criteria

1. The system SHALL compute SpO2 as `70 + 29 * passed / (passed + failed)` over completed checks, and SHALL show it as unknown when no check has completed.
2. The system SHALL compute systolic pressure from open pull requests and diastolic pressure from open issues on a log scale.
3. The system SHALL compute temperature from lines churned in the last 24 hours on a log scale, between 36.6 and 41.0 C.
4. WHERE the patient is a local repository the system SHALL show the number of uncommitted files as BLEED.

### Requirement 4: Alarms

**User Story:** As a developer, I want the monitor to alarm like a real one, so that problems interrupt me in proportion to their severity.

#### Acceptance Criteria

1. The system SHALL raise critical alarms for asystole, ventricular fibrillation and SpO2 below 80%.
2. The system SHALL raise warning alarms for failing checks, SpO2 below 90%, systolic pressure of 160 or more, temperature of 38.5 C or more, and 25 or more uncommitted files.
3. The alarm banner SHALL show the highest-priority alarm first and a count of the others.
4. WHEN the top alarm is critical THEN the system SHALL sound a 3 + 2 pulse melodic burst every 4 seconds; WHEN it is a warning THEN a 3 pulse burst every 12 seconds.
5. WHILE the rhythm is asystole the system SHALL sound a continuous flatline tone AND display the time of death.

### Requirement 5: Waveforms and sound

**User Story:** As a viewer, I want the traces and sounds to be believable, so that the metaphor holds.

#### Acceptance Criteria

1. The ECG trace SHALL sweep at a constant speed behind an erase bar, drawing P-QRS-T complexes for normal beats, wide complexes with compensatory pauses for PVCs, a chaotic waveform for V-fib, and baseline wander for asystole.
2. The pleth trace SHALL follow each beat, with amplitude scaled by SpO2, weaker pulses after PVCs and no effective pulse in V-fib.
3. Each beat SHALL beep with a pitch that falls as SpO2 falls.
4. Audio SHALL start only after a user gesture AND SHALL be mutable.

### Requirement 6: Defibrillator

**User Story:** As a viewer, I want to try to shock a dying repo, so that the monitor tells me what would actually save it.

#### Acceptance Criteria

1. WHILE the rhythm is V-fib or asystole the system SHALL show a CHARGE 200J control.
2. WHEN the control is used THEN the system SHALL play a charge and discharge sound, draw a shock artifact on the ECG, shake the monitor, and state the real remedy (split the giant commit, or push a commit).

### Requirement 7: Data sources

**User Story:** As an operator, I want accurate signals without burning API quota, so that the monitor can run all day.

#### Acceptance Criteria

1. The local source SHALL read `git log --numstat` across local and remote branches and `git status --porcelain`, polling every 5 seconds.
2. WHERE `EKG_TEST_CMD` is set the local source SHALL run it in the repository at most once a minute and SHALL read "N passed / N failed" summaries, falling back to the exit code.
3. The GitHub source SHALL use conditional requests with ETags, poll every 20 seconds with `GITHUB_TOKEN` and every 5 minutes without, count open pull requests from the Link header, tally check runs and commit statuses on the default branch head, and cache commit stats by SHA.
4. The system SHALL display the remaining GitHub rate limit as INSURANCE.
5. Concurrent monitors of the same patient SHALL share reads.

### Requirement 8: Interoperability

**User Story:** As an integrator, I want readings as HL7 FHIR, so that repository vitals can flow into existing health tooling.

#### Acceptance Criteria

1. WHEN `GET /api/fhir` is called THEN the system SHALL return an HL7 FHIR R4 `collection` Bundle of `vital-signs` Observations coded in LOINC with UCUM units.
2. The system SHALL omit an Observation when the source could not measure that vital.

### Requirement 9: Host safety

**User Story:** As an operator, I want running the monitor to be safe on my machine.

#### Acceptance Criteria

1. The server SHALL bind to 127.0.0.1 by default AND SHALL reject requests whose Host header is not a loopback name while bound to loopback.
2. The system SHALL never pass request input to a shell.
3. The system SHALL render user-controlled strings as text, never as HTML.
