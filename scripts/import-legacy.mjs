/**
 * 旧系统数据迁移：CSV → Slogan（D1）
 *
 * 用法：
 *   1) 复制 legacy.config.example.json 为 legacy.config.json，按老库导出的 CSV 列名改 map
 *   2) node scripts/import-legacy.mjs            # 生成 legacy-import.sql
 *   3) npx wrangler d1 execute slogan --local  --file ./legacy-import.sql
 *      npx wrangler d1 execute slogan --remote --file ./legacy-import.sql
 *
 * 说明：
 *   - 只迁移「商品 / 卡密 / 会员」三类高价值数据；历史订单建议保留在原库备查
 *   - 老系统的 bcrypt/MD5 密码无法直接复用，导入用户会写入随机密码，
 *     由管理员在后台「用户 → 编辑」里重置，或让用户走「找回密码」
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const configPath = process.argv[2] || 'legacy.config.json';
if (!existsSync(configPath)) {
  console.error(`缺少配置文件 ${configPath}，请复制 legacy.config.example.json 并按实际列名修改`);
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(configPath, 'utf8'));

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      continue;
    }
    field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function loadTable(section) {
  const spec = cfg[section];
  if (!spec || !spec.file || !existsSync(spec.file)) return [];
  const rows = parseCsv(readFileSync(spec.file, 'utf8'));
  const head = rows.shift().map((h) => h.trim());
  return rows.slice(0, spec.limit || 50000).map((r) => {
    const obj = {};
    head.forEach((h, i) => {
      obj[h] = (r[i] ?? '').trim();
    });
    return obj;
  });
}

function pick(row, spec, keys, fallback = '') {
  for (const k of keys) {
    const col = spec.map?.[k];
    if (!col) continue;
    if (Array.isArray(col)) {
      const parts = col.map((c) => (row[c] ?? '').trim()).filter(Boolean);
      if (parts.length) return parts.join(spec.joiner || '----');
      continue;
    }
    if (row[col] !== undefined && row[col] !== '') return row[col];
  }
  return fallback;
}

function esc(v) {
  return `'${String(v ?? '').replace(/'/g, "''")}'`;
}

function toCents(v) {
  const n = Number(String(v ?? '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const out = [];
out.push('-- 由 scripts/import-legacy.mjs 生成，请先备份 D1 后再执行');
out.push('PRAGMA foreign_keys = OFF;');

/* ---------------- 分类 ---------------- */
const defaultCategory = cfg.category?.name || '老数据导入';
out.push(
  `INSERT OR IGNORE INTO categories (name, slug, icon, description, sort, enabled, created_at) VALUES (${esc(
    defaultCategory,
  )}, ${esc('legacy')}, '📦', ${esc('由老系统导入')}, 99, 1, ${Date.now()});`,
);
const categoryIdExpr = `(SELECT id FROM categories WHERE slug = 'legacy')`;

/* ---------------- 商品 ---------------- */
const products = loadTable('products');
const productIds = new Map();
let idx = 0;
for (const row of products) {
  const spec = cfg.products;
  const name = pick(row, spec, ['name'], '');
  if (!name) continue;
  idx += 1;
  const price = toCents(pick(row, spec, ['price_yuan', 'price'], 0));
  const cost = toCents(pick(row, spec, ['cost_yuan', 'cost'], 0));
  const stock = Number(pick(row, spec, ['stock'], 0)) || 0;
  const desc = pick(row, spec, ['description', 'content'], '');
  const mode = spec.default?.delivery_mode || 'auto';
  const slug = `legacy-${idx}`;
  out.push(
    `INSERT INTO products (category_id, name, slug, description, images, delivery_mode, price_cents, member_price_cents, wholesale_tiers, stock, cost_cents, min_qty, max_qty, limit_per_user, pick_enabled, pick_fee_cents, content, status, is_recommend, sort, created_at, updated_at) VALUES (${categoryIdExpr}, ${esc(
      name,
    )}, ${esc(slug)}, ${esc(desc)}, '[]', '${mode}', ${price}, NULL, '[]', ${mode === 'auto' ? 0 : stock}, ${cost}, 1, 99, 0, 0, 0, NULL, 'on', 0, ${idx}, ${Date.now()}, ${Date.now()});`,
  );
  productIds.set(slug, name);
}

/* ---------------- 卡密 ---------------- */
const cards = cfg.cards ? loadTable('cards') : [];
let cardCount = 0;
const cardSpec = cfg.cards || { map: {} };
for (const row of cards) {
  const content = pick(row, cardSpec, ['content', 'card'], '');
  if (!content) continue;
  const productRef = pick(row, cardSpec, ['product', 'goods', 'product_name'], '');
  const productMatch =
    [...productIds.entries()].find(([, name]) => productRef && (String(name) === productRef || String(name).includes(productRef))) ||
    null;
  const productSlug = productMatch ? productMatch[0] : cfg.cards.fallback_product || [...productIds.keys()][0];
  if (!productSlug) continue;
  out.push(
    `INSERT INTO cards (product_id, sku_id, content, status, created_at) SELECT id, NULL, ${esc(
      content.slice(0, 500),
    )}, 'unused', ${Date.now()} FROM products WHERE slug = ${esc(productSlug)};`,
  );
  cardCount += 1;
}

/* ---------------- 会员 ---------------- */
const users = cfg.users ? loadTable('users') : [];
let userCount = 0;
for (const row of users) {
  const email = pick(row, cfg.users, ['email'], '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
  const balance = toCents(pick(row, cfg.users, ['balance_yuan', 'balance'], 0));
  const invite = randomBytes(4).toString('hex').toUpperCase();
  // 随机密码占位，登录时无法通过校验；管理员可在后台重置
  const placeholder = randomBytes(16).toString('hex');
  out.push(
    `INSERT INTO users (email, password_hash, balance_cents, level_id, invite_code, inviter_id, total_spent_cents, status, created_at, last_login_at) VALUES (${esc(
      email,
    )}, ${esc('legacy!' + placeholder)}, ${balance}, 1, ${esc(invite)}, NULL, 0, 'active', ${Date.now()}, NULL);`,
  );
  userCount += 1;
}

out.push('PRAGMA foreign_keys = ON;');
const target = cfg.output || 'legacy-import.sql';
writeFileSync(target, out.join('\n'), 'utf8');
console.log(`✅ 已生成 ${target}`);
console.log(`   商品 ${productIds.size} 个 · 卡密 ${cardCount} 条 · 会员 ${userCount} 人`);
console.log('   下一步：npx wrangler d1 execute slogan --local --file ./' + target);
