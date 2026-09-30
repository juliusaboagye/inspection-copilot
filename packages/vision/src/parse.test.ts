import { describe, it, expect } from 'vitest';
import { parseReading } from './parse';

const valid = {
  readable: true, value: 8.2, unit: 'bar', scaleMin: 0, scaleMax: 16,
  defects: [], imageQuality: 'good', notes: 'Needle just past 8.',
};

describe('parseReading', () => {
  it('accepts a valid reading', () => {
    expect(parseReading(valid)).toEqual(valid);
  });

  it('accepts a JSON string, including one wrapped in a markdown fence', () => {
    expect(parseReading(JSON.stringify(valid))).toEqual(valid);
    expect(parseReading('```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid);
  });

  it.each([
    ['°C', 'degC'], ['C', 'degC'], ['°F', 'degF'], ['PSI', 'psi'], ['Bar', 'bar'], ['kpa', 'kPa'],
  ])('normalises unit %s to %s', (raw, unit) => {
    expect(parseReading({ ...valid, unit: raw }).unit).toBe(unit);
  });

  it('coerces numeric strings', () => {
    expect(parseReading({ ...valid, value: '8.2' }).value).toBe(8.2);
  });

  it('forces value to null when the model says unreadable', () => {
    expect(parseReading({ ...valid, readable: false, value: 3 }).value).toBeNull();
  });

  it('maps unknown defects to "other" rather than failing', () => {
    expect(parseReading({ ...valid, defects: ['rust stain'] }).defects).toEqual(['other']);
  });

  it('throws a helpful error on garbage', () => {
    expect(() => parseReading('I think it says about 8')).toThrow(/invalid model output/i);
    expect(() => parseReading({ value: 8 })).toThrow(/invalid model output/i);
  });
});
