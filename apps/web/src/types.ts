export type Severity = 'none' | 'low' | 'medium' | 'high';

export interface FindingRow {
  id: number;
  inspectionId: string;
  assetId: string;
  assetName: string;
  status: 'auto_accepted' | 'needs_review' | 'reviewed';
  value: number | null;
  unit: string;
  confidence: number;
  severity: Severity;
  reasons: string[];
  capturedAt: string;
  robotValue: number | null;
  robotUnit: string | null;
  robotConfidence: number;
  audioRmsDb: number | null;
  normalMin: number;
  normalMax: number;
  reviewDecision?: string | null;
  reviewedValue?: number | null;
}

export interface FindingDetail extends FindingRow {
  reading: { model: string; samples: Array<{ value: number | null; readable: boolean; notes: string }>; input_tokens: number; output_tokens: number } | null;
}

export type ReviewInput =
  | { decision: 'confirm'; note?: string }
  | { decision: 'correct'; value: number; note?: string }
  | { decision: 'unreadable'; note?: string };
