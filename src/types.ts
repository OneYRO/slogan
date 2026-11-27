export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ADMIN_PATH?: string;
  SITE_URL?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  SEND_EMAIL?: SendEmail;
  RATE_LIMIT?: KVNamespace;
  BUCKET?: R2Bucket;
}

export interface Merchant {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  description: string;
  announcement: string;
  contact: string;
  footer: string;
  logo: string;
  logo_image: string;
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
  status: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}

export interface Admin {
  id: number;
  username: string;
  role: string;
  merchant_id: number | null;
  created_at: number;
  last_login_at: number | null;
}

export interface Level {
  id: number;
  name: string;
  discount: number;
  min_spent_cents: number;
  sort: number;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  balance_cents: number;
  level_id: number;
  invite_code: string;
  inviter_id: number | null;
  total_spent_cents: number;
  status: string;
  created_at: number;
  last_login_at: number | null;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  sort: number;
  enabled: number;
  merchant_id?: number | null;
}

export interface Sku {
  id: number;
  product_id: number;
  name: string;
  price_cents: number | null;
  member_price_cents: number | null;
  cost_cents: number;
  sort: number;
  enabled: number;
}

export interface Product {
  id: number;
  category_id: number | null;
  name: string;
  slug: string | null;
  description: string | null;
  images: string;
  delivery_mode: 'auto' | 'manual' | 'physical' | 'fixed';
  price_cents: number;
  member_price_cents: number | null;
  wholesale_tiers: string;
  stock: number;
  cost_cents: number;
  min_qty: number;
  max_qty: number;
  limit_per_user: number;
  seckill_price_cents: number | null;
  seckill_starts_at: number | null;
  seckill_ends_at: number | null;
  pick_enabled: number;
  pick_fee_cents: number;
  content: string | null;
  status: string;
  is_recommend: number;
  sort: number;
  sales_count: number;
  supplier_id?: number | null;
  supplier_goods_id?: string | null;
  supplier_cost_cents?: number;
  auto_purchase?: number;
  merchant_id?: number | null;
  created_at: number;
  updated_at: number;
}

export interface OrderRow {
  id: number;
  order_no: string;
  token: string | null;
  user_id: number | null;
  email: string;
  status: string;
  subtotal_cents: number;
  discount_cents: number;
  amount_cents: number;
  coupon_id: number | null;
  pay_channel: string | null;
  pay_trade_no: string | null;
  paid_at: number | null;
  closed_at: number | null;
  address: string | null;
  note: string | null;
  remark: string | null;
  ip: string | null;
  ua: string | null;
  merchant_id?: number | null;
  merchant_slug?: string | null;
  created_at: number;
  updated_at: number;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number;
  sku_id: number | null;
  product_name: string;
  sku_name: string | null;
  price_cents: number;
  qty: number;
  amount_cents: number;
  delivery_mode: string;
  delivered: string | null;
  delivered_at: number | null;
}

export interface CardRow {
  id: number;
  product_id: number;
  sku_id: number | null;
  content: string;
  status: string;
  order_item_id: number | null;
  created_at: number;
  sold_at: number | null;
}

export interface SiteConfig {
  name: string;
  logo: string;
  logo_image?: string;
  background_image?: string;
  description: string;
  announcement: string;
  notice: string;
  footer: string;
  currency: string;
  currency_code: string;
  lang: string;
  currency_rates: Record<string, number>;
  currency_symbols: Record<string, string>;
  seo_title: string;
  seo_description: string;
  seo_keywords: string;
  og_image: string;
  contact: string;
  icp: string;
  theme_color: string;
  maintenance: boolean;
  allow_register: boolean;
  force_login: boolean;
  show_stock: boolean;
  order_expire_minutes: number;
  min_amount_cents: number;
  stock_alert: number;
  custom_head: string;
  turnstile_enabled?: boolean;
  turnstile_site_key?: string;
}

export interface PaymentConfig {
  epay: {
    enabled: boolean;
    api_url: string;
    pid: string;
    key: string;
    channels: { type: string; name: string; enabled: boolean }[];
  };
  alipay: {
    enabled: boolean;
    app_id: string;
    private_key: string;
    public_key: string;
    gateway: string;
  };
  usdt: {
    enabled: boolean;
    provider: string;
    api_url: string;
    app_secret: string;
    token: string;
  };
  stripe: {
    enabled: boolean;
    secret_key: string;
    publishable_key: string;
    webhook_secret: string;
    currency: string;
  };
  paypal: {
    enabled: boolean;
    client_id: string;
    client_secret: string;
    mode: string;
    currency: string;
  };
  hashpay: {
    enabled: boolean;
    api_url: string;
    api_key: string;
    organization_id: string;
    signing_secret: string;
    currency: string;
  };
  balance: { enabled: boolean };
  mock: { enabled: boolean };
}

export interface NotifyConfig {
  email: {
    enabled: boolean;
    provider: string;
    host: string;
    port: number;
    username: string;
    password: string;
    from: string;
    ssl: boolean;
  };
  telegram: { enabled: boolean; bot_token: string; chat_id: string };
  webhook: { enabled: boolean; url: string };
  templates: {
    order_paid: { subject: string; html: string };
    ticket_reply: { subject: string; html: string };
    password_reset: { subject: string; html: string };
  };
}

export interface CommissionConfig {
  enabled: boolean;
  levels: number[];
}

export interface SecurityConfig {
  turnstile: {
    enabled: boolean;
    site_key: string;
    secret_key: string;
  };
  upstream: {
    enabled: boolean;
    api_key: string;
  };
}
