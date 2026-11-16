import { describe, expect, it } from 'vitest';
import { toFhirBundle } from '../src/shared/fhir.ts';
import type { Reading } from '../src/shared/types.ts';

const reading: Reading = {
  signals: {
    source: 'github', repo: 'acme/app', sampledAt: Date.UTC(2026, 10, 3), lastCommitAt: null, commitsLastHour: 0,
    commitsLast24h: 0, linesChangedLast24h: 0, largestRecentDiff: 0, checks: null, openPRs: 3, openIssues: 9,
    uncommittedFiles: null, recentCommits: [], rateLimitRemaining: null,
  },
  vitals: { bpm: 72, rhythm: 'sinus', spo2: 97, bp: { systolic: 124, diastolic: 80 }, temp: 37.1, alarms: [], diagnosis: '' },
};

describe('toFhirBundle', () => {
  it('emits LOINC-coded vital-sign observations with UCUM units', () => {
    const bundle = toFhirBundle(reading);
    expect(bundle).toMatchObject({ resourceType: 'Bundle', type: 'collection' });
    // Bundle.timestamp is assembly time (~now), not the observation time.
    expect(Math.abs(Date.parse(bundle.timestamp) - Date.now())).toBeLessThan(60_000);
    // Observations carry the sample time as effectiveDateTime, a Patient
    // reference subject, an id, and the vital-signs profile.
    type Obs = { resource: { code: { coding: { code: string }[] } } & Record<string, unknown> };
    const obs = bundle.entry.filter((e) => e.resource.resourceType === 'Observation') as Obs[];
    const patient = bundle.entry.find((e) => e.resource.resourceType === 'Patient')!.resource;
    expect(patient).toBeDefined();
    const hr = obs.find((e) => e.resource.code.coding[0]!.code === '8867-4')!.resource;

    expect(hr).toMatchObject({
      id: expect.stringMatching(/^ekg-8867-4-[A-Za-z0-9.-]+-\d+$/),
      meta: { profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'] },
      subject: { reference: expect.stringMatching(/^urn:codebase-ekg:patient:/), display: 'github:acme/app' },
      effectiveDateTime: '2026-11-03T00:00:00.000Z',
    });
    const byCode = Object.fromEntries(obs.map((e) => [e.resource.code.coding[0]!.code, e.resource as Record<string, unknown>]));
    expect(Object.keys(byCode).sort()).toEqual(['59408-5', '8310-5', '85354-9', '8867-4']);
    expect(byCode['8867-4']).toMatchObject({ valueQuantity: { value: 72, code: '/min', system: 'http://unitsofmeasure.org' } });
    expect(byCode['85354-9']).toMatchObject({
      component: [
        { code: { coding: [{ code: '8480-6' }] }, valueQuantity: { value: 124, code: 'mm[Hg]' } },
        { code: { coding: [{ code: '8462-4' }] }, valueQuantity: { value: 80, code: 'mm[Hg]' } },
      ],
    });
  });

  it('omits vitals the source could not measure', () => {
    const bundle = toFhirBundle({ ...reading, vitals: { ...reading.vitals, spo2: null, bp: null } });
    expect(bundle.entry.filter((e) => e.resource.resourceType === 'Observation')
      .map((e) => (e.resource as { code: { coding: { code: string }[] } }).code.coding[0]!.code)).toEqual(['8867-4', '8310-5']);
  });
});
