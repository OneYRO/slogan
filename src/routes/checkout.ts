import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { optionalUser, requireUser } from '../auth';
import { all, one } from '../db';
import { createOrder, loadOrderDetail, publicOrder } from '../orders';
import { orderReturnPath, payWithBalance, startPayment } from '../payments';
import { getSite } from '../settings';
import { HttpError, now, toInt } from '../util';
import { getMerchant, publicMerchant, resolveMerchant } from '../merchants';
import type { OrderRow } from '../types';

export const checkout = new Hono<AppEnv>();

checkout.use('*', optionalUser);

async function findAccessibleOrder(c: any): Promise<OrderRow> {
  const orderNo = c.req.param('orderNo');
  const url = new URL(c.req.url);
  const token = url.searchParams.get('token') || c.req.header('x-order-token') || '';
  const order = await one<OrderRow>(c.env, 'SELECT * FROM orders WHERE order_no = ?', orderNo);
  if (!order) throw new HttpError(404, '订单不存在');
  const user = c.get('user');
  const owner = user && order.user_id === user.id;
  const tokenOk = order.token && token && token === order.token;
  if (!owner && !tokenOk) throw new HttpError(403, '无权查看该订单');
  return order;
}

/** 创建订单 */
checkout.post('/orders', async (c) => {
  const site = await getSite(c.env);
  const user = c.get('user') ?? null;
  if (site.force_login && !user) throw new HttpError(401, '请先登录后再下单');
  const merchant = await resolveMerchant(c.env, c.req.raw);

  const body = await c.req.json<any>().catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  const address = body.address && typeof body.address === 'object' ? body.address : null;

  const created = await createOrder(
    c.env,
    {
      items: items.map((it: any) => ({
        product_id: toInt(it.product_id, 0),
        sku_id: it.sku_id ?? null,
        qty: toInt(it.qty, 1),
        pick_card_id: it.pick_card_id ?? null,
      })),
      email: String(body.email ?? (user?.email ?? '')),
      coupon_code: body.coupon_code ?? null,
      note: body.note ?? null,
      address,
      channel: String(body.pay_channel ?? 'epay'),
      merchant_id: merchant.id,
    },
    {
      user,
      ip: c.req.header('cf-connecting-ip') || '0.0.0.0',
      ua: c.req.header('user-agent') ?? '',
    },
  );
  return c.json({ ok: true, data: created });
});

/** 订单详情（凭 token 或本人身份） */
checkout.get('/orders/:orderNo', async (c) => {
  const order = await findAccessibleOrder(c);
  const detail = await loadOrderDetail(c.env, order.id);
  const site = await getSite(c.env);
  if (!detail) throw new HttpError(404, '订单不存在');
  const merchant = order.merchant_id ? await getMerchant(c.env, order.merchant_id) : null;
  return c.json({
    ok: true,
    data: {
      ...publicOrder(detail, site),
      merchant: merchant ? publicMerchant(merchant) : null,
      expire_at: order.created_at + site.order_expire_minutes * 60 * 1000,
      server_time: now(),
    },
  });
});

/** 发起支付 */
checkout.post('/orders/:orderNo/pay', async (c) => {
  const order = await findAccessibleOrder(c);
  if (order.status !== 'pending') throw new HttpError(400, '订单已处理，请勿重复支付');
  const site = await getSite(c.env);
  if (now() > order.created_at + site.order_expire_minutes * 60 * 1000) {
    throw new HttpError(400, '订单已超时，请重新下单');
  }
  const body = await c.req.json<any>().catch(() => ({}));
  const channel = String(body.channel ?? 'epay');

  if (channel === 'balance') {
    const user = c.get('user');
    if (!user) throw new HttpError(401, '请先登录后使用余额支付');
    if (order.user_id !== user.id) throw new HttpError(403, '无权支付该订单');
    const res = await payWithBalance(c.env, order, user.id);
    if (!res.ok) throw new HttpError(400, res.message);
    return c.json({ ok: true, data: { action: { type: 'paid', redirect: orderReturnPath(order) } } });
  }

  const action = await startPayment(c.env, order, channel, c.req.raw);
  return c.json({ ok: true, data: { action } });
});

/** 轮询订单状态 */
checkout.get('/orders/:orderNo/status', async (c) => {
  const order = await findAccessibleOrder(c);
  return c.json({
    ok: true,
    data: {
      order_no: order.order_no,
      status: order.status,
      amount_cents: order.amount_cents,
      paid_at: order.paid_at,
      server_time: now(),
    },
  });
});

/** 支付完成回跳（服务端重定向到订单页） */
checkout.get('/return', async (c) => {
  const url = new URL(c.req.url);
  const orderNo = url.searchParams.get('order') ?? '';
  const order = await one<OrderRow>(c.env, 'SELECT * FROM orders WHERE order_no = ?', orderNo);
  if (!order) return c.redirect('/orders');
  return c.redirect(orderReturnPath(order));
});

/** 我的订单列表（登录用户） */
checkout.get('/me/orders', requireUser, async (c) => {
  const user = c.get('user');
  const orders = await all<any>(
    c.env,
    'SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    user.id,
  );
  const ids = orders.map((o) => o.id);
  const items = ids.length
    ? await all<any>(
        c.env,
        `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      )
    : [];
  return c.json({
    ok: true,
    data: orders.map((o) => ({ ...o, items: items.filter((it) => it.order_id === o.id) })),
  });
});
