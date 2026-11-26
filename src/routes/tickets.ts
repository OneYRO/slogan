import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { requireUser } from '../auth';
import { all, one, run, scalar } from '../db';
import { HttpError, now, pager, pageResult } from '../util';
import { resolveMerchant } from '../merchants';

export const tickets = new Hono<AppEnv>();

tickets.use('*', requireUser);

tickets.get('/', async (c) => {
  const user = c.get('user');
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 20, 50);
  const total = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM tickets WHERE user_id = ?', user.id));
  const list = await all(
    c.env,
    'SELECT * FROM tickets WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
    user.id,
    size,
    offset,
  );
  return c.json({ ok: true, data: { list, ...pageResult([], total, page, size) } });
});

tickets.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<any>().catch(() => ({}));
  const subject = String(body.subject ?? '').trim();
  const content = String(body.content ?? '').trim();
  if (!subject || subject.length < 2) throw new HttpError(400, '请填写工单标题');
  if (!content || content.length < 5) throw new HttpError(400, '请描述你遇到的问题（至少 5 个字）');

  const merchant = await resolveMerchant(c.env, c.req.raw);
  const ts = now();
  const res = await run(
    c.env,
    'INSERT INTO tickets (user_id, email, subject, status, merchant_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    user.id,
    user.email,
    subject.slice(0, 100),
    'open',
    merchant.id,
    ts,
    ts,
  );
  const id = res.meta.last_row_id as number;
  await run(
    c.env,
    'INSERT INTO ticket_messages (ticket_id, sender_type, content, created_at) VALUES (?, ?, ?, ?)',
    id,
    'user',
    content.slice(0, 2000),
    ts,
  );
  return c.json({ ok: true, data: { id } });
});

tickets.get('/:id', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const ticket = await one<any>(c.env, 'SELECT * FROM tickets WHERE id = ? AND user_id = ?', id, user.id);
  if (!ticket) throw new HttpError(404, '工单不存在');
  const messages = await all(
    c.env,
    'SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC',
    id,
  );
  return c.json({ ok: true, data: { ...ticket, messages } });
});

tickets.post('/:id/messages', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  const ticket = await one<any>(c.env, 'SELECT * FROM tickets WHERE id = ? AND user_id = ?', id, user.id);
  if (!ticket) throw new HttpError(404, '工单不存在');
  if (ticket.status === 'closed') throw new HttpError(400, '工单已关闭，请提交新工单');
  const body = await c.req.json<any>().catch(() => ({}));
  const content = String(body.content ?? '').trim();
  if (!content) throw new HttpError(400, '回复内容不能为空');
  const ts = now();
  await run(
    c.env,
    'INSERT INTO ticket_messages (ticket_id, sender_type, content, created_at) VALUES (?, ?, ?, ?)',
    id,
    'user',
    content.slice(0, 2000),
    ts,
  );
  await run(c.env, 'UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?', 'open', ts, id);
  return c.json({ ok: true });
});
