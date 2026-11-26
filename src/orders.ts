import type { CardRow, Env, Level, OrderItem, OrderRow, Product, Sku, UserRow } from './types';
import { all, one, run, scalar, batch } from './db';
import { getCommission, getSite } from './settings';
import { purchaseFromSupplier } from './suppliers';
import {
  HttpError,
  assert,
  clamp,
  genOrderNo,
  genOrderToken,
  intOrNull,
  now,
  parseJSON,
  toInt,
} from './util';

/* ------------------------------------------------------------------ */
/* 价格计算                                                            */
/* ------------------------------------------------------------------ */

export interface Tier {
  min_qty: number;
  price_cents: number;
}

export function parseTiers(raw: unknown): Tier[] {
  const arr = parseJSON<any[]>(raw, []);
  return (Array.isArray(arr) ? arr : [])
    .map((t) => ({ min_qty: toInt(t?.min_qty, 0), price_cents: toInt(t?.price_cents, 0) }))
    .filter((t) => t.min_qty > 0 && t.price_cents >= 0)
    .sort((a, b) => a.min_qty - b.min_qty);
}

export interface PriceResult {
  unit_cents: number;
  list_cents: number;
  subtotal_cents: number;
  seckill: boolean;
  wholesale: boolean;
  member: boolean;
}

export function calcUnit(
  product: Product,
  sku: Sku | null,
  qty: number,
  opts: { loggedIn: boolean; levelDiscount: number; picked: boolean; ts?: number },
): PriceResult {
  const ts = opts.ts ?? now();
  const list = sku?.price_cents ?? product.price_cents;
  let unit = list;
  let seckill = false;
  let wholesale = false;
  let member = false;

  // 1) 限时秒杀
  if (
    product.seckill_price_cents != null &&
    product.seckill_price_cents >= 0 &&
    product.seckill_starts_at != null &&
    product.seckill_ends_at != null &&
    ts >= product.seckill_starts_at &&
    ts <= product.seckill_ends_at
  ) {
    if (product.seckill_price_cents < unit) {
      unit = product.seckill_price_cents;
      seckill = true;
    }
  }

  // 2) 阶梯批发价（数量越多越便宜）
  const tiers = parseTiers(product.wholesale_tiers);
  const tier = [...tiers].reverse().find((t) => qty >= t.min_qty);
  if (tier && tier.price_cents < unit) {
    unit = tier.price_cents;
    wholesale = true;
  }

  // 3) 会员价 / 等级折扣
  if (opts.loggedIn) {
    const mp = sku?.member_price_cents ?? product.member_price_cents;
    if (mp != null && mp >= 0 && mp < unit) {
      unit = mp;
      member = true;
    }
    if (!member && !wholesale && opts.levelDiscount < 100) {
      const discounted = Math.floor((unit * opts.levelDiscount) / 100);
      if (discounted < unit) {
        unit = discounted;
        member = true;
      }
    }
  }

  // 4) 卡密预选加价
  if (opts.picked && product.pick_fee_cents > 0) unit += product.pick_fee_cents;

  return { unit_cents: unit, list_cents: list, subtotal_cents: unit * qty, seckill, wholesale, member };
}

export async function levelDiscountOf(env: Env, user: UserRow | null): Promise<number> {
  if (!user) return 100;
  const level = await one<{ discount: number }>(env, 'SELECT discount FROM levels WHERE id = ?', user.level_id);
  return clamp(Number(level?.discount ?? 100), 0, 100);
}

/* ------------------------------------------------------------------ */
/* 优惠券                                                              */
/* ------------------------------------------------------------------ */

export interface CouponResult {
  coupon_id: number;
  code: string;
  discount_cents: number;
  type: string;
}

export async function validateCoupon(
  env: Env,
  code: string | undefined | null,
  subtotal: number,
  email: string | null,
  userId: number | null,
  productIds: number[],
  merchantId?: number | null,
): Promise<CouponResult | null> {
  if (!code || !String(code).trim()) return null;
  const c = await one<any>(env, 'SELECT * FROM coupons WHERE code = ?', String(code).trim().toUpperCase());
  if (!c) throw new HttpError(400, '优惠券不存在');
  if (merchantId != null && Number(c.merchant_id) !== Number(merchantId)) {
    throw new HttpError(400, '优惠券不适用于当前店铺');
  }
  const ts = now();
  if (!c.enabled) throw new HttpError(400, '优惠券已停用');
  if (c.starts_at && ts < c.starts_at) throw new HttpError(400, '优惠券尚未生效');
  if (c.ends_at && ts > c.ends_at) throw new HttpError(400, '优惠券已过期');
  if (c.max_uses > 0 && c.used_count >= c.max_uses) throw new HttpError(400, '优惠券已被领完');
  if (subtotal < c.min_amount_cents) {
    throw new HttpError(400, `满 ${(c.min_amount_cents / 100).toFixed(2)} 元可用`);
  }
  const scope = parseJSON<number[]>(c.product_ids, []);
  if (scope.length && productIds.length && !productIds.some((id) => scope.includes(id))) {
    throw new HttpError(400, '当前商品不适用该优惠券');
  }
  if (c.per_user_limit > 0) {
    const used = await scalar<number>(
      env,
      `SELECT COUNT(*) AS c FROM coupon_uses WHERE coupon_id = ? AND (user_id = ? OR email = ?)`,
      c.id,
      userId ?? -1,
      email ?? '',
    );
    if (Number(used) >= c.per_user_limit) throw new HttpError(400, '你已达到该优惠券的使用上限');
  }

  let discount = 0;
  if (c.type === 'percent') discount = Math.floor((subtotal * clamp(c.value, 0, 100)) / 100);
  else if (c.type === 'fixed') discount = Math.min(c.value, subtotal);
  else if (c.type === 'per_item') {
    const qty = await scalar<number>(
      env,
      `SELECT COALESCE(SUM(qty),0) AS c FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE oi.product_id IN (${productIds.map(() => '?').join(',') || 'NULL'})`,
      ...productIds,
    );
    discount = Math.min(c.value * Number(qty), subtotal);
  }
  if (discount <= 0) throw new HttpError(400, '优惠券不可用');

  return { coupon_id: c.id, code: c.code, discount_cents: discount, type: c.type };
}

/* ------------------------------------------------------------------ */
/* 库存查询                                                            */
/* ------------------------------------------------------------------ */

export async function autoStock(env: Env, productId: number, skuId: number | null): Promise<number> {
  return Number(
    await scalar<number>(
      env,
      `SELECT COUNT(*) AS c FROM cards WHERE product_id = ? AND COALESCE(sku_id, 0) = ? AND status = 'unused'`,
      productId,
      skuId ?? 0,
    ),
  );
}

export async function productStock(env: Env, p: Product): Promise<number> {
  if (p.delivery_mode === 'auto') return autoStock(env, p.id, null);
  if (p.delivery_mode === 'fixed') return 999999;
  return p.stock;
}

/* ------------------------------------------------------------------ */
/* 创建订单                                                            */
/* ------------------------------------------------------------------ */

export interface CreateOrderInput {
  items: { product_id: number; sku_id?: number | null; qty: number; pick_card_id?: number | null }[];
  email: string;
  coupon_code?: string | null;
  note?: string | null;
  address?: Record<string, unknown> | null;
  channel: string;
  merchant_id?: number | null;
}

export interface CreatedOrder {
  order_no: string;
  token: string;
  status: string;
  amount_cents: number;
  subtotal_cents: number;
  discount_cents: number;
  created_at: number;
  items: OrderItem[];
}

export async function createOrder(
  env: Env,
  input: CreateOrderInput,
  ctx: { user: UserRow | null; ip: string; ua: string },
): Promise<CreatedOrder> {
  const ts = now();
  const site = await getSite(env);
  assert(Array.isArray(input.items) && input.items.length > 0, 400, '请选择商品');
  assert(input.items.length <= 30, 400, '单次最多购买 30 种商品');
  assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email), 400, '请填写有效的邮箱地址');

  const levelDiscount = await levelDiscountOf(env, ctx.user);
  const normalized: {
    product: Product;
    sku: Sku | null;
    qty: number;
    pick_card_id: number | null;
    price: PriceResult;
  }[] = [];
  const seen = new Set<string>();
  let merchantId: number | null = null;

  for (const raw of input.items) {
    const qty = toInt(raw.qty, 0);
    assert(qty > 0, 400, '商品数量必须大于 0');
    assert(qty <= 9999, 400, '单次购买数量过大');

    const product = await one<Product>(env, 'SELECT * FROM products WHERE id = ?', toInt(raw.product_id, 0));
    assert(product, 404, '商品不存在或已下架');
    assert(product.status === 'on', 400, `「${product.name}」已下架`);
    const productMerchantId = Number(product.merchant_id ?? 0);
    assert(productMerchantId > 0, 400, `「${product.name}」未归属任何店铺`);
    if (merchantId == null) merchantId = productMerchantId;
    assert(merchantId === productMerchantId, 400, '购物车中包含不同店铺的商品，请分开结算');
    assert(input.merchant_id == null || Number(input.merchant_id) === merchantId, 400, '商品不属于当前店铺');
    assert(qty >= product.min_qty, 400, `「${product.name}」最少购买 ${product.min_qty} 件`);
    assert(qty <= product.max_qty, 400, `「${product.name}」单次最多购买 ${product.max_qty} 件`);

    let sku: Sku | null = null;
    if (raw.sku_id) {
      sku = await one<Sku>(env, 'SELECT * FROM skus WHERE id = ? AND product_id = ?', raw.sku_id, product.id);
      assert(sku, 400, '商品规格不存在');
      assert(sku.enabled === 1, 400, '该规格已停用');
    }

    const key = `${product.id}:${sku?.id ?? 0}`;
    assert(!seen.has(key), 400, '同一商品规格请合并数量后提交');
    seen.add(key);

    // 限购
    if (product.limit_per_user > 0) {
      const bought = await scalar<number>(
        env,
        `SELECT COALESCE(SUM(oi.qty),0) AS c FROM order_items oi JOIN orders o ON o.id = oi.order_id
         WHERE oi.product_id = ? AND o.status IN ('pending','paid','manual','shipped','delivered')
           AND (o.email = ? OR o.user_id = ?)`,
        product.id,
        input.email,
        ctx.user?.id ?? -1,
      );
      assert(
        Number(bought) + qty <= product.limit_per_user,
        400,
        `「${product.name}」每人限购 ${product.limit_per_user} 件`,
      );
    }

    // 库存
    if (product.delivery_mode === 'auto') {
      if (raw.pick_card_id) {
        const card = await one<CardRow>(
          env,
          `SELECT * FROM cards WHERE id = ? AND product_id = ? AND status = 'unused'`,
          raw.pick_card_id,
          product.id,
        );
        assert(card, 409, '所选卡密已被抢购，请重新选择');
        if (sku && card.sku_id !== sku.id) throw new HttpError(400, '所选卡密与规格不匹配');
      } else {
        const stock = await autoStock(env, product.id, sku?.id ?? null);
        const canAutoBuy = !!product.auto_purchase && !!product.supplier_id;
        if (!canAutoBuy) assert(stock >= qty, 409, `「${product.name}」库存不足（剩余 ${stock}）`);
      }
    } else if (product.delivery_mode !== 'fixed') {
      assert(product.stock >= qty, 409, `「${product.name}」库存不足（剩余 ${product.stock}）`);
    }

    const price = calcUnit(product, sku, qty, {
      loggedIn: !!ctx.user,
      levelDiscount,
      picked: !!raw.pick_card_id,
      ts,
    });
    assert(price.subtotal_cents >= 0, 400, '价格异常');

    normalized.push({ product, sku, qty, pick_card_id: raw.pick_card_id ?? null, price });
  }

  const hasPhysical = normalized.some((n) => n.product.delivery_mode === 'physical');
  if (hasPhysical) {
    const addr = input.address as any;
    assert(addr && addr.name && addr.phone && addr.detail, 400, '实物商品请填写完整的收货地址');
    assert(/^1[3-9]\d{9}$/.test(String(addr.phone).replace(/\s/g, '')), 400, '收货人手机号格式不正确');
  }

  // 实付口径（会员价/批发价/秒杀价后的金额）
  const payable = normalized.reduce((s, n) => s + n.price.subtotal_cents, 0);
  // 原价口径（商品原价 × 数量），用于展示“原价 / 优惠 / 实付”
  const subtotal = normalized.reduce((s, n) => s + n.price.list_cents * n.qty, 0);
  const productIds = normalized.map((n) => n.product.id);
  const coupon = await validateCoupon(env, input.coupon_code, payable, input.email, ctx.user?.id ?? null, productIds, merchantId);
  const couponDiscount = coupon?.discount_cents ?? 0;
  const amount = Math.max(0, payable - couponDiscount);
  const discount = Math.max(0, subtotal - amount);
  assert(amount >= site.min_amount_cents, 400, `订单金额最低 ${site.currency}${(site.min_amount_cents / 100).toFixed(2)}`);

  const orderNo = genOrderNo();
  const token = genOrderToken();
  const orderStatus = 'pending';
  const merchantSlug = merchantId
    ? (await one<{ slug: string }>(env, 'SELECT slug FROM merchants WHERE id = ?', merchantId))?.slug ?? null
    : null;

  const inserted = await run(
    env,
    `INSERT INTO orders (order_no, token, user_id, email, status, subtotal_cents, discount_cents,
       amount_cents, coupon_id, address, note, ip, ua, merchant_id, merchant_slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    orderNo,
    token,
    ctx.user?.id ?? null,
    input.email.toLowerCase(),
    orderStatus,
    subtotal,
    discount,
    amount,
    coupon?.coupon_id ?? null,
    input.address ? JSON.stringify(input.address) : null,
    (input.note ?? '').slice(0, 300),
    ctx.ip,
    ctx.ua,
    merchantId,
    merchantSlug,
    ts,
    ts,
  );
  const orderId = inserted.meta.last_row_id as number;

  const items: OrderItem[] = [];
  for (const n of normalized) {
    const res = await run(
      env,
      `INSERT INTO order_items (order_id, product_id, sku_id, product_name, sku_name, price_cents,
         qty, amount_cents, delivery_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      orderId,
      n.product.id,
      n.sku?.id ?? null,
      n.product.name,
      n.sku?.name ?? null,
      n.price.unit_cents,
      n.qty,
      n.price.subtotal_cents,
      n.product.delivery_mode,
    );
    items.push({
      id: res.meta.last_row_id as number,
      order_id: orderId,
      product_id: n.product.id,
      sku_id: n.sku?.id ?? null,
      product_name: n.product.name,
      sku_name: n.sku?.name ?? null,
      price_cents: n.price.unit_cents,
      qty: n.qty,
      amount_cents: n.price.subtotal_cents,
      delivery_mode: n.product.delivery_mode,
      delivered: null,
      delivered_at: null,
    });
  }

  // 预占卡密 / 扣减人工发货库存
  const reserved = await reserveOrder(env, orderId, items);
  if (!reserved) {
    await releaseOrder(env, orderId, false);
    await run(env, 'DELETE FROM order_items WHERE order_id = ?', orderId);
    await run(env, 'DELETE FROM orders WHERE id = ?', orderId);
    throw new HttpError(409, '手慢了，商品库存不足，请刷新重试');
  }

  // 记录优惠券占用
  if (coupon) {
    try {
      await run(
        env,
        'INSERT INTO coupon_uses (coupon_id, email, user_id, order_id, created_at) VALUES (?, ?, ?, ?, ?)',
        coupon.coupon_id,
        input.email.toLowerCase(),
        ctx.user?.id ?? null,
        orderId,
        ts,
      );
      await run(env, 'UPDATE coupons SET used_count = used_count + 1 WHERE id = ?', coupon.coupon_id);
    } catch {
      await releaseOrder(env, orderId, false);
      await run(env, 'DELETE FROM order_items WHERE order_id = ?', orderId);
      await run(env, 'DELETE FROM orders WHERE id = ?', orderId);
      throw new HttpError(409, '优惠券使用失败，请重试');
    }
  }

  return {
    order_no: orderNo,
    token,
    status: orderStatus,
    amount_cents: amount,
    subtotal_cents: subtotal,
    discount_cents: discount,
    created_at: ts,
    items,
  };
}

/** 预占库存：卡密置为 locked，人工/实物商品扣减 stock */
async function reserveOrder(env: Env, orderId: number, items: OrderItem[]): Promise<boolean> {
  const ts = now();
  for (const item of items) {
    if (item.delivery_mode === 'auto') {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        const rows = await all<{ id: number }>(
          env,
          `SELECT id FROM cards WHERE product_id = ? AND COALESCE(sku_id, 0) = ? AND status = 'unused'
           ORDER BY id LIMIT ?`,
          item.product_id,
          item.sku_id ?? 0,
          item.qty,
        );
        if (rows.length < item.qty) break;
        const results = await batch(
          env,
          rows.map((r) =>
            env.DB.prepare(
              `UPDATE cards SET status = 'locked', order_item_id = ? WHERE id = ? AND status = 'unused'`,
            ).bind(item.id, r.id),
          ),
        );
        const changed = results.reduce((s, r) => s + (r.meta.changes ?? 0), 0);
        if (changed === item.qty) {
          ok = true;
        } else {
          // 释放本次抢到的部分，换一批重试
          await run(
            env,
            `UPDATE cards SET status = 'unused', order_item_id = NULL WHERE order_item_id = ? AND status = 'locked'`,
            item.id,
          );
        }
      }
      if (!ok) {
        // 卡密不足但商品配置了上游自动采购：允许下单，支付后向上游补货
        const p = await one<{ auto_purchase: number; supplier_id: number | null }>(
          env,
          'SELECT auto_purchase, supplier_id FROM products WHERE id = ?',
          item.product_id,
        );
        if (!p?.auto_purchase || !p.supplier_id) return false;
      }
    } else if (item.delivery_mode !== 'fixed') {
      const res = await run(
        env,
        'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?',
        item.qty,
        item.product_id,
        item.qty,
      );
      if ((res.meta.changes ?? 0) !== 1) return false;
    }
  }
  return true;
}

/** 释放订单占用的库存（未支付时） */
export async function releaseOrder(env: Env, orderId: number, refundStock = true): Promise<void> {
  const items = await all<OrderItem>(env, 'SELECT * FROM order_items WHERE order_id = ?', orderId);
  for (const item of items) {
    if (item.delivery_mode === 'auto') {
      await run(
        env,
        `UPDATE cards SET status = 'unused', order_item_id = NULL
         WHERE order_item_id = ? AND status = 'locked'`,
        item.id,
      );
    } else if (refundStock && item.delivery_mode !== 'fixed') {
      await run(env, 'UPDATE products SET stock = stock + ? WHERE id = ?', item.qty, item.product_id);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 支付成功 -> 发货                                                    */
/* ------------------------------------------------------------------ */

export async function markOrderPaid(
  env: Env,
  orderId: number,
  channel: string,
  tradeNo: string | null,
): Promise<boolean> {
  const ts = now();
  const upd = await run(
    env,
    `UPDATE orders SET status = 'paid', pay_channel = ?, pay_trade_no = ?, paid_at = ?, updated_at = ?
     WHERE id = ? AND status = 'pending'`,
    channel,
    tradeNo,
    ts,
    ts,
    orderId,
  );
  if ((upd.meta.changes ?? 0) === 0) return false;

  const order = await one<OrderRow>(env, 'SELECT * FROM orders WHERE id = ?', orderId);
  const items = await all<OrderItem>(env, 'SELECT * FROM order_items WHERE order_id = ?', orderId);
  if (!order) return false;

  let needManual = false;
  for (const item of items) {
    if (item.delivery_mode === 'auto') {
      const cards = await all<CardRow>(
        env,
        'SELECT * FROM cards WHERE order_item_id = ? AND status = ?',
        item.id,
        'locked',
      );
      let contents = cards.map((c) => c.content);
      // 库存不足时自动向上游供应商采购
      if (contents.length < item.qty) {
        try {
          const bought = await purchaseFromSupplier(
            env,
            item,
            item.qty - contents.length,
            order.order_no,
            order.email,
          );
          for (const content of bought.contents) {
            await run(
              env,
              `INSERT INTO cards (product_id, sku_id, content, status, order_item_id, created_at, sold_at)
               VALUES (?, ?, ?, 'sold', ?, ?, ?)`,
              item.product_id,
              item.sku_id,
              content,
              item.id,
              ts,
              ts,
            );
            contents.push(content);
          }
        } catch (e) {
          console.error('[supplier]', e);
        }
      }
      if (cards.length) {
        await batch(
          env,
          cards.map((c) =>
            env.DB.prepare(
              `UPDATE cards SET status = 'sold', sold_at = ? WHERE id = ?`,
            ).bind(ts, c.id),
          ),
        );
      }
      await run(
        env,
        'UPDATE order_items SET delivered = ?, delivered_at = ? WHERE id = ?',
        JSON.stringify(contents),
        ts,
        item.id,
      );
    } else if (item.delivery_mode === 'fixed') {
      const product = await one<Product>(env, 'SELECT * FROM products WHERE id = ?', item.product_id);
      await run(
        env,
        'UPDATE order_items SET delivered = ?, delivered_at = ? WHERE id = ?',
        JSON.stringify([product?.content ?? '']),
        ts,
        item.id,
      );
    } else {
      needManual = true;
    }
  }

  const finalStatus = needManual ? 'manual' : 'delivered';
  await run(env, 'UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', finalStatus, ts, orderId);

  // 销量统计
  for (const item of items) {
    await run(env, 'UPDATE products SET sales_count = sales_count + ? WHERE id = ?', item.qty, item.product_id);
  }

  // 支付记录
  await run(
    env,
    `UPDATE payments SET status = 'paid', trade_no = ?, paid_at = ? WHERE order_id = ? AND status != 'paid'`,
    tradeNo,
    ts,
    orderId,
  );

  // 余额充值订单：直接给账户加钱，不参与返佣
  if (order.note === 'recharge' && order.user_id) {
    await run(env, 'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?', order.amount_cents, order.user_id);
    const fresh = await one<UserRow>(env, 'SELECT * FROM users WHERE id = ?', order.user_id);
    await run(
      env,
      `INSERT INTO balance_logs (user_id, type, amount_cents, balance_after, order_id, note, created_at)
       VALUES (?, 'recharge', ?, ?, ?, ?, ?)`,
      order.user_id,
      order.amount_cents,
      fresh?.balance_cents ?? 0,
      order.id,
      '余额充值',
      ts,
    );
    return true;
  }

  // 会员成长值 & 升级
  if (order.user_id) {
    const user = await one<UserRow>(env, 'SELECT * FROM users WHERE id = ?', order.user_id);
    if (user) {
      const spent = user.total_spent_cents + order.amount_cents;
      await run(env, 'UPDATE users SET total_spent_cents = ? WHERE id = ?', spent, user.id);
      const level = await one<Level>(
        env,
        'SELECT * FROM levels WHERE min_spent_cents <= ? ORDER BY min_spent_cents DESC, sort DESC LIMIT 1',
        spent,
      );
      if (level && level.id !== user.level_id) {
        await run(env, 'UPDATE users SET level_id = ? WHERE id = ?', level.id, user.id);
      }
      await settleCommission(env, order, user, ts);
    }
  }

  return true;
}

/** 三级推广返佣：按订单实付金额比例计入上级余额 */
async function settleCommission(env: Env, order: OrderRow, buyer: UserRow, ts: number): Promise<void> {
  const cfg = await getCommission(env);
  if (!cfg.enabled || !cfg.levels?.length) return;
  const ratios = cfg.levels.slice(0, 3).map((n) => Number(n) || 0);
  let inviterId = buyer.inviter_id;
  let depth = 0;
  const visited = new Set<number>([buyer.id]);
  while (inviterId && depth < ratios.length && ratios[depth] > 0) {
    if (visited.has(inviterId)) break;
    visited.add(inviterId);
    const inviter = await one<UserRow>(env, 'SELECT * FROM users WHERE id = ? AND status = ?', inviterId, 'active');
    if (!inviter) break;
    const amount = Math.floor((order.amount_cents * ratios[depth]) / 100);
    if (amount > 0) {
      await run(
        env,
        'UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?',
        amount,
        inviter.id,
      );
      const fresh = await one<UserRow>(env, 'SELECT balance_cents FROM users WHERE id = ?', inviter.id);
      await run(
        env,
        `INSERT INTO referrals (order_id, inviter_id, invitee_id, level, amount_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        order.id,
        inviter.id,
        buyer.id,
        depth + 1,
        amount,
        ts,
      );
      await run(
        env,
        `INSERT INTO balance_logs (user_id, type, amount_cents, balance_after, order_id, note, created_at)
         VALUES (?, 'commission', ?, ?, ?, ?, ?)`,
        inviter.id,
        amount,
        fresh?.balance_cents ?? 0,
        order.id,
        `下级消费返佣（第 ${depth + 1} 级）`,
        ts,
      );
    }
    inviterId = inviter.inviter_id;
    depth += 1;
  }
}

/* ------------------------------------------------------------------ */
/* 关闭订单                                                            */
/* ------------------------------------------------------------------ */

export async function closeOrder(env: Env, orderId: number, reason = '超时未支付'): Promise<boolean> {
  const order = await one<OrderRow>(env, 'SELECT * FROM orders WHERE id = ?', orderId);
  if (!order || order.status !== 'pending') return false;
  const ts = now();
  await releaseOrder(env, orderId, true);
  if (order.coupon_id) {
    await run(env, 'DELETE FROM coupon_uses WHERE order_id = ?', orderId);
    await run(env, 'UPDATE coupons SET used_count = MAX(used_count - 1, 0) WHERE id = ?', order.coupon_id);
  }
  await run(
    env,
    `UPDATE orders SET status = 'closed', closed_at = ?, remark = ?, updated_at = ? WHERE id = ?`,
    ts,
    reason,
    ts,
    orderId,
  );
  return true;
}

export async function closeExpiredOrders(env: Env): Promise<number> {
  const site = await getSite(env);
  const deadline = now() - site.order_expire_minutes * 60 * 1000;
  const rows = await all<{ id: number }>(
    env,
    'SELECT id FROM orders WHERE status = ? AND created_at < ? LIMIT 50',
    'pending',
    deadline,
  );
  let count = 0;
  for (const r of rows) if (await closeOrder(env, r.id)) count += 1;
  return count;
}

/* ------------------------------------------------------------------ */
/* 订单展示                                                            */
/* ------------------------------------------------------------------ */

export async function loadOrderDetail(env: Env, orderId: number) {
  const order = await one<OrderRow>(env, 'SELECT * FROM orders WHERE id = ?', orderId);
  if (!order) return null;
  const items = await all<OrderItem & { delivered_json: string[] | null }>(
    env,
    `SELECT oi.*, CASE WHEN oi.delivered IS NULL THEN NULL ELSE oi.delivered END AS delivered_json
     FROM order_items oi WHERE oi.order_id = ? ORDER BY oi.id`,
    orderId,
  );
  const normalized = items.map((it) => ({
    ...it,
    delivered: parseJSON<string[] | null>(it.delivered, null),
  }));
  const coupon = order.coupon_id
    ? await one<any>(env, 'SELECT id, code, type, value FROM coupons WHERE id = ?', order.coupon_id)
    : null;
  return { order, items: normalized, coupon };
}

export function publicOrder(detail: any, site: { currency: string }) {
  const { order, items, coupon } = detail;
  return {
    id: order.id,
    order_no: order.order_no,
    status: order.status,
    email: order.email,
    subtotal_cents: order.subtotal_cents,
    discount_cents: order.discount_cents,
    amount_cents: order.amount_cents,
    currency: site.currency,
    pay_channel: order.pay_channel,
    pay_trade_no: order.pay_trade_no,
    created_at: order.created_at,
    paid_at: order.paid_at,
    closed_at: order.closed_at,
    remark: order.remark,
    note: order.note,
    address: order.address ? parseJSON(order.address, null) : null,
    coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value } : null,
    items: items.map((it: any) => ({
      id: it.id,
      product_id: it.product_id,
      product_name: it.product_name,
      sku_name: it.sku_name,
      price_cents: it.price_cents,
      qty: it.qty,
      amount_cents: it.amount_cents,
      delivery_mode: it.delivery_mode,
      delivered: it.delivered ?? [],
      delivered_at: it.delivered_at,
    })),
  };
}
