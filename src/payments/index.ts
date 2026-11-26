import type { Env, OrderRow } from '../types';
import { getPayment, getSite } from '../settings';
import { baseUrl, HttpError, money, signWithKey, rsaSign, rsaVerify, hmacSha256, safeEqual } from '../util';
import { one } from '../db';
import { markOrderPaid } from '../orders';

export type PayAction =
  | { type: 'redirect'; url: string }
  | { type: 'form'; html: string }
  | { type: 'paid'; redirect: string };

export function orderReturnPath(order: OrderRow): string {
  const slug = order.merchant_slug ? `&merchant=${encodeURIComponent(order.merchant_slug)}` : '';
  return `/order/${encodeURIComponent(order.order_no)}?token=${encodeURIComponent(order.token ?? '')}${slug}`;
}

/* ------------------------------------------------------------------ */
/* 发起支付                                                            */
/* ------------------------------------------------------------------ */

export async function startPayment(
  env: Env,
  order: OrderRow,
  channel: string,
  req: Request,
): Promise<PayAction> {
  const cfg = await getPayment(env);
  const site = await getSite(env);
  const base = baseUrl(req);
  const amountYuan = (order.amount_cents / 100).toFixed(2);

  if (channel === 'mock') {
    if (!cfg.mock.enabled) throw new HttpError(400, '模拟支付未开启');
    await markOrderPaid(env, order.id, 'mock', 'MOCK-' + order.order_no);
    return { type: 'paid', redirect: orderReturnPath(order) };
  }

  if (channel === 'epay') {
    if (!cfg.epay.enabled) throw new HttpError(400, '该支付方式未启用');
    if (!cfg.epay.api_url) throw new HttpError(400, '易支付接口地址未配置');
    const params: Record<string, string> = {
      pid: cfg.epay.pid,
      type: 'alipay',
      out_trade_no: order.order_no,
      notify_url: `${base}/api/pay/notify/epay`,
      return_url: `${base}/pay/return?channel=epay&order=${encodeURIComponent(order.order_no)}`,
      name: `${site.name} - 订单 ${order.order_no}`,
      money: amountYuan,
    };
    const sign = signWithKey(params, cfg.epay.key);
    const qs = new URLSearchParams({ ...params, sign, sign_type: 'MD5' }).toString();
    return { type: 'redirect', url: `${cfg.epay.api_url.replace(/\/+$/, '')}/submit.php?${qs}` };
  }

  if (channel === 'alipay') {
    if (!cfg.alipay.enabled) throw new HttpError(400, '该支付方式未启用');
    if (!cfg.alipay.app_id || !cfg.alipay.private_key) throw new HttpError(400, '支付宝参数未配置');
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const timestamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    const params: Record<string, string> = {
      app_id: cfg.alipay.app_id,
      method: 'alipay.trade.page.pay',
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp,
      version: '1.0',
      notify_url: `${base}/api/pay/notify/alipay`,
      return_url: `${base}/pay/return?channel=alipay&order=${encodeURIComponent(order.order_no)}`,
      biz_content: JSON.stringify({
        out_trade_no: order.order_no,
        total_amount: amountYuan,
        subject: `${site.name} - 订单 ${order.order_no}`,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        qr_pay_mode: '2',
      }),
    };
    const content = Object.keys(params)
      .filter((k) => k !== 'sign' && params[k] !== '')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const sign = await rsaSign(cfg.alipay.private_key, content);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>正在跳转支付宝…</title>
      <style>body{font-family:system-ui;display:grid;place-items:center;height:100vh;background:#0b1020;color:#cbd5e1}</style></head>
      <body><div>正在跳转支付宝，请稍候…</div>
      <form id="f" method="post" action="${cfg.alipay.gateway || 'https://openapi.alipay.com/gateway.do'}">
      ${Object.entries({ ...params, sign })
        .map(([k, v]) => `<input type="hidden" name="${k}" value="${encodeURIComponent(v)}">`)
        .join('')}
      </form><script>document.getElementById('f').submit();</script></body></html>`;
    return { type: 'form', html };
  }

  if (channel === 'stripe') {
    if (!cfg.stripe.enabled) throw new HttpError(400, '该支付方式未启用');
    if (!cfg.stripe.secret_key) throw new HttpError(400, 'Stripe 密钥未配置');
    const currency = (cfg.stripe.currency || 'cny').toLowerCase();
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: `${base}/pay/return?channel=stripe&order=${encodeURIComponent(order.order_no)}`,
      cancel_url: `${base}/order/${encodeURIComponent(order.order_no)}?token=${encodeURIComponent(order.token ?? '')}`,
      client_reference_id: order.order_no,
      'metadata[order_no]': order.order_no,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': currency,
      'line_items[0][price_data][unit_amount]': String(order.amount_cents),
      'line_items[0][price_data][product_data][name]': `${site.name} - 订单 ${order.order_no}`,
    });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.stripe.secret_key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.url) throw new HttpError(502, data?.error?.message || 'Stripe 下单失败');
    return { type: 'redirect', url: data.url };
  }

  if (channel === 'paypal') {
    if (!cfg.paypal.enabled) throw new HttpError(400, '该支付方式未启用');
    if (!cfg.paypal.client_id || !cfg.paypal.client_secret) throw new HttpError(400, 'PayPal 参数未配置');
    const paypalBase = cfg.paypal.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    const tokenRes = await fetch(`${paypalBase}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(`${cfg.paypal.client_id}:${cfg.paypal.client_secret}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenData: any = await tokenRes.json().catch(() => null);
    const accessToken = tokenData?.access_token;
    if (!accessToken) throw new HttpError(502, tokenData?.error_description || 'PayPal 授权失败');

    const createRes = await fetch(`${paypalBase}/v2/checkout/orders`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: order.order_no,
            description: `${site.name} - 订单 ${order.order_no}`,
            amount: { currency_code: cfg.paypal.currency || 'CNY', value: amountYuan },
          },
        ],
        application_context: {
          brand_name: site.name,
          return_url: `${base}/api/pay/paypal/return?order=${encodeURIComponent(order.order_no)}`,
          cancel_url: `${base}/order/${encodeURIComponent(order.order_no)}?token=${encodeURIComponent(order.token ?? '')}`,
          user_action: 'PAY_NOW',
        },
      }),
    });
    const orderData: any = await createRes.json().catch(() => null);
    const approve = (orderData?.links || []).find((l: any) => l.rel === 'approve')?.href;
    if (!createRes.ok || !approve) throw new HttpError(502, orderData?.message || 'PayPal 下单失败');
    return { type: 'redirect', url: approve };
  }

  if (channel === 'hashpay') {
    if (!cfg.hashpay.enabled) throw new HttpError(400, '该支付方式未启用');
    if (!cfg.hashpay.api_key || !cfg.hashpay.organization_id) throw new HttpError(400, 'HashPay 参数未配置');
    const rate = Number(site.currency_rates?.usd ?? 0.14) || 0.14;
    const amountUsd = ((order.amount_cents / 100) * rate).toFixed(2);
    const res = await fetch(
      `${(cfg.hashpay.api_url || 'https://api.hashpay.me/v1').replace(/\/+$/, '')}/organizations/${encodeURIComponent(cfg.hashpay.organization_id)}/invoices`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-HashPay-Key': cfg.hashpay.api_key,
          'x-hashpay-organization-id': cfg.hashpay.organization_id,
        },
        body: JSON.stringify({
          amount: amountUsd,
          settlementCurrency: cfg.hashpay.currency || 'USD',
          network: 'tron',
          tokenSymbol: 'USDT',
          metadata: { order_no: order.order_no, order_id: String(order.id) },
        }),
      },
    );
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.checkoutUrl) {
      throw new HttpError(502, data?.message || data?.error || 'HashPay 创建发票失败');
    }
    return { type: 'redirect', url: data.checkoutUrl };
  }

  if (channel === 'usdt') {
    if (!cfg.usdt.enabled) throw new HttpError(400, '该支付方式未启用');
    if (!cfg.usdt.api_url) throw new HttpError(400, 'USDT 网关未配置');
    const params: Record<string, string> = {
      trade_id: order.order_no,
      order_id: order.order_no,
      amount: amountYuan,
      notify_url: `${base}/api/pay/notify/usdt`,
      redirect_url: `${base}/pay/return?channel=usdt&order=${encodeURIComponent(order.order_no)}`,
    };
    const sign = signWithKey(params, cfg.usdt.app_secret);
    const res = await fetch(`${cfg.usdt.api_url.replace(/\/+$/, '')}/api/v1/order/create-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, sign }),
    });
    const data: any = await res.json().catch(() => null);
    const paymentUrl = data?.data?.payment_url || data?.data?.payment_url || data?.payment_url;
    if (!paymentUrl) {
      throw new HttpError(502, data?.message || 'USDT 网关下单失败');
    }
    return { type: 'redirect', url: paymentUrl };
  }

  throw new HttpError(400, '不支持的支付方式');
}

/* ------------------------------------------------------------------ */
/* 回调验签                                                            */
/* ------------------------------------------------------------------ */

async function findOrder(env: Env, orderNo: string): Promise<OrderRow | null> {
  return one<OrderRow>(env, 'SELECT * FROM orders WHERE order_no = ?', orderNo);
}

export async function handleEpayNotify(env: Env, req: Request): Promise<{ ok: boolean; message: string }> {
  const form = await req.formData();
  const get = (k: string) => (form.get(k) as string) || new URL(req.url).searchParams.get(k) || '';
  const cfg = await getPayment(env);
  const params: Record<string, string> = {};
  for (const k of ['pid', 'name', 'money', 'out_trade_no', 'trade_no', 'type', 'trade_status']) {
    params[k] = get(k);
  }
  const sign = get('sign');
  const expect = signWithKey(params, cfg.epay.key);
  if (!sign || sign.toLowerCase() !== expect) return { ok: false, message: 'fail' };
  if (params.pid !== cfg.epay.pid) return { ok: false, message: 'fail' };
  if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(params.trade_status)) return { ok: false, message: 'fail' };
  const order = await findOrder(env, params.out_trade_no);
  if (!order) return { ok: false, message: 'fail' };
  if (order.amount_cents !== Math.round(Number(params.money) * 100)) return { ok: false, message: 'fail' };
  await markOrderPaid(env, order.id, 'epay', params.trade_no);
  return { ok: true, message: 'success' };
}

export async function handleAlipayNotify(env: Env, req: Request): Promise<{ ok: boolean; message: string }> {
  const form = await req.formData();
  const cfg = await getPayment(env);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);
  const sign = params.sign;
  const content = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== '')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  if (!sign || !(await rsaVerify(cfg.alipay.public_key, content, sign))) {
    return { ok: false, message: 'failure' };
  }
  if (!['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(params.trade_status)) return { ok: false, message: 'failure' };
  if (params.app_id && params.app_id !== cfg.alipay.app_id) return { ok: false, message: 'failure' };
  const order = await findOrder(env, params.out_trade_no);
  if (!order) return { ok: false, message: 'failure' };
  if (order.amount_cents !== Math.round(Number(params.total_amount) * 100)) {
    return { ok: false, message: 'failure' };
  }
  await markOrderPaid(env, order.id, 'alipay', params.trade_no);
  return { ok: true, message: 'success' };
}

export async function handleUsdtNotify(env: Env, req: Request): Promise<{ ok: boolean; message: string }> {
  const u = new URL(req.url);
  const cfg = await getPayment(env);
  const token = u.searchParams.get('token') || '';
  if (!cfg.usdt.token || token !== cfg.usdt.token) return { ok: false, message: 'fail' };
  const orderNo = u.searchParams.get('order_id') || u.searchParams.get('trade_id') || '';
  const status = (u.searchParams.get('status') || '').toLowerCase();
  if (!['2', 'success', 'paid', 'ok'].includes(status)) return { ok: false, message: 'fail' };
  const order = await findOrder(env, orderNo);
  if (!order) return { ok: false, message: 'fail' };
  const amount = Number(u.searchParams.get('actual_amount') || u.searchParams.get('amount') || 0);
  if (amount > 0 && Math.abs(amount * 100 - order.amount_cents) > 1) return { ok: false, message: 'fail' };
  await markOrderPaid(env, order.id, 'usdt', u.searchParams.get('trade_id') || orderNo);
  return { ok: true, message: 'ok' };
}

export async function handleHashpayNotify(env: Env, req: Request): Promise<{ ok: boolean; message: string }> {
  const cfg = await getPayment(env);
  if (!cfg.hashpay.enabled || !cfg.hashpay.signing_secret) return { ok: false, message: 'disabled' };
  const raw = await req.text();
  const header = (req.headers.get('X-HashPay-Signature') || '').trim();
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/i.exec(header);
  if (!m) return { ok: false, message: 'invalid signature header' };
  const ts = m[1];
  const sig = m[2].toLowerCase();
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return { ok: false, message: 'stale timestamp' };
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'bad payload' };
  }
  const eventId = String(event?.event_id || '');
  if (!eventId) return { ok: false, message: 'missing event id' };
  const expected = await hmacSha256(cfg.hashpay.signing_secret, `${ts}.${eventId}.${raw}`);
  if (!safeEqual(sig, expected)) return { ok: false, message: 'invalid signature' };
  if (event?.type !== 'invoice.paid') return { ok: true, message: 'ignored' };
  const invoice = event?.data?.invoice ?? event?.data ?? {};
  const orderNo = invoice?.metadata?.order_no || invoice?.metadata?.order_id || '';
  const order = await findOrder(env, orderNo);
  if (!order) return { ok: false, message: 'order not found' };
  const site = await getSite(env);
  const rate = Number(site.currency_rates?.usd ?? 0.14) || 0.14;
  const paid = Number(invoice?.paidAmount ?? invoice?.amount ?? 0);
  const expectUsd = Math.round(((order.amount_cents / 100) * rate) * 100);
  if (paid > 0 && Math.abs(Math.round(paid * 100) - expectUsd) > 1) {
    return { ok: false, message: 'amount mismatch' };
  }
  await markOrderPaid(env, order.id, 'hashpay', invoice?.id || eventId);
  return { ok: true, message: 'ok' };
}

export async function handleStripeNotify(env: Env, req: Request): Promise<{ ok: boolean; message: string }> {
  const cfg = await getPayment(env);
  const payload = await req.text();
  const header = req.headers.get('stripe-signature') || '';
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find((p) => p[0] === 't')?.[1] || '';
  const v1 = parts.find((p) => p[0] === 'v1')?.[1] || '';
  if (!t || !v1) return { ok: false, message: 'missing signature' };
  const expected = await hmacSha256(cfg.stripe.webhook_secret, `${t}.${payload}`);
  if (!safeEqual(v1, expected)) return { ok: false, message: 'invalid signature' };

  let event: any;
  try {
    event = JSON.parse(payload);
  } catch {
    return { ok: false, message: 'bad payload' };
  }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event?.type)) {
    return { ok: true, message: 'ignored' };
  }
  const session = event.data?.object || {};
  const orderNo = session.metadata?.order_no || session.client_reference_id;
  const order = await findOrder(env, orderNo);
  if (!order) return { ok: false, message: 'order not found' };
  if (Number(session.amount_total) !== order.amount_cents) return { ok: false, message: 'amount mismatch' };
  if (session.payment_status && session.payment_status !== 'paid') return { ok: false, message: 'unpaid' };
  await markOrderPaid(env, order.id, 'stripe', session.payment_intent || session.id || orderNo);
  return { ok: true, message: 'ok' };
}

/* PayPal：返回页与 webhook 都会调用 capture，capture 本身带 PayPal 服务端校验 */
export async function capturePaypalOrder(env: Env, paypalOrderId: string): Promise<{ ok: boolean; message: string; orderNo?: string }> {
  const cfg = await getPayment(env);
  if (!cfg.paypal.enabled) return { ok: false, message: 'disabled' };
  const paypalBase = cfg.paypal.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const tokenRes = await fetch(`${paypalBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + btoa(`${cfg.paypal.client_id}:${cfg.paypal.client_secret}`),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const tokenData: any = await tokenRes.json().catch(() => null);
  const accessToken = tokenData?.access_token;
  if (!accessToken) return { ok: false, message: 'auth failed' };

  const capRes = await fetch(`${paypalBase}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  const cap: any = await capRes.json().catch(() => null);
  if (!capRes.ok) return { ok: false, message: cap?.message || 'capture failed' };
  if (cap.status !== 'COMPLETED') return { ok: false, message: cap.status || 'not completed' };

  const orderNo = cap.purchase_units?.[0]?.reference_id || '';
  const order = await findOrder(env, orderNo);
  if (!order) return { ok: false, message: 'order not found' };
  const amount = Number(cap.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || 0);
  if (amount > 0 && Math.abs(amount * 100 - order.amount_cents) > 1) {
    return { ok: false, message: 'amount mismatch' };
  }
  const captureId = cap.purchase_units?.[0]?.payments?.captures?.[0]?.id || paypalOrderId;
  await markOrderPaid(env, order.id, 'paypal', captureId);
  return { ok: true, message: 'ok', orderNo };
}

export async function handlePaypalNotify(env: Env, req: Request): Promise<{ ok: boolean; message: string }> {
  const body: any = await req.json().catch(() => null);
  if (!body) return { ok: false, message: 'bad payload' };
  if (body.event_type !== 'CHECKOUT.ORDER.APPROVED') return { ok: true, message: 'ignored' };
  const paypalOrderId = body.resource?.id || '';
  if (!paypalOrderId) return { ok: false, message: 'missing id' };
  const res = await capturePaypalOrder(env, paypalOrderId);
  return res.ok ? { ok: true, message: 'ok' } : { ok: false, message: res.message };
}

/* ------------------------------------------------------------------ */
/* 余额支付                                                            */
/* ------------------------------------------------------------------ */

export async function payWithBalance(
  env: Env,
  order: OrderRow,
  userId: number,
): Promise<{ ok: boolean; message: string }> {
  const res = await env.DB.prepare(
    `UPDATE users SET balance_cents = balance_cents - ? WHERE id = ? AND balance_cents >= ?`,
  )
    .bind(order.amount_cents, userId, order.amount_cents)
    .run();
  if ((res.meta.changes ?? 0) !== 1) return { ok: false, message: '余额不足，请先充值' };
  const fresh = await one<{ balance_cents: number }>(env, 'SELECT balance_cents FROM users WHERE id = ?', userId);
  await env.DB.prepare(
    `INSERT INTO balance_logs (user_id, type, amount_cents, balance_after, order_id, note, created_at)
     VALUES (?, 'consume', ?, ?, ?, ?, ?)`,
  )
    .bind(userId, -order.amount_cents, fresh?.balance_cents ?? 0, order.id, '余额支付订单', Date.now())
    .run();
  await markOrderPaid(env, order.id, 'balance', null);
  return { ok: true, message: 'ok' };
}

/* ------------------------------------------------------------------ */
/* 前端可选支付方式                                                    */
/* ------------------------------------------------------------------ */

export async function availableChannels(env: Env, loggedIn: boolean) {
  const cfg = await getPayment(env);
  const site = await getSite(env);
  const list: { id: string; name: string; desc: string }[] = [];
  if (cfg.epay.enabled) {
    const names: Record<string, string> = { alipay: '支付宝', wxpay: '微信支付', qqpay: 'QQ 钱包' };
    for (const ch of cfg.epay.channels || []) {
      if (!ch.enabled) continue;
      list.push({ id: 'epay', name: ch.name || names[ch.type] || ch.type, desc: `易支付 · ${money(0, site.currency)}0 起付` });
      break; // 前台先展示一个入口，具体通道由网关页选择
    }
  }
  if (cfg.alipay.enabled) list.push({ id: 'alipay', name: '支付宝', desc: '官方当面付 · 扫码/跳转' });
  if (cfg.usdt.enabled) list.push({ id: 'usdt', name: 'USDT', desc: '加密货币 · 自动确认' });
  if (cfg.stripe.enabled) list.push({ id: 'stripe', name: 'Stripe', desc: `国际卡 / 钱包 · ${(cfg.stripe.currency || 'CNY').toUpperCase()}` });
  if (cfg.paypal.enabled) list.push({ id: 'paypal', name: 'PayPal', desc: `国际 PayPal · ${cfg.paypal.currency || 'CNY'}` });
  if (cfg.hashpay.enabled) list.push({ id: 'hashpay', name: 'HashPay', desc: `USDT-TRC20 · ${cfg.hashpay.currency || 'USD'} 结算` });
  if (cfg.balance.enabled && loggedIn) list.push({ id: 'balance', name: '余额支付', desc: '使用账户余额抵扣' });
  if (cfg.mock.enabled) list.push({ id: 'mock', name: '模拟支付', desc: '仅用于测试，立即到账' });
  return list;
}
