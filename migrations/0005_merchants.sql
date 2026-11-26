-- 多商户：一个平台后台管理多个独立店铺
-- 现有数据默认归属平台自营店铺（is_default = 1）

CREATE TABLE IF NOT EXISTS merchants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  domain          TEXT,
  description     TEXT NOT NULL DEFAULT '',
  announcement    TEXT NOT NULL DEFAULT '',
  contact         TEXT NOT NULL DEFAULT '',
  footer          TEXT NOT NULL DEFAULT '',
  logo            TEXT NOT NULL DEFAULT '',
  logo_image      TEXT NOT NULL DEFAULT '',
  seo_title       TEXT NOT NULL DEFAULT '',
  seo_description TEXT NOT NULL DEFAULT '',
  seo_keywords    TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'on',
  is_default      INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_merchants_domain ON merchants(domain) WHERE domain IS NOT NULL AND domain != '';

INSERT INTO merchants (name, slug, description, announcement, footer, status, is_default, created_at, updated_at)
VALUES (
  'Slogan',
  'slogan',
  '数字商品自动发货 · 付款后秒到账',
  '欢迎光临 Slogan，本站所有卡密均为自动发货，支付成功后立即到账。',
  'Powered by Slogan on Cloudflare Workers',
  'on',
  1,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

-- 商户管理员：merchant_id 为 NULL 表示平台管理员（可管理全部商户）
ALTER TABLE admins ADD COLUMN merchant_id INTEGER;

ALTER TABLE categories ADD COLUMN merchant_id INTEGER;
ALTER TABLE products  ADD COLUMN merchant_id INTEGER;
ALTER TABLE orders    ADD COLUMN merchant_id INTEGER;
ALTER TABLE orders    ADD COLUMN merchant_slug TEXT;
ALTER TABLE coupons   ADD COLUMN merchant_id INTEGER;
ALTER TABLE tickets   ADD COLUMN merchant_id INTEGER;

UPDATE categories SET merchant_id = (SELECT id FROM merchants WHERE is_default = 1) WHERE merchant_id IS NULL;
UPDATE products  SET merchant_id = (SELECT id FROM merchants WHERE is_default = 1) WHERE merchant_id IS NULL;
UPDATE orders    SET merchant_id = (SELECT id FROM merchants WHERE is_default = 1) WHERE merchant_id IS NULL;
UPDATE orders    SET merchant_slug = (SELECT slug FROM merchants WHERE id = orders.merchant_id) WHERE merchant_slug IS NULL;
UPDATE coupons   SET merchant_id = (SELECT id FROM merchants WHERE is_default = 1) WHERE merchant_id IS NULL;
UPDATE tickets   SET merchant_id = (SELECT id FROM merchants WHERE is_default = 1) WHERE merchant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_admins_merchant     ON admins(merchant_id);
CREATE INDEX IF NOT EXISTS idx_categories_merchant ON categories(merchant_id);
CREATE INDEX IF NOT EXISTS idx_products_merchant   ON products(merchant_id);
CREATE INDEX IF NOT EXISTS idx_orders_merchant     ON orders(merchant_id);
CREATE INDEX IF NOT EXISTS idx_coupons_merchant    ON coupons(merchant_id);
CREATE INDEX IF NOT EXISTS idx_tickets_merchant    ON tickets(merchant_id);
