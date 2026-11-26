import type { Admin, Env, Merchant, SiteConfig } from './types';
import { all, one } from './db';
import { getSite } from './settings';
import { HttpError, toInt } from './util';

/* ------------------------------------------------------------------ */
/* 商户基础查询                                                         */
/* ------------------------------------------------------------------ */

export async function getDefaultMerchant(env: Env): Promise<Merchant> {
  const m = await one<Merchant>(env, 'SELECT * FROM merchants WHERE is_default = 1 LIMIT 1');
  if (m) return m;
  const any = await one<Merchant>(env, 'SELECT * FROM merchants ORDER BY id ASC LIMIT 1');
  if (!any) throw new HttpError(503, '店铺数据未初始化，请先执行数据库迁移');
  return any;
}

export async function getMerchant(env: Env, id: number | null | undefined): Promise<Merchant | null> {
  if (!id) return null;
  return one<Merchant>(env, 'SELECT * FROM merchants WHERE id = ?', id);
}

export async function getMerchantBySlug(env: Env, slug: string): Promise<Merchant | null> {
  const s = String(slug ?? '').trim().toLowerCase();
  if (!s) return null;
  return one<Merchant>(env, 'SELECT * FROM merchants WHERE slug = ?', s);
}

export async function getMerchantByDomain(env: Env, host: string): Promise<Merchant | null> {
  const h = String(host ?? '').trim().toLowerCase().split(':')[0];
  if (!h) return null;
  return one<Merchant>(env, 'SELECT * FROM merchants WHERE lower(domain) = ?', h);
}

/**
 * 解析当前请求对应的店铺。
 * 优先级：显式 ?merchant=slug / X-Merchant-Slug → 商户绑定域名 → 默认店铺
 */
export async function resolveMerchant(env: Env, req: Request, explicitSlug?: string | null): Promise<Merchant> {
  const url = new URL(req.url);
  const slug = String(explicitSlug ?? url.searchParams.get('merchant') ?? req.headers.get('x-merchant-slug') ?? '').trim();
  if (slug) {
    const m = await getMerchantBySlug(env, slug);
    if (!m) throw new HttpError(404, '店铺不存在');
    if (m.status !== 'on') throw new HttpError(403, '该店铺已停用');
    return m;
  }
  const byDomain = await getMerchantByDomain(env, url.hostname);
  if (byDomain) {
    if (byDomain.status !== 'on') throw new HttpError(403, '该店铺已停用');
    return byDomain;
  }
  return getDefaultMerchant(env);
}

/* ------------------------------------------------------------------ */
/* 商户配置                                                             */
/* ------------------------------------------------------------------ */

export function publicMerchant(m: Merchant) {
  return {
    id: m.id,
    name: m.name,
    slug: m.slug,
    domain: m.domain || '',
    description: m.description || '',
    announcement: m.announcement || '',
    contact: m.contact || '',
    footer: m.footer || '',
    logo: m.logo || '',
    logo_image: m.logo_image || '',
    seo_title: m.seo_title || '',
    seo_description: m.seo_description || '',
    seo_keywords: m.seo_keywords || '',
    is_default: !!m.is_default,
    status: m.status,
  };
}

/** 把全局站点配置与商户资料合并；默认店铺沿用全局设置 */
export async function merchantSiteConfig(env: Env, merchant: Merchant): Promise<SiteConfig> {
  const site = await getSite(env);
  if (merchant.is_default) return site;
  const out: SiteConfig = { ...site };
  if (merchant.name) out.name = merchant.name;
  if (merchant.description) out.description = merchant.description;
  if (merchant.announcement) out.announcement = merchant.announcement;
  if (merchant.contact) out.contact = merchant.contact;
  if (merchant.footer) out.footer = merchant.footer;
  if (merchant.logo) out.logo = merchant.logo;
  if (merchant.logo_image) out.logo_image = merchant.logo_image;
  if (merchant.seo_title) out.seo_title = merchant.seo_title;
  if (merchant.seo_description) out.seo_description = merchant.seo_description;
  if (merchant.seo_keywords) out.seo_keywords = merchant.seo_keywords;
  return out;
}

/* ------------------------------------------------------------------ */
/* 后台权限与查询范围                                                   */
/* ------------------------------------------------------------------ */

export function adminMerchantId(admin: Admin, requested?: string | number | null): number | null {
  if (admin.merchant_id != null) return admin.merchant_id;
  if (requested == null || requested === '') return null;
  const n = toInt(requested, 0);
  return n > 0 ? n : null;
}

export function scopeWhere(alias: string, merchantId: number | null): { sql: string; params: unknown[] } {
  if (merchantId == null) return { sql: '', params: [] };
  return { sql: ` AND ${alias}.merchant_id = ?`, params: [merchantId] };
}

export function assertMerchantAccess(admin: Admin, merchantId: number | null | undefined): void {
  if (admin.merchant_id != null && Number(merchantId) !== Number(admin.merchant_id)) {
    throw new HttpError(403, '无权访问其他店铺的数据');
  }
}

export async function assertMerchantExists(env: Env, id: number | null | undefined): Promise<Merchant> {
  const m = await getMerchant(env, id);
  if (!m) throw new HttpError(404, '店铺不存在');
  return m;
}

export async function listMerchants(env: Env): Promise<Merchant[]> {
  return all<Merchant>(env, 'SELECT * FROM merchants ORDER BY is_default DESC, id ASC');
}

export function normalizeSlug(input: string): string {
  return String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export function validSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug);
}

export function normalizeDomain(input: string): string {
  let d = String(input ?? '').trim().toLowerCase();
  if (!d) return '';
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return d;
}

export function validDomain(domain: string): boolean {
  if (!domain) return true;
  return /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain);
}
