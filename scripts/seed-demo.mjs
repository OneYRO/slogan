/**
 * 演示数据填充（仅用于本地/新站体验，不会在部署时自动执行）
 * 前置：已初始化管理员。默认账号 admin / slogan-demo-2026
 *
 *   BASE=http://127.0.0.1:8787 ADMIN_USER=admin ADMIN_PASS=slogan-demo-2026 npm run seed
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'slogan-demo-2026';

const jar = new Map();

function cookie() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function remember(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const [pair] = line.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(jar.size ? { cookie: cookie() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  remember(res);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!res.ok || !json?.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return json.data;
}

const catalog = [
  {
    category: { name: '流媒体会员', description: '海外流媒体 · 独享账号', icon: '🎬' },
    products: [
      {
        name: 'Netflix 高级会员 · 月卡',
        images: ['/assets/img/products/streaming.webp'],
        description: '独享账号，支持 4K UHD 与 4 台设备同时在线，下单后自动发货。',
        price: 1990,
        member: 1790,
        tiers: [
          { min_qty: 3, price_cents: 1850 },
          { min_qty: 10, price_cents: 1690 },
        ],
        cards: ['netflix-01@mail.com----Nf#2026a', 'netflix-02@mail.com----Nf#2026b', 'netflix-03@mail.com----Nf#2026c', 'netflix-04@mail.com----Nf#2026d', 'netflix-05@mail.com----Nf#2026e'],
      },
      {
        name: 'Spotify Premium · 年卡',
        images: ['/assets/img/products/music.webp'],
        description: '个人版年卡，可绑定自己的邮箱，地区可选。',
        price: 3990,
        member: 3690,
        cards: ['spotify-01@mail.com----Sp#2026a', 'spotify-02@mail.com----Sp#2026b', 'spotify-03@mail.com----Sp#2026c'],
      },
      {
        name: 'Disney+ 标准版 · 月卡',
        images: ['/assets/img/products/live.webp'],
        description: '支持 1080P 与双设备，发货后可立即登录。',
        price: 1590,
        cards: ['disney-01@mail.com----Dp#2026a', 'disney-02@mail.com----Dp#2026b'],
      },
    ],
  },
  {
    category: { name: 'AI 工具', description: 'ChatGPT / Midjourney 订阅', icon: '🤖' },
    products: [
      {
        name: 'ChatGPT Plus · 独享号',
        images: ['/assets/img/products/ai.webp'],
        description: '月付 Plus，独享账号，交付邮箱密码与恢复码。',
        price: 9900,
        member: 9500,
        cards: ['chatgpt-01@mail.com----Cg#2026a', 'chatgpt-02@mail.com----Cg#2026b'],
      },
      {
        name: 'Midjourney · 标准月付',
        images: ['/assets/img/products/software.webp'],
        description: '官方订阅，交付登录方式，支持续费。',
        price: 19900,
        cards: ['mj-01@mail.com----Mj#2026a'],
      },
    ],
  },
  {
    category: { name: '游戏点卡', description: 'Steam / 手游充值', icon: '🎮' },
    products: [
      {
        name: 'Steam 钱包充值码 · $10',
        images: ['/assets/img/products/cloud.webp'],
        description: '美区充值码，到账后可在钱包余额中查看。',
        price: 7200,
        cards: ['STEAM-US-10-AAAA-BBBB-CCCC', 'STEAM-US-10-DDDD-EEEE-FFFF', 'STEAM-US-10-GGGG-HHHH-IIII'],
      },
      {
        name: '原神 · 创世结晶 6480',
        images: ['/assets/img/products/game.webp'],
        description: '直充到 UID，下单时请在备注填写 UID 与区服。',
        price: 64800,
        cards: ['GENSHIN-6480-KEY-0001', 'GENSHIN-6480-KEY-0002'],
      },
    ],
  },
  {
    category: { name: '代充服务', description: '人工处理 · 1-24 小时内完成', icon: '🛠️' },
    products: [
      {
        name: 'ChatGPT 代注册 · 独享',
        images: ['/assets/img/products/edu.webp'],
        description: '提交邮箱后由客服完成注册并交付账号，通常 2 小时内完成。',
        price: 4900,
        mode: 'manual',
        stock: 99,
      },
      {
        name: '海外手机号 · 代接验证',
        images: ['/assets/img/products/gift.webp'],
        description: '用于注册验证，单次有效，请在备注中注明用途。',
        price: 2500,
        mode: 'manual',
        stock: 99,
      },
    ],
  },
];

async function main() {
  const boot = await api('GET', '/api/admin/bootstrap');
  if (!boot.initialized) await api('POST', '/api/admin/setup', { username: ADMIN_USER, password: ADMIN_PASS });
  else {
    try {
      await api('POST', '/api/admin/login', { username: ADMIN_USER, password: ADMIN_PASS });
    } catch {
      throw new Error('管理员登录失败，请用 ADMIN_USER / ADMIN_PASS 指定已存在的账号');
    }
  }

  await api('PUT', '/api/admin/settings', {
    section: 'site',
    data: {
      name: 'Slogan',
      announcement: '🎉 Slogan 新站上线：全场数字商品自动发货，支付成功后卡密立即到账。',
      notice: '卡密类商品具有可复制性，一经售出原则上不支持退款；如遇无法登录请提交工单，客服会在 2 小时内处理。',
      contact: '客服邮箱：support@example.com · 工作时间 10:00–22:00',
      footer: 'Slogan · 多商户数字商品自动发货，运行于 Cloudflare Workers',
      seo_title: 'Slogan - 数字商品自动发货平台',
      seo_description: 'Slogan：流媒体会员、AI 工具订阅、游戏点卡自动发货，支持会员价、批发价、优惠券与余额支付。',
      seo_keywords: 'Slogan,发卡,自动发卡,卡密,Netflix,ChatGPT,Steam',
    },
  });

  for (const group of catalog) {
    let cats = await api('GET', '/api/admin/categories');
    let cat = cats.find((x) => x.name === group.category.name);
    if (!cat) {
      await api('POST', '/api/admin/categories', group.category);
      cats = await api('GET', '/api/admin/categories');
      cat = cats.find((x) => x.name === group.category.name);
    }
    for (const p of group.products) {
      const existed = await api('GET', `/api/admin/products?q=${encodeURIComponent(p.name)}&size=100`);
      if ((existed.list || []).some((x) => x.name === p.name)) continue;
      const created = await api('POST', '/api/admin/products', {
        category_id: cat.id,
        name: p.name,
        description: p.description,
        delivery_mode: p.mode || 'auto',
        price_cents: p.price,
        member_price_cents: p.member ?? null,
        wholesale_tiers: p.tiers || [],
        stock: p.stock ?? 0,
        status: 'on',
        is_recommend: Math.random() > 0.5,
        skus: [],
        images: p.images || [],
      });
      if (p.cards?.length) {
        await api('POST', '/api/admin/cards/import', {
          product_id: created.id,
          text: p.cards.join('\n'),
        });
      }
    }
  }

  console.log('✅ 演示数据已写入：4 个分类、9 个商品、18 条卡密（可重复执行）');
}

main().catch((e) => {
  console.error('❌', e.message);
  process.exit(1);
});
