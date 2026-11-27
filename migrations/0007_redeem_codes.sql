CREATE TABLE IF NOT EXISTS redeem_codes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT NOT NULL UNIQUE,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'unused', -- unused | used | disabled
  note         TEXT,
  created_by   INTEGER,
  used_by      INTEGER,
  used_at      INTEGER,
  expires_at   INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_code_status ON redeem_codes(status);
CREATE INDEX IF NOT EXISTS idx_redeem_code_used_by ON redeem_codes(used_by);
