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
  const subject = { display: `${signals.source}:${signals.repo}` };
  const observation = (code: string, display: string, value: object) => ({
    fullUrl: `urn:codebase-ekg:${signals.source}:${signals.repo}:${code}:${signals.sampledAt}`,
    resource: {
      resourceType: 'Observation',
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
    entry.push(observation('59408-5', 'Oxygen saturation in Arterial blood by Pulse oximetry', {
      valueQuantity: quantity(vitals.spo2, '%', '%'),
    }));
  }
  if (vitals.bp) {
    entry.push(observation('85354-9', 'Blood pressure panel with all children optional', {
      component: [
        { code: loinc('8480-6', 'Systolic blood pressure'), valueQuantity: quantity(vitals.bp.systolic, 'mmHg', 'mm[Hg]') },
        { code: loinc('8462-4', 'Diastolic blood pressure'), valueQuantity: quantity(vitals.bp.diastolic, 'mmHg', 'mm[Hg]') },
      ],
    }));
  }
  return { resourceType: 'Bundle', type: 'collection', timestamp: effectiveDateTime, entry };
}
