import { describe, it, expect } from 'vitest';
import { convert, isCompatible } from './units';

describe('convert', () => {
  it('returns the same value for the same unit', () => {
    expect(convert(5, 'bar', 'bar')).toBe(5);
  });
  it('converts bar to psi', () => {
    expect(convert(1, 'bar', 'psi')).toBeCloseTo(14.5038, 3);
  });
  it('converts psi to kPa', () => {
    expect(convert(100, 'psi', 'kPa')).toBeCloseTo(689.476, 2);
  });
  it('converts Celsius to Fahrenheit and back', () => {
    expect(convert(100, 'degC', 'degF')).toBeCloseTo(212, 6);
    expect(convert(32, 'degF', 'degC')).toBeCloseTo(0, 6);
  });
  it('refuses to convert pressure to temperature', () => {
    expect(() => convert(1, 'bar', 'degC')).toThrow(/incompatible/i);
  });
});

describe('isCompatible', () => {
  it('is true within a quantity and false across quantities', () => {
    expect(isCompatible('bar', 'kPa')).toBe(true);
    expect(isCompatible('degF', 'psi')).toBe(false);
  });
});
