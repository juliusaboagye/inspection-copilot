import { convert, isCompatible } from './units';
import type { AssetSpec, ConsensusReading, Finding, RobotPayload, Severity } from './types';

export interface ReconcileOptions {
  /** Minimum AI confidence to accept a reading without a human. */
  autoAcceptConfidence: number;
  /** Robot and AI "agree" if within this fraction of the gauge span. */
  agreeTolerance: number;
}
const DEFAULTS: ReconcileOptions = { autoAcceptConfidence: 0.8, agreeTolerance: 0.03 };

/** Reasons that describe a known vendor data fault; they don't need a human if the AI is confident. */
const INFORMATIONAL = new Set(['robot_reading_missing', 'robot_decimal_shift', 'robot_unit_mismatch']);
const SEVERITY_ORDER: Severity[] = ['none', 'low', 'medium', 'high'];
const maxSeverity = (a: Severity, b: Severity) => (SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b);

/**
 * Decide what we believe the gauge reads, how bad it is, and whether a person must look.
 * Pure function: every rule here is unit-tested and explainable to an operator.
 */
export function reconcile(
  asset: AssetSpec,
  robot: RobotPayload['robotReading'],
  ai: ConsensusReading,
  opts: Partial<ReconcileOptions> = {},
): Finding {
  const o = { ...DEFAULTS, ...opts };
  const span = asset.scaleMax - asset.scaleMin;
  const reasons: string[] = [];
  let severity: Severity = 'none';

  if (!ai.readable || ai.value === null) {
    return { status: 'needs_review', value: null, unit: asset.unit, severity, reasons: ['image_unreadable'] };
  }

  // 1. Put the AI reading into the asset's unit.
  let value = ai.value;
  if (ai.unit && ai.unit !== asset.unit) {
    if (isCompatible(ai.unit, asset.unit)) value = convert(ai.value, ai.unit, asset.unit);
    else reasons.push('ai_unit_mismatch');
  }
  if (value < asset.scaleMin - 0.02 * span || value > asset.scaleMax + 0.02 * span) reasons.push('ai_value_out_of_scale');
  if (ai.confidence < o.autoAcceptConfidence) reasons.push('low_confidence');

  // 2. Cross-check the robot's own reading and classify known vendor faults.
  const tol = o.agreeTolerance * span;
  if (robot.value === null) {
    reasons.push('robot_reading_missing');
  } else {
    const raw = robot.value;
    const robotInAssetUnit =
      robot.unit && robot.unit !== asset.unit && isCompatible(robot.unit, asset.unit) ? convert(raw, robot.unit, asset.unit) : raw;
    if (Math.abs(robotInAssetUnit - value) <= tol) {
      // agrees
    } else if (robot.unit && robot.unit !== asset.unit && Math.abs(raw - value) <= tol) {
      reasons.push('robot_unit_mismatch'); // right number, wrong label
    } else if (Math.abs(raw / 10 - value) <= tol / 10 + 0.01 * span || Math.abs(raw * 10 - value) <= tol) {
      reasons.push('robot_decimal_shift');
    } else {
      reasons.push('robot_ai_disagree');
    }
  }

  // 3. Plant condition: distance outside the normal band, and visible defects.
  const band = asset.normalMax - asset.normalMin;
  const excursion = value > asset.normalMax ? value - asset.normalMax : value < asset.normalMin ? asset.normalMin - value : 0;
  if (excursion > 0) {
    reasons.push('outside_normal_band');
    const ratio = excursion / band;
    severity = maxSeverity(severity, ratio <= 0.1 ? 'low' : ratio <= 0.3 ? 'medium' : 'high');
  }
  for (const d of ai.defects) {
    reasons.push(`defect:${d}`);
    severity = maxSeverity(severity, 'medium');
  }
  if (severity === 'high') reasons.push('confirm_alarm');

  // Being outside the band is a plant condition, not a data-trust problem; high severity adds 'confirm_alarm'.
  const needsReview = reasons.some((r) => !INFORMATIONAL.has(r) && r !== 'outside_normal_band');

  return {
    status: needsReview ? 'needs_review' : 'auto_accepted',
    value: Math.round(value * 100) / 100,
    unit: asset.unit,
    severity,
    reasons,
  };
}
