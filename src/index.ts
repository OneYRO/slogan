import { Hono } from 'hono';
import type { AppEnv } from './auth';
import { HttpError, clientIP, escapeHTML, parseJSON } from './util';
import { closeExpiredOrders } from './orders';
import { site } from './routes/site';
import { auth } from './routes/auth';
import { checkout } from './routes/checkout';
import { pay } from './routes/pay';
import { tickets } from './routes/tickets';
import { admin, adminPublic } from './routes/admin';
import { media } from './routes/media';
import { getSite } from './settings';
import { one } from './db';
import { merchantSiteConfig, resolveMerchant } from './merchants';

const app = new Hono<AppEnv>();

/* ------------------------- 全局安全中间件 ------------------------- */
app.use('/api/*', async (c, next) => {
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  const len = Number(c.req.header('content-length') || 0);
  if (len > 8 * 1024 * 1024) return c.json({ ok: false, error: '请求体过大' }, 403);

  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== new URL(c.req.url).host) {
          return c.json({ ok: false, error: '跨域请求被拒绝' }, 403);
        }
      } catch {
        return c.json({ ok: false, error: '请求来源异常' }, 403);
      }
    }
  }
  await next();
});

/* 简单限流：单 IP 每分钟 180 次写请求 */
const buckets = new Map<string, { n: number; reset: number }>();
app.use('/api/*', async (c, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return next();
  const key = clientIP(c.req.raw);
  const nowTs = Date.now();
  const rec = buckets.get(key);
  if (!rec || rec.reset < nowTs) {
    buckets.set(key, { n: 1, reset: nowTs + 60000 });
  } else {
    rec.n += 1;
    if (rec.n > 180) return c.json({ ok: false, error: '操作过于频繁，请稍后再试' }, 429);
  }
  if (buckets.size > 5000) buckets.clear();
  await next();
});

/* ------------------------- 错误处理 ------------------------- */
app.onError((err, c) => {
  if (err instanceof HttpError) {
    return c.json({ ok: false, error: err.message }, err.status as any);
  }
  console.error('[slogan]', err);
  return c.json({ ok: false, error: '服务器开小差了，请稍后再试' }, 500);
});

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ ok: false, error: '接口不存在' }, 404);
  return c.text('Not Found', 404);
});

/* ------------------------- API 路由 ------------------------- */
app.route('/api', site);
app.route('/api/auth', auth);
app.route('/api', checkout);
app.route('/api/pay', pay);
app.route('/api/tickets', tickets);
app.route('/api/admin', adminPublic);
app.route('/api/admin', admin);
app.route('/api/admin/media', media);

/* ------------------------- 媒体文件（R2 直出） ------------------------- */
app.get('/media/*', async (c) => {
  const bucket = c.env.BUCKET;
  const key = decodeURIComponent(c.req.path.slice('/media/'.length));
  if (!bucket || !key || key.includes('..')) return c.text('Not Found', 404);
  const obj = await bucket.get(key);
  if (!obj) return c.text('Not Found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(obj.body, { headers });
});

/* ------------------------- 页面路由 ------------------------- */
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
};

/** 服务端注入 SEO / OG 信息，保证分享卡片与爬虫可读 */
async function renderSpa(c: any, path: string) {
  const merchant = await resolveMerchant(c.env, c.req.raw);
  const site = await merchantSiteConfig(c.env, merchant);
  const origin = new URL(c.req.url).origin;
  let title = site.seo_title || `${site.name} · 自动发货`;
  let desc = site.seo_description || site.description || '';
  let keywords = site.seo_keywords || '';
  let image = '';

  const m = path.match(/^\/product\/(\d+)/);
  if (m) {
    const p = await one<any>(c.env, 'SELECT name, description, images FROM products WHERE id = ? AND merchant_id = ?', Number(m[1]), merchant.id);
    if (p) {
      title = `${p.name} - ${site.name}`;
      desc = String(p.description || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const imgs = parseJSON<string[]>(p.images, []);
      image = imgs[0] || '';
    }
  }
  if (!image) image = site.og_image || site.logo || '';
  if (image && image.startsWith('/')) image = origin + image;

  const asset = await c.env.ASSETS.fetch(new Request(origin + '/index.html', { method: 'GET' }));
  let html = await asset.text();
  const repl: Record<string, string> = {
    '{{SEO_TITLE}}': escapeHTML(title),
    '{{SEO_DESC}}': escapeHTML(desc),
    '{{SEO_KEYWORDS}}': escapeHTML(keywords),
    '{{CANONICAL}}': escapeHTML(origin + path),
    '{{SITE_NAME}}': escapeHTML(site.name),
    '{{OG_IMAGE}}': escapeHTML(image),
  };
  for (const [k, v] of Object.entries(repl)) html = html.split(k).join(v);
  const headers = new Headers(asset.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.delete('Content-Length');
  for (const [k, v] of Object.entries(securityHeaders)) headers.set(k, v);
  return new Response(html, { status: 200, headers });
}

async function serveAsset(c: any, path: string) {
  const url = new URL(c.req.url);
  const asset = await c.env.ASSETS.fetch(new Request(url.origin + path, { method: 'GET' }));
  const headers = new Headers(asset.headers);
  for (const [k, v] of Object.entries(securityHeaders)) headers.set(k, v);
  return new Response(asset.body, { status: asset.status, headers });
}

app.all('*', async (c) => {
  const url = new URL(c.req.url);
  const path = url.pathname;
  const site = await getSite(c.env);
  const adminPath = '/' + String(c.env.ADMIN_PATH || 'admin').replace(/^\/+|\/+$/g, '');

  // 维护模式：后台与 API 不受影响
  if (site.maintenance && !path.startsWith(adminPath) && !path.startsWith('/api/')) {
    return c.html(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
       <meta name="viewport" content="width=device-width,initial-scale=1">
       <title>站点维护中 - ${escapeHTML(site.name)}</title>
       <style>
        body{margin:0;min-height:100vh;display:grid;place-items:center;background:
          radial-gradient(1200px 600px at 20% 0%,#1e1b4b 0%,#0b1020 55%,#020617 100%);
          color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
        .box{max-width:520px;padding:40px 36px;border:1px solid rgba(255,255,255,.08);border-radius:20px;
          background:rgba(255,255,255,.04);backdrop-filter:blur(12px)}
        .dot{width:10px;height:10px;border-radius:50%;background:#fbbf24;box-shadow:0 0 0 6px rgba(251,191,36,.15);
          display:inline-block;margin-right:10px}
        h1{font-size:22px;margin:0 0 12px}
        p{color:#94a3b8;line-height:1.8;font-size:14px;margin:0}
       </style></head><body><div class="box"><div><span class="dot"></span>站点维护中</div>
       <h1>${escapeHTML(site.name)} 正在升级</h1>
       <p>系统维护期间暂时无法下单，已支付的订单不受影响，请稍后刷新页面。</p>
       </div></body></html>`,
      503,
    );
  }

  // 后台页面（路径可在环境变量中自定义）
  if (path === adminPath || path.startsWith(adminPath + '/') || path === '/setup') {
    return serveAsset(c, '/admin/index.html');
  }

  // 静态资源
  if (
    path.startsWith('/assets/') ||
    path === '/favicon.ico' ||
    path === '/favicon.svg' ||
    path === '/robots.txt' ||
    path === '/og-image.png'
  ) {
    return serveAsset(c, path);
  }

  // 其余路径交给前台 SPA（服务端注入 SEO）
  return renderSpa(c, path);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: any, ctx: ExecutionContext) {
    ctx.waitUntil(closeExpiredOrders(env));
  },
} satisfies ExportedHandler<any>;
