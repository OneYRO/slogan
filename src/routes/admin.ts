import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import {
  ADMIN_COOKIE,
  clearCookieHeader,
  cookieHeader,
  createSession,
  destroySession,
  loginClear,
  loginGuard,
  parseCookies,
  requireAdmin,
  clientOf,
} from '../auth';
import { all, one, run, scalar, batch } from '../db';
import { closeOrder, loadOrderDetail, publicOrder } from '../orders';
import { getCommission, getNotify, getPayment, getSecurity, getSite, setSetting } from '../settings';
import { sendMail, sendTest, renderTemplate } from '../notify';
import {
  HttpError,
  assert,
  centsToYuan,
  dayStart,
  escapeHTML,
  hashPassword,
  intOrNull,
  randomBase32,
  randomString,
  totpCode,
  verifyTotp,
  verifyTotpStep,
  now,
  pageResult,
  pager,
  parseJSON,
  toInt,
  verifyPassword,
} from '../util';
import {
  adminMerchantId,
  assertMerchantAccess,
  assertMerchantExists,
  getDefaultMerchant,
  getMerchant,
  listMerchants,
  normalizeDomain,
  normalizeSlug,
  publicMerchant,
  scopeWhere,
  validDomain,
  validSlug,
} from '../merchants';
import type { Merchant, Product, Sku, UserRow } from '../types';

/* ================================================================== */
/* 未登录可访问：初始化 / 登录                                          */
/* ================================================================== */

export const adminPublic = new Hono<AppEnv>();

adminPublic.get('/bootstrap', async (c) => {
  const count = await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM admins');
  return c.json({ ok: true, data: { initialized: Number(count) > 0 } });
});

adminPublic.post('/setup', async (c) => {
  const count = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM admins'));
  if (count > 0) throw new HttpError(403, '系统已初始化，如需新增管理员请在后台操作');
  const body = await c.req.json<any>().catch(() => ({}));
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  assert(/^[a-zA-Z0-9_]{3,24}$/.test(username), 400, '用户名需为 3-24 位字母、数字或下划线');
  assert(password.length >= 10, 400, '密码至少 10 位');
  const ts = now();
  await run(
    c.env,
    'INSERT INTO admins (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)',
    username,
    await hashPassword(password),
    'root',
    ts,
  );
  const admin = await one<any>(c.env, 'SELECT * FROM admins WHERE username = ?', username);
  const token = await createSession(c.env, 'admin', admin.id, c.req.raw);
  c.header('Set-Cookie', cookieHeader(ADMIN_COOKIE, token, 7 * 86400, c.req.raw));
  return c.json({ ok: true, data: { id: admin.id, username: admin.username } });
});

adminPublic.post('/login', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  const username = String(body.username ?? '').trim();
  const password = String(body.password ?? '');
  if (!username || !password) throw new HttpError(400, '请输入账号和密码');
  const { ip } = clientOf(c);
  loginGuard(`admin:${ip}`);
  const admin = await one<any>(c.env, 'SELECT * FROM admins WHERE username = ?', username);
  if (!admin || !(await verifyPassword(password, admin.password_hash))) {
    throw new HttpError(401, '账号或密码错误');
  }
  if (admin.totp_enabled) {
    const step = await verifyTotpStep(admin.totp_secret || '', String(body.code ?? ''));
    if (step === null) throw new HttpError(401, '动态验证码错误或已过期');
    if (step <= Number(admin.totp_last_step || 0)) {
      throw new HttpError(401, '该动态验证码已使用，请等待下一次验证码');
    }
    admin._totp_step = step;
  }
  loginClear(`admin:${ip}`);
  const token = await createSession(c.env, 'admin', admin.id, c.req.raw);
  c.header('Set-Cookie', cookieHeader(ADMIN_COOKIE, token, 7 * 86400, c.req.raw));
  if (admin.totp_enabled) {
    await run(c.env, 'UPDATE admins SET last_login_at = ?, totp_last_step = ? WHERE id = ?', now(), admin._totp_step, admin.id);
  } else {
    await run(c.env, 'UPDATE admins SET last_login_at = ? WHERE id = ?', now(), admin.id);
  }
  await audit(c, '登录后台', `管理员 ${admin.username} 登录`);
  const merchant = admin.merchant_id ? await getMerchant(c.env, admin.merchant_id) : null;
  return c.json({
    ok: true,
    data: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      merchant_id: admin.merchant_id ?? null,
      merchant: merchant ? publicMerchant(merchant) : null,
    },
  });
});

/* ================================================================== */
/* 受保护接口                                                          */
/* ================================================================== */

export const admin = new Hono<AppEnv>();

admin.use('*', requireAdmin);

/** 仅平台管理员（merchant_id IS NULL）可访问的模块 */
async function requireRoot(c: any, next: () => Promise<void>) {
  const a = c.get('admin');
  if (a?.merchant_id != null) throw new HttpError(403, '该功能仅平台管理员可用');
  await next();
}

for (const p of [
  '/settings', '/settings/*',
  '/payments', '/payments/*',
  '/security', '/security/*',
  '/notify', '/notify/*',
  '/templates', '/templates/*',
  '/logs', '/logs/*',
  '/users', '/users/*',
  '/levels', '/levels/*',
  '/suppliers', '/suppliers/*',
  '/redeem-codes', '/redeem-codes/*',
  '/merchants', '/merchants/*',
]) {
  admin.use(p, requireRoot);
}

async function audit(c: any, action: string, detail?: string) {
  const admin = c.get('admin');
  await run(
    c.env,
    'INSERT INTO audit_logs (admin_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)',
    admin?.id ?? null,
    action,
    detail ? String(detail).slice(0, 500) : null,
    c.req.header('cf-connecting-ip') || '',
    now(),
  ).catch(() => {});
}

admin.post('/logout', async (c) => {
  const token = parseCookies(c.req.header('cookie'))[ADMIN_COOKIE];
  await destroySession(c.env, token);
  c.header('Set-Cookie', clearCookieHeader(ADMIN_COOKIE));
  return c.json({ ok: true });
});

/* ---------------------------- 两步验证 ---------------------------- */

admin.post('/2fa/setup', async (c) => {
  const adminRow = c.get('admin');
  const existing = await one<any>(c.env, 'SELECT totp_enabled FROM admins WHERE id = ?', adminRow.id);
  if (existing?.totp_enabled) throw new HttpError(400, '两步验证已启用，如需重置请先关闭');
  const secret = randomBase32(20);
  await run(c.env, 'UPDATE admins SET totp_secret = ? WHERE id = ?', secret, adminRow.id);
  const site = await getSite(c.env);
  const label = encodeURIComponent(`${site.name}:${adminRow.username}`);
  return c.json({
    ok: true,
    data: {
      secret,
      otpauth_url: `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(site.name)}&algorithm=SHA1&digits=6&period=30`,
    },
  });
});

admin.post('/2fa/enable', async (c) => {
  const adminRow = c.get('admin');
  const b = await c.req.json<any>().catch(() => ({}));
  const row = await one<any>(c.env, 'SELECT totp_secret FROM admins WHERE id = ?', adminRow.id);
  if (!row?.totp_secret) throw new HttpError(400, '请先生成密钥');
  if (!(await verifyTotp(row.totp_secret, String(b.code ?? '')))) throw new HttpError(400, '动态验证码错误');
  await run(c.env, 'UPDATE admins SET totp_enabled = 1 WHERE id = ?', adminRow.id);
  await audit(c, '开启两步验证');
  return c.json({ ok: true });
});

admin.post('/2fa/disable', async (c) => {
  const adminRow = c.get('admin');
  const b = await c.req.json<any>().catch(() => ({}));
  const row = await one<any>(c.env, 'SELECT totp_secret, totp_enabled FROM admins WHERE id = ?', adminRow.id);
  if (!row?.totp_enabled) throw new HttpError(400, '两步验证未开启');
  if (!(await verifyTotp(row.totp_secret || '', String(b.code ?? '')))) throw new HttpError(400, '动态验证码错误');
  await run(c.env, 'UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_last_step = 0 WHERE id = ?', adminRow.id);
  await audit(c, '关闭两步验证');
  return c.json({ ok: true });
});

admin.post('/password', async (c) => {
  const adminRow = c.get('admin');
  const b = await c.req.json<any>().catch(() => ({}));
  const oldPassword = String(b.old_password ?? '');
  const newPassword = String(b.new_password ?? '');
  assert(oldPassword, 400, '请输入当前密码');
  assert(newPassword.length >= 10, 400, '新密码至少 10 位');
  const row = await one<any>(c.env, 'SELECT password_hash FROM admins WHERE id = ?', adminRow.id);
  if (!(await verifyPassword(oldPassword, row?.password_hash || ''))) throw new HttpError(400, '当前密码不正确');
  await run(c.env, 'UPDATE admins SET password_hash = ? WHERE id = ?', await hashPassword(newPassword), adminRow.id);
  await audit(c, '修改管理员密码');
  return c.json({ ok: true });
});

admin.get('/me', async (c) => {
  const a = c.get('admin');
  const site = await getSite(c.env);
  const merchant = a.merchant_id ? await getMerchant(c.env, a.merchant_id) : null;
  const totp = await one<{ totp_enabled: number }>(c.env, 'SELECT totp_enabled FROM admins WHERE id = ?', a.id);
  return c.json({
    ok: true,
    data: {
      ...a,
      totp_enabled: !!totp?.totp_enabled,
      site_name: site.name,
      merchant: merchant ? publicMerchant(merchant) : null,
    },
  });
});

/* ---------------------------- 仪表盘 ---------------------------- */

admin.get('/stats', async (c) => {
  const ts = now();
  const start = dayStart(ts);
  const paidStatus = "('paid','manual','shipped','delivered')";
  const mid = adminMerchantId(c.get('admin'), c.req.query('merchant_id'));
  const oScope = mid ? ' AND merchant_id = ?' : '';
  const oParams: unknown[] = mid ? [mid] : [];
  const pScope = mid ? ' AND merchant_id = ?' : '';
  const pParams: unknown[] = mid ? [mid] : [];

  const todayOrders = Number(
    await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND status IN ${paidStatus}${oScope}`, start, ...oParams),
  );
  const todayRevenue = Number(
    await scalar<number>(c.env, `SELECT COALESCE(SUM(amount_cents),0) AS c FROM orders WHERE paid_at >= ? AND status IN ${paidStatus}${oScope}`, start, ...oParams),
  );
  const todayProfit = Number(
    await scalar<number>(
      c.env,
      `SELECT COALESCE(SUM(oi.amount_cents - p.cost_cents * oi.qty),0) AS c
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
       WHERE o.paid_at >= ? AND o.status IN ${paidStatus}${mid ? ' AND o.merchant_id = ?' : ''}`,
      start,
      ...oParams,
    ),
  );
  const pendingShip = Number(
    await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM orders WHERE status IN ('paid','manual')${oScope}`, ...oParams),
  );
  const totalUsers = Number(
    mid
      ? await scalar<number>(c.env, 'SELECT COUNT(DISTINCT user_id) AS c FROM orders WHERE user_id IS NOT NULL AND merchant_id = ?', mid)
      : await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM users'),
  );
  const totalProducts = Number(
    await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM products WHERE status = 'on'${pScope}`, ...pParams),
  );
  const totalCards = Number(
    await scalar<number>(
      c.env,
      `SELECT COUNT(*) AS c FROM cards c JOIN products p ON p.id = c.product_id
       WHERE c.status = 'unused'${mid ? ' AND p.merchant_id = ?' : ''}`,
      ...pParams,
    ),
  );
  const site = await getSite(c.env);

  const lowStock = await all<any>(
    c.env,
    `SELECT p.id, p.name, p.delivery_mode, p.stock,
            (SELECT COUNT(*) FROM cards c WHERE c.product_id = p.id AND c.status = 'unused') AS card_count
     FROM products p WHERE p.status = 'on'${pScope}
       AND ((p.delivery_mode = 'auto' AND (SELECT COUNT(*) FROM cards c WHERE c.product_id = p.id AND c.status = 'unused') <= ?)
         OR (p.delivery_mode IN ('manual','physical') AND p.stock <= ?))
     ORDER BY p.id ASC LIMIT 10`,
    ...pParams,
    site.stock_alert,
    site.stock_alert,
  );

  const series = [];
  for (let i = 6; i >= 0; i--) {
    const dStart = dayStart(ts) - i * 86400000;
    const dEnd = dStart + 86400000;
    const orders = Number(
      await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND created_at < ? AND status IN ${paidStatus}${oScope}`, dStart, dEnd, ...oParams),
    );
    const revenue = Number(
      await scalar<number>(c.env, `SELECT COALESCE(SUM(amount_cents),0) AS c FROM orders WHERE paid_at >= ? AND paid_at < ? AND status IN ${paidStatus}${oScope}`, dStart, dEnd, ...oParams),
    );
    series.push({
      date: new Date(dStart).toISOString().slice(5, 10),
      orders,
      revenue,
    });
  }

  const recent = await all<any>(
    c.env,
    `SELECT id, order_no, email, status, amount_cents, created_at FROM orders WHERE 1=1${oScope} ORDER BY id DESC LIMIT 8`,
    ...oParams,
  );

  const top = await all<any>(
    c.env,
    `SELECT id, name, sales_count, price_cents FROM products WHERE status = 'on'${pScope} ORDER BY sales_count DESC LIMIT 5`,
    ...pParams,
  );

  const statusCount = await all<any>(
    c.env,
    `SELECT status, COUNT(*) AS c FROM orders WHERE 1=1${oScope} GROUP BY status`,
    ...oParams,
  );

  return c.json({
    ok: true,
    data: {
      merchant_id: mid,
      today: { orders: todayOrders, revenue: todayRevenue, profit: todayProfit },
      pending_ship: pendingShip,
      total_users: totalUsers,
      total_products: totalProducts,
      total_cards: totalCards,
      low_stock: lowStock,
      series,
      recent_orders: recent,
      top_products: top,
      status_count: Object.fromEntries(statusCount.map((s) => [s.status, s.c])),
    },
  });
});

/* ---------------------------- 分类 ---------------------------- */

admin.get('/categories', async (c) => {
  const mid = adminMerchantId(c.get('admin'), c.req.query('merchant_id'));
  const list = await all<any>(
    c.env,
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM categories c WHERE 1=1${mid ? ' AND c.merchant_id = ?' : ''} ORDER BY c.sort ASC, c.id ASC`,
    ...(mid ? [mid] : []),
  );
  return c.json({ ok: true, data: list });
});

admin.post('/categories', async (c) => {
  const b = await c.req.json<any>();
  assert(String(b.name ?? '').trim(), 400, '分类名称不能为空');
  const slug = String(b.slug ?? '').trim() || Date.now().toString(36);
  const mid = adminMerchantId(c.get('admin'), c.req.query('merchant_id'))
    ?? (await getDefaultMerchant(c.env)).id;
  await run(
    c.env,
    'INSERT INTO categories (name, slug, icon, description, sort, enabled, merchant_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    String(b.name).trim().slice(0, 40),
    slug.slice(0, 40),
    String(b.icon ?? '').slice(0, 20),
    String(b.description ?? '').slice(0, 200),
    toInt(b.sort, 0),
    b.enabled === false ? 0 : 1,
    mid,
    now(),
  );
  await audit(c, '新建分类', b.name);
  return c.json({ ok: true });
});

admin.put('/categories/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  const exists = await one<any>(c.env, 'SELECT * FROM categories WHERE id = ?', id);
  assert(exists, 404, '分类不存在');
  assertMerchantAccess(c.get('admin'), exists.merchant_id);
  await run(
    c.env,
    `UPDATE categories SET name = ?, icon = ?, description = ?, sort = ?, enabled = ?, slug = ? WHERE id = ?`,
    String(b.name ?? '').trim().slice(0, 40) || '未命名',
    String(b.icon ?? '').slice(0, 20),
    String(b.description ?? '').slice(0, 200),
    toInt(b.sort, 0),
    b.enabled === false ? 0 : 1,
    String(b.slug ?? slugSafe(b.name)) || exists.slug,
    id,
  );
  await audit(c, '编辑分类', `#${id} ${b.name}`);
  return c.json({ ok: true });
});

admin.delete('/categories/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await one<any>(c.env, 'SELECT * FROM categories WHERE id = ?', id);
  assert(exists, 404, '分类不存在');
  assertMerchantAccess(c.get('admin'), exists.merchant_id);
  const used = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM products WHERE category_id = ?', id));
  assert(used === 0, 400, '该分类下还有商品，请先移除商品');
  await run(c.env, 'DELETE FROM categories WHERE id = ?', id);
  await audit(c, '删除分类', `#${id}`);
  return c.json({ ok: true });
});

function slugSafe(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/* ---------------------------- 商品 ---------------------------- */

admin.get('/products', async (c) => {
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 20, 100);
  const q = url.searchParams.get('q')?.trim();
  const category = url.searchParams.get('category');
  const status = url.searchParams.get('status');
  const mid = adminMerchantId(c.get('admin'), url.searchParams.get('merchant_id'));
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (mid) {
    where.push('p.merchant_id = ?');
    params.push(mid);
  }
  if (q) {
    where.push('(p.name LIKE ? OR p.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    where.push('p.category_id = ?');
    params.push(toInt(category, 0));
  }
  if (status) {
    where.push('p.status = ?');
    params.push(status);
  }
  const whereSql = where.join(' AND ');
  const total = Number(await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM products p WHERE ${whereSql}`, ...params));
  const list = await all<any>(
    c.env,
    `SELECT p.*, c.name AS category_name,
            (SELECT COUNT(*) FROM cards cd WHERE cd.product_id = p.id AND cd.status = 'unused') AS card_count
     FROM products p LEFT JOIN categories c ON c.id = p.category_id
     WHERE ${whereSql} ORDER BY p.sort DESC, p.id DESC LIMIT ? OFFSET ?`,
    ...params,
    size,
    offset,
  );
  return c.json({ ok: true, data: { list, ...pageResult([], total, page, size) } });
});

admin.get('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const p = await one<any>(
    c.env,
    `SELECT p.*, (SELECT COUNT(*) FROM cards cd WHERE cd.product_id = p.id AND cd.status = 'unused') AS card_count
     FROM products p WHERE p.id = ?`,
    id,
  );
  assert(p, 404, '商品不存在');
  assertMerchantAccess(c.get('admin'), p.merchant_id);
  const skus = await all<Sku>(c.env, 'SELECT * FROM skus WHERE product_id = ? ORDER BY sort ASC, id ASC', id);
  return c.json({ ok: true, data: { ...p, skus } });
});

function normalizeProductPayload(b: any) {
  const images = Array.isArray(b.images)
    ? b.images.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 8)
    : parseJSON<string[]>(b.images, []);
  const tiers = Array.isArray(b.wholesale_tiers)
    ? b.wholesale_tiers
        .map((t: any) => ({ min_qty: toInt(t.min_qty, 0), price_cents: toInt(t.price_cents, 0) }))
        .filter((t: any) => t.min_qty > 0)
    : parseJSON<any[]>(b.wholesale_tiers, []);
  const mode = ['auto', 'manual', 'physical', 'fixed'].includes(b.delivery_mode) ? b.delivery_mode : 'auto';
  return {
    category_id: intOrNull(b.category_id),
    name: String(b.name ?? '').trim().slice(0, 120),
    slug: String(b.slug ?? '').trim().slice(0, 60) || null,
    description: String(b.description ?? '').slice(0, 20000),
    images: JSON.stringify(images),
    delivery_mode: mode,
    price_cents: Math.max(0, toInt(b.price_cents, 0)),
    member_price_cents: intOrNull(b.member_price_cents),
    wholesale_tiers: JSON.stringify(tiers),
    stock: Math.max(0, toInt(b.stock, 0)),
    cost_cents: Math.max(0, toInt(b.cost_cents, 0)),
    min_qty: Math.max(1, toInt(b.min_qty, 1)),
    max_qty: Math.max(1, toInt(b.max_qty, 99)),
    limit_per_user: Math.max(0, toInt(b.limit_per_user, 0)),
    seckill_price_cents: intOrNull(b.seckill_price_cents),
    seckill_starts_at: intOrNull(b.seckill_starts_at),
    seckill_ends_at: intOrNull(b.seckill_ends_at),
    pick_enabled: b.pick_enabled ? 1 : 0,
    pick_fee_cents: Math.max(0, toInt(b.pick_fee_cents, 0)),
    content: b.content ? String(b.content).slice(0, 20000) : null,
    status: b.status === 'off' ? 'off' : 'on',
    is_recommend: b.is_recommend ? 1 : 0,
    sort: toInt(b.sort, 0),
    supplier_id: intOrNull(b.supplier_id),
    supplier_goods_id: b.supplier_goods_id ? String(b.supplier_goods_id).trim().slice(0, 120) : null,
    supplier_cost_cents: Math.max(0, toInt(b.supplier_cost_cents, 0)),
    auto_purchase: b.auto_purchase ? 1 : 0,
  };
}

async function saveSkus(env: any, productId: number, skus: any[]) {
  const keep: number[] = [];
  for (const s of Array.isArray(skus) ? skus : []) {
    const name = String(s.name ?? '').trim().slice(0, 60);
    if (!name) continue;
    const price = intOrNull(s.price_cents);
    const memberPrice = intOrNull(s.member_price_cents);
    if (s.id) {
      await run(
        env,
        `UPDATE skus SET name = ?, price_cents = ?, member_price_cents = ?, cost_cents = ?, sort = ?, enabled = ?
         WHERE id = ? AND product_id = ?`,
        name,
        price,
        memberPrice,
        Math.max(0, toInt(s.cost_cents, 0)),
        toInt(s.sort, 0),
        s.enabled === false ? 0 : 1,
        s.id,
        productId,
      );
      keep.push(Number(s.id));
    } else {
      const res = await run(
        env,
        `INSERT INTO skus (product_id, name, price_cents, member_price_cents, cost_cents, sort, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        productId,
        name,
        price,
        memberPrice,
        Math.max(0, toInt(s.cost_cents, 0)),
        toInt(s.sort, 0),
        s.enabled === false ? 0 : 1,
      );
      keep.push(res.meta.last_row_id as number);
    }
  }
  const old = await all<{ id: number }>(env, 'SELECT id FROM skus WHERE product_id = ?', productId);
  const removed = old.filter((s) => !keep.includes(s.id)).map((s) => s.id);
  if (removed.length) {
    await run(
      env,
      `UPDATE cards SET sku_id = NULL WHERE product_id = ? AND sku_id IN (${removed.map(() => '?').join(',')})`,
      productId,
      ...removed,
    );
    await run(env, `DELETE FROM skus WHERE id IN (${removed.map(() => '?').join(',')})`, ...removed);
  }
}

admin.post('/products', async (c) => {
  const b = await c.req.json<any>();
  const p = normalizeProductPayload(b);
  assert(p.name, 400, '商品名称不能为空');
  if (p.delivery_mode === 'auto') p.stock = 0;
  const mid = adminMerchantId(c.get('admin'), c.req.query('merchant_id'))
    ?? (await getDefaultMerchant(c.env)).id;
  if (p.category_id) {
    const cat = await one<any>(c.env, 'SELECT id, merchant_id FROM categories WHERE id = ?', p.category_id);
    assert(cat, 400, '商品分组不存在');
    assert(Number(cat.merchant_id) === Number(mid), 400, '商品分组不属于当前店铺');
  }
  const ts = now();
  const res = await run(
    c.env,
    `INSERT INTO products (category_id, name, slug, description, images, delivery_mode, price_cents, member_price_cents,
      wholesale_tiers, stock, cost_cents, min_qty, max_qty, limit_per_user, seckill_price_cents, seckill_starts_at,
      seckill_ends_at, pick_enabled, pick_fee_cents, content, status, is_recommend, sort, created_at, updated_at,
      supplier_id, supplier_goods_id, supplier_cost_cents, auto_purchase, merchant_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    p.category_id, p.name, p.slug, p.description, p.images, p.delivery_mode, p.price_cents, p.member_price_cents,
    p.wholesale_tiers, p.stock, p.cost_cents, p.min_qty, p.max_qty, p.limit_per_user, p.seckill_price_cents,
    p.seckill_starts_at, p.seckill_ends_at, p.pick_enabled, p.pick_fee_cents, p.content, p.status, p.is_recommend,
    p.sort, ts, ts,
    p.supplier_id, p.supplier_goods_id, p.supplier_cost_cents, p.auto_purchase, mid,
  );
  const id = res.meta.last_row_id as number;
  await saveSkus(c.env, id, b.skus);
  await audit(c, '新建商品', `#${id} ${p.name}`);
  return c.json({ ok: true, data: { id } });
});

admin.put('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await one<Product>(c.env, 'SELECT * FROM products WHERE id = ?', id);
  assert(exists, 404, '商品不存在');
  assertMerchantAccess(c.get('admin'), exists.merchant_id);
  const b = await c.req.json<any>();
  const p = normalizeProductPayload(b);
  assert(p.name, 400, '商品名称不能为空');
  if (p.delivery_mode === 'auto') p.stock = exists.stock;
  if (p.category_id) {
    const cat = await one<any>(c.env, 'SELECT id, merchant_id FROM categories WHERE id = ?', p.category_id);
    assert(cat, 400, '商品分组不存在');
    assert(Number(cat.merchant_id) === Number(exists.merchant_id), 400, '商品分组不属于当前店铺');
  }
  await run(
    c.env,
    `UPDATE products SET category_id=?, name=?, slug=?, description=?, images=?, delivery_mode=?, price_cents=?,
      member_price_cents=?, wholesale_tiers=?, stock=?, cost_cents=?, min_qty=?, max_qty=?, limit_per_user=?,
      seckill_price_cents=?, seckill_starts_at=?, seckill_ends_at=?, pick_enabled=?, pick_fee_cents=?, content=?,
      status=?, is_recommend=?, sort=?, updated_at=?, supplier_id=?, supplier_goods_id=?, supplier_cost_cents=?, auto_purchase=? WHERE id=?`,
    p.category_id, p.name, p.slug, p.description, p.images, p.delivery_mode, p.price_cents, p.member_price_cents,
    p.wholesale_tiers, p.stock, p.cost_cents, p.min_qty, p.max_qty, p.limit_per_user, p.seckill_price_cents,
    p.seckill_starts_at, p.seckill_ends_at, p.pick_enabled, p.pick_fee_cents, p.content, p.status,
    p.is_recommend, p.sort, now(),
    p.supplier_id, p.supplier_goods_id, p.supplier_cost_cents, p.auto_purchase, id,
  );
  await saveSkus(c.env, id, b.skus);
  await audit(c, '编辑商品', `#${id} ${p.name}`);
  return c.json({ ok: true });
});

admin.delete('/products/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await one<any>(c.env, 'SELECT id, merchant_id FROM products WHERE id = ?', id);
  assert(exists, 404, '商品不存在');
  assertMerchantAccess(c.get('admin'), exists.merchant_id);
  const sold = Number(await scalar<number>(c.env, "SELECT COUNT(*) AS c FROM cards WHERE product_id = ? AND status = 'sold'", id));
  assert(sold === 0, 400, '该商品已有售出卡密，建议下架而非删除');
  await run(c.env, 'DELETE FROM cards WHERE product_id = ?', id);
  await run(c.env, 'DELETE FROM skus WHERE product_id = ?', id);
  await run(c.env, 'DELETE FROM products WHERE id = ?', id);
  await audit(c, '删除商品', `#${id}`);
  return c.json({ ok: true });
});

/* ---------------------------- 卡密 ---------------------------- */

admin.get('/cards', async (c) => {
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 20, 200);
  const productId = intOrNull(url.searchParams.get('product_id'));
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q')?.trim();
  const mid = adminMerchantId(c.get('admin'), url.searchParams.get('merchant_id'));
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (mid) {
    where.push('p.merchant_id = ?');
    params.push(mid);
  }
  if (productId) {
    where.push('c.product_id = ?');
    params.push(productId);
  }
  if (status) {
    where.push('c.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('c.content LIKE ?');
    params.push(`%${q}%`);
  }
  const whereSql = where.join(' AND ');
  const total = Number(await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM cards c JOIN products p ON p.id = c.product_id WHERE ${whereSql}`, ...params));
  const list = await all<any>(
    c.env,
    `SELECT c.*, p.name AS product_name, s.name AS sku_name FROM cards c
     LEFT JOIN products p ON p.id = c.product_id LEFT JOIN skus s ON s.id = c.sku_id
     WHERE ${whereSql} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    ...params,
    size,
    offset,
  );
  return c.json({ ok: true, data: { list, ...pageResult([], total, page, size) } });
});

/** 批量导入卡密：支持 卡号----密码 / 卡号 密码 / 卡号,密码 / 卡号|密码 / 纯卡密 / CSV */
function parseCardLines(text: string): string[] {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\r/g, '').trim())
    .filter((l) => l && !/^(卡号|卡密|账号|card|id)[,\s]/i.test(l));
}

admin.post('/cards/import', async (c) => {
  const b = await c.req.json<any>();
  const productId = toInt(b.product_id, 0);
  const skuId = intOrNull(b.sku_id);
  const product = await one<Product>(c.env, 'SELECT * FROM products WHERE id = ?', productId);
  assert(product, 404, '商品不存在');
  assertMerchantAccess(c.get('admin'), product.merchant_id);
  if (skuId) {
    const sku = await one(c.env, 'SELECT id FROM skus WHERE id = ? AND product_id = ?', skuId, productId);
    assert(sku, 400, '规格不属于该商品');
  }
  const lines = parseCardLines(b.text ?? (Array.isArray(b.lines) ? b.lines.join('\n') : ''));
  assert(lines.length > 0, 400, '没有解析到有效卡密');
  assert(lines.length <= 5000, 400, '单次最多导入 5000 条');

  const ts = now();
  const unique = [...new Set(lines.map((l) => l.slice(0, 500)))];
  let imported = 0;
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const stmts = chunk.map((content) =>
      c.env.DB.prepare(
        'INSERT INTO cards (product_id, sku_id, content, status, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(productId, skuId, content, 'unused', ts),
    );
    await batch(c.env, stmts);
    imported += chunk.length;
  }
  const total = Number(
    await scalar<number>(c.env, "SELECT COUNT(*) AS c FROM cards WHERE product_id = ? AND status = 'unused'", productId),
  );
  await audit(c, '导入卡密', `商品 #${productId} 导入 ${imported} 条`);
  return c.json({ ok: true, data: { imported, skipped: lines.length - unique.length, total } });
});

admin.get('/cards/export', async (c) => {
  const url = new URL(c.req.url);
  const productId = intOrNull(url.searchParams.get('product_id'));
  const status = url.searchParams.get('status');
  const mid = adminMerchantId(c.get('admin'), url.searchParams.get('merchant_id'));
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (mid) {
    where.push('p.merchant_id = ?');
    params.push(mid);
  }
  if (productId) {
    where.push('c.product_id = ?');
    params.push(productId);
  }
  if (status) {
    where.push('c.status = ?');
    params.push(status);
  }
  const rows = await all<any>(
    c.env,
    `SELECT c.id, p.name AS product_name, s.name AS sku_name, c.content, c.status, c.created_at, c.sold_at
     FROM cards c LEFT JOIN products p ON p.id = c.product_id LEFT JOIN skus s ON s.id = c.sku_id
     WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT 20000`,
    ...params,
  );
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = 'ID,商品,规格,卡密,状态,导入时间,售出时间';
  const body = rows.map((r) =>
    [r.id, r.product_name, r.sku_name ?? '', r.content, r.status, new Date(r.created_at).toISOString(), r.sold_at ? new Date(r.sold_at).toISOString() : '']
      .map(esc).join(','),
  );
  return new Response('\ufeff' + [head, ...body].join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cards-${Date.now()}.csv"`,
    },
  });
});

admin.delete('/cards/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const card = await one<any>(
    c.env,
    'SELECT c.id, p.merchant_id FROM cards c JOIN products p ON p.id = c.product_id WHERE c.id = ?',
    id,
  );
  assert(card, 404, '卡密不存在');
  assertMerchantAccess(c.get('admin'), card.merchant_id);
  await run(c.env, 'DELETE FROM cards WHERE id = ? AND status != ?', id, 'sold');
  return c.json({ ok: true });
});

admin.post('/cards/:id/restore', async (c) => {
  const id = Number(c.req.param('id'));
  const card = await one<any>(
    c.env,
    'SELECT c.id, p.merchant_id FROM cards c JOIN products p ON p.id = c.product_id WHERE c.id = ?',
    id,
  );
  assert(card, 404, '卡密不存在');
  assertMerchantAccess(c.get('admin'), card.merchant_id);
  await run(c.env, "UPDATE cards SET status = 'unused', order_item_id = NULL, sold_at = NULL WHERE id = ?", id);
  await audit(c, '恢复卡密', `#${id}`);
  return c.json({ ok: true });
});

/* ---------------------------- 订单 ---------------------------- */

admin.get('/orders', async (c) => {
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 20, 100);
  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q')?.trim();
  const date = url.searchParams.get('date');
  const mid = adminMerchantId(c.get('admin'), url.searchParams.get('merchant_id'));
  const where: string[] = ['1=1'];
  const params: unknown[] = [];
  if (mid) {
    where.push('o.merchant_id = ?');
    params.push(mid);
  }
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(o.order_no LIKE ? OR o.email LIKE ? OR o.pay_trade_no LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const s = new Date(date + 'T00:00:00').getTime();
    where.push('o.created_at >= ? AND o.created_at < ?');
    params.push(s, s + 86400000);
  }
  const whereSql = where.join(' AND ');
  const total = Number(await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM orders o WHERE ${whereSql}`, ...params));
  const list = await all<any>(
    c.env,
    `SELECT o.* FROM orders o WHERE ${whereSql} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
    ...params,
    size,
    offset,
  );
  return c.json({ ok: true, data: { list, ...pageResult([], total, page, size) } });
});

admin.get('/orders/export', async (c) => {
  const url = new URL(c.req.url);
  const status = url.searchParams.get('status');
  const mid = adminMerchantId(c.get('admin'), url.searchParams.get('merchant_id'));
  const where: string[] = [];
  const params: unknown[] = [];
  if (mid) {
    where.push('merchant_id = ?');
    params.push(mid);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = await all<any>(
    c.env,
    `SELECT * FROM orders ${whereSql} ORDER BY id DESC LIMIT 20000`,
    ...params,
  );
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = '订单号,邮箱,状态,原价,优惠,实付,支付方式,交易号,创建时间,支付时间';
  const body = rows.map((r) =>
    [
      r.order_no, r.email, r.status, centsToYuan(r.subtotal_cents), centsToYuan(r.discount_cents),
      centsToYuan(r.amount_cents), r.pay_channel ?? '', r.pay_trade_no ?? '',
      new Date(r.created_at).toISOString(), r.paid_at ? new Date(r.paid_at).toISOString() : '',
    ].map(esc).join(','),
  );
  return new Response('\ufeff' + [head, ...body].join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="orders-${Date.now()}.csv"`,
    },
  });
});

admin.get('/orders/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const detail = await loadOrderDetail(c.env, id);
  assert(detail, 404, '订单不存在');
  assertMerchantAccess(c.get('admin'), detail.order.merchant_id);
  const payments = await all(c.env, 'SELECT * FROM payments WHERE order_id = ? ORDER BY id DESC', id);
  const cards = await all<any>(
    c.env,
    `SELECT c.id, c.content, c.status, c.sku_id, c.order_item_id FROM cards c
     JOIN order_items oi ON oi.id = c.order_item_id WHERE oi.order_id = ?`,
    id,
  );
  return c.json({
    ok: true,
    data: { ...publicOrder(detail, await getSite(c.env)), payments, cards, raw: detail.order },
  });
});

admin.post('/orders/:id/action', async (c) => {
  const id = Number(c.req.param('id'));
  const order = await one<any>(c.env, 'SELECT * FROM orders WHERE id = ?', id);
  assert(order, 404, '订单不存在');
  assertMerchantAccess(c.get('admin'), order.merchant_id);
  const b = await c.req.json<any>();
  const action = String(b.action ?? '');

  if (action === 'close') {
    assert(order.status === 'pending', 400, '仅待支付订单可关闭');
    await closeOrder(c.env, id, b.remark || '管理员关闭');
    await audit(c, '关闭订单', order.order_no);
    return c.json({ ok: true });
  }

  if (action === 'refund') {
    assert(['paid', 'manual', 'shipped', 'delivered'].includes(order.status), 400, '该订单状态不可退款');
    if (b.restock) {
      const items = await all<any>(c.env, 'SELECT * FROM order_items WHERE order_id = ?', id);
      for (const it of items) {
        if (it.delivery_mode === 'auto') {
          await run(
            c.env,
            "UPDATE cards SET status = 'unused', order_item_id = NULL, sold_at = NULL WHERE order_item_id = ? AND status = 'sold'",
            it.id,
          );
        } else if (it.delivery_mode !== 'fixed') {
          await run(c.env, 'UPDATE products SET stock = stock + ? WHERE id = ?', it.qty, it.product_id);
        }
      }
    }
    await run(c.env, "UPDATE orders SET status = 'refunded', remark = ?, updated_at = ? WHERE id = ?", b.remark || '管理员退款', now(), id);
    await audit(c, '订单退款', `${order.order_no} ${b.remark ?? ''}`);
    return c.json({ ok: true });
  }

  if (action === 'ship') {
    assert(['paid', 'manual', 'shipped'].includes(order.status), 400, '该订单无需发货');
    const items = Array.isArray(b.items) ? b.items : [];
    const ts = now();
    for (const it of items) {
      const content = String(it.content ?? '').trim();
      if (!content) continue;
      const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      await run(
        c.env,
        'UPDATE order_items SET delivered = ?, delivered_at = ? WHERE id = ? AND order_id = ?',
        JSON.stringify(lines),
        ts,
        it.id,
        id,
      );
    }
    await run(c.env, "UPDATE orders SET status = 'delivered', updated_at = ? WHERE id = ?", ts, id);
    await audit(c, '人工发货', order.order_no);
    return c.json({ ok: true });
  }

  if (action === 'remark') {
    await run(c.env, 'UPDATE orders SET remark = ?, updated_at = ? WHERE id = ?', String(b.remark ?? '').slice(0, 500), now(), id);
    return c.json({ ok: true });
  }

  throw new HttpError(400, '未知操作');
});

/** 手动补发邮件 */
admin.post('/orders/:id/resend', async (c) => {
  const id = Number(c.req.param('id'));
  const detail = await loadOrderDetail(c.env, id);
  assert(detail, 404, '订单不存在');
  assertMerchantAccess(c.get('admin'), detail.order.merchant_id);
  const items = detail.items as any;
  if (!items.some((it: any) => it.delivered?.length)) throw new HttpError(400, '该订单没有可补发的卡密');
  const { notifyOrderPaid } = await import('../notify');
  await notifyOrderPaid(c.env, detail.order, items);
  await audit(c, '补发邮件', detail.order.order_no);
  return c.json({ ok: true });
});

/* ---------------------------- 兑换码 ---------------------------- */

admin.get('/redeem-codes', async (c) => {
  const list = await all<any>(
    c.env,
    `SELECT r.*, u.email AS used_by_email, a.username AS created_by_name
     FROM redeem_codes r
     LEFT JOIN users u ON u.id = r.used_by
     LEFT JOIN admins a ON a.id = r.created_by
     ORDER BY r.id DESC LIMIT 300`,
  );
  const stats = await one<any>(
    c.env,
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN status = 'used' THEN amount_cents ELSE 0 END), 0) AS used_amount_cents,
       COALESCE(SUM(CASE WHEN status = 'unused' AND (expires_at IS NULL OR expires_at > ?) THEN amount_cents ELSE 0 END), 0) AS available_amount_cents
     FROM redeem_codes`,
    now(),
  );
  return c.json({ ok: true, data: { list, stats } });
});

admin.post('/redeem-codes', async (c) => {
  const b = await c.req.json<any>().catch(() => ({}));
  const amountCents = Math.round(Number(b.amount_cents ?? 0));
  assert(Number.isFinite(amountCents) && amountCents > 0, 400, '请输入有效的兑换金额');
  assert(amountCents <= 100000000, 400, '单个兑换码金额过高');
  const quantity = Math.min(200, Math.max(1, toInt(b.quantity, 1)));
  const prefix = String(b.prefix ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 8);
  const note = String(b.note ?? '').trim().slice(0, 120) || null;
  const expiresAt = intOrNull(b.expires_at);
  const ts = now();
  if (expiresAt && expiresAt <= ts) throw new HttpError(400, '有效期必须晚于当前时间');
  const codes: string[] = [];
  for (let i = 0; i < quantity; i++) {
    let code = '';
    for (let attempt = 0; attempt < 8; attempt++) {
      code = `${prefix}${randomBase32(6)}`;
      const exists = await one(c.env, 'SELECT id FROM redeem_codes WHERE code = ?', code);
      if (!exists) break;
      code = '';
    }
    assert(code, 500, '兑换码生成失败，请重试');
    await run(
      c.env,
      `INSERT INTO redeem_codes (code, amount_cents, status, note, created_by, expires_at, created_at)
       VALUES (?, ?, 'unused', ?, ?, ?, ?)`,
      code,
      amountCents,
      note,
      c.get('admin')?.id ?? null,
      expiresAt || null,
      ts,
    );
    codes.push(code);
  }
  await audit(c, '生成兑换码', `${quantity} 个 · ${centsToYuan(amountCents)} 元/个`);
  return c.json({ ok: true, data: { codes, amount_cents: amountCents, quantity } });
});

admin.put('/redeem-codes/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await one<any>(c.env, 'SELECT * FROM redeem_codes WHERE id = ?', id);
  assert(row, 404, '兑换码不存在');
  assert(row.status !== 'used', 400, '已使用的兑换码不能修改状态');
  const status = String((await c.req.json<any>().catch(() => ({}))).status ?? '');
  assert(['unused', 'disabled'].includes(status), 400, '无效的兑换码状态');
  await run(c.env, 'UPDATE redeem_codes SET status = ? WHERE id = ? AND status != ?', status, id, 'used');
  await audit(c, status === 'disabled' ? '停用兑换码' : '启用兑换码', row.code);
  return c.json({ ok: true });
});

/* ---------------------------- 优惠券 ---------------------------- */

admin.get('/coupons', async (c) => {
  const mid = adminMerchantId(c.get('admin'), c.req.query('merchant_id'));
  const list = await all<any>(
    c.env,
    `SELECT * FROM coupons WHERE 1=1${mid ? ' AND merchant_id = ?' : ''} ORDER BY id DESC LIMIT 200`,
    ...(mid ? [mid] : []),
  );
  return c.json({ ok: true, data: list });
});

admin.post('/coupons', async (c) => {
  const b = await c.req.json<any>();
  const code = String(b.code ?? '').trim().toUpperCase();
  assert(/^[A-Z0-9_-]{2,32}$/.test(code), 400, '优惠码需为 2-32 位字母数字');
  const exists = await one(c.env, 'SELECT id FROM coupons WHERE code = ?', code);
  assert(!exists, 409, '优惠码已存在');
  const mid = adminMerchantId(c.get('admin'), c.req.query('merchant_id'))
    ?? (await getDefaultMerchant(c.env)).id;
  const productIds = Array.isArray(b.product_ids) ? b.product_ids.map((n: any) => toInt(n, 0)).filter(Boolean) : [];
  if (productIds.length) {
    const cnt = Number(await scalar<number>(
      c.env,
      `SELECT COUNT(*) AS c FROM products WHERE id IN (${productIds.map(() => '?').join(',')}) AND merchant_id = ?`,
      ...productIds,
      mid,
    ));
    assert(cnt === productIds.length, 400, '优惠券商品不属于当前店铺');
  }
  await run(
    c.env,
    `INSERT INTO coupons (code, type, value, min_amount_cents, product_ids, max_uses, used_count, per_user_limit,
      starts_at, ends_at, enabled, created_at, merchant_id)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    code,
    ['percent', 'fixed', 'per_item'].includes(b.type) ? b.type : 'fixed',
    toInt(b.value, 0),
    toInt(b.min_amount_cents, 0),
    JSON.stringify(productIds),
    toInt(b.max_uses, 0),
    toInt(b.per_user_limit, 1),
    intOrNull(b.starts_at) ?? 0,
    intOrNull(b.ends_at) ?? 0,
    b.enabled === false ? 0 : 1,
    now(),
    mid,
  );
  await audit(c, '新建优惠券', code);
  return c.json({ ok: true });
});

admin.put('/coupons/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  const exists = await one<any>(c.env, 'SELECT * FROM coupons WHERE id = ?', id);
  assert(exists, 404, '优惠券不存在');
  assertMerchantAccess(c.get('admin'), exists.merchant_id);
  const productIds = Array.isArray(b.product_ids) ? b.product_ids.map((n: any) => toInt(n, 0)).filter(Boolean) : [];
  if (productIds.length) {
    const cnt = Number(await scalar<number>(
      c.env,
      `SELECT COUNT(*) AS c FROM products WHERE id IN (${productIds.map(() => '?').join(',')}) AND merchant_id = ?`,
      ...productIds,
      exists.merchant_id,
    ));
    assert(cnt === productIds.length, 400, '优惠券商品不属于当前店铺');
  }
  await run(
    c.env,
    `UPDATE coupons SET type=?, value=?, min_amount_cents=?, product_ids=?, max_uses=?, per_user_limit=?,
      starts_at=?, ends_at=?, enabled=? WHERE id=?`,
    ['percent', 'fixed', 'per_item'].includes(b.type) ? b.type : 'fixed',
    toInt(b.value, 0),
    toInt(b.min_amount_cents, 0),
    JSON.stringify(productIds),
    toInt(b.max_uses, 0),
    toInt(b.per_user_limit, 1),
    intOrNull(b.starts_at) ?? 0,
    intOrNull(b.ends_at) ?? 0,
    b.enabled === false ? 0 : 1,
    id,
  );
  return c.json({ ok: true });
});

admin.delete('/coupons/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await one<any>(c.env, 'SELECT id, merchant_id FROM coupons WHERE id = ?', id);
  assert(exists, 404, '优惠券不存在');
  assertMerchantAccess(c.get('admin'), exists.merchant_id);
  await run(c.env, 'DELETE FROM coupons WHERE id = ?', id);
  return c.json({ ok: true });
});

/* ---------------------------- 用户 ---------------------------- */

admin.get('/users', async (c) => {
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 20, 100);
  const q = url.searchParams.get('q')?.trim();
  const where = q ? 'WHERE (u.email LIKE ? OR u.invite_code LIKE ?)' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];
  const total = Number(await scalar<number>(c.env, `SELECT COUNT(*) AS c FROM users u ${where}`, ...params));
  const list = await all<any>(
    c.env,
    `SELECT u.id, u.email, u.balance_cents, u.level_id, l.name AS level_name, u.invite_code, u.inviter_id,
            u.total_spent_cents, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
     FROM users u LEFT JOIN levels l ON l.id = u.level_id ${where}
     ORDER BY u.id DESC LIMIT ? OFFSET ?`,
    ...params,
    size,
    offset,
  );
  return c.json({ ok: true, data: { list, ...pageResult([], total, page, size) } });
});

admin.get('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const user = await one<UserRow>(c.env, 'SELECT * FROM users WHERE id = ?', id);
  assert(user, 404, '用户不存在');
  const logs = await all(c.env, 'SELECT * FROM balance_logs WHERE user_id = ? ORDER BY id DESC LIMIT 50', id);
  const orders = await all(c.env, 'SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 20', id);
  return c.json({ ok: true, data: { user, logs, orders } });
});

admin.patch('/users/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const user = await one<UserRow>(c.env, 'SELECT * FROM users WHERE id = ?', id);
  assert(user, 404, '用户不存在');
  const b = await c.req.json<any>();
  if (b.status !== undefined) {
    assert(['active', 'banned'].includes(b.status), 400, '状态不合法');
    await run(c.env, 'UPDATE users SET status = ? WHERE id = ?', b.status, id);
  }
  if (b.level_id !== undefined) {
    await run(c.env, 'UPDATE users SET level_id = ? WHERE id = ?', toInt(b.level_id, 1), id);
  }
  if (b.password !== undefined) {
    const pwd = String(b.password);
    assert(pwd.length >= 8, 400, '密码至少 8 位');
    await run(c.env, 'UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(pwd), id);
  }
  if (b.balance_delta !== undefined && Number(b.balance_delta) !== 0) {
    const delta = toInt(b.balance_delta, 0);
    const fresh = await one<UserRow>(c.env, 'SELECT * FROM users WHERE id = ?', id);
    const newBalance = Math.max(0, fresh!.balance_cents + delta);
    await run(c.env, 'UPDATE users SET balance_cents = ? WHERE id = ?', newBalance, id);
    await run(
      c.env,
      `INSERT INTO balance_logs (user_id, type, amount_cents, balance_after, note, created_at)
       VALUES (?, 'adjust', ?, ?, ?, ?)`,
      id,
      delta,
      newBalance,
      String(b.note ?? '管理员调整').slice(0, 200),
      now(),
    );
  }
  await audit(c, '编辑用户', `${user.email}`);
  return c.json({ ok: true });
});

/* ---------------------------- 会员等级 ---------------------------- */

admin.get('/levels', async (c) => {
  const list = await all(c.env, 'SELECT * FROM levels ORDER BY sort ASC, id ASC');
  return c.json({ ok: true, data: list });
});

admin.post('/levels', async (c) => {
  const b = await c.req.json<any>();
  await run(
    c.env,
    'INSERT INTO levels (name, discount, min_spent_cents, sort) VALUES (?, ?, ?, ?)',
    String(b.name ?? '').slice(0, 30),
    Math.min(100, Math.max(0, toInt(b.discount, 100))),
    toInt(b.min_spent_cents, 0),
    toInt(b.sort, 0),
  );
  return c.json({ ok: true });
});

admin.put('/levels/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  await run(
    c.env,
    'UPDATE levels SET name = ?, discount = ?, min_spent_cents = ?, sort = ? WHERE id = ?',
    String(b.name ?? '').slice(0, 30),
    Math.min(100, Math.max(0, toInt(b.discount, 100))),
    toInt(b.min_spent_cents, 0),
    toInt(b.sort, 0),
    id,
  );
  return c.json({ ok: true });
});

admin.delete('/levels/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const used = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM users WHERE level_id = ?', id));
  assert(used === 0, 400, '仍有用户处于该等级');
  await run(c.env, 'DELETE FROM levels WHERE id = ?', id);
  return c.json({ ok: true });
});

/* ---------------------------- 工单 ---------------------------- */

admin.get('/tickets', async (c) => {
  const url = new URL(c.req.url);
  const status = url.searchParams.get('status');
  const mid = adminMerchantId(c.get('admin'), url.searchParams.get('merchant_id'));
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    where.push('t.status = ?');
    params.push(status);
  }
  if (mid) {
    where.push('t.merchant_id = ?');
    params.push(mid);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const list = await all<any>(
    c.env,
    `SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.sender_type = 'user') AS user_msgs
     FROM tickets t ${whereSql} ORDER BY t.updated_at DESC LIMIT 100`,
    ...params,
  );
  return c.json({ ok: true, data: list });
});

admin.get('/tickets/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await one<any>(c.env, 'SELECT * FROM tickets WHERE id = ?', id);
  assert(t, 404, '工单不存在');
  assertMerchantAccess(c.get('admin'), t.merchant_id);
  const messages = await all(c.env, 'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC', id);
  return c.json({ ok: true, data: { ...t, messages } });
});

admin.post('/tickets/:id/reply', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await one<any>(c.env, 'SELECT * FROM tickets WHERE id = ?', id);
  assert(t, 404, '工单不存在');
  assertMerchantAccess(c.get('admin'), t.merchant_id);
  const b = await c.req.json<any>();
  const content = String(b.content ?? '').trim();
  assert(content, 400, '回复内容不能为空');
  const ts = now();
  await run(
    c.env,
    "INSERT INTO ticket_messages (ticket_id, sender_type, content, created_at) VALUES (?, 'admin', ?, ?)",
    id,
    content.slice(0, 2000),
    ts,
  );
  await run(c.env, "UPDATE tickets SET status = 'waiting', updated_at = ? WHERE id = ?", ts, id);
  if (t.email) {
    const { sendMail, renderTemplate } = await import('../notify');
    const merchant = t.merchant_id ? await getMerchant(c.env, t.merchant_id) : null;
    const siteName = merchant?.name || (await getSite(c.env)).name;
    const mail = await renderTemplate(
      c.env,
      'ticket_reply',
      {
        site_name: siteName,
        ticket_id: String(id),
        subject: t.subject,
        content: escapeHTML(content),
        created_at: new Date(ts).toLocaleString('zh-CN'),
      },
      `[${siteName}] 工单已回复：${t.subject}`,
      `<div style="font-family:sans-serif;padding:24px;color:#111827">
        <h3 style="margin:0 0 8px">客服回复</h3>
        <p style="color:#475569">您的工单「${escapeHTML(t.subject)}」有了新的回复：</p>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;white-space:pre-wrap">${escapeHTML(content)}</div>
      </div>`,
    );
    sendMail(c.env, { to: t.email, subject: mail.subject, html: mail.html, text: content }).catch(() => {});
  }
  await audit(c, '回复工单', `#${id}`);
  return c.json({ ok: true });
});

admin.patch('/tickets/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const t = await one<any>(c.env, 'SELECT id, merchant_id FROM tickets WHERE id = ?', id);
  assert(t, 404, '工单不存在');
  assertMerchantAccess(c.get('admin'), t.merchant_id);
  const b = await c.req.json<any>();
  assert(['open', 'waiting', 'closed'].includes(b.status), 400, '状态不合法');
  await run(c.env, 'UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', b.status, now(), id);
  return c.json({ ok: true });
});

/* ---------------------------- 多商户 ---------------------------- */

const PAID_ORDER_STATUS = "('paid','manual','shipped','delivered')";

export async function merchantWithCounts(env: any, id: number) {
  const m = await getMerchant(env, id);
  if (!m) throw new HttpError(404, '店铺不存在');
  const [productCount, orderCount, revenue, admin] = await Promise.all([
    scalar<number>(env, 'SELECT COUNT(*) AS c FROM products WHERE merchant_id = ?', id),
    scalar<number>(env, 'SELECT COUNT(*) AS c FROM orders WHERE merchant_id = ?', id),
    scalar<number>(env, `SELECT COALESCE(SUM(amount_cents),0) AS c FROM orders WHERE merchant_id = ? AND status IN ${PAID_ORDER_STATUS}`, id),
    one<any>(env, 'SELECT id, username FROM admins WHERE merchant_id = ? ORDER BY id ASC LIMIT 1', id),
  ]);
  return {
    ...publicMerchant(m),
    product_count: Number(productCount),
    order_count: Number(orderCount),
    revenue_cents: Number(revenue),
    admin_username: admin?.username ?? '',
    admin_id: admin?.id ?? null,
    created_at: m.created_at,
  };
}

admin.get('/merchants', async (c) => {
  const list = await listMerchants(c.env);
  const out = [];
  for (const m of list) out.push(await merchantWithCounts(c.env, m.id));
  return c.json({ ok: true, data: out });
});

admin.post('/merchants', async (c) => {
  const b = await c.req.json<any>();
  const name = String(b.name ?? '').trim().slice(0, 60);
  assert(name, 400, '店铺名称不能为空');
  let slug = normalizeSlug(b.slug || name);
  if (!slug) slug = `shop-${Date.now().toString(36)}`;
  assert(validSlug(slug), 400, '店铺标识只能包含小写字母、数字和连字符');
  const domain = normalizeDomain(b.domain);
  assert(validDomain(domain), 400, '绑定域名格式不正确');
  const slugExists = await one(c.env, 'SELECT id FROM merchants WHERE slug = ?', slug);
  assert(!slugExists, 409, '店铺标识已存在');
  if (domain) {
    const domainExists = await one(c.env, 'SELECT id FROM merchants WHERE lower(domain) = ?', domain);
    assert(!domainExists, 409, '该域名已绑定其他店铺');
  }
  const ts = now();
  const res = await run(
    c.env,
    `INSERT INTO merchants (name, slug, domain, description, announcement, contact, footer, logo, logo_image,
      seo_title, seo_description, seo_keywords, status, is_default, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    name,
    slug,
    domain || null,
    String(b.description ?? '').slice(0, 500),
    String(b.announcement ?? '').slice(0, 1000),
    String(b.contact ?? '').slice(0, 200),
    String(b.footer ?? '').slice(0, 300),
    String(b.logo ?? '').slice(0, 20) || name.slice(0, 1),
    String(b.logo_image ?? '').slice(0, 500),
    String(b.seo_title ?? '').slice(0, 120),
    String(b.seo_description ?? '').slice(0, 300),
    String(b.seo_keywords ?? '').slice(0, 200),
    b.status === 'off' ? 'off' : 'on',
    ts,
    ts,
  );
  const id = res.meta.last_row_id as number;

  let adminUsername = String(b.admin_username ?? '').trim() || `${slug}-admin`;
  let adminPassword = String(b.admin_password ?? '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(adminUsername)) adminUsername = `${slug.replace(/-/g, '_')}_admin`.slice(0, 24);
  const userExists = await one(c.env, 'SELECT id FROM admins WHERE username = ?', adminUsername);
  assert(!userExists, 409, `管理员账号 ${adminUsername} 已存在`);
  if (adminPassword && adminPassword.length < 10) throw new HttpError(400, '管理员密码至少 10 位');
  const generated = !adminPassword;
  if (generated) adminPassword = randomString(14);
  await run(
    c.env,
    'INSERT INTO admins (username, password_hash, role, merchant_id, created_at) VALUES (?, ?, ?, ?, ?)',
    adminUsername,
    await hashPassword(adminPassword),
    'merchant',
    id,
    ts,
  );
  await audit(c, '新建店铺', `${name} (${slug})`);
  return c.json({
    ok: true,
    data: {
      ...(await merchantWithCounts(c.env, id)),
      admin_username: adminUsername,
      generated_password: generated ? adminPassword : '',
    },
  });
});

admin.get('/merchants/:id', async (c) => {
  return c.json({ ok: true, data: await merchantWithCounts(c.env, Number(c.req.param('id'))) });
});

admin.put('/merchants/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await getMerchant(c.env, id);
  assert(exists, 404, '店铺不存在');
  const b = await c.req.json<any>();
  const name = String(b.name ?? exists.name).trim().slice(0, 60);
  assert(name, 400, '店铺名称不能为空');
  const slug = normalizeSlug(b.slug ?? exists.slug) || exists.slug;
  assert(validSlug(slug), 400, '店铺标识只能包含小写字母、数字和连字符');
  const slugExists = await one(c.env, 'SELECT id FROM merchants WHERE slug = ? AND id != ?', slug, id);
  assert(!slugExists, 409, '店铺标识已存在');
  const domain = b.domain === undefined ? exists.domain || '' : normalizeDomain(b.domain);
  assert(validDomain(domain), 400, '绑定域名格式不正确');
  if (domain) {
    const domainExists = await one(c.env, 'SELECT id FROM merchants WHERE lower(domain) = ? AND id != ?', domain, id);
    assert(!domainExists, 409, '该域名已绑定其他店铺');
  }
  await run(
    c.env,
    `UPDATE merchants SET name=?, slug=?, domain=?, description=?, announcement=?, contact=?, footer=?,
      logo=?, logo_image=?, seo_title=?, seo_description=?, seo_keywords=?, status=?, updated_at=? WHERE id=?`,
    name,
    slug,
    domain || null,
    String(b.description ?? exists.description).slice(0, 500),
    String(b.announcement ?? exists.announcement).slice(0, 1000),
    String(b.contact ?? exists.contact).slice(0, 200),
    String(b.footer ?? exists.footer).slice(0, 300),
    String(b.logo ?? exists.logo).slice(0, 20),
    String(b.logo_image ?? exists.logo_image).slice(0, 500),
    String(b.seo_title ?? exists.seo_title).slice(0, 120),
    String(b.seo_description ?? exists.seo_description).slice(0, 300),
    String(b.seo_keywords ?? exists.seo_keywords).slice(0, 200),
    b.status === 'off' ? 'off' : 'on',
    now(),
    id,
  );
  if (b.admin_password) {
    const pw = String(b.admin_password);
    assert(pw.length >= 10, 400, '管理员密码至少 10 位');
    const adminRow = await one<any>(c.env, 'SELECT id FROM admins WHERE merchant_id = ? ORDER BY id ASC LIMIT 1', id);
    if (adminRow) {
      await run(c.env, 'UPDATE admins SET password_hash = ? WHERE id = ?', await hashPassword(pw), adminRow.id);
    } else {
      const username = String(b.admin_username ?? `${slug}-admin`).trim();
      assert(/^[a-zA-Z0-9_]{3,24}$/.test(username), 400, '管理员账号需为 3-24 位字母数字下划线');
      const userExists = await one(c.env, 'SELECT id FROM admins WHERE username = ?', username);
      assert(!userExists, 409, `管理员账号 ${username} 已存在`);
      await run(
        c.env,
        'INSERT INTO admins (username, password_hash, role, merchant_id, created_at) VALUES (?, ?, ?, ?, ?)',
        username,
        await hashPassword(pw),
        'merchant',
        id,
        now(),
      );
    }
  }
  await audit(c, '编辑店铺', `${name} (${slug})`);
  return c.json({ ok: true, data: await merchantWithCounts(c.env, id) });
});

admin.post('/merchants/:id/admin', async (c) => {
  const id = Number(c.req.param('id'));
  const merchant = await assertMerchantExists(c.env, id);
  const b = await c.req.json<any>();
  const username = String(b.username ?? '').trim();
  assert(/^[a-zA-Z0-9_]{3,24}$/.test(username), 400, '管理员账号需为 3-24 位字母数字下划线');
  const existing = await one<any>(c.env, 'SELECT id FROM admins WHERE username = ?', username);
  const merchantAdmin = await one<any>(c.env, 'SELECT id FROM admins WHERE merchant_id = ? ORDER BY id ASC LIMIT 1', id);
  if (existing && existing.id !== merchantAdmin?.id) throw new HttpError(409, '管理员账号已存在');
  let password = String(b.password ?? '');
  const generated = !password;
  if (generated) password = randomString(14);
  assert(password.length >= 10, 400, '密码至少 10 位');
  if (merchantAdmin) {
    await run(
      c.env,
      'UPDATE admins SET username = ?, password_hash = ?, role = ?, merchant_id = ? WHERE id = ?',
      username,
      await hashPassword(password),
      'merchant',
      id,
      merchantAdmin.id,
    );
  } else {
    await run(
      c.env,
      'INSERT INTO admins (username, password_hash, role, merchant_id, created_at) VALUES (?, ?, ?, ?, ?)',
      username,
      await hashPassword(password),
      'merchant',
      id,
      now(),
    );
  }
  await audit(c, '设置店铺管理员', `${merchant.name} (${username})`);
  return c.json({ ok: true, data: { admin_username: username, generated_password: generated ? password : '' } });
});

admin.delete('/merchants/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const merchant = await assertMerchantExists(c.env, id);
  assert(!merchant.is_default, 400, '默认店铺不可删除');
  const [products, orders, coupons, tickets] = await Promise.all([
    scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM products WHERE merchant_id = ?', id),
    scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM orders WHERE merchant_id = ?', id),
    scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM coupons WHERE merchant_id = ?', id),
    scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM tickets WHERE merchant_id = ?', id),
  ]);
  assert(
    !Number(products) && !Number(orders) && !Number(coupons) && !Number(tickets),
    400,
    '该店铺已有业务数据，请先下架商品并保留订单，或仅停用店铺',
  );
  await run(c.env, 'DELETE FROM admins WHERE merchant_id = ?', id);
  await run(c.env, 'DELETE FROM merchants WHERE id = ?', id);
  await audit(c, '删除店铺', merchant.name);
  return c.json({ ok: true });
});

/** 商户管理员维护自己的店铺资料（不含域名/标识） */
admin.get('/merchant/profile', async (c) => {
  const a = c.get('admin');
  const m = await assertMerchantExists(c.env, a.merchant_id);
  return c.json({ ok: true, data: publicMerchant(m) });
});

admin.put('/merchant/profile', async (c) => {
  const a = c.get('admin');
  const m = await assertMerchantExists(c.env, a.merchant_id);
  const b = await c.req.json<any>();
  const name = String(b.name ?? m.name).trim().slice(0, 60);
  assert(name, 400, '店铺名称不能为空');
  await run(
    c.env,
    `UPDATE merchants SET name=?, description=?, announcement=?, contact=?, footer=?, logo=?, logo_image=?,
      seo_title=?, seo_description=?, seo_keywords=?, updated_at=? WHERE id=?`,
    name,
    String(b.description ?? m.description).slice(0, 500),
    String(b.announcement ?? m.announcement).slice(0, 1000),
    String(b.contact ?? m.contact).slice(0, 200),
    String(b.footer ?? m.footer).slice(0, 300),
    String(b.logo ?? m.logo).slice(0, 20),
    String(b.logo_image ?? m.logo_image).slice(0, 500),
    String(b.seo_title ?? m.seo_title).slice(0, 120),
    String(b.seo_description ?? m.seo_description).slice(0, 300),
    String(b.seo_keywords ?? m.seo_keywords).slice(0, 200),
    now(),
    m.id,
  );
  await audit(c, '更新店铺资料', name);
  return c.json({ ok: true, data: publicMerchant(await assertMerchantExists(c.env, m.id)) });
});

/* ---------------------------- 设置 ---------------------------- */

const SECRET_FIELDS: Record<string, string[]> = {
  security: ['turnstile.secret_key'],
  payment: ['epay.key', 'alipay.private_key', 'usdt.app_secret', 'stripe.secret_key', 'stripe.webhook_secret', 'paypal.client_secret', 'hashpay.api_key', 'hashpay.signing_secret'],
  notify: ['email.password', 'telegram.bot_token'],
};
const SECRET_MASK = '••••••••';

function getPath(obj: any, path: string): any {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
function setPath(obj: any, path: string, value: any) {
  const keys = path.split('.');
  const last = keys.pop()!;
  let cur = obj;
  for (const k of keys) {
    if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k];
  }
  cur[last] = value;
}
function maskSecrets(section: string, data: any) {
  const copy = JSON.parse(JSON.stringify(data ?? {}));
  for (const path of SECRET_FIELDS[section] || []) {
    if (getPath(copy, path)) setPath(copy, path, SECRET_MASK);
  }
  return copy;
}
function mergeKeepingSecrets(section: string, current: any, incoming: any) {
  const out = { ...current, ...(incoming || {}) };
  for (const path of SECRET_FIELDS[section] || []) {
    const next = getPath(incoming, path);
    if (next === undefined || next === '' || next === SECRET_MASK) {
      setPath(out, path, getPath(current, path));
    }
  }
  return out;
}

admin.get('/settings', async (c) => {
  const [site, payment, notify, commission, security] = await Promise.all([
    getSite(c.env),
    getPayment(c.env),
    getNotify(c.env),
    getCommission(c.env),
    getSecurity(c.env),
  ]);
  return c.json({
    ok: true,
    data: {
      site,
      payment: maskSecrets('payment', payment),
      notify: maskSecrets('notify', notify),
      commission,
      security: maskSecrets('security', security),
    },
  });
});

admin.put('/settings', async (c) => {
  const b = await c.req.json<any>();
  const section = String(b.section ?? '');
  assert(['site', 'payment', 'notify', 'commission', 'security'].includes(section), 400, '未知的配置分组');
  if (section === 'site') {
    const cur = await getSite(c.env);
    const next = { ...cur, ...(b.data || {}) };
    next.order_expire_minutes = Math.min(1440, Math.max(1, toInt(next.order_expire_minutes, 30)));
    next.min_amount_cents = Math.max(0, toInt(next.min_amount_cents, 0));
    next.stock_alert = Math.max(0, toInt(next.stock_alert, 5));
    next.maintenance = !!next.maintenance;
    next.allow_register = !!next.allow_register;
    await setSetting(c.env, 'site', next);
  } else if (section === 'payment') {
    const cur = await getPayment(c.env);
    await setSetting(c.env, 'payment', mergeKeepingSecrets('payment', cur, b.data || {}));
  } else if (section === 'notify') {
    const cur = await getNotify(c.env);
    await setSetting(c.env, 'notify', mergeKeepingSecrets('notify', cur, b.data || {}));
  } else if (section === 'commission') {
    const data = b.data || {};
    await setSetting(c.env, 'commission', {
      enabled: !!data.enabled,
      levels: Array.isArray(data.levels) ? data.levels.slice(0, 3).map((n: any) => Number(n) || 0) : [10, 5, 2],
    });
  } else if (section === 'security') {
    const cur = await getSecurity(c.env);
    const next = mergeKeepingSecrets('security', cur, b.data || {});
    next.turnstile = {
      enabled: !!(b.data?.turnstile?.enabled),
      site_key: String(b.data?.turnstile?.site_key ?? '').trim(),
      secret_key: String(next.turnstile?.secret_key ?? cur.turnstile.secret_key ?? '').trim(),
    };
    assert(
      !next.turnstile.enabled || (next.turnstile.site_key && next.turnstile.secret_key),
      400,
      '启用 Turnstile 前必须填写 Site Key 和 Secret Key',
    );
    await setSetting(c.env, 'security', next);
  }
  await audit(c, '修改设置', section);
  return c.json({ ok: true });
});

admin.post('/settings/test-mail', async (c) => {
  const b = await c.req.json<any>();
  const to = String(b.to ?? '').trim();
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to), 400, '邮箱格式不正确');
  await sendTest(c.env, to);
  return c.json({ ok: true });
});

admin.get('/suppliers', async (c) => {
  const list = await all<any>(
    c.env,
    `SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id) AS product_count
     FROM suppliers s ORDER BY s.id DESC`,
  );
  return c.json({
    ok: true,
    data: list.map((s) => ({
      ...s,
      api_key: s.api_key ? `${s.api_key.slice(0, 4)}••••••••` : '',
    })),
  });
});

admin.post('/suppliers', async (c) => {
  const b = await c.req.json<any>();
  const name = String(b.name ?? '').trim();
  const apiUrl = String(b.api_url ?? '').trim();
  assert(name && apiUrl, 400, '请填写供应商名称与接口地址');
  assert(/^https?:\/\//.test(apiUrl), 400, '接口地址必须是 http(s)://');
  const ts = now();
  const res = await run(
    c.env,
    `INSERT INTO suppliers (name, api_url, api_key, balance_cents, enabled, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    name, apiUrl, String(b.api_key ?? '').slice(0, 200), Math.max(0, toInt(b.balance_cents, 0)),
    b.enabled === false ? 0 : 1, String(b.note ?? '').slice(0, 500), ts, ts,
  );
  await audit(c, '新建供应商', name);
  return c.json({ ok: true, data: { id: res.meta.last_row_id } });
});

admin.put('/suppliers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const exists = await one<any>(c.env, 'SELECT * FROM suppliers WHERE id = ?', id);
  assert(exists, 404, '供应商不存在');
  const b = await c.req.json<any>();
  const name = String(b.name ?? exists.name).trim();
  const apiUrl = String(b.api_url ?? exists.api_url).trim();
  assert(/^https?:\/\//.test(apiUrl), 400, '接口地址必须是 http(s)://');
  // 掩码不覆盖真实密钥
  const apiKey = b.api_key && !b.api_key.includes('••') ? String(b.api_key).slice(0, 200) : exists.api_key;
  await run(
    c.env,
    `UPDATE suppliers SET name=?, api_url=?, api_key=?, balance_cents=?, enabled=?, note=?, updated_at=? WHERE id=?`,
    name, apiUrl, apiKey, Math.max(0, toInt(b.balance_cents, exists.balance_cents)),
    b.enabled === false ? 0 : 1, String(b.note ?? exists.note ?? '').slice(0, 500), now(), id,
  );
  await audit(c, '编辑供应商', name);
  return c.json({ ok: true });
});

admin.delete('/suppliers/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const used = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM products WHERE supplier_id = ?', id));
  assert(used === 0, 400, '仍有商品关联该供应商，请先解除绑定');
  await run(c.env, 'DELETE FROM suppliers WHERE id = ?', id);
  await audit(c, '删除供应商', `#${id}`);
  return c.json({ ok: true });
});

admin.post('/suppliers/:id/test', async (c) => {
  const id = Number(c.req.param('id'));
  const sup = await one<any>(c.env, 'SELECT * FROM suppliers WHERE id = ?', id);
  assert(sup, 404, '供应商不存在');
  const ts = Math.floor(Date.now() / 1000);
  const started = Date.now();
  try {
    const res = await fetch(sup.api_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': sup.api_key, 'X-Timestamp': String(ts) },
      body: JSON.stringify({ action: 'ping', timestamp: ts }),
    });
    const text = await res.text();
    return c.json({ ok: res.ok, data: { status: res.status, latency_ms: Date.now() - started, body: text.slice(0, 300) } });
  } catch (e) {
    return c.json({ ok: false, data: { latency_ms: Date.now() - started, body: String(e) } });
  }
});

admin.get('/suppliers/logs', async (c) => {
  const list = await all<any>(
    c.env,
    `SELECT so.*, s.name AS supplier_name, oi.product_name FROM supplier_orders so
     LEFT JOIN suppliers s ON s.id = so.supplier_id
     LEFT JOIN order_items oi ON oi.id = so.order_item_id
     ORDER BY so.id DESC LIMIT 100`,
  );
  return c.json({ ok: true, data: list });
});

admin.get('/templates', async (c) => {
  const notify = await getNotify(c.env);
  return c.json({ ok: true, data: notify.templates });
});

admin.put('/templates', async (c) => {
  const b = await c.req.json<any>();
  const key = String(b.key ?? '');
  assert(['order_paid', 'ticket_reply', 'password_reset'].includes(key), 400, '未知的模板');
  const subject = String(b.subject ?? '').slice(0, 200);
  const html = String(b.html ?? '').slice(0, 60000);
  const notify = await getNotify(c.env);
  await setSetting(c.env, 'notify', {
    ...notify,
    templates: { ...(notify.templates as any), [key]: { subject, html } },
  });
  await audit(c, '修改邮件模板', key);
  return c.json({ ok: true });
});

admin.post('/templates/test', async (c) => {
  const b = await c.req.json<any>();
  const key = String(b.key ?? 'order_paid');
  const to = String(b.to ?? '').trim();
  assert(['order_paid', 'ticket_reply', 'password_reset'].includes(key), 400, '未知的模板');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to), 400, '邮箱格式不正确');
  const site = await getSite(c.env);
  const samples: Record<string, Record<string, string>> = {
    order_paid: {
      site_name: site.name, order_no: 'FK20261126001', amount: '¥19.90', email: to,
      created_at: new Date().toLocaleString('zh-CN'),
      items: '<tr><td style="padding:10px;border-bottom:1px solid #eee">Netflix 高级会员 · 月卡</td><td style="padding:10px;text-align:center">1</td><td style="padding:10px;text-align:right">¥19.90</td></tr>',
      cards: '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:monospace">demo@example.com----Abc123456</div>',
    },
    ticket_reply: {
      site_name: site.name, ticket_id: '1024', subject: '购买的卡密无法登录',
      content: '您好，已为您重新补发，请查看订单页。', created_at: new Date().toLocaleString('zh-CN'),
    },
    password_reset: {
      site_name: site.name, email: to, link: `${new URL(c.req.url).origin}/reset?token=demo`, expire_minutes: '30',
    },
  };
  const fallback: Record<string, string> = {
    order_paid: `订单支付成功`, ticket_reply: `工单已回复`, password_reset: `密码重置链接`,
  };
  const mail = await renderTemplate(c.env, key as any, samples[key], fallback[key], '<p>邮件模板测试</p>');
  await sendMail(c.env, { to, subject: mail.subject, html: mail.html, text: '模板测试' });
  await audit(c, '测试邮件模板', key);
  return c.json({ ok: true });
});

admin.get('/logs/notify', async (c) => {
  const list = await all(c.env, 'SELECT * FROM notify_logs ORDER BY id DESC LIMIT 100');
  return c.json({ ok: true, data: list });
});

admin.get('/logs/audit', async (c) => {
  const list = await all(c.env, 'SELECT * FROM audit_logs ORDER BY id DESC LIMIT 150');
  return c.json({ ok: true, data: list });
});
