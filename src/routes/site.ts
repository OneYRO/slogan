import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { optionalUser } from '../auth';
import { all, one, scalar } from '../db';
import { calcUnit, levelDiscountOf, parseTiers } from '../orders';
import { availableChannels } from '../payments';
import { HttpError, dayStart, maskCard, now, pageResult, pager, parseJSON, toInt } from '../util';
import { merchantSiteConfig, publicMerchant, resolveMerchant } from '../merchants';
import { getSecurity } from '../settings';
import type { Category, Product, Sku } from '../types';

export const site = new Hono<AppEnv>();

site.use('*', optionalUser);

/** 站点配置 + 分类 + 支付方式 */
site.get('/site', async (c) => {
  const merchant = await resolveMerchant(c.env, c.req.raw);
  const cfg = await merchantSiteConfig(c.env, merchant);
  const security = await getSecurity(c.env);
  const publicCfg = {
    ...cfg,
    turnstile_enabled: !!security.turnstile.enabled,
    turnstile_site_key: security.turnstile.site_key,
  };
  const categories = await all<Category>(
    c.env,
    'SELECT * FROM categories WHERE enabled = 1 AND merchant_id = ? ORDER BY sort ASC, id ASC',
    merchant.id,
  );
  const channels = await availableChannels(c.env, !!c.get('user'));

  // 首页展示用的真实数据（不暴露邮箱等敏感信息）
  const paidStatus = "('paid','manual','shipped','delivered')";
  const start = dayStart(now());
  const [todayOrders, totalOrders, productCount] = await Promise.all([
    scalar<number>(c.env, `SELECT COUNT(*) AS c FROM orders WHERE created_at >= ? AND status IN ${paidStatus} AND merchant_id = ?`, start, merchant.id),
    scalar<number>(c.env, `SELECT COUNT(*) AS c FROM orders WHERE status IN ${paidStatus} AND merchant_id = ?`, merchant.id),
    scalar<number>(c.env, "SELECT COUNT(*) AS c FROM products WHERE status = 'on' AND merchant_id = ?", merchant.id),
  ]);
  const recentSales = await all<any>(
    c.env,
    `SELECT oi.product_name, o.paid_at FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE o.paid_at IS NOT NULL AND o.status IN ${paidStatus} AND o.merchant_id = ?
     ORDER BY o.paid_at DESC LIMIT 5`,
    merchant.id,
  );
  return c.json({
    ok: true,
    data: {
      site: publicCfg,
      merchant: publicMerchant(merchant),
      categories,
      channels,
      stats: {
        today_orders: Number(todayOrders),
        total_orders: Number(totalOrders),
        product_count: Number(productCount),
      },
      recent_sales: recentSales.map((r) => ({ name: r.product_name, paid_at: r.paid_at })),
      server_time: now(),
    },
  });
});

site.get('/categories', async (c) => {
  const merchant = await resolveMerchant(c.env, c.req.raw);
  const list = await all<Category>(
    c.env,
    'SELECT * FROM categories WHERE enabled = 1 AND merchant_id = ? ORDER BY sort ASC, id ASC',
    merchant.id,
  );
  return c.json({ ok: true, data: list });
});

export function seckillInfo(p: Product) {
  const ts = now();
  if (
    p.seckill_price_cents == null ||
    p.seckill_starts_at == null ||
    p.seckill_ends_at == null ||
    ts < p.seckill_starts_at ||
    ts > p.seckill_ends_at
  ) {
    return null;
  }
  return {
    price_cents: p.seckill_price_cents,
    starts_at: p.seckill_starts_at,
    ends_at: p.seckill_ends_at,
  };
}

export function serializeProduct(p: any, opts: { detail?: boolean } = {}) {
  const stock = p.delivery_mode === 'auto'
    ? Number(p.card_count ?? 0)
    : p.delivery_mode === 'fixed'
      ? 999999
      : Number(p.stock ?? 0);
  return {
    id: p.id,
    category_id: p.category_id,
    name: p.name,
    slug: p.slug,
    description: opts.detail ? p.description : String(p.description ?? '').replace(/<[^>]+>/g, '').slice(0, 120),
    images: parseJSON<string[]>(p.images, []),
    delivery_mode: p.delivery_mode,
    price_cents: p.price_cents,
    member_price_cents: p.member_price_cents,
    stock,
    stock_text: p.delivery_mode === 'auto' ? `${stock} 件` : p.delivery_mode === 'fixed' ? '不限' : `${stock} 件`,
    min_qty: p.min_qty,
    max_qty: p.max_qty,
    pick_enabled: !!p.pick_enabled,
    pick_fee_cents: p.pick_fee_cents,
    sales_count: p.sales_count,
    is_recommend: !!p.is_recommend,
    seckill: seckillInfo(p),
  };
}

site.get('/products', async (c) => {
  const url = new URL(c.req.url);
  const merchant = await resolveMerchant(c.env, c.req.raw);
  const { page, size, offset } = pager(url, 24, 60);
  const category = url.searchParams.get('category');
  const q = url.searchParams.get('q')?.trim();
  const recommend = url.searchParams.get('recommend') === '1';

  const where: string[] = ["p.status = 'on'", 'p.merchant_id = ?'];
  const params: unknown[] = [merchant.id];
  if (category) {
    const cat = await one<Category>(
      c.env,
      'SELECT * FROM categories WHERE (slug = ? OR id = ?) AND merchant_id = ?',
      category,
      toInt(category, 0),
      merchant.id,
    );
    if (cat) {
      where.push('p.category_id = ?');
      params.push(cat.id);
    }
  }
  if (q) {
    where.push('(p.name LIKE ? OR p.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (recommend) where.push('p.is_recommend = 1');

  const whereSql = where.join(' AND ');
  const total = Number(
    await scalar<number>(
      c.env,
      `SELECT COUNT(*) AS c FROM products p WHERE ${whereSql}`,
      ...params,
    ),
  );
  const rows = await all<any>(
    c.env,
    `SELECT p.*, (SELECT COUNT(*) FROM cards c WHERE c.product_id = p.id AND c.status = 'unused') AS card_count
     FROM products p WHERE ${whereSql}
     ORDER BY p.is_recommend DESC, p.sort DESC, p.id DESC
     LIMIT ? OFFSET ?`,
    ...params,
    size,
    offset,
  );
  return c.json({
    ok: true,
    data: { list: rows.map((r) => serializeProduct(r)), ...pageResult([], total, page, size), page, size },
  });
});

site.get('/products/:id', async (c) => {
  const id = toInt(c.req.param('id'), 0);
  const merchant = await resolveMerchant(c.env, c.req.raw);
  const p = await one<any>(
    c.env,
    `SELECT p.*, (SELECT COUNT(*) FROM cards c WHERE c.product_id = p.id AND c.status = 'unused') AS card_count
     FROM products p WHERE p.id = ? AND p.status = 'on' AND p.merchant_id = ?`,
    id,
    merchant.id,
  );
  if (!p) throw new HttpError(404, '商品不存在或已下架');

  const skus = await all<Sku>(
    c.env,
    'SELECT * FROM skus WHERE product_id = ? AND enabled = 1 ORDER BY sort ASC, id ASC',
    id,
  );
  const category = p.category_id
    ? await one<Category>(c.env, 'SELECT * FROM categories WHERE id = ?', p.category_id)
    : null;

  const user = c.get('user');
  const levelDiscount = await levelDiscountOf(c.env, user ?? null);
  const tiers = parseTiers(p.wholesale_tiers);
  const basePrice = calcUnit(p as Product, null, 1, {
    loggedIn: !!user,
    levelDiscount,
    picked: false,
  });

  let pickCards: { id: number; content: string }[] = [];
  if (p.pick_enabled && p.delivery_mode === 'auto') {
    pickCards = await all<{ id: number; content: string }>(
      c.env,
      `SELECT id, content FROM cards WHERE product_id = ? AND status = 'unused' ORDER BY id ASC LIMIT 200`,
      id,
    );
  }

  return c.json({
    ok: true,
    data: {
      ...serializeProduct(p, { detail: true }),
      description_html: p.description,
      content: null,
      skus: skus.map((s) => ({
        ...s,
        price_cents: s.price_cents ?? p.price_cents,
        stock: Number(
          p.delivery_mode === 'auto'
            ? 0
            : 0,
        ),
      })),
      sku_stock: p.delivery_mode === 'auto'
        ? Object.fromEntries(
            (await all<{ sku_id: number | null; c: number }>(
              c.env,
              `SELECT sku_id, COUNT(*) AS c FROM cards WHERE product_id = ? AND status = 'unused' GROUP BY sku_id`,
              id,
            )).map((r) => [r.sku_id ?? 0, r.c]),
          )
        : null,
      tiers,
      category,
      price_preview: basePrice,
      pick_cards: pickCards.map((card) => ({ id: card.id, content: maskCard(card.content) })),
    },
  });
});

/** 秒杀专区 */
site.get('/seckill', async (c) => {
  const ts = now();
  const merchant = await resolveMerchant(c.env, c.req.raw);
  const rows = await all<any>(
    c.env,
    `SELECT p.*, (SELECT COUNT(*) FROM cards c WHERE c.product_id = p.id AND c.status = 'unused') AS card_count
     FROM products p
     WHERE p.status = 'on' AND p.merchant_id = ? AND p.seckill_price_cents IS NOT NULL
       AND p.seckill_starts_at IS NOT NULL AND p.seckill_ends_at IS NOT NULL
       AND p.seckill_starts_at <= ? AND p.seckill_ends_at >= ?
     ORDER BY p.seckill_ends_at ASC LIMIT 20`,
    merchant.id,
    ts,
    ts,
  );
  return c.json({ ok: true, data: rows.map((r) => serializeProduct(r)) });
});

/** 校验优惠券 */
site.post('/coupons/check', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  const code = String(body.code ?? '').trim();
  const subtotal = toInt(body.subtotal, 0);
  const productIds = Array.isArray(body.product_ids) ? body.product_ids.map((n: any) => toInt(n, 0)) : [];
  if (!code) throw new HttpError(400, '请输入优惠券码');
  const merchant = await resolveMerchant(c.env, c.req.raw);
  const { validateCoupon } = await import('../orders');
  const result = await validateCoupon(c.env, code, subtotal, body.email ?? null, c.get('user')?.id ?? null, productIds, merchant.id);
  if (!result) throw new HttpError(400, '优惠券不可用');
  return c.json({ ok: true, data: result });
});

/** 订单查询（游客：订单号 + 邮箱） */
site.get('/order-lookup', async (c) => {
  const url = new URL(c.req.url);
  const orderNo = String(url.searchParams.get('order_no') ?? '').trim();
  const email = String(url.searchParams.get('email') ?? '').trim().toLowerCase();
  if (!orderNo || !email) throw new HttpError(400, '请填写订单号和下单邮箱');
  const order = await one<any>(
    c.env,
    'SELECT id, order_no, token, email, status, amount_cents, created_at FROM orders WHERE order_no = ? AND lower(email) = ?',
    orderNo,
    email,
  );
  if (!order) throw new HttpError(404, '未找到该订单，请核对订单号与邮箱');
  const items = await all<any>(c.env, 'SELECT * FROM order_items WHERE order_id = ?', order.id);
  return c.json({
    ok: true,
    data: {
      order_no: order.order_no,
      token: order.token,
      status: order.status,
      amount_cents: order.amount_cents,
      created_at: order.created_at,
      items: items.map((it) => ({
        product_name: it.product_name,
        sku_name: it.sku_name,
        qty: it.qty,
        amount_cents: it.amount_cents,
        delivery_mode: it.delivery_mode,
        delivered: parseJSON<string[] | null>(it.delivered, null),
      })),
    },
  });
});
