import { Hono } from 'hono';
import type { AppEnv } from '../auth';
import { requireAdmin } from '../auth';
import { HttpError } from '../util';

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml',
]);
const MAX_SIZE = 5 * 1024 * 1024;

function extOf(type: string, name: string) {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif', 'image/svg+xml': 'svg',
  };
  if (map[type]) return map[type];
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name || '');
  return m ? m[1].toLowerCase() : 'bin';
}

export const media = new Hono<AppEnv>();
media.use('*', requireAdmin);
media.use('*', async (c, next) => {
  if (c.get('admin')?.merchant_id != null) throw new HttpError(403, '媒体库仅平台管理员可用');
  await next();
});

/** 媒体库列表（R2 绑定存在时可用） */
media.get('/', async (c) => {
  const bucket = c.env.BUCKET;
  if (!bucket) return c.json({ ok: true, data: { available: false, list: [] } });
  const listed = await bucket.list({ limit: 300 });
  const list = listed.objects.map((o) => ({
    key: o.key,
    url: `/media/${o.key}`,
    size: o.size,
    uploaded: o.uploaded,
  }));
  return c.json({ ok: true, data: { available: true, list } });
});

/** 上传图片（multipart/form-data，字段名 file） */
media.post('/', async (c) => {
  const bucket = c.env.BUCKET;
  if (!bucket) throw new HttpError(400, '未绑定 R2 存储桶：请在 wrangler.jsonc 配置 r2_buckets 并执行 wrangler r2 bucket create');
  const form = await c.req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) throw new HttpError(400, '请选择要上传的图片');
  if (!ALLOWED.has(file.type)) throw new HttpError(400, '仅支持 JPG / PNG / WebP / GIF / AVIF / SVG');
  if (file.size > MAX_SIZE) throw new HttpError(400, '图片不能超过 5MB');
  const key = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${extOf(file.type, file.name)}`;
  await bucket.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return c.json({
    ok: true,
    data: { key, url: `/media/${key}`, size: file.size, uploaded: Date.now() },
  });
});

/** 删除图片 */
media.delete('/:key{.+}', async (c) => {
  const bucket = c.env.BUCKET;
  if (!bucket) throw new HttpError(400, '未绑定 R2 存储桶');
  const key = decodeURIComponent(c.req.param('key'));
  if (!/^\d{4}-\d{2}\/[a-zA-Z0-9-]+\.[a-zA-Z0-9]{2,5}$/.test(key)) throw new HttpError(400, '非法的媒体路径');
  await bucket.delete(key);
  return c.json({ ok: true });
});
