-- Owner-attached AI keys only. No existing deployment keys are copied/rotated.
-- Private: intentionally absent from both public and generic admin DB allowlists.
-- Same server-side storage contract as legacy app_settings, on the working D1
-- backend. Never query this table through a browser data adapter.
CREATE TABLE IF NOT EXISTS ai_provider_keys (
  provider TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
