import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { optionalUser, requireUser, USER_COOKIE, ADMIN_COOKIE, getSessionSubject, cookieHeader, clearCookieHeader, createSession, destroySession, parseCookies, loginGuard, loginClear, clientOf } from '../auth';
import { all, one, run, scalar } from '../db';
import { getSite } from '../settings';
import { getDefaultMerchant } from '../merchants';
import { HttpError, genInviteCode, genOrderNo, genOrderToken, hashPassword, now, pageResult, pager, sha256Hex, verifyPassword } from '../util';
import type { Level, UserRow } from '../types';
import { verifyTurnstile } from '../turnstile';

export const auth = new Hono<AppEnv>();

auth.use('*', optionalUser);

async function publicUser(env: any, u: UserRow) {
  const level = await one<Level>(env, 'SELECT * FROM levels WHERE id = ?', u.level_id);
  const nextLevel = await one<Level>(
    env,
    'SELECT * FROM levels WHERE min_spent_cents > ? ORDER BY min_spent_cents ASC LIMIT 1',
    u.total_spent_cents,
  );
  return {
    id: u.id,
    email: u.email,
    balance_cents: u.balance_cents,
    level_id: u.level_id,
    level_name: level?.name ?? '普通会员',
    level_discount: level?.discount ?? 100,
    total_spent_cents: u.total_spent_cents,
    invite_code: u.invite_code,
    inviter_id: u.inviter_id,
    created_at: u.created_at,
    next_level: nextLevel
      ? { name: nextLevel.name, min_spent_cents: nextLevel.min_spent_cents, gap_cents: nextLevel.min_spent_cents - u.total_spent_cents }
      : null,
  };
}

auth.post('/register', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const inviteCode = String(body.invite_code ?? '').trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, '邮箱格式不正确');
  if (password.length < 8) throw new HttpError(400, '密码至少 8 位');
  if (password.length > 72) throw new HttpError(400, '密码过长');

  const site = await getSite(c.env);
  if (!site.allow_register) throw new HttpError(403, '站点已关闭注册');

  await verifyTurnstile(
    c.env,
    String(body.turnstile_token ?? body.token ?? '').trim(),
    c.req.header('cf-connecting-ip'),
  );

  const exists = await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM users WHERE email = ?', email);
  if (Number(exists) > 0) throw new HttpError(409, '该邮箱已注册');

  let inviterId: number | null = null;
  if (inviteCode) {
    const inviter = await one<UserRow>(c.env, 'SELECT * FROM users WHERE invite_code = ? AND status = ?', inviteCode, 'active');
    if (!inviter) throw new HttpError(400, '邀请码无效');
    inviterId = inviter.id;
  }

  const ts = now();
  const inviteCodeNew = genInviteCode();
  const res = await run(
    c.env,
    `INSERT INTO users (email, password_hash, balance_cents, level_id, invite_code, inviter_id, created_at)
     VALUES (?, ?, 0, 1, ?, ?, ?)`,
    email,
    await hashPassword(password),
    inviteCodeNew,
    inviterId,
    ts,
  );
  const userId = res.meta.last_row_id as number;
  const token = await createSession(c.env, 'user', userId, c.req.raw);
  c.header('Set-Cookie', cookieHeader(USER_COOKIE, token, 30 * 86400, c.req.raw));
  const user = await one<UserRow>(c.env, 'SELECT * FROM users WHERE id = ?', userId);
  return c.json({ ok: true, data: await publicUser(c.env, user!) });
});

auth.post('/login', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) throw new HttpError(400, '请输入邮箱和密码');
  await verifyTurnstile(
    c.env,
    String(body.turnstile_token ?? body.token ?? '').trim(),
    c.req.header('cf-connecting-ip'),
  );
  const { ip } = clientOf(c);
  loginGuard(`user:${ip}:${email}`);
  const user = await one<UserRow>(c.env, 'SELECT * FROM users WHERE email = ?', email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw new HttpError(401, '邮箱或密码错误');
  }
  if (user.status !== 'active') throw new HttpError(403, '账号已被停用，请联系客服');
  loginClear(`user:${ip}:${email}`);
  const token = await createSession(c.env, 'user', user.id, c.req.raw);
  c.header('Set-Cookie', cookieHeader(USER_COOKIE, token, 30 * 86400, c.req.raw));
  await run(c.env, 'UPDATE users SET last_login_at = ? WHERE id = ?', now(), user.id);
  return c.json({ ok: true, data: await publicUser(c.env, user) });
});

auth.post('/logout', async (c) => {
  const token = parseCookies(c.req.header('cookie'))[USER_COOKIE];
  await destroySession(c.env, token);
  c.header('Set-Cookie', clearCookieHeader(USER_COOKIE));
  return c.json({ ok: true });
});

/* 找回密码：始终返回成功，避免邮箱枚举 */
auth.post('/forgot', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, '邮箱格式不正确');
  await verifyTurnstile(
    c.env,
    String(body.turnstile_token ?? body.token ?? '').trim(),
    c.req.header('cf-connecting-ip'),
  );
  const { ip } = clientOf(c);
  loginGuard(`forgot:${ip}`);

  const user = await one<UserRow>(c.env, 'SELECT * FROM users WHERE email = ?', email);
  if (user) {
    const token = genOrderToken();
    const ts = now();
    await run(
      c.env,
      `INSERT INTO password_resets (email, token_hash, expires_at, ip, created_at) VALUES (?, ?, ?, ?, ?)`,
      email,
      await sha256Hex(token),
      ts + 30 * 60 * 1000,
      ip,
      ts,
    );
    const site = await getSite(c.env);
    const link = `${new URL(c.req.url).origin}/reset?token=${encodeURIComponent(token)}`;
    const { sendMail, renderTemplate } = await import('../notify');
    const mail = await renderTemplate(
      c.env,
      'password_reset',
      { site_name: site.name, email, link, expire_minutes: '30' },
      `[${site.name}] 密码重置链接（30 分钟内有效）`,
      `<div style="font-family:sans-serif;padding:24px;color:#111827">
        <h3 style="margin:0 0 10px">重置密码</h3>
        <p style="color:#475569;line-height:1.8">我们收到了您的密码重置请求，点击下面的按钮设置新密码：</p>
        <p style="margin:20px 0"><a href="${link}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px">设置新密码</a></p>
        <p style="color:#94a3b8;font-size:12px;line-height:1.8">链接 30 分钟内有效。如果不是您本人操作，请忽略这封邮件，您的密码不会被修改。</p>
      </div>`,
    );
    await sendMail(c.env, {
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: `请在 30 分钟内打开以下链接设置新密码：${link}`,
    }).catch(() => {});
  }
  loginClear(`forgot:${ip}`);
  return c.json({ ok: true, data: { message: '如果该邮箱已注册，重置链接已发送，请查收邮件（30 分钟内有效）。' } });
});

auth.post('/reset', async (c) => {
  const body = await c.req.json<any>().catch(() => ({}));
  const token = String(body.token ?? '').trim();
  const password = String(body.password ?? '');
  if (password.length < 8) throw new HttpError(400, '密码至少 8 位');
  const rec = await one<any>(
    c.env,
    'SELECT * FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    await sha256Hex(token),
    now(),
  );
  if (!rec) throw new HttpError(400, '重置链接无效或已过期，请重新申请');
  await run(c.env, 'UPDATE users SET password_hash = ? WHERE email = ?', await hashPassword(password), rec.email);
  await run(c.env, 'UPDATE password_resets SET used_at = ? WHERE id = ?', now(), rec.id);
  return c.json({ ok: true, data: { message: '密码已重置，请使用新密码登录' } });
});

auth.get('/me', async (c) => {
  const user = c.get('user');
  if (!user) return c.json({ ok: true, data: null });

  // 同一浏览器已登录后台时，前台头像菜单显示「进入后台」入口
  const adminToken = parseCookies(c.req.header('cookie'))[ADMIN_COOKIE];
  const adminId = await getSessionSubject(c.env, adminToken, 'admin');
  const data: any = await publicUser(c.env, user);
  data.is_admin = !!adminId;
  data.admin_url = adminId ? `/${c.env.ADMIN_PATH || 'admin'}` : null;
  return c.json({ ok: true, data });
});

/** 余额充值：生成一张「充值订单」，支付成功后自动加余额 */
auth.post('/recharge', requireUser, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<any>().catch(() => ({}));
  const amount = Math.round(Number(body.amount_cents ?? 0));
  if (!Number.isFinite(amount) || amount < 100) throw new HttpError(400, '充值金额至少 1 元');
  if (amount > 100000000) throw new HttpError(400, '单笔充值金额过高');

  const ts = now();
  const orderNo = genOrderNo();
  const token = genOrderToken();
  const merchant = await getDefaultMerchant(c.env);
  await run(
    c.env,
    `INSERT INTO orders (order_no, token, user_id, email, status, subtotal_cents, discount_cents, amount_cents,
       note, ip, ua, merchant_id, merchant_slug, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'pending', ?, 0, ?, 'recharge', ?, ?, ?, ?, ?, ?)`,
    orderNo,
    token,
    user.id,
    user.email,
    amount,
    amount,
    clientOf(c).ip,
    clientOf(c).ua,
    merchant.id,
    merchant.slug,
    ts,
    ts,
  );
  return c.json({ ok: true, data: { order_no: orderNo, token, amount_cents: amount } });
});

auth.get('/balance-logs', requireUser, async (c) => {
  const user = c.get('user');
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 20, 50);
  const total = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM balance_logs WHERE user_id = ?', user.id));
  const list = await all(
    c.env,
    'SELECT * FROM balance_logs WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    user.id,
    size,
    offset,
  );
  return c.json({ ok: true, data: { list, ...pageResult([], total, page, size) } });
});

auth.get('/referrals', requireUser, async (c) => {
  const user = c.get('user');
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 20, 50);
  const total = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM referrals WHERE inviter_id = ?', user.id));
  const list = await all(
    c.env,
    `SELECT r.*, o.order_no FROM referrals r JOIN orders o ON o.id = r.order_id
     WHERE r.inviter_id = ? ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    user.id,
    size,
    offset,
  );
  const sum = await scalar<number>(
    c.env,
    'SELECT COALESCE(SUM(amount_cents),0) AS c FROM referrals WHERE inviter_id = ?',
    user.id,
  );
  const invitees = await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM users WHERE inviter_id = ?', user.id);
  return c.json({
    ok: true,
    data: { list, total_cents: Number(sum), invitees: Number(invitees), ...pageResult([], total, page, size) },
  });
});

auth.get('/orders', requireUser, async (c) => {
  const user = c.get('user');
  const url = new URL(c.req.url);
  const { page, size, offset } = pager(url, 10, 50);
  const total = Number(await scalar<number>(c.env, 'SELECT COUNT(*) AS c FROM orders WHERE user_id = ?', user.id));
  const orders = await all<any>(
    c.env,
    'SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?',
    user.id,
    size,
    offset,
  );
  const ids = orders.map((o) => o.id);
  let items: any[] = [];
  if (ids.length) {
    items = await all(
      c.env,
      `SELECT * FROM order_items WHERE order_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`,
      ...ids,
    );
  }
  const data = orders.map((o) => ({
    ...o,
    items: items.filter((it) => it.order_id === o.id),
  }));
  return c.json({ ok: true, data: { list: data, ...pageResult([], total, page, size) } });
});
