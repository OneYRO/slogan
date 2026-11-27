CREATE TABLE IF NOT EXISTS upstream_orders (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no         TEXT NOT NULL UNIQUE,
  remote_order_no  TEXT,
  goods_id         TEXT NOT NULL,
  product_id       INTEGER,
  sku_id           INTEGER,
  qty              INTEGER NOT NULL DEFAULT 0,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents       INTEGER NOT NULL DEFAULT 0,
  email            TEXT,
  ip               TEXT,
  status           TEXT NOT NULL DEFAULT 'success', -- success | failed
  cards_json       TEXT,                            -- 已出货卡密，用于同一订单重试幂等返回
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upstream_orders_created ON upstream_orders(created_at);
