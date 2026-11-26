import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { Admin, Env, UserRow } from './types';
import { one, run, scalar } from './db';
import { HttpError, assert, clientIP, ipMask, now, randomString, safeEqual, sha256Hex } from './util';
import { verifyPassword } from './util';

export type AppEnv = {
  Bindings: Env;
  Variables: {
    admin: Admin;
    user: UserRow;
  };
};

export const ADMIN_COOKIE = 'fh_admin';
export const USER_COOKIE = 'fh_user';
const ADMIN_TTL = 7 * 86400;
const USER_TTL = 30 * 86400;

/* ------------------------------------------------------------------ */
/* Cookie 工具                                                         */
/* ------------------------------------------------------------------ */

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function cookieHeader(name: string, value: string, maxAge: number, req: Request): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function clearCookieHeader(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

export async function createSession(
  env: Env,
  kind: 'admin' | 'user',
  subjectId: number,
  req: Request,
): Promise<string> {
  const token = randomString(48, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  const tokenHash = await sha256Hex(token);
  const ts = now();
  const ttl = kind === 'admin' ? ADMIN_TTL : USER_TTL;
  await run(
    env,
    `INSERT INTO sessions (token_hash, kind, subject_id, expires_at, created_at, ua, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    tokenHash,
    kind,
    subjectId,
    ts + ttl * 1000,
    ts,
    req.headers.get('user-agent')?.slice(0, 200) ?? '',
    ipMask(clientIP(req)),
  );
  // 顺手清理过期会话（低频）
  if (Math.random() < 0.05) {
    await run(env, 'DELETE FROM sessions WHERE expires_at < ?', ts).catch(() => {});
  }
  return token;
}

export async function getSessionSubject(
  env: Env,
  token: string | undefined,
  kind: 'admin' | 'user',
): Promise<number | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await one<{ subject_id: number; expires_at: number }>(
    env,
    'SELECT subject_id, expires_at FROM sessions WHERE token_hash = ? AND kind = ?',
    tokenHash,
    kind,
  );
  if (!row) return null;
  if (row.expires_at < now()) {
    await run(env, 'DELETE FROM sessions WHERE token_hash = ?', tokenHash).catch(() => {});
    return null;
  }
  return row.subject_id;
}

export async function destroySession(env: Env, token: string | undefined): Promise<void> {
  if (!token) return;
  await run(env, 'DELETE FROM sessions WHERE token_hash = ?', await sha256Hex(token)).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = parseCookies(c.req.header('cookie'))[ADMIN_COOKIE];
  const adminId = await getSessionSubject(c.env, token, 'admin');
  if (!adminId) throw new HttpError(401, '请先登录后台');
  const admin = await one<Admin>(c.env, 'SELECT id, username, role, merchant_id, created_at, last_login_at FROM admins WHERE id = ?', adminId);
  if (!admin) throw new HttpError(401, '登录已失效');
  c.set('admin', admin);
  await next();
});

export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = parseCookies(c.req.header('cookie'))[USER_COOKIE];
  const userId = await getSessionSubject(c.env, token, 'user');
  if (!userId) throw new HttpError(401, '请先登录');
  const user = await one<UserRow>(c.env, 'SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw new HttpError(401, '登录已失效');
  if (user.status !== 'active') throw new HttpError(403, '账号已被停用，请联系客服');
  c.set('user', user);
  await next();
});

export const optionalUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = parseCookies(c.req.header('cookie'))[USER_COOKIE];
  const userId = await getSessionSubject(c.env, token, 'user');
  if (userId) {
    const user = await one<UserRow>(c.env, 'SELECT * FROM users WHERE id = ?', userId);
    if (user && user.status === 'active') c.set('user', user);
  }
  await next();
});

/* ------------------------------------------------------------------ */
/* 登录限流（单 isolate 内存，配合 KV 可跨节点）                        */
/* ------------------------------------------------------------------ */

const attempts = new Map<string, { count: number; reset: number }>();

export function loginGuard(key: string, limit = 10, windowMs = 15 * 60 * 1000): void {
  const ts = now();
  const rec = attempts.get(key);
  if (!rec || rec.reset < ts) {
    attempts.set(key, { count: 1, reset: ts + windowMs });
    return;
  }
  rec.count += 1;
  if (rec.count > limit) throw new HttpError(429, '尝试次数过多，请 15 分钟后再试');
}

export function loginClear(key: string): void {
  attempts.delete(key);
}

export async function assertInitialized(env: Env): Promise<void> {
  const count = await scalar<number>(env, 'SELECT COUNT(*) AS c FROM admins');
  assert(Number(count) > 0, 503, '系统尚未初始化管理员');
}

export function clientOf(c: Context<AppEnv>) {
  return {
    ip: ipMask(clientIP(c.req.raw)),
    ua: c.req.header('user-agent')?.slice(0, 200) ?? '',
  };
}
