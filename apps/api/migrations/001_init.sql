CREATE TABLE asset (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  unit        text NOT NULL CHECK (unit IN ('bar','psi','kPa','degC','degF')),
  scale_min   double precision NOT NULL,
  scale_max   double precision NOT NULL,
  normal_min  double precision NOT NULL,
  normal_max  double precision NOT NULL,
  site        text,
  area        text,
  CHECK (scale_max > scale_min),
  CHECK (normal_max > normal_min)
);

-- One row per robot capture. Doubles as a job queue (status + FOR UPDATE SKIP LOCKED).
CREATE TABLE inspection (
  id                text PRIMARY KEY,               -- vendor's inspection id => idempotent ingest
  asset_id          text NOT NULL REFERENCES asset(id),
  robot_id          text NOT NULL,
  captured_at       timestamptz NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  image_path        text NOT NULL,
  media_type        text NOT NULL,
  robot_value       double precision,
  robot_unit        text,
  robot_confidence  double precision NOT NULL,
  audio_rms_db      double precision,
  status            text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','failed')),
  attempts          int  NOT NULL DEFAULT 0,
  locked_at         timestamptz,
  last_error        text
);
CREATE INDEX inspection_queue_idx ON inspection (received_at) WHERE status IN ('queued','processing');
CREATE INDEX inspection_asset_time_idx ON inspection (asset_id, captured_at DESC);

-- Raw model output is kept so every decision can be audited and replayed.
CREATE TABLE reading (
  inspection_id  text PRIMARY KEY REFERENCES inspection(id) ON DELETE CASCADE,
  model          text NOT NULL,
  samples        jsonb NOT NULL,
  consensus      jsonb NOT NULL,
  input_tokens   int NOT NULL,
  output_tokens  int NOT NULL,
  latency_ms     int NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE finding (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inspection_id   text NOT NULL UNIQUE REFERENCES inspection(id) ON DELETE CASCADE,
  asset_id        text NOT NULL REFERENCES asset(id),
  status          text NOT NULL CHECK (status IN ('auto_accepted','needs_review','reviewed')),
  value           double precision,
  unit            text NOT NULL,
  confidence      double precision NOT NULL,
  severity        text NOT NULL CHECK (severity IN ('none','low','medium','high')),
  reasons         text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- human-in-the-loop review; corrections become evaluation data
  review_decision text CHECK (review_decision IN ('confirm','correct','unreadable')),
  reviewed_value  double precision,
  reviewed_by     text,
  reviewed_at     timestamptz,
  review_note     text
);
CREATE INDEX finding_queue_idx ON finding (status, severity, created_at DESC);
CREATE INDEX finding_asset_idx ON finding (asset_id, created_at DESC);
