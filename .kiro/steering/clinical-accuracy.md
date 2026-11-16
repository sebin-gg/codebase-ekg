---
inclusion: fileMatch
fileMatchPattern: ["src/shared/**/*.ts", "src/web/waveform.ts", "src/web/audio.ts", "test/**/*.ts"]
---

# Clinical accuracy guide

The joke only lands if the medicine is right. When touching vitals, waveforms, alarms or FHIR:

## Waveforms

- Normal complex: P wave about 200 ms before R, narrow QRS (< 120 ms), T wave 250-300 ms after R.
- PVC: no P wave, wide QRS, T wave opposite to the QRS, followed by a compensatory pause so that
  the PVC-plus-pause interval equals two normal RR intervals.
- V-fib: chaotic, no identifiable complexes, and no effective pulse on the pleth trace.
- Asystole: flat line with slight baseline wander, never a perfectly straight line.

## Sound

- Pulse-ox beep pitch falls as SpO2 falls. Keep this; clinicians rely on it.
- Alarm priorities follow the IEC 60601-1-8 pattern: high priority is a 3 + 2 pulse burst repeating
  every few seconds, medium priority is 3 pulses repeating less often.
- Audio may only start after a user gesture.

## FHIR / LOINC

| Vital | LOINC | UCUM |
|---|---|---|
| Heart rate | 8867-4 | /min |
| SpO2 (pulse oximetry) | 59408-5 | % |
| Blood pressure panel | 85354-9 (systolic 8480-6, diastolic 8462-4) | mm[Hg] |
| Body temperature | 8310-5 | Cel |

Every Observation carries the `vital-signs` category. Omit an Observation rather than inventing a
value the source could not measure.

## Correctness properties

The properties in `.kiro/specs/codebase-ekg/design.md` are executable in `test/vitals.test.ts`.
If a mapping change breaks one, change the design deliberately first, then the test, then the code.
