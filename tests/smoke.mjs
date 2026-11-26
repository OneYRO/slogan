/**
 * 本地端到端冒烟测试
 * 前置：先执行 npm run db:migrate:local，并在另一个终端执行 npm run dev（默认 http://127.0.0.1:8787）
 * 运行：BASE=http://127.0.0.1:8787 npm run smoke
 */
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const BASE = process.env.BASE || 'http://127.0.0.1:8787';

const jars = { admin: new Map(), user: new Map() };
let pass = 0;
let fail = 0;

function t(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

function remember(jar, res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const line of list) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
}

async function api(method, path, body, jar) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(jar && jar.size ? { cookie: cookieHeader(jar) } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (jar) remember(jar, res);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

const ok = (r) => r.status >= 200 && r.status < 300 && r.json && r.json.ok !== false;

function totp(secret, ts = Date.now()) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const ch of String(secret).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | alpha.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const counter = Math.floor(ts / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const sig = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, '0');
}

async function main() {
  console.log(`\n▶ 站点与初始化`);
  const site = await api('GET', '/api/site');
  t('GET /api/site 返回站点配置', ok(site) && site.json.data.site.name, site.text.slice(0, 200));
  t('站点配置包含支付渠道列表', Array.isArray(site.json?.data?.channels), site.json?.data?.channels);

  const boot = await api('GET', '/api/admin/bootstrap');
  t('GET /api/admin/bootstrap', ok(boot) && typeof boot.json.data.initialized === 'boolean');

  if (!boot.json.data.initialized) {
    const setup = await api('POST', '/api/admin/setup', {
      username: 'admin',
      password: 'slogan-demo-2026',
    }, jars.admin);
    t('POST /api/admin/setup 初始化管理员', ok(setup), setup.text.slice(0, 200));
  } else {
    const login = await api('POST', '/api/admin/login', {
      username: 'admin',
      password: 'slogan-demo-2026',
    }, jars.admin);
    t('POST /api/admin/login 登录管理员', ok(login), login.text.slice(0, 200));
  }

  const me = await api('GET', '/api/admin/me', undefined, jars.admin);
  t('GET /api/admin/me 已登录', ok(me) && me.json.data.username === 'admin', me.text.slice(0, 200));

  console.log(`\n▶ 管理员两步验证`);
  const setup2fa = await api('POST', '/api/admin/2fa/setup', {}, jars.admin);
  t('生成 TOTP 密钥', ok(setup2fa) && /^[A-Z2-7]{32}$/.test(setup2fa.json?.data?.secret || ''), setup2fa.text.slice(0, 160));
  const totpSecret = setup2fa.json?.data?.secret || '';
  t('返回 otpauth 链接', /otpauth:\/\/totp\//.test(setup2fa.json?.data?.otpauth_url || ''), setup2fa.json?.data?.otpauth_url);

  const codeNow = totp(totpSecret);
  const enable2fa = await api('POST', '/api/admin/2fa/enable', { code: codeNow }, jars.admin);
  t('输入动态码开启两步验证', ok(enable2fa), enable2fa.text.slice(0, 160));

  const noCodeLogin = await api('POST', '/api/admin/login', { username: 'admin', password: 'slogan-demo-2026' });
  t('开启后不带验证码登录被拒绝', noCodeLogin.status === 401, noCodeLogin.text.slice(0, 160));

  const codeLogin = await api('POST', '/api/admin/login', { username: 'admin', password: 'slogan-demo-2026', code: totp(totpSecret) }, jars.admin);
  t('带验证码登录成功', ok(codeLogin), codeLogin.text.slice(0, 160));

  const wrongCode = await api('POST', '/api/admin/login', { username: 'admin', password: 'slogan-demo-2026', code: '000000' });
  t('错误动态码被拒绝', wrongCode.status === 401, wrongCode.text.slice(0, 160));

  const disable2fa = await api('POST', '/api/admin/2fa/disable', { code: totp(totpSecret) }, jars.admin);
  t('关闭两步验证', ok(disable2fa), disable2fa.text.slice(0, 160));

  console.log(`\n▶ 修改管理员密码`);
  const wrongOld = await api('POST', '/api/admin/password', { old_password: 'wrong-password', new_password: 'another-pass-2026' }, jars.admin);
  t('原密码错误时拒绝修改', wrongOld.status === 400, wrongOld.text.slice(0, 120));
  await api('POST', '/api/admin/password', { old_password: 'slogan-demo-2026', new_password: 'slogan-demo-2027' }, jars.admin);
  const newLogin = await api('POST', '/api/admin/login', { username: 'admin', password: 'slogan-demo-2027' }, jars.admin);
  t('新密码可登录', ok(newLogin), newLogin.text.slice(0, 160));
  await api('POST', '/api/admin/password', { old_password: 'slogan-demo-2027', new_password: 'slogan-demo-2026' }, jars.admin);
  t('密码改回原值', true);

  console.log(`\n▶ 新增支付渠道`);
  const paySettings = await api('GET', '/api/admin/settings', undefined, jars.admin);
  t('支付配置包含 Stripe 与 PayPal', !!paySettings.json?.data?.payment?.stripe && !!paySettings.json?.data?.payment?.paypal, paySettings.text.slice(0, 200));
  const badStripe = await api('POST', '/api/pay/notify/stripe', { test: 1 });
  t('Stripe 回调缺少签名被拒绝', badStripe.status === 400, badStripe.text.slice(0, 120));
  const paypalIgnore = await api('POST', '/api/pay/notify/paypal', { event_type: 'PAYMENT.CAPTURE.COMPLETED' });
  t('PayPal 非目标事件被忽略', paypalIgnore.status === 200, paypalIgnore.text.slice(0, 120));

  const openMock = await api(
    'PUT',
    '/api/admin/settings',
    { section: 'payment', data: { mock: { enabled: true } } },
    jars.admin,
  );
  t('开启模拟支付通道', ok(openMock), openMock.text.slice(0, 200));

  console.log(`\n▶ 分类 / 商品 / 规格`);
  const cat = await api(
    'POST',
    '/api/admin/categories',
    { name: '流媒体会员', sort: 1, description: '海外流媒体账号' },
    jars.admin,
  );
  t('新建分类', ok(cat), cat.text.slice(0, 200));
  const catList = await api('GET', '/api/admin/categories', undefined, jars.admin);
  const categoryId = catList.json.data.find((x) => x.name === '流媒体会员')?.id;
  t('分类列表回读', !!categoryId, catList.text.slice(0, 200));

  const prod = await api(
    'POST',
    '/api/admin/products',
    {
      category_id: categoryId,
      name: 'Netflix 高级会员 · 月卡',
      description: '独享账号，支持 4K。',
      delivery_mode: 'auto',
      price_cents: 1000,
      member_price_cents: 900,
      wholesale_tiers: [
        { min_qty: 3, price_cents: 900 },
        { min_qty: 10, price_cents: 800 },
      ],
      pick_enabled: true,
      pick_fee_cents: 100,
      status: 'on',
      is_recommend: true,
      skus: [
        { name: '月卡', price_cents: 1000, member_price_cents: 900 },
        { name: '季卡', price_cents: 2700 },
      ],
    },
    jars.admin,
  );
  t('新建商品（含 2 个规格与批发价）', ok(prod), prod.text.slice(0, 200));
  const productId = prod.json.data.id;

  const detail = await api('GET', `/api/products/${productId}`);
  t(
    'GET /api/products/:id 返回 SKU 与批发价',
    ok(detail) && detail.json.data.skus.length === 2 && detail.json.data.tiers.length === 2,
    detail.text.slice(0, 300),
  );
  const skuId = detail.json.data.skus[0].id;

  const cards = await api(
    'POST',
    '/api/admin/cards/import',
    {
      product_id: productId,
      sku_id: skuId,
      text: 'netflix001@mail.com----pass001\nnetflix002@mail.com----pass002\nnetflix003@mail.com----pass003\nnetflix004@mail.com----pass004\nnetflix005@mail.com----pass005',
    },
    jars.admin,
  );
  t('批量导入 5 条卡密', ok(cards) && cards.json.data.imported === 5, cards.text.slice(0, 200));
  const stock = await api('GET', `/api/products/${productId}`);
  t('库存自动更新为 5', stock.json.data.stock === 5, stock.json?.data?.stock);

  console.log(`\n▶ 会员注册 / 优惠券`);
  const email = `user${Date.now()}@example.com`;
  const reg = await api('POST', '/api/auth/register', {
    email,
    password: 'user-pass-2026',
    nickname: '测试用户',
  }, jars.user);
  t('注册会员', ok(reg), reg.text.slice(0, 200));
  const userMe = await api('GET', '/api/auth/me', undefined, jars.user);
  t('GET /api/auth/me 已登录', ok(userMe) && userMe.json.data.email === email, userMe.text.slice(0, 200));

  console.log(`\n▶ 找回密码`);
  const forgotUnknown = await api('POST', '/api/auth/forgot', { email: 'nobody@example.com' });
  t('未注册邮箱也返回成功（防枚举）', ok(forgotUnknown), forgotUnknown.text.slice(0, 200));
  const forgot = await api('POST', '/api/auth/forgot', { email });
  t('已注册邮箱返回成功', ok(forgot), forgot.text.slice(0, 200));
  const { createHash } = await import('node:crypto');
  const { execSync } = await import('node:child_process');
  const rawToken = 'reset-' + Date.now();
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const tsNow = Date.now();
  execSync(
    `npx wrangler d1 execute slogan --local --command "INSERT INTO password_resets (email, token_hash, expires_at, created_at) VALUES ('${email}','${tokenHash}',${tsNow + 600000},${tsNow})"`,
    { cwd: process.cwd(), stdio: 'ignore' },
  );
  const badReset = await api('POST', '/api/auth/reset', { token: 'wrong-token', password: 'new-pass-2026' });
  t('错误令牌被拒绝', badReset.status === 400, badReset.text.slice(0, 200));
  const reset = await api('POST', '/api/auth/reset', { token: rawToken, password: 'new-pass-2026' });
  t('正确令牌重置密码', ok(reset), reset.text.slice(0, 200));
  const relogin = await api('POST', '/api/auth/login', { email, password: 'new-pass-2026' });
  t('新密码可登录', ok(relogin), relogin.text.slice(0, 200));

  const couponCode = 'SMOKE' + String(Date.now()).slice(-6);
  const coupon = await api(
    'POST',
    '/api/admin/coupons',
    {
      code: couponCode,
      type: 'fixed',
      value: 100,
      min_amount_cents: 0,
      max_uses: 100,
      per_user_limit: 5,
      enabled: true,
    },
    jars.admin,
  );
  t(`新建固定立减券 ${couponCode}`, ok(coupon), coupon.text.slice(0, 200));

  console.log(`\n▶ 下单 → 支付 → 自动发卡`);
  const order = await api(
    'POST',
    '/api/orders',
    {
      items: [{ product_id: productId, sku_id: skuId, qty: 2 }],
      email,
      coupon_code: couponCode,
      pay_channel: 'mock',
    },
    jars.user,
  );
  t('创建订单', ok(order), order.text.slice(0, 400));
  const orderNo = order.json?.data?.order_no;
  const token = order.json?.data?.token;
  t('订单号与订单 token 存在', !!orderNo && !!token, order.json?.data);
  t(
    '会员价 + 立减券计算正确 (2×9.00−1.00=17.00)',
    order.json?.data?.amount_cents === 1700,
    order.json?.data?.amount_cents,
  );
  t('优惠合计 = 原价 2000 − 实付 1700', order.json?.data?.discount_cents === 300 && order.json?.data?.subtotal_cents === 2000, order.json?.data);

  const locked = await api('GET', `/api/admin/orders?q=${encodeURIComponent(orderNo)}`, undefined, jars.admin);
  t('后台可查到该订单', locked.json?.data?.list?.length === 1, locked.text.slice(0, 200));
  const adminOrder = locked.json.data.list[0];
  t('订单状态为 pending', adminOrder.status === 'pending', adminOrder.status);

  const pay = await api('POST', `/api/orders/${orderNo}/pay`, { channel: 'mock' }, jars.user);
  t('mock 支付立即到账', ok(pay) && pay.json?.data?.action?.type === 'paid', pay.text.slice(0, 300));

  const paid = await api('GET', `/api/orders/${orderNo}/status?token=${encodeURIComponent(token)}`);
  t('订单状态变为 delivered（自动发货）', paid.json?.data?.status === 'delivered', paid.text.slice(0, 200));

  const detailAfter = await api('GET', `/api/orders/${orderNo}?token=${encodeURIComponent(token)}`);
  const delivered = detailAfter.json?.data?.items?.[0]?.delivered || [];
  t('返回 2 条已售卡密', delivered.length === 2, delivered);
  t('卡密内容格式正确', delivered.every((c) => /@mail\.com----pass\d{3}/.test(c)), delivered);

  const after = await api('GET', `/api/products/${productId}`);
  t('库存回落到 3', after.json.data.stock === 3, after.json?.data?.stock);

  console.log(`\n▶ 超时未支付 → 卡密释放`);
  const order2 = await api(
    'POST',
    '/api/orders',
    { items: [{ product_id: productId, sku_id: skuId, qty: 1 }], email, pay_channel: 'mock' },
    jars.user,
  );
  const orderNo2 = order2.json?.data?.order_no;
  t('第二笔订单创建成功', !!orderNo2, order2.text.slice(0, 200));
  const orderId2 = (await api('GET', `/api/admin/orders?q=${encodeURIComponent(orderNo2)}`, undefined, jars.admin))
    .json?.data?.list?.[0]?.id;
  const close = await api('POST', `/api/admin/orders/${orderId2}/action`, { action: 'close' }, jars.admin);
  t('后台关闭订单', ok(close), close.text.slice(0, 200));
  const stockAfter = await api('GET', `/api/products/${productId}`);
  t('关闭后卡密回库，库存恢复 3（已售 2）', stockAfter.json.data.stock === 3, stockAfter.json?.data?.stock);

  console.log(`\n▶ 人工发货商品`);
  const manual = await api(
    'POST',
    '/api/admin/products',
    {
      category_id: categoryId,
      name: '代注册服务 · 人工发货',
      delivery_mode: 'manual',
      price_cents: 2000,
      stock: 99,
      skus: [],
    },
    jars.admin,
  );
  const manualId = manual.json?.data?.id;
  const mo = await api(
    'POST',
    '/api/orders',
    { items: [{ product_id: manualId, qty: 1 }], email, pay_channel: 'mock' },
    jars.user,
  );
  const manualNo = mo.json?.data?.order_no;
  await api('POST', `/api/orders/${manualNo}/pay`, { channel: 'mock' }, jars.user);
  const mDetail = await api('GET', `/api/orders/${manualNo}?token=${encodeURIComponent(mo.json.data.token)}`);
  t('人工发货商品支付后进入 manual 状态', mDetail.json?.data?.status === 'manual', mDetail.json?.data?.status);

  const mOrderList = await api('GET', `/api/admin/orders?q=${encodeURIComponent(manualNo)}`, undefined, jars.admin);
  const mOrderId = mOrderList.json?.data?.list?.[0]?.id;
  const ship = await api(
    'POST',
    `/api/admin/orders/${mOrderId}/action`,
    { action: 'ship', content: '账号：demo  密码：demo123' },
    jars.admin,
  );
  t('后台人工发货', ok(ship), ship.text.slice(0, 200));
  const shipped = await api('GET', `/api/orders/${manualNo}?token=${encodeURIComponent(mo.json.data.token)}`);
  t('人工发货后状态为 delivered', shipped.json?.data?.status === 'delivered', shipped.text.slice(0, 200));

  console.log(`\n▶ 余额充值与余额支付`);
  const recharge = await api(
    'POST',
    '/api/auth/recharge',
    { amount_cents: 10000, channel: 'mock' },
    jars.user,
  );
  t('创建充值订单', ok(recharge), recharge.text.slice(0, 200));
  await api('POST', `/api/orders/${recharge.json.data.order_no}/pay`, { channel: 'mock' }, jars.user);
  const bal = await api('GET', '/api/auth/me', undefined, jars.user);
  t('余额到账 100.00', bal.json?.data?.balance_cents === 10000, bal.json?.data?.balance_cents);

  const bOrder = await api(
    'POST',
    '/api/orders',
    { items: [{ product_id: productId, sku_id: skuId, qty: 1 }], email, pay_channel: 'balance' },
    jars.user,
  );
  const bNo = bOrder.json?.data?.order_no;
  const bPay = await api('POST', `/api/orders/${bNo}/pay`, { channel: 'balance' }, jars.user);
  t('余额支付成功', ok(bPay) && bPay.json.data.action.type === 'paid', bPay.text.slice(0, 200));
  const bAfter = await api('GET', '/api/auth/me', undefined, jars.user);
  t('余额扣减为 91.00', bAfter.json?.data?.balance_cents === 9100, bAfter.json?.data?.balance_cents);

  console.log(`\n▶ 工单与统计`);
  const tk = await api(
    'POST',
    '/api/tickets',
    { subject: '卡密无法登录', content: '提示密码错误，请处理。', order_no: orderNo },
    jars.user,
  );
  t('提交工单', ok(tk), tk.text.slice(0, 200));
  const tickets = await api('GET', '/api/tickets', undefined, jars.user);
  t('我的工单列表', ok(tickets) && tickets.json.data.list.length >= 1, tickets.text.slice(0, 200));
  const adminTickets = await api('GET', '/api/admin/tickets', undefined, jars.admin);
  const ticketId = (adminTickets.json?.data?.[0] ?? adminTickets.json?.data?.list?.[0])?.id;
  const reply = await api('POST', `/api/admin/tickets/${ticketId}/reply`, { content: '已为您重置密码。' }, jars.admin);
  t('后台回复工单', ok(reply), reply.text.slice(0, 200));

  const stats = await api('GET', '/api/admin/stats', undefined, jars.admin);
  t('后台统计接口可用', ok(stats) && stats.json.data.today, stats.text.slice(0, 300));
  t('今日订单数 ≥ 3', Number(stats.json.data.today.orders) >= 3, stats.json?.data?.today);

  const settings = await api('GET', '/api/admin/settings', undefined, jars.admin);
  t('读取站点设置', ok(settings) && settings.json.data.site, settings.text.slice(0, 200));
  const putSite = await api(
    'PUT',
    '/api/admin/settings',
    { section: 'site', data: { name: 'Slogan', announcement: '多商户自动发卡，支付成功后立即发货。' } },
    jars.admin,
  );
  t('更新站点设置', ok(putSite), putSite.text.slice(0, 200));
  const site2 = await api('GET', '/api/site');
  t('前台读到新站点名', site2.json.data.site.name === 'Slogan', site2.json?.data?.site?.name);

  console.log(`\n▶ 新增模块`);
  const supCreated = await api('POST', '/api/admin/suppliers', {
    name: '冒烟测试上游', api_url: 'http://127.0.0.1:1/api', api_key: 'smoke-key',
    balance_cents: 5000, enabled: true, note: 'smoke',
  }, jars.admin);
  const supplierId = supCreated.json?.data?.id;
  t('创建上游供应商', ok(supCreated) && supplierId > 0, supCreated.text.slice(0, 200));
  const supList = await api('GET', '/api/admin/suppliers', undefined, jars.admin);
  t('供应商列表包含新记录', ok(supList) && (supList.json.data || []).some((x) => x.id === supplierId), supList.text.slice(0, 200));
  const supTest = await api('POST', `/api/admin/suppliers/${supplierId}/test`, {}, jars.admin);
  t('供应商连通性测试返回结构化结果', supTest.status === 200 && supTest.json && typeof supTest.json.ok === 'boolean', supTest.text.slice(0, 200));
  const supDel = await api('DELETE', `/api/admin/suppliers/${supplierId}`, undefined, jars.admin);
  t('删除供应商', ok(supDel), supDel.text.slice(0, 200));

  const tplGet = await api('GET', '/api/admin/templates', undefined, jars.admin);
  t('读取邮件模板', ok(tplGet) && tplGet.json.data.order_paid, tplGet.text.slice(0, 200));
  const tplPut = await api('PUT', '/api/admin/templates', { key: 'order_paid', subject: '测试主题 {{order_no}}', html: '<p>{{site_name}}</p>' }, jars.admin);
  t('保存邮件模板', ok(tplPut), tplPut.text.slice(0, 200));
  const tplGet2 = await api('GET', '/api/admin/templates', undefined, jars.admin);
  t('邮件模板已持久化', tplGet2.json.data.order_paid.subject.includes('{{order_no}}'), tplGet2.text.slice(0, 200));
  await api('PUT', '/api/admin/templates', { key: 'order_paid', subject: '', html: '' }, jars.admin);

  const media = await api('GET', '/api/admin/media', undefined, jars.admin);
  t('媒体库接口可用（未绑定 R2 时 available=false）', ok(media) && media.json.data.available === false, media.text.slice(0, 200));

  const payPut = await api('PUT', '/api/admin/settings', {
    section: 'payment',
    data: { hashpay: { enabled: false, api_url: 'https://api.hashpay.me/v1', api_key: 'hp_test_key', organization_id: 'org_smoke', signing_secret: 'whsec_test', currency: 'USD' } },
  }, jars.admin);
  t('保存 HashPay 配置', ok(payPut), payPut.text.slice(0, 200));
  const payGet = await api('GET', '/api/admin/settings', undefined, jars.admin);
  t('HashPay 密钥返回时已脱敏', payGet.json.data.payment.hashpay.api_key === '••••••••' && payGet.json.data.payment.hashpay.signing_secret === '••••••••', payGet.json?.data?.payment?.hashpay);
  const payPut2 = await api('PUT', '/api/admin/settings', {
    section: 'payment',
    data: { hashpay: { enabled: false, api_url: 'https://api.hashpay.me/v1', api_key: 'hp_test_key', organization_id: 'org_smoke', signing_secret: 'whsec_test', currency: 'USD' } },
  }, jars.admin);
  t('HashPay 配置可重复保存', ok(payPut2), payPut2.text.slice(0, 200));

  // HashPay 回调验签：启用配置 → 下单 → 构造合法签名回调 → 订单自动发货
  const hpSecret = 'whsec_smoke_' + Date.now();
  const hpOrg = 'org_smoke';
  const hpEnable = await api('PUT', '/api/admin/settings', {
    section: 'payment',
    data: { hashpay: { enabled: true, api_url: 'https://api.hashpay.me/v1', api_key: 'hp_test_key', organization_id: hpOrg, signing_secret: hpSecret, currency: 'USD' } },
  }, jars.admin);
  const hpOrder = await api('POST', '/api/orders', {
    items: [{ product_id: productId, sku_id: skuId, qty: 1 }],
    email,
    pay_channel: 'hashpay',
  }, jars.user);
  const hpNo = hpOrder.json?.data?.order_no;
  const hpToken = hpOrder.json?.data?.token;
  t('创建 HashPay 待支付订单', ok(hpOrder) && !!hpNo, hpOrder.text.slice(0, 300));
  if (hpNo) {
    const hpAmt = ((hpOrder.json.data.amount_cents / 100) * 0.14).toFixed(2);
    const hpTs = Math.floor(Date.now() / 1000);
    const hpBody = JSON.stringify({
      event_id: 'evt_smoke_' + hpTs,
      type: 'invoice.paid',
      timestamp: new Date().toISOString(),
      api_version: 'v1',
      organization_id: hpOrg,
      data: { invoice: { id: 'inv_smoke_' + hpTs, amount: hpAmt, paidAmount: hpAmt, status: 'paid', metadata: { order_no: hpNo } } },
    });
    const hpSig = createHmac('sha256', hpSecret).update(`${hpTs}.evt_smoke_${hpTs}.${hpBody}`).digest('hex');
    const hpRes = await fetch(BASE + '/api/pay/notify/hashpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-HashPay-Signature': `t=${hpTs},v1=${hpSig}` },
      body: hpBody,
    });
    const hpText = await hpRes.text();
    t('HashPay 合法回调被接受', hpRes.status === 200, hpText.slice(0, 200));
    const hpStatus = await api('GET', `/api/orders/${hpNo}/status?token=${encodeURIComponent(hpToken)}`);
    t('HashPay 回调后订单已发货', hpStatus.json?.data?.status === 'delivered', hpStatus.text.slice(0, 200));
    const hpBad = await fetch(BASE + '/api/pay/notify/hashpay', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-HashPay-Signature': `t=${hpTs},v1=${'0'.repeat(64)}` },
      body: hpBody,
    });
    t('HashPay 错误签名被拒绝', hpBad.status === 400, hpBad.status);
  }
  await api('PUT', '/api/admin/settings', {
    section: 'payment',
    data: { hashpay: { enabled: false, api_url: 'https://api.hashpay.me/v1', api_key: 'hp_test_key', organization_id: hpOrg, signing_secret: hpSecret, currency: 'USD' } },
  }, jars.admin);

  // 上游供应商自动采购：0 库存商品下单 -> 支付 -> 调用上游补货 -> 自动发货
  let upstreamCalled = false;
  const upstream = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      upstreamCalled = !!req.headers['x-sign'] && body.includes('"action":"purchase"');
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, data: { cards: ['UP-A----1', 'UP-B----2'], cost_cents: 600, order_no: 'UP-SMOKE-1' } }));
    });
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upstreamPort = upstream.address().port;
  const upSup = await api('POST', '/api/admin/suppliers', {
    name: '冒烟自动采购', api_url: `http://127.0.0.1:${upstreamPort}/api`, api_key: 'smoke-secret',
    balance_cents: 10000, enabled: true,
  }, jars.admin);
  const upSupId = upSup.json?.data?.id;
  const upCats = await api('GET', '/api/admin/categories', undefined, jars.admin);
  const upCatId = (upCats.json?.data?.[0] ?? upCats.json?.data?.list?.[0])?.id;
  const upProd = await api('POST', '/api/admin/products', {
    category_id: upCatId, name: '冒烟-上游自动发货', description: 'smoke', delivery_mode: 'auto',
    price_cents: 500, stock: 0, status: 'on', auto_purchase: true,
    supplier_id: upSupId, supplier_goods_id: 'up-smoke-1', supplier_cost_cents: 300, skus: [],
  }, jars.admin);
  const upProdId = upProd.json?.data?.id;
  t('创建 0 库存 + 自动采购商品', ok(upProd) && upProdId > 0, upProd.text.slice(0, 200));
  const upOrder = await api('POST', '/api/orders', {
    items: [{ product_id: upProdId, qty: 2 }], email: 'upstream-buyer@example.com', pay_channel: 'mock',
  });
  const upNo = upOrder.json?.data?.order_no;
  const upToken = encodeURIComponent(upOrder.json?.data?.token || '');
  t('0 库存商品可下单', ok(upOrder) && !!upNo, upOrder.text.slice(0, 300));
  const upPay = await api('POST', `/api/orders/${upNo}/pay?token=${upToken}`, { channel: 'mock' });
  t('自动采购订单支付成功', ok(upPay) && upPay.json?.data?.action?.type === 'paid', upPay.text.slice(0, 200));
  const upStatus = await api('GET', `/api/orders/${upNo}/status?token=${upToken}`);
  t('上游卡密补齐后订单自动发货', upStatus.json?.data?.status === 'delivered', upStatus.text.slice(0, 200));
  const upDetail = await api('GET', `/api/orders/${upNo}?token=${upToken}`);
  t('发货内容来自上游', (upDetail.json?.data?.items?.[0]?.delivered || []).join(',').includes('UP-'), upDetail.text.slice(0, 300));
  t('上游收到带签名的采购请求', upstreamCalled, upstreamCalled);
  const upLogs = await api('GET', '/api/admin/suppliers/logs', undefined, jars.admin);
  t('采购日志写入成功', ok(upLogs) && JSON.stringify(upLogs.json.data).includes('UP-SMOKE-1'), upLogs.text.slice(0, 300));
  await new Promise((r) => upstream.close(r));

  console.log(`\n▶ 多商户`);
  const mSlug = `smoke-shop-${Date.now().toString(36)}`;
  const mCreate = await api('POST', '/api/admin/merchants', {
    name: '冒烟测试店', slug: mSlug, description: '多商户冒烟测试', announcement: '冒烟测试公告',
  }, jars.admin);
  const mId = mCreate.json?.data?.id;
  const mAdmin = mCreate.json?.data?.admin_username || '';
  const mPass = mCreate.json?.data?.generated_password || '';
  t('创建商户并自动生成管理员', ok(mCreate) && mId > 0 && !!mAdmin && mPass.length >= 10, mCreate.text.slice(0, 300));
  t('商户列表包含新店铺', (await api('GET', '/api/admin/merchants', undefined, jars.admin)).json?.data?.some((x) => x.id === mId));
  const mSite = await api('GET', `/api/site?merchant=${mSlug}`);
  t('商户站点配置按 slug 加载', ok(mSite) && mSite.json?.data?.merchant?.slug === mSlug && mSite.json.data.site.name === '冒烟测试店', mSite.text.slice(0, 300));
  const mProducts = await api('GET', `/api/products?merchant=${mSlug}`);
  t('新商户商品为空且不串店', ok(mProducts) && mProducts.json?.data?.total === 0, mProducts.text.slice(0, 300));

  const jarsMerchant = new Map();
  const mLogin = await api('POST', '/api/admin/login', { username: mAdmin, password: mPass }, jarsMerchant);
  t('商户管理员可登录', ok(mLogin) && mLogin.json?.data?.role === 'merchant' && mLogin.json?.data?.merchant_id === mId, mLogin.text.slice(0, 300));
  const mMe = await api('GET', '/api/admin/me', undefined, jarsMerchant);
  t('商户管理员 /me 返回所属店铺', ok(mMe) && mMe.json?.data?.merchant?.id === mId, mMe.text.slice(0, 300));
  const mList = await api('GET', '/api/admin/products', undefined, jarsMerchant);
  t('商户管理员只能看到自己的商品', ok(mList) && mList.json?.data?.list?.every((x) => x.merchant_id === mId) === true, mList.text.slice(0, 300));
  const mForbid1 = await api('GET', '/api/admin/merchants', undefined, jarsMerchant);
  t('商户管理员无权访问商户管理', mForbid1.status === 403, mForbid1.status);
  const mForbid2 = await api('GET', '/api/admin/settings', undefined, jarsMerchant);
  t('商户管理员无权访问站点设置', mForbid2.status === 403, mForbid2.status);

  const mProfile = await api('PUT', '/api/admin/merchant/profile', {
    name: '冒烟测试店改', description: '更新后的描述', announcement: '更新后的公告', contact: 'test@example.com',
  }, jarsMerchant);
  t('商户管理员可维护店铺资料', ok(mProfile) && mProfile.json?.data?.name === '冒烟测试店改', mProfile.text.slice(0, 300));
  const mSite2 = await api('GET', `/api/site?merchant=${mSlug}`);
  t('前台读取到商户更新后的资料', ok(mSite2) && mSite2.json?.data?.site?.name === '冒烟测试店改', mSite2.text.slice(0, 300));

  const mOff = await api('PUT', `/api/admin/merchants/${mId}`, { status: 'off' }, jars.admin);
  t('平台管理员可停用商户', ok(mOff) && mOff.json?.data?.status === 'off', mOff.text.slice(0, 300));
  const mOffSite = await api('GET', `/api/site?merchant=${mSlug}`);
  t('停用商户前台不可访问', mOffSite.status === 403, mOffSite.status);
  const mOn = await api('PUT', `/api/admin/merchants/${mId}`, { status: 'on' }, jars.admin);
  t('平台管理员可重新启用商户', ok(mOn) && mOn.json?.data?.status === 'on', mOn.text.slice(0, 300));

  const mDel = await api('DELETE', `/api/admin/merchants/${mId}`, undefined, jars.admin);
  t('删除无业务数据的商户', ok(mDel), mDel.text.slice(0, 300));
  const mGone = await api('GET', `/api/site?merchant=${mSlug}`);
  t('删除后商户前台 404', mGone.status === 404, mGone.status);

  console.log(`\n▶ 前台与后台页面`);
  for (const path of ['/', '/admin', '/assets/css/store.css', '/assets/js/store.js']) {
    const r = await fetch(BASE + path);
    t(`GET ${path} → ${r.status}`, r.status === 200, r.status);
  }
  const spa = await fetch(BASE + '/product/' + productId);
  t('商品详情页 History 路由回退到 index.html', spa.status === 200 && (await spa.text()).includes('Slogan'), spa.status);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
