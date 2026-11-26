import type { CommissionConfig, Env, NotifyConfig, PaymentConfig, SiteConfig } from './types';
import { one, run } from './db';
import { parseJSON } from './util';

export const DEFAULT_SITE: SiteConfig = {
  name: 'Slogan',
  logo: '',
  description: '数字商品自动发货 · 付款后秒到账',
  announcement: '欢迎光临 Slogan，本站所有卡密均为自动发货，支付成功后立即到账。',
  notice: '下单前请仔细阅读商品说明；卡密类商品具有可复制性，一经售出原则上不支持退款。',
  footer: 'Powered by Slogan on Cloudflare Workers',
  currency: '¥',
  currency_code: 'CNY',
  lang: 'zh-CN',
  currency_rates: { CNY: 1, USD: 0.14, JPY: 20 },
  currency_symbols: { CNY: '¥', USD: '$', JPY: '¥' },
  seo_title: 'Slogan - 数字商品自动发货',
  seo_description: 'Slogan：数字商品自动发货系统，支持卡密自动发货、优惠券、会员折扣与多支付渠道。',
  seo_keywords: 'Slogan,发卡,自动发卡,卡密,数字商品',
  og_image: '/og-image.png',
  contact: '客服邮箱：support@example.com',
  icp: '',
  theme_color: '#6366f1',
  maintenance: false,
  allow_register: true,
  force_login: false,
  show_stock: true,
  order_expire_minutes: 30,
  min_amount_cents: 100,
  stock_alert: 5,
  custom_head: '',
};

export const DEFAULT_PAYMENT: PaymentConfig = {
  epay: {
    enabled: false,
    api_url: '',
    pid: '',
    key: '',
    channels: [
      { type: 'alipay', name: '支付宝', enabled: true },
      { type: 'wxpay', name: '微信支付', enabled: true },
      { type: 'qqpay', name: 'QQ 钱包', enabled: false },
    ],
  },
  alipay: {
    enabled: false,
    app_id: '',
    private_key: '',
    public_key: '',
    gateway: 'https://openapi.alipay.com/gateway.do',
  },
  usdt: {
    enabled: false,
    provider: 'bepusdt',
    api_url: '',
    app_secret: '',
    token: '',
  },
  stripe: {
    enabled: false,
    secret_key: '',
    publishable_key: '',
    webhook_secret: '',
    currency: 'cny',
  },
  paypal: {
    enabled: false,
    client_id: '',
    client_secret: '',
    mode: 'sandbox',
    currency: 'CNY',
  },
  hashpay: {
    enabled: false,
    api_url: 'https://api.hashpay.me/v1',
    api_key: '',
    organization_id: '',
    signing_secret: '',
    currency: 'USD',
  },
  balance: { enabled: true },
  mock: { enabled: false },
};

export const DEFAULT_NOTIFY: NotifyConfig = {
  email: {
    enabled: false,
    provider: 'smtp',
    host: '',
    port: 465,
    username: '',
    password: '',
    from: '',
    ssl: true,
  },
  telegram: { enabled: false, bot_token: '', chat_id: '' },
  webhook: { enabled: false, url: '' },
  templates: {
    order_paid: { subject: '', html: '' },
    ticket_reply: { subject: '', html: '' },
    password_reset: { subject: '', html: '' },
  },
};

export const DEFAULT_COMMISSION: CommissionConfig = {
  enabled: true,
  levels: [10, 5, 2],
};

const DEFAULTS: Record<string, unknown> = {
  site: DEFAULT_SITE,
  payment: DEFAULT_PAYMENT,
  notify: DEFAULT_NOTIFY,
  commission: DEFAULT_COMMISSION,
};

function deepMerge<T>(def: T, patch: any): T {
  if (patch === null || patch === undefined) return def;
  if (Array.isArray(def)) return (Array.isArray(patch) ? patch : def) as T;
  if (typeof def === 'object' && def !== null) {
    const out: any = { ...(def as any) };
    if (typeof patch === 'object' && !Array.isArray(patch)) {
      for (const [k, v] of Object.entries(patch)) {
        out[k] = k in (def as any) ? deepMerge((def as any)[k], v) : v;
      }
    }
    return out;
  }
  return (patch as T) ?? def;
}

export async function getSetting<T>(env: Env, key: string): Promise<T> {
  const row = await one<{ value: string }>(env, 'SELECT value FROM settings WHERE key = ?', key);
  const patch = row ? parseJSON<any>(row.value, null) : null;
  return deepMerge(DEFAULTS[key], patch) as T;
}

export async function setSetting(env: Env, key: string, value: unknown): Promise<void> {
  await run(
    env,
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    JSON.stringify(value),
  );
}

export async function getSite(env: Env): Promise<SiteConfig> {
  return getSetting<SiteConfig>(env, 'site');
}

export async function getPayment(env: Env): Promise<PaymentConfig> {
  return getSetting<PaymentConfig>(env, 'payment');
}

export async function getNotify(env: Env): Promise<NotifyConfig> {
  return getSetting<NotifyConfig>(env, 'notify');
}

export async function getCommission(env: Env): Promise<CommissionConfig> {
  return getSetting<CommissionConfig>(env, 'commission');
}

/** 前台可见的站点配置（过滤敏感字段） */
export async function publicSite(env: Env) {
  const s = await getSite(env);
  const { custom_head, ...rest } = s;
  return {
    ...rest,
    custom_head,
  };
}

export async function updateSite(env: Env, patch: Record<string, unknown>): Promise<SiteConfig> {
  const current = await getSite(env);
  const next = deepMerge(current, patch);
  await setSetting(env, 'site', next);
  return next;
}
