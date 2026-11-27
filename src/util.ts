import type { Env } from './types';

export interface Ctx {
  env: Env;
  req: Request;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const now = () => Date.now();
export const ok = (data: unknown = {}, init: ResponseInit = {}) =>
  Response.json({ ok: true, data }, init);
export const fail = (status: number, message: string) =>
  Response.json({ ok: false, error: message }, { status });

export function assert(cond: unknown, status: number, message: string): asserts cond {
  if (!cond) throw new HttpError(status, message);
}

const ALNUM = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomString(len: number, alphabet = ALNUM): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let s = '';
  for (let i = 0; i < len; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

export function genInviteCode(): string {
  return randomString(8);
}

export function genOrderNo(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `FH${stamp}${randomString(4, '0123456789')}`;
}

export function genOrderToken(): string {
  return randomString(24);
}

export function toInt(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : def;
}

export function toCents(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, '金额格式错误');
  return Math.round(n * 100);
}

export function centsToYuan(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function money(cents: number, symbol = '¥'): string {
  return `${symbol}${centsToYuan(cents)}`;
}

export function parseJSON<T>(raw: unknown, def: T): T {
  if (raw == null) return def;
  if (typeof raw !== 'string') return raw as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return def;
  }
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 常数时间比较，避免时序侧信道 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function clientIP(req: Request): string {
  const h = req.headers;
  return (
    h.get('cf-connecting-ip') ||
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    h.get('x-real-ip') ||
    '0.0.0.0'
  );
}

export function ipMask(ip: string): string {
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::';
  const p = ip.split('.');
  if (p.length === 4) return `${p[0]}.${p[1]}.*.*`;
  return ip;
}

export function escapeHTML(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function maskCard(content: string): string {
  const s = String(content).replace(/\s+/g, ' ').trim();
  if (s.length <= 8) return s.slice(0, 2) + '••••••';
  return s.slice(0, 4) + '••••••' + s.slice(-3);
}

/** 隐藏邮箱中间部分 */
export function maskEmail(email: string): string {
  const [u, d] = String(email).split('@');
  if (!u || !d) return String(email);
  const head = u.slice(0, 2);
  return `${head}${'•'.repeat(Math.max(3, Math.min(6, u.length - 2)))}@${d}`;
}

/** 分页参数 */
export function pager(url: URL, defSize = 20, maxSize = 100) {
  const pageParam = url.searchParams.get('page');
  const sizeParam = url.searchParams.get('size');
  const page = Math.max(1, pageParam ? toInt(pageParam, 1) : 1);
  const size = clamp(sizeParam ? toInt(sizeParam, defSize) : defSize, 1, maxSize);
  return { page, size, offset: (page - 1) * size };
}

export function intOrNull(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/* ------------------------------------------------------------------ */
/* 哈希与签名                                                          */
/* ------------------------------------------------------------------ */

const encoder = new TextEncoder();

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacSha256(key: string, data: string): Promise<string> {
  const raw = encoder.encode(key);
  const ck = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', ck, encoder.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function pbkdf2(password: string, salt: string, iterations = 120000): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomString(16, 'abcdef0123456789');
  const hash = await pbkdf2(password, salt);
  return `pbkdf2$120000$${salt}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = String(stored).split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iter, salt, hash] = parts;
  const calc = await pbkdf2(password, salt, Number(iter) || 120000);
  return safeEqual(calc, hash);
}

export async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(value));
}

/* ------------------------- MD5（易支付签名用） ------------------------- */

const MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];

const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

function rotl(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

export function md5(input: string): string {
  const msg = encoder.encode(input);
  const len = msg.length;
  const total = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = len * 8;
  dv.setUint32(total - 8, bitLen >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bitLen / 0x100000000), true);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  const M = new Uint32Array(16);

  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let a = h0, b = h1, c = h2, d = h3;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl((a + f + MD5_K[i] + M[g]) >>> 0, MD5_S[i])) >>> 0;
      a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
  }
  const hex = (n: number) => [0, 8, 16, 24].map((s) => ((n >>> s) & 0xff).toString(16).padStart(2, '0')).join('');
  return hex(h0) + hex(h1) + hex(h2) + hex(h3);
}

/** 易支付/BEpusdt 通用签名：按 key 升序拼接 k=v&... + 密钥 */
export function signWithKey(params: Record<string, string | number | undefined | null>, key: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign' && k !== 'sign_type' && params[k] !== undefined && params[k] !== null && params[k] !== '')
    .sort();
  const base = keys.map((k) => `${k}=${params[k]}`).join('&');
  return md5(base + key);
}

/* ------------------------- RSA（支付宝） ------------------------- */

function pemToBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----(BEGIN|END)[^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export async function rsaSign(privateKeyPem: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBuffer(privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function rsaVerify(publicKeyPem: string, data: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      'spki',
      pemToBuffer(publicKeyPem),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const bin = atob(signature);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, buf.buffer, encoder.encode(data));
  } catch {
    return false;
  }
}

export function randomBytesHex(n: number): string {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function baseUrl(req: Request): string {
  const u = new URL(req.url);
  return `${u.protocol}//${u.host}`;
}

/** 生成分页返回体 */
export function pageResult<T>(list: T[], total: number, page: number, size: number) {
  return { total, page, size, pages: Math.max(1, Math.ceil(total / size)) };
}

export function dateRange(param: string | null): { start: number; end: number } | null {
  if (!param) return null;
  const m = param.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const end = start + 86400000;
  return { start, end };
}

export function dayStart(ts = Date.now()): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/* ------------------------------------------------------------------ */
/* TOTP（RFC 6238，SHA-1，30 秒）                                      */
/* ------------------------------------------------------------------ */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Uint8Array {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function randomBase32(bytes = 20): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}

export async function totpCode(secret: string, ts = Date.now(), step = 30): Promise<string> {
  const counter = Math.floor(ts / 1000 / step);
  const msg = new ArrayBuffer(8);
  new DataView(msg).setBigUint64(0, BigInt(counter));
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret) as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}

export async function verifyTotpStep(secret: string, code: string, window = 1): Promise<number | null> {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean) || !secret) return null;
  const base = Math.floor(Date.now() / 30000);
  for (let w = -window; w <= window; w++) {
    const step = base + w;
    const expect = await totpCode(secret, step * 30000);
    if (safeEqual(expect, clean)) return step;
  }
  return null;
}

export async function verifyTotp(secret: string, code: string, window = 1): Promise<boolean> {
  return (await verifyTotpStep(secret, code, window)) !== null;
}
