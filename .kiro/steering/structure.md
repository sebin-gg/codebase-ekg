---
inclusion: always
---

# Project structure

```
src/shared/    Pure, isomorphic logic. No IO, no DOM, no Node APIs.
  types.ts       RepoSignals (raw observations) -> Vitals (clinical interpretation)
  vitals.ts      The only place signals are mapped to vitals and alarms
  fhir.ts        Reading -> HL7 FHIR R4 Bundle
src/server/    Node only
  index.ts       HTTP routes, SSE, Vite middleware / static files
  sources/       One module per data source; each returns RepoSignals and nothing else
src/web/       Browser only
  waveform.ts    Pure signal synthesis (PQRST, PVC, pleth, V-fib) + beat scheduler; unit-testable
  sweep.ts       Canvas sweep renderer
  audio.ts       Web Audio beeps, alarms, flatline, defibrillator
  main.ts        Wiring: EventSource -> render -> animation loop
test/          Vitest suites, mirroring the module they cover
```

## Rules

- Data flows one way: source -> `RepoSignals` -> `assess()` -> `Vitals` -> UI / FHIR.
  Sources must not compute vitals; the UI must not re-derive them.
- A new data source implements `Source` from `src/server/sources/types.ts` and is registered in
  `sources/index.ts`. It must fill every `RepoSignals` field, using `null` for what it cannot measure.
- Keep `src/web/waveform.ts` free of DOM access so it stays testable in Node.
- User-controlled strings (commit messages, author names) reach the DOM via `textContent` only.
