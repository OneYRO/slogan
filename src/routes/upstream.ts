import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { all, batch, one, run } from '../db';
import { getSecurity } from '../settings';
import { hmacSha256 } from '../suppliers';
import { HttpError, clientIP, now, randomString, safeEqual } from '../util';

export const upstream = new Hono<AppEnv>();

/**
 * Slogan 上游供应商 API。
 * 另一个 Slogan 站点在后台「上游供应商」里填写本站地址 + API Key 后即可采购。
 * POST /api/upstream
 */
upstream.post('/', async (c) => {
  const security = await getSecurity(c.env);
  const cfg = security.upstream;
  if (!cfg?.enabled) throw new HttpError(403, '本站未启用上游供货接口');
  if (!cfg.api_key) throw new HttpError(503, '上游接口尚未配置 API Key');

  const apiKey = c.req.header('x-api-key') || '';
  if (!apiKey || !safeEqual(apiKey, cfg.api_key)) throw new HttpError(401, 'API Key 无效');

  const body = await c.req.json<any>().catch(() => ({}));
  const tsHeader = Number(c.req.header('x-timestamp') || body?.timestamp || 0);
  const tsNow = Math.floor(now() / 1000);
  if (!Number.isInteger(tsHeader) || Math.abs(tsNow - tsHeader) > 300) {
    throw new HttpError(401, '请求时间戳无效或已过期');
  }

  const action = String(body.action || '');
  if (action === 'ping') {
    return c.json({ ok: true, data: { name: 'Slogan', time: now() } });
  }
  if (action !== 'purchase') throw new HttpError(400, '不支持的 action');

  const orderNo = String(body.order_no || '').trim().slice(0, 80);
  const goodsId = String(body.goods_id || '').trim().slice(0, 80);
  const qty = Number(body.qty || 0);
  const email = String(body.email || '').trim().slice(0, 120);
  if (!orderNo || !goodsId || !Number.isInteger(qty) || qty < 1 || qty > 200) {
    throw new HttpError(400, '采购参数不完整或数量无效');
  }

  const sign = c.req.header('x-sign') || '';
  const expected = await hmacSha256(cfg.api_key, `${orderNo}|${goodsId}|${qty}|${tsHeader}`);
  if (!sign || !safeEqual(sign, expected)) throw new HttpError(401, '签名错误');

  const parts = goodsId.split(':');
  const productId = Number(parts[0]);
  const skuId = parts[1] ? Number(parts[1]) : 0;
  if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(skuId) || skuId < 0) {
    throw new HttpError(400, 'goods_id 无效，应使用 商品ID 或 商品ID:SKU_ID');
  }

  const product = await one<any>(
    c.env,
    `SELECT id, name, price_cents, delivery_mode, status FROM products WHERE id = ? AND status = 'on'`,
    productId,
  );
  if (!product) throw new HttpError(404, '上游商品不存在或已下架');
  if (product.delivery_mode !== 'auto') throw new HttpError(400, '该商品不是自动卡密商品，不能作为上游供货');

  const sku = skuId
    ? await one<any>(
        c.env,
        'SELECT id, name, price_cents, enabled FROM skus WHERE id = ? AND product_id = ?',
        skuId,
        productId,
      )
    : null;
  if (skuId && (!sku || !sku.enabled)) throw new HttpError(400, '上游 SKU 不存在或已停用');
  if (!skuId) {
    const enabledSkus = Number(await one<any>(
      c.env,
      'SELECT COUNT(*) AS c FROM skus WHERE product_id = ? AND enabled = 1',
      productId,
    ).then((r: any) => r?.c ?? 0));
    if (enabledSkus > 0) throw new HttpError(400, '该商品有多个规格，请使用 商品ID:SKU_ID 采购');
  }

  // 同一买家订单 + 同一商品重复请求时幂等返回，避免卡密被重复扣减
  const previous = await one<any>(
    c.env,
    `SELECT order_no, cost_cents, cards_json FROM upstream_orders
     WHERE remote_order_no = ? AND goods_id = ? AND status = 'success' AND cards_json IS NOT NULL
     ORDER BY id DESC LIMIT 1`,
    orderNo,
    goodsId,
  );
  if (previous) {
    const cards = JSON.parse(previous.cards_json || '[]');
    const payload = {
      cards,
      cost_cents: Number(previous.cost_cents || 0),
      order_no: previous.order_no,
      product_id: productId,
      sku_id: skuId || null,
      qty,
    };
    return c.json({ ok: true, ...payload, data: payload });
  }

  const available = await one<any>(
    c.env,
    `SELECT COUNT(*) AS c FROM cards
     WHERE product_id = ? AND COALESCE(sku_id, 0) = ? AND status = 'unused'`,
    productId,
    skuId,
  );
  const availableCount = Number(available?.c || 0);
  if (availableCount < qty) throw new HttpError(409, `上游库存不足（可用 ${availableCount} 张）`);

  const selected = await all<{ id: number; content: string }>(
    c.env,
    `SELECT id, content FROM cards
     WHERE product_id = ? AND COALESCE(sku_id, 0) = ? AND status = 'unused'
     ORDER BY id LIMIT ?`,
    productId,
    skuId,
    qty,
  );

  const ts = now();
  const sold: string[] = [];
  const claimedIds: number[] = [];
  const results = await batch(
    c.env,
    selected.map((card) =>
      c.env.DB.prepare(
        `UPDATE cards SET status = 'sold', sold_at = ? WHERE id = ? AND status = 'unused'`,
      ).bind(ts, card.id),
    ),
  );
  for (let i = 0; i < selected.length; i++) {
    if ((results[i]?.meta?.changes ?? 0) === 1) {
      claimedIds.push(selected[i].id);
      sold.push(selected[i].content);
    }
  }
  if (claimedIds.length !== qty) {
    // 并发下只抢到部分卡：释放本次占用的卡，避免库存被吞
    if (claimedIds.length) {
      await batch(
        c.env,
        claimedIds.map((id) =>
          c.env.DB.prepare(`UPDATE cards SET status = 'unused', sold_at = NULL WHERE id = ? AND status = 'sold'`).bind(id),
        ),
      );
    }
    throw new HttpError(409, '上游库存不足或正在被其他订单占用，请稍后重试');
  }

  const unitPriceCents = Number(sku?.price_cents ?? product.price_cents ?? 0) || 0;
  const costCents = unitPriceCents * qty;
  const providerOrderNo = `UP${ts}${randomString(4)}`;
  await run(
    c.env,
    `INSERT INTO upstream_orders
      (order_no, remote_order_no, goods_id, product_id, sku_id, qty, unit_price_cents, cost_cents, email, ip, status, cards_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?, ?)`,
    providerOrderNo,
    orderNo,
    goodsId,
    productId,
    skuId || null,
    qty,
    unitPriceCents,
    costCents,
    email,
    clientIP(c.req.raw),
    JSON.stringify(sold),
    ts,
  );

  const payload = {
    cards: sold,
    cost_cents: costCents,
    order_no: providerOrderNo,
    product_id: productId,
    sku_id: skuId || null,
    qty,
  };
  return c.json({ ok: true, ...payload, data: payload });
});
