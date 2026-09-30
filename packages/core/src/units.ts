import type { Unit } from './types';

const PRESSURE_IN_KPA: Partial<Record<Unit, number>> = { kPa: 1, bar: 100, psi: 6.894757293168 };
const TEMPERATURE: Unit[] = ['degC', 'degF'];

const quantity = (u: Unit) => (u in PRESSURE_IN_KPA ? 'pressure' : TEMPERATURE.includes(u) ? 'temperature' : 'unknown');

export const isCompatible = (a: Unit, b: Unit) => quantity(a) === quantity(b);

export function convert(value: number, from: Unit, to: Unit): number {
  if (from === to) return value;
  if (!isCompatible(from, to)) throw new Error(`incompatible units: ${from} -> ${to}`);
  if (quantity(from) === 'pressure') return (value * PRESSURE_IN_KPA[from]!) / PRESSURE_IN_KPA[to]!;
  return from === 'degC' ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9;
}
