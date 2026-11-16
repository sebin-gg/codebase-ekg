import type { Reading } from './types.ts';

const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
const VITAL_SIGNS = [{
  coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }],
}];

const loinc = (code: string, display: string) => ({ coding: [{ system: LOINC, code, display }], text: display });
const quantity = (value: number, unit: string, code: string) => ({ value, unit, system: UCUM, code });

/** Renders a reading as an HL7 FHIR R4 collection Bundle of LOINC-coded vital-sign Observations. */
export function toFhirBundle({ signals, vitals }: Reading) {
  const effectiveDateTime = new Date(signals.sampledAt).toISOString();
  // Slugs lose information (a/b == a-b) — a short hash keeps ids unique across repos.
  const rawKey = `${signals.source}:${signals.repo}`;
  let h = 5381;
  for (const c of rawKey) h = ((h << 5) + h + (c.codePointAt(0) ?? 0)) | 0;
  const repoHash = (h >>> 0).toString(36);
  const patientId = `${rawKey.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 55)}-${repoHash}`;
  const repoUrn = `${rawKey.replace(/[^A-Za-z0-9.-]/g, '-')}-${repoHash}`;
  // Absolute reference = the entry's fullUrl, so it resolves either way.
  const subject = { reference: `urn:codebase-ekg:patient:${repoUrn}`, display: rawKey };
  // FHIR logical ids allow [A-Za-z0-9.-]{1,64} — ISO timestamps carry ':' so use epoch millis.
  const sampleKey = String(new Date(signals.sampledAt).getTime() || 0);
  // Slug bounded so the hash always survives inside the 64-char id budget.
  const idSlug = `${rawKey.replace(/[^A-Za-z0-9.-]/g, '-').slice(0, 20)}-${repoHash}`;
  const observation = (code: string, display: string, value: object) => ({
    fullUrl: `urn:codebase-ekg:${repoUrn}:${code}:${sampleKey}`,
    resource: {
      resourceType: 'Observation',
      // Repo slug keeps ids unique across repositories sampled at the same time.
      id: `ekg-${code}-${idSlug}-${sampleKey}`.slice(0, 64),
      meta: { profile: ['http://hl7.org/fhir/StructureDefinition/vitalsigns'] },
      status: 'final',
      category: VITAL_SIGNS,
      code: loinc(code, display),
      subject,
      effectiveDateTime,
      ...value,
    },
  });

  const entry = [
    observation('8867-4', 'Heart rate', { valueQuantity: quantity(vitals.bpm, 'beats/minute', '/min') }),
    observation('8310-5', 'Body temperature', { valueQuantity: quantity(vitals.temp, 'C', 'Cel') }),
  ];
  if (vitals.spo2 !== null) {
    const spo2 = observation('59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry', {
      valueQuantity: quantity(vitals.spo2, '%', '%'),
    });
    // The R4 vital-signs profile mandates the 2708-6 magic code alongside the
    // more specific pulse-oximetry code.
    spo2.resource.code.coding.push({ system: LOINC, code: '2708-6', display: 'Oxygen saturation in Arterial blood' });
    entry.push(spo2);
  }
  if (vitals.bp) {
    entry.push(observation('85354-9', 'Blood pressure panel with all children optional', {
      component: [
        { code: loinc('8480-6', 'Systolic blood pressure'), valueQuantity: quantity(vitals.bp.systolic, 'mmHg', 'mm[Hg]') },
        { code: loinc('8462-4', 'Diastolic blood pressure'), valueQuantity: quantity(vitals.bp.diastolic, 'mmHg', 'mm[Hg]') },
      ],
    }));
  }
  // Include the Patient so `subject.reference` resolves inside this bundle.
  const patient = {
    fullUrl: `urn:codebase-ekg:patient:${repoUrn}`,
    resource: { resourceType: 'Patient', id: patientId, name: [{ text: rawKey }] },
  };
  return { resourceType: 'Bundle', type: 'collection', timestamp: new Date().toISOString(), entry: [patient, ...entry] };
}
