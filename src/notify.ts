import type { Env, OrderRow, OrderItem } from './types';
import { getNotify, getSite } from './settings';
import { run } from './db';
import { escapeHTML, money, now } from './util';

interface MailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/* ------------------------------------------------------------------ */
/* 邮件发送                                                            */
/* ------------------------------------------------------------------ */

async function sendViaResend(cfg: any, mail: MailPayload): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.password || cfg.api_key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: cfg.from,
      to: [mail.to],
      subject: mail.subject,
      html: mail.html,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendViaHttp(cfg: any, mail: MailPayload): Promise<void> {
  const url = cfg.webhook_url || cfg.url;
  if (!url) throw new Error('未配置邮件 Webhook 地址');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: mail.to, subject: mail.subject, html: mail.html, text: mail.text }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function sendViaSocket(cfg: any, mail: MailPayload): Promise<void> {
  const { connect } = await import('cloudflare:sockets');
  const host = cfg.host;
  const port = Number(cfg.port) || 465;
  const ssl = cfg.ssl !== false;
  const socket = connect({ hostname: host, port, secure: ssl } as any);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = '';
  const reader = socket.readable.getReader();

  const readResponse = async (): Promise<string> => {
    let lastLine = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        lastLine = line;
        if (/^\d{3} /.test(line)) return line;
      }
    }
    return lastLine;
  };

  const send = async (cmd: string): Promise<string> => {
    const writer = socket.writable.getWriter();
    await writer.write(encoder.encode(cmd + '\r\n'));
    writer.releaseLock();
    return readResponse();
  };

  const greeting = await readResponse();
  if (!greeting.startsWith('220')) throw new Error('SMTP 握手失败: ' + greeting);
  await send(`EHLO ${host}`);
  if (!ssl) {
    const tls = await send('STARTTLS');
    if (tls.startsWith('220')) {
      await (socket as any).startTls();
      await send(`EHLO ${host}`);
    }
  }
  if (cfg.username) {
    const auth = await send('AUTH LOGIN');
    if (auth.startsWith('334')) {
      await send(btoa(cfg.username));
      await send(btoa(cfg.password));
    }
  }
  await send(`MAIL FROM:<${cfg.from}>`);
  await send(`RCPT TO:<${mail.to}>`);
  const data = await send('DATA');
  if (data.startsWith('354')) {
    const boundary = 'fh-' + Math.random().toString(36).slice(2);
    const headers = [
      `From: ${cfg.from}`,
      `To: ${mail.to}`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(mail.subject)))}?=`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];
    const body = [
      ...headers,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=UTF-8',
      '',
      mail.text || '请使用支持 HTML 的邮件客户端查看。',
      `--${boundary}`,
      'Content-Type: text/html; charset=UTF-8',
      '',
      mail.html,
      `--${boundary}--`,
    ].join('\r\n');
    await send(body.replace(/\r?\n/g, '\r\n') + '\r\n.');
  }
  await send('QUIT');
  reader.releaseLock();
  socket.close();
}

export async function sendMail(env: Env, mail: MailPayload): Promise<void> {
  const cfg = await getNotify(env);
  if (!cfg.email.enabled) throw new Error('邮件通知未启用');
  if (cfg.email.provider === 'send_email' && env.SEND_EMAIL) {
    await env.SEND_EMAIL.send({
      to: mail.to,
      from: cfg.email.from,
      subject: mail.subject,
      html: mail.html,
    });
    return;
  }
  if (cfg.email.provider === 'resend') return sendViaResend(cfg.email, mail);
  if (cfg.email.provider === 'http') return sendViaHttp(cfg.email, mail);
  return sendViaSocket(cfg.email, mail);
}

/* ------------------------------------------------------------------ */
/* 通知发送                                                            */
/* ------------------------------------------------------------------ */

async function log(env: Env, channel: string, target: string, subject: string, status: string, error?: string) {
  await run(
    env,
    'INSERT INTO notify_logs (channel, target, subject, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    channel,
    target,
    subject,
    status,
    error ? String(error).slice(0, 500) : null,
    now(),
  ).catch(() => {});
}

export type TemplateKey = 'order_paid' | 'ticket_reply' | 'password_reset';

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return String(tpl || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) =>
    vars[k] != null ? String(vars[k]) : '');
}

/** 读取模板：后台为空时回退到内置模板 */
export async function renderTemplate(
  env: Env,
  key: TemplateKey,
  vars: Record<string, string>,
  fallbackSubject: string,
  fallbackHtml: string,
): Promise<{ subject: string; html: string }> {
  const cfg = await getNotify(env);
  const tpl = (cfg.templates as any)?.[key] || {};
  return {
    subject: tpl.subject ? fillTemplate(tpl.subject, vars) : fallbackSubject,
    html: tpl.html ? fillTemplate(tpl.html, vars) : fallbackHtml,
  };
}

export function orderMailHtml(site: any, order: any, items: any[]) {
  const rows = items
    .map(
      (it) => `<tr>
        <td style="padding:10px;border-bottom:1px solid #eef0f4">${escapeHTML(it.product_name)}${it.sku_name ? ' / ' + escapeHTML(it.sku_name) : ''}</td>
        <td style="padding:10px;border-bottom:1px solid #eef0f4;text-align:center">${it.qty}</td>
        <td style="padding:10px;border-bottom:1px solid #eef0f4;text-align:right">${money(it.amount_cents, site.currency)}</td>
      </tr>`,
    )
    .join('');
  const cards = items
    .filter((it) => it.delivered && it.delivered.length)
    .map(
      (it) => `<div style="margin-top:16px">
        <div style="font-weight:600;color:#111827">${escapeHTML(it.product_name)}</div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:8px;font-family:ui-monospace,monospace;font-size:13px;line-height:1.9;white-space:pre-wrap">${escapeHTML(it.delivered.join('\n'))}</div>
      </div>`,
    )
    .join('');
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f6f7fb;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #eceff5">
      <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:22px 26px;color:#fff">
        <div style="font-size:18px;font-weight:700">${escapeHTML(site.name)}</div>
        <div style="opacity:.85;font-size:13px;margin-top:4px">订单支付成功，感谢您的支持</div>
      </div>
      <div style="padding:24px 26px;color:#111827">
        <div style="display:flex;justify-content:space-between;font-size:14px;color:#475569">
          <span>订单号：${escapeHTML(order.order_no)}</span>
          <span>${money(order.amount_cents, site.currency)}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;margin-top:16px;font-size:14px">
          <thead><tr style="color:#64748b;font-size:12px">
            <th style="text-align:left;padding:8px 10px;background:#f8fafc">商品</th>
            <th style="text-align:center;padding:8px 10px;background:#f8fafc">数量</th>
            <th style="text-align:right;padding:8px 10px;background:#f8fafc">金额</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${cards}
        <div style="margin-top:22px;font-size:12px;color:#94a3b8;line-height:1.8">
          本邮件由系统自动发送，请妥善保管卡密信息。<br/>如有问题请回复本邮件或联系站点客服。
        </div>
      </div>
    </div>
  </div>`;
}

export async function notifyOrderPaid(
  env: Env,
  order: OrderRow,
  items: (OrderItem & { delivered: string[] | null })[],
): Promise<void> {
  const cfg = await getNotify(env);
  const site = await getSite(env);
  const paidItems = items.filter((i) => i.delivered && i.delivered.length > 0);

  if (cfg.email.enabled) {
    try {
      const itemsHtml = items.map((it) => `<tr>
        <td style="padding:10px;border-bottom:1px solid #eef0f4">${escapeHTML(it.product_name)}${it.sku_name ? ' / ' + escapeHTML(it.sku_name) : ''}</td>
        <td style="padding:10px;border-bottom:1px solid #eef0f4;text-align:center">${it.qty}</td>
        <td style="padding:10px;border-bottom:1px solid #eef0f4;text-align:right">${money(it.amount_cents, site.currency)}</td>
      </tr>`).join('');
      const cardsHtml = paidItems.map((it) => `<div style="margin-top:16px">
        <div style="font-weight:600;color:#111827">${escapeHTML(it.product_name)}</div>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:8px;font-family:ui-monospace,monospace;font-size:13px;line-height:1.9;white-space:pre-wrap">${escapeHTML(it.delivered!.join('\n'))}</div>
      </div>`).join('');
      const vars = {
        site_name: site.name,
        order_no: order.order_no,
        amount: money(order.amount_cents, site.currency),
        email: order.email,
        created_at: new Date(Number(order.created_at)).toLocaleString('zh-CN'),
        items: itemsHtml,
        cards: cardsHtml,
      };
      const mail = await renderTemplate(
        env,
        'order_paid',
        vars,
        `[${site.name}] 订单 ${order.order_no} 支付成功${paidItems.length ? '，卡密已发货' : ''}`,
        orderMailHtml(site, order, items as any[]),
      );
      await sendMail(env, {
        to: order.email,
        subject: mail.subject,
        html: mail.html,
        text: `订单 ${order.order_no} 支付成功，金额 ${money(order.amount_cents, site.currency)}\n` +
          paidItems.map((i) => `${i.product_name}：\n${i.delivered!.join('\n')}`).join('\n\n'),
      });
      await log(env, 'email', order.email, `订单 ${order.order_no}`, 'ok');
    } catch (e) {
      await log(env, 'email', order.email, `订单 ${order.order_no}`, 'fail', String(e));
    }
  }

  if (cfg.telegram.enabled) {
    try {
      const text = [
        `🛒 *新订单*`,
        `站点：${site.name}`,
        `订单号：${order.order_no}`,
        `金额：${money(order.amount_cents, site.currency)}`,
        `商品：${items.map((i) => `${i.product_name} x${i.qty}`).join('、')}`,
        `邮箱：${order.email}`,
        `状态：${order.status === 'delivered' ? '已自动发货' : '待人工发货'}`,
      ].join('\n');
      const res = await fetch(
        `https://api.telegram.org/bot${cfg.telegram.bot_token}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: cfg.telegram.chat_id, text, parse_mode: 'Markdown' }),
        },
      );
      if (!res.ok) throw new Error(await res.text());
      await log(env, 'telegram', cfg.telegram.chat_id, `订单 ${order.order_no}`, 'ok');
    } catch (e) {
      await log(env, 'telegram', cfg.telegram.chat_id, `订单 ${order.order_no}`, 'fail', String(e));
    }
  }

  if (cfg.webhook.enabled && cfg.webhook.url) {
    try {
      const res = await fetch(cfg.webhook.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'order.paid',
          order: { order_no: order.order_no, amount_cents: order.amount_cents, email: order.email, status: order.status },
          items: items.map((i) => ({
            product_id: i.product_id,
            product_name: i.product_name,
            qty: i.qty,
            delivered: i.delivered,
          })),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await log(env, 'webhook', cfg.webhook.url, `订单 ${order.order_no}`, 'ok');
    } catch (e) {
      await log(env, 'webhook', cfg.webhook.url, `订单 ${order.order_no}`, 'fail', String(e));
    }
  }
}

/** 后台「发送测试」 */
export async function sendTest(env: Env, target: string): Promise<void> {
  const site = await getSite(env);
  await sendMail(env, {
    to: target,
    subject: `[${site.name}] 邮件通知测试`,
    html: `<div style="font-family:sans-serif;padding:24px"><h2 style="color:#111827">邮件配置成功</h2>
      <p style="color:#475569">这是一封来自 ${escapeHTML(site.name)} 的测试邮件，收到说明 SMTP 配置可用。</p></div>`,
    text: '邮件配置成功',
  });
}
