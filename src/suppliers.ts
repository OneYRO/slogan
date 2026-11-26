import type { Env, OrderItem } from './types';
import { one, run } from './db';
import { now } from './util';

interface SupplierRow {
  id: number;
  name: string;
  api_url: string;
  api_key: string;
  balance_cents: number;
  enabled: number;
}

interface SupplierProduct {
  supplier_id: number | null;
  supplier_goods_id: string | null;
  auto_purchase: number;
}

async function hmacSha256(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 从上游采购卡密；返回卡密内容数组，失败抛错 */
export async function purchaseFromSupplier(
  env: Env,
  item: OrderItem,
  qty: number,
  orderNo: string,
  email: string,
): Promise<{ contents: string[]; costCents: number; remoteOrderNo: string }> {
  const p = await one<SupplierProduct>(
    env,
    'SELECT supplier_id, supplier_goods_id, auto_purchase FROM products WHERE id = ?',
    item.product_id,
  );
  if (!p?.supplier_id || !p.supplier_goods_id || !p.auto_purchase) {
    throw new Error('商品未配置上游供应商');
  }
  const sup = await one<SupplierRow>(env, 'SELECT * FROM suppliers WHERE id = ? AND enabled = 1', p.supplier_id);
  if (!sup) throw new Error('上游供应商不存在或已停用');

  const ts = Math.floor(Date.now() / 1000);
  const sign = await hmacSha256(sup.api_key, `${orderNo}|${p.supplier_goods_id}|${qty}|${ts}`);
  const payload = {
    action: 'purchase',
    goods_id: p.supplier_goods_id,
    qty,
    order_no: orderNo,
    email,
    timestamp: ts,
  };
  const res = await fetch(sup.api_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': sup.api_key,
      'X-Timestamp': String(ts),
      'X-Sign': sign,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  const rawCards = json?.data?.cards || json?.cards || [];
  const contents = (Array.isArray(rawCards) ? rawCards : [])
    .map((c: any) => (typeof c === 'string' ? c : c?.content))
    .filter((c: any) => typeof c === 'string' && c.trim());
  const costCents = Number(json?.data?.cost_cents ?? json?.cost_cents ?? 0) || 0;
  const remoteOrderNo = String(json?.data?.order_no ?? json?.order_no ?? '');
  const ok = res.ok && json && (json.ok === true || json.success === true || contents.length > 0);

  await run(
    env,
    `INSERT INTO supplier_orders (order_id, order_item_id, supplier_id, product_id, remote_order_no, qty, cost_cents, status, request, response, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    item.order_id,
    item.id,
    sup.id,
    item.product_id,
    remoteOrderNo,
    qty,
    costCents,
    ok ? 'success' : 'failed',
    JSON.stringify(payload),
    text.slice(0, 2000),
    now(),
  );

  if (!ok) throw new Error(`上游采购失败：${text.slice(0, 200)}`);
  if (contents.length < qty) throw new Error(`上游返回卡密数量不足（${contents.length}/${qty}）`);
  if (costCents) {
    await run(env, 'UPDATE suppliers SET balance_cents = MAX(0, balance_cents - ?) WHERE id = ?', costCents, sup.id);
  }
  return { contents: contents.slice(0, qty), costCents, remoteOrderNo };
}
