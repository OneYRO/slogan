import type { Env } from './types';
import { getSecurity } from './settings';
import { HttpError } from './util';

/**
 * 校验 Cloudflare Turnstile token。
 * 只有后台开启 Turnstile 后才校验；关闭时不消耗任何请求。
 */
export async function verifyTurnstile(env: Env, token: string, remoteIp?: string): Promise<void> {
  const security = await getSecurity(env);
  const turnstile = security.turnstile;

  if (!turnstile?.enabled) return;
  if (!turnstile.site_key || !turnstile.secret_key) {
    throw new HttpError(503, 'Turnstile 配置不完整，请联系管理员');
  }
  if (!token) throw new HttpError(400, '请先完成人机验证');

  const form = new URLSearchParams({
    secret: turnstile.secret_key,
    response: token,
  });
  if (remoteIp) form.set('remoteip', remoteIp);

  let res: Response;
  try {
    res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
  } catch {
    throw new HttpError(502, '人机验证服务暂时不可用，请稍后重试');
  }

  const result = await res.json().catch(() => null) as { success?: boolean } | null;
  if (!res.ok || !result?.success) {
    throw new HttpError(400, '人机验证失败，请刷新页面后重试');
  }
}
