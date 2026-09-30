import { Defect, VisionReading } from '@ic/core';

const UNIT_ALIASES: Record<string, string> = {
  bar: 'bar', psi: 'psi', kpa: 'kPa',
  degc: 'degC', '°c': 'degC', c: 'degC', celsius: 'degC',
  degf: 'degF', '°f': 'degF', f: 'degF', fahrenheit: 'degF',
};

/**
 * Validate model output. Models are usually right about structure when forced
 * through a tool/JSON schema, but we never trust unvalidated output.
 */
export function parseReading(raw: unknown): VisionReading {
  let obj: any = raw;
  if (typeof raw === 'string') {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    try {
      obj = JSON.parse(cleaned);
    } catch {
      throw new Error(`invalid model output: not JSON: ${raw.slice(0, 80)}`);
    }
  }
  if (obj && typeof obj === 'object') {
    obj = { ...obj };
    if (typeof obj.unit === 'string') obj.unit = UNIT_ALIASES[obj.unit.trim().toLowerCase()] ?? obj.unit;
    for (const k of ['value', 'scaleMin', 'scaleMax'] as const) {
      if (typeof obj[k] === 'string' && obj[k].trim() !== '' && !isNaN(Number(obj[k]))) obj[k] = Number(obj[k]);
    }
    if (Array.isArray(obj.defects)) {
      obj.defects = [...new Set(obj.defects.map((d: unknown) => (Defect.safeParse(d).success ? d : 'other')))];
    }
    if (obj.notes === undefined) obj.notes = '';
    if (obj.readable === false) obj.value = null;
  }
  const result = VisionReading.safeParse(obj);
  if (!result.success) {
    throw new Error(`invalid model output: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return result.data;
}
