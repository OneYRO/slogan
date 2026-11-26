-- Slogan · D1 初始表结构
-- 金额一律以「分」为单位的整数存储，避免浮点误差。

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS admins (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'root',
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,              -- admin | user
  subject_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  ua         TEXT,
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT NOT NULL UNIQUE,
  password_hash     TEXT NOT NULL,
  balance_cents     INTEGER NOT NULL DEFAULT 0,
  level_id          INTEGER NOT NULL DEFAULT 1,
  invite_code       TEXT NOT NULL UNIQUE,
  inviter_id        INTEGER,
  total_spent_cents INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        INTEGER NOT NULL,
  last_login_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_inviter ON users(inviter_id);

CREATE TABLE IF NOT EXISTS levels (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  discount        INTEGER NOT NULL DEFAULT 100,  -- 90 表示 9 折
  min_spent_cents INTEGER NOT NULL DEFAULT 0,
  sort            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  icon        TEXT,
  description TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id         INTEGER,
  name                TEXT NOT NULL,
  slug                TEXT,
  description         TEXT,
  images              TEXT NOT NULL DEFAULT '[]',
  delivery_mode       TEXT NOT NULL DEFAULT 'auto',  -- auto | manual | physical | fixed
  price_cents         INTEGER NOT NULL DEFAULT 0,
  member_price_cents  INTEGER,
  wholesale_tiers     TEXT NOT NULL DEFAULT '[]',
  stock               INTEGER NOT NULL DEFAULT 0,
  cost_cents          INTEGER NOT NULL DEFAULT 0,
  min_qty             INTEGER NOT NULL DEFAULT 1,
  max_qty             INTEGER NOT NULL DEFAULT 99,
  limit_per_user      INTEGER NOT NULL DEFAULT 0,
  seckill_price_cents INTEGER,
  seckill_starts_at   INTEGER,
  seckill_ends_at     INTEGER,
  pick_enabled        INTEGER NOT NULL DEFAULT 0,
  pick_fee_cents      INTEGER NOT NULL DEFAULT 0,
  content             TEXT,
  status              TEXT NOT NULL DEFAULT 'on',
  is_recommend        INTEGER NOT NULL DEFAULT 0,
  sort                INTEGER NOT NULL DEFAULT 0,
  sales_count         INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_cat    ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS skus (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id        INTEGER NOT NULL,
  name              TEXT NOT NULL,
  price_cents       INTEGER,              -- NULL 表示跟随商品价格
  member_price_cents INTEGER,
  cost_cents        INTEGER NOT NULL DEFAULT 0,
  sort              INTEGER NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_skus_product ON skus(product_id);

CREATE TABLE IF NOT EXISTS cards (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id    INTEGER NOT NULL,
  sku_id        INTEGER,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'unused',  -- unused | locked | sold
  order_item_id INTEGER,
  created_at    INTEGER NOT NULL,
  sold_at       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cards_pool ON cards(product_id, sku_id, status);
CREATE INDEX IF NOT EXISTS idx_cards_item ON cards(order_item_id);

CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no        TEXT NOT NULL UNIQUE,
  token           TEXT,
  user_id         INTEGER,
  email           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending|paid|manual|shipped|delivered|closed|refunded
  subtotal_cents  INTEGER NOT NULL DEFAULT 0,
  discount_cents  INTEGER NOT NULL DEFAULT 0,
  amount_cents    INTEGER NOT NULL DEFAULT 0,
  coupon_id       INTEGER,
  pay_channel     TEXT,
  pay_trade_no    TEXT,
  paid_at         INTEGER,
  closed_at       INTEGER,
  address         TEXT,
  note            TEXT,
  remark          TEXT,
  ip              TEXT,
  ua              TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_email   ON orders(email);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      INTEGER NOT NULL,
  product_id    INTEGER NOT NULL,
  sku_id        INTEGER,
  product_name  TEXT NOT NULL,
  sku_name      TEXT,
  price_cents   INTEGER NOT NULL,
  qty           INTEGER NOT NULL,
  amount_cents  INTEGER NOT NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'auto',
  delivered     TEXT,
  delivered_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_items_order  ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);

CREATE TABLE IF NOT EXISTS payments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL,
  channel      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'created',
  trade_no     TEXT,
  payload      TEXT,
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);

CREATE TABLE IF NOT EXISTS coupons (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  code             TEXT NOT NULL UNIQUE,
  type             TEXT NOT NULL DEFAULT 'fixed',  -- percent | fixed | per_item
  value            INTEGER NOT NULL DEFAULT 0,
  min_amount_cents INTEGER NOT NULL DEFAULT 0,
  product_ids      TEXT NOT NULL DEFAULT '[]',
  max_uses         INTEGER NOT NULL DEFAULT 0,
  used_count       INTEGER NOT NULL DEFAULT 0,
  per_user_limit   INTEGER NOT NULL DEFAULT 1,
  starts_at        INTEGER NOT NULL DEFAULT 0,
  ends_at          INTEGER NOT NULL DEFAULT 0,
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS coupon_uses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id  INTEGER NOT NULL,
  email      TEXT,
  user_id    INTEGER,
  order_id   INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_uses_order ON coupon_uses(coupon_id, order_id);

CREATE TABLE IF NOT EXISTS tickets (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  email      TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ticket_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL,
  sender_type TEXT NOT NULL,  -- user | admin
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_msg ON ticket_messages(ticket_id);

CREATE TABLE IF NOT EXISTS balance_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL,
  type          TEXT NOT NULL,  -- recharge | consume | refund | commission | adjust
  amount_cents  INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  order_id      INTEGER,
  note          TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_balance_user ON balance_logs(user_id);

CREATE TABLE IF NOT EXISTS referrals (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL,
  inviter_id  INTEGER NOT NULL,
  invitee_id  INTEGER NOT NULL,
  level       INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON referrals(inviter_id);

CREATE TABLE IF NOT EXISTS notify_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel    TEXT NOT NULL,
  target     TEXT,
  subject    TEXT,
  status     TEXT NOT NULL,
  error      TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER,
  action     TEXT NOT NULL,
  detail     TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

INSERT OR IGNORE INTO levels (id, name, discount, min_spent_cents, sort) VALUES
  (1, '普通会员', 100, 0, 0),
  (2, '黄金会员', 95, 100000, 1),
  (3, '铂金会员', 90, 500000, 2),
  (4, '钻石会员', 85, 2000000, 3);
