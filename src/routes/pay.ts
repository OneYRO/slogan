import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { capturePaypalOrder, handleAlipayNotify, handleHashpayNotify, handleEpayNotify, handlePaypalNotify, handleStripeNotify, handleUsdtNotify } from '../payments';
import { one, run } from '../db';
import { now } from '../util';

export const pay = new Hono<AppEnv>();

pay.all('/notify/epay', async (c) => {
  const res = await handleEpayNotify(c.env, c.req.raw);
  if (!res.ok) await logNotify(c.env, 'epay', 'fail');
  return c.text(res.message, res.ok ? 200 : 400);
});

pay.all('/notify/alipay', async (c) => {
  const res = await handleAlipayNotify(c.env, c.req.raw);
  if (!res.ok) await logNotify(c.env, 'alipay', 'fail');
  return c.text(res.message, res.ok ? 200 : 400);
});

pay.all('/notify/usdt', async (c) => {
  const res = await handleUsdtNotify(c.env, c.req.raw);
  if (!res.ok) await logNotify(c.env, 'usdt', 'fail');
  return c.text(res.message, res.ok ? 200 : 400);
});

pay.all('/notify/hashpay', async (c) => {
  const res = await handleHashpayNotify(c.env, c.req.raw);
  if (!res.ok) await logNotify(c.env, 'hashpay', 'fail');
  return c.text(res.message, res.ok ? 200 : 400);
});

pay.all('/notify/stripe', async (c) => {
  const res = await handleStripeNotify(c.env, c.req.raw);
  if (!res.ok) await logNotify(c.env, 'stripe', 'fail');
  return c.text(res.message, res.ok ? 200 : 400);
});

pay.all('/notify/paypal', async (c) => {
  const res = await handlePaypalNotify(c.env, c.req.raw);
  if (!res.ok) await logNotify(c.env, 'paypal', 'fail');
  return c.text(res.message, res.ok ? 200 : 400);
});

/** PayPal 授权后跳回：服务端 capture 成功才发货 */
pay.get('/paypal/return', async (c) => {
  const url = new URL(c.req.url);
  const paypalOrderId = url.searchParams.get('token') || '';
  if (!paypalOrderId) return c.redirect('/orders?pay=failed');
  const res = await capturePaypalOrder(c.env, paypalOrderId);
  if (!res.ok || !res.orderNo) return c.redirect('/orders?pay=failed');
  const order = await one<any>(c.env, 'SELECT token, merchant_slug FROM orders WHERE order_no = ?', res.orderNo);
  const token = order?.token ? `?token=${encodeURIComponent(order.token)}` : '';
  const merchant = order?.merchant_slug ? `&merchant=${encodeURIComponent(order.merchant_slug)}` : '';
  return c.redirect(`/order/${encodeURIComponent(res.orderNo)}${token}${merchant}`);
});

async function logNotify(env: any, channel: string, status: string) {
  await run(
    env,
    'INSERT INTO notify_logs (channel, target, subject, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    `pay:${channel}`,
    '',
    '支付回调',
    status,
    '',
    now(),
  ).catch(() => {});
}
