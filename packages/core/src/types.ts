import { z } from 'zod';

export const Unit = z.enum(['bar', 'psi', 'kPa', 'degC', 'degF']);
export type Unit = z.infer<typeof Unit>;

export const AssetSpec = z.object({
  id: z.string(),
  name: z.string(),
  unit: Unit,
  scaleMin: z.number(),
  scaleMax: z.number(),
  normalMin: z.number(),
  normalMax: z.number(),
  site: z.string().optional(),
  area: z.string().optional(),
});
export type AssetSpec = z.infer<typeof AssetSpec>;

/** What the robot vendor sends us. Treat every field as untrusted. */
export const RobotPayload = z.object({
  inspectionId: z.string().min(1),
  assetId: z.string().min(1),
  robotId: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }),
  robotReading: z.object({
    value: z.number().nullable(),
    unit: Unit.nullable(),
    confidence: z.number().min(0).max(1),
  }),
  audio: z.object({ rmsDb: z.number() }).optional(),
});
export type RobotPayload = z.infer<typeof RobotPayload>;

export const Defect = z.enum(['cracked_glass', 'needle_missing', 'leak', 'corrosion', 'fogged_glass', 'other']);
export type Defect = z.infer<typeof Defect>;

/** Structured output we force the vision model to return (one sample). */
export const VisionReading = z.object({
  readable: z.boolean(),
  value: z.number().nullable(),
  unit: Unit.nullable(),
  scaleMin: z.number().nullable(),
  scaleMax: z.number().nullable(),
  defects: z.array(Defect),
  imageQuality: z.enum(['good', 'fair', 'poor']),
  notes: z.string().max(500),
});
export type VisionReading = z.infer<typeof VisionReading>;

/** Several samples merged into one reading with a confidence score. */
export interface ConsensusReading {
  readable: boolean;
  value: number | null;
  unit: Unit | null;
  defects: Defect[];
  confidence: number; // 0..1
  samples: number;
  spread: number | null; // max - min of sampled values, in reading units
}

export type FindingStatus = 'auto_accepted' | 'needs_review';
export type Severity = 'none' | 'low' | 'medium' | 'high';

export interface Finding {
  status: FindingStatus;
  value: number | null; // best value, in the asset's unit
  unit: Unit;
  severity: Severity;
  reasons: string[]; // machine-readable reason codes
}
