-- 上游供应商（自动进货）
CREATE TABLE IF NOT EXISTS suppliers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  api_url       TEXT NOT NULL,
  api_key       TEXT NOT NULL,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER,
  order_item_id  INTEGER,
  supplier_id    INTEGER NOT NULL,
  product_id     INTEGER,
  remote_order_no TEXT,
  qty            INTEGER NOT NULL DEFAULT 0,
  cost_cents     INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'pending', -- pending | success | failed
  request        TEXT,
  response       TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supplier_orders_order ON supplier_orders(order_id);

ALTER TABLE products ADD COLUMN supplier_id INTEGER;
ALTER TABLE products ADD COLUMN supplier_goods_id TEXT;
ALTER TABLE products ADD COLUMN supplier_cost_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN auto_purchase INTEGER NOT NULL DEFAULT 1;
