# Implementation Plan

- [x] 1. Scaffold the project
  - Node native TypeScript, Vite, Vitest, fast-check, strict erasable-only tsconfig, MIT license
  - _Requirements: 9.1_

- [x] 2. Implement the clinical mapping in `src/shared/vitals.ts`
  - [x] 2.1 Heart rate, rhythm, SpO2, NIBP, temperature, alarms, diagnosis
    - _Requirements: 2.1-2.5, 3.1-3.4, 4.1-4.3_
  - [x] 2.2 Property tests P1-P7 in `test/vitals.test.ts`
    - _Requirements: 2.1-2.3, 3.1, 3.3, 4.1, 4.3_

- [x] 3. Implement waveform synthesis in `src/web/waveform.ts`
  - [x] 3.1 PQRST, PVC with compensatory pause, pleth, V-fib, baseline wander, seeded scheduler
    - _Requirements: 5.1, 5.2_
  - [x] 3.2 Property test P8 in `test/waveform.test.ts`
    - _Requirements: 5.1_

- [x] 4. Implement data sources
  - [x] 4.1 Local git source with optional `EKG_TEST_CMD`, integration-tested on a real temp repo
    - _Requirements: 1.2, 3.4, 7.1, 7.2_
  - [x] 4.2 GitHub source with ETags, Link-header PR counts, check tally, SHA-cached stats
    - _Requirements: 1.1, 7.3, 7.4_
  - [x] 4.3 Source registry with input validation and shared reads
    - _Requirements: 1.3, 1.6, 7.5_

- [x] 5. Implement the server: SSE stream, JSON reading, FHIR export, static/Vite, host checks
  - _Requirements: 1.3, 1.4, 8.1, 8.2, 9.1, 9.2_

- [x] 6. Implement the monitor UI
  - [x] 6.1 CRT layout, numerics, alarm banner, chart notes, time of death
    - _Requirements: 1.5, 4.3, 4.5, 9.3_
  - [x] 6.2 Sweep renderer and animation loop
    - _Requirements: 5.1, 5.2_
  - [x] 6.3 Audio: pulse-ox beeps, alarm bursts, flatline, defibrillator
    - _Requirements: 4.4, 4.5, 5.3, 5.4, 6.1, 6.2_

- [ ] 7. Central station: monitor several patients side by side in one ward view
  - Grid of compact monitors, worst patient pinned top-left, one shared audio channel
  - _Requirements: new requirement needed_

- [ ] 8. MCP server exposing `get_vitals` and `get_fhir` tools
  - Let Kiro agents check a repository's vitals before risky operations (for example refuse to
    start a refactor while the patient is in V-fib)
  - _Requirements: new requirement needed_

- [ ] 9. Code Blue paging: POST critical alarms to a webhook (Discord / Slack)
  - Debounced, includes the FHIR bundle
  - _Requirements: new requirement needed_

- [ ] 10. Deploy a public demo (GitHub source only, `HOST=0.0.0.0`) and record the 3 minute video
  - _Requirements: 1.6_
