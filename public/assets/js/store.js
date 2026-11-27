/* ============================================================
   Slogan · 前台逻辑
   ============================================================ */
(function () {
  'use strict';

  const { icon, esc, money, setMoney, date, request, toast, openModal, confirmDialog, copyText, qs, qsa, debounce } = UI;

  const S = {
    site: null,
    merchant: null,
    categories: [],
    channels: [],
    user: null,
    cart: loadCart(),
    homeQuery: '',
    homeCategory: '',
    homePage: 1,
  };

  const EMOJIS = ['🎁', '🔑', '🎮', '💎', '⚡', '🎫', '🧩', '🚀', '🍿', '🛡️', '🎧', '📦'];

  /* ------------------------- 多语言 ------------------------- */
  const I18N = {
    'zh-TW': {
      '首页': '首頁', '限时秒杀': '限時秒殺', '我的订单': '我的訂單', '工单中心': '工單中心',
      '自动发货 · 即买即得': '自動發貨 · 即買即得', '正在加载…': '正在載入…',
      '在售商品': '在售商品', '今日订单': '今日訂單', '累计销量': '累計銷量', '购物车': '購物車',
      '公告': '公告', '联系客服': '聯繫客服', '订单查询': '訂單查詢',
      '今天需要一点': '今天需要一點', '什么': '什麼', '搜索商品，或按分类逛逛 · 支付成功后自动发货': '搜尋商品，或按分類逛逛 · 付款成功後自動發貨',
      '搜索商品名称 / 关键词': '搜尋商品名稱 / 關鍵字', '全部': '全部', '秒杀': '秒殺', '热销': '熱銷',
      '自动发货': '自動發貨', '已售罄': '已售罄', '库存': '庫存', '已售': '已售', '人工发货': '人工發貨', '实物配送': '實物配送',
      '购买': '購買', '缺货': '缺貨', '购物车还是空的': '購物車還是空的', '去逛逛': '去逛逛',
      '共': '共', '件 · 合计': '件 · 合計', '去结算': '去結算', '会员价': '會員價',
      '距结束': '距結束', '选择规格': '選擇規格', '卡密预选': '卡密預選', '自选卡号': '自選卡號', '加价': '加價', '免费': '免費',
      '购买数量': '購買數量', '起购': '起購', '，单次限购': '，單次限購', '件': '件', '小计': '小計',
      '批发阶梯价': '批發階梯價', '数量': '數量', '单价': '單價', '立即购买': '立即購買', '加入购物车': '加入購物車',
      '发货说明：': '發貨說明：', '商品详情': '商品詳情', '购买须知': '購買須知', '常见问题': '常見問題',
      '确认订单': '確認訂單', '购物车是空的': '購物車是空的', '先去挑选喜欢的商品吧': '先去挑選喜歡的商品吧',
      '商品金额': '商品金額', '优惠码': '優惠碼', '实付': '實付', '提交订单': '提交訂單', '支付方式': '支付方式',
      '订单号': '訂單號', '下单邮箱': '下單信箱', '备注': '備註', '订单查询': '訂單查詢',
      '输入订单号与下单邮箱查询订单状态与卡密': '輸入訂單號與下單信箱查詢訂單狀態與卡密',
      '查询订单': '查詢訂單', '登录后可查看全部历史订单': '登入後可查看全部歷史訂單', '登录 / 注册': '登入 / 註冊',
      '登录后可查看历史订单、余额与专属会员价': '登入後可查看歷史訂單、餘額與專屬會員價',
      '登录': '登入', '注册': '註冊', '找回密码': '找回密碼', '邮箱': '信箱', '密码': '密碼', '游客订单查询': '訪客訂單查詢',
      '新建工单': '新建工單', '暂无工单': '暫無工單', '处理中': '處理中', '客服已回复': '客服已回覆', '已关闭': '已關閉',
      '加载中': '載入中', '复制': '複製', '已复制': '已複製', '提交': '提交', '取消': '取消', '保存': '儲存',
      '已支付': '已支付', '待支付': '待支付', '已完成': '已完成', '已退款': '已退款', '待发货': '待發貨', '配送中': '配送中',
    },
    en: {
      '首页': 'Home', '限时秒杀': 'Flash Sale', '我的订单': 'Orders', '工单中心': 'Tickets',
      '自动发货 · 即买即得': 'Auto delivery · Instant', '正在加载…': 'Loading…',
      '在售商品': 'Products', '今日订单': 'Orders today', '累计销量': 'Total sold', '购物车': 'Cart',
      '公告': 'Notice', '联系客服': 'Contact', '订单查询': 'Order lookup',
      '今天需要一点': 'What do you need', '什么': ' today', '搜索商品，或按分类逛逛 · 支付成功后自动发货': 'Search products or browse categories · auto delivery after payment',
      '搜索商品名称 / 关键词': 'Search products / keywords', '全部': 'All', '秒杀': 'Sale', '热销': 'Hot',
      '自动发货': 'Auto delivery', '已售罄': 'Sold out', '库存': 'Stock', '已售': 'Sold', '人工发货': 'Manual', '实物配送': 'Shipping',
      '购买': 'Buy', '缺货': 'Out of stock', '购物车还是空的': 'Your cart is empty', '去逛逛': 'Browse',
      '共': 'Total', '件 · 合计': 'items', '去结算': 'Checkout', '会员价': 'Member',
      '距结束': 'Ends in', '选择规格': 'Select option', '卡密预选': 'Pick a card', '自选卡号': 'Choose card number', '加价': 'Fee', '免费': 'Free',
      '购买数量': 'Quantity', '起购': 'Min', '，单次限购': ', max', '件': 'pcs', '小计': 'Subtotal',
      '批发阶梯价': 'Wholesale tiers', '数量': 'Qty', '单价': 'Unit price', '立即购买': 'Buy now', '加入购物车': 'Add to cart',
      '发货说明：': 'Delivery: ', '商品详情': 'Details', '购买须知': 'Before you buy', '常见问题': 'FAQ',
      '确认订单': 'Checkout', '购物车是空的': 'Your cart is empty', '先去挑选喜欢的商品吧': 'Pick something you like first',
      '商品金额': 'Subtotal', '优惠码': 'Coupon', '实付': 'Total', '提交订单': 'Place order', '支付方式': 'Payment',
      '订单号': 'Order no.', '下单邮箱': 'Email', '备注': 'Note',
      '输入订单号与下单邮箱查询订单状态与卡密': 'Enter order number and email to check status and cards',
      '查询订单': 'Find order', '登录后可查看全部历史订单': 'Log in to see all orders', '登录 / 注册': 'Log in / Sign up',
      '登录后可查看历史订单、余额与专属会员价': 'Log in to view orders, balance and member prices',
      '登录': 'Log in', '注册': 'Sign up', '找回密码': 'Forgot password', '邮箱': 'Email', '密码': 'Password', '游客订单查询': 'Guest order lookup',
      '新建工单': 'New ticket', '暂无工单': 'No tickets', '处理中': 'Open', '客服已回复': 'Replied', '已关闭': 'Closed',
      '加载中': 'Loading', '复制': 'Copy', '已复制': 'Copied', '提交': 'Submit', '取消': 'Cancel', '保存': 'Save',
      '已支付': 'Paid', '待支付': 'Unpaid', '已完成': 'Completed', '已退款': 'Refunded', '待发货': 'To ship', '配送中': 'Shipping',
    },
  };

  function T(zh) {
    const dict = I18N[S.lang];
    return (dict && dict[zh]) || zh;
  }

  let translating = false;
  function translateDom() {
    if (!S.lang || S.lang === 'zh-CN' || translating) return;
    translating = true;
    const dict = I18N[S.lang] || {};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const raw = walker.currentNode.nodeValue;
      const key = raw.trim().replace(/^[^\u4e00-\u9fa5A-Za-z]+/, '');
      if (key && dict[key]) nodes.push([walker.currentNode, raw, key]);
    }
    for (const [node, raw, key] of nodes) {
      const next = raw.replace(key, dict[key]);
      if (next !== raw) node.nodeValue = next;
    }

    // 组合文本（库存 2 · 已售 0 等）按词替换
    const tokens = ['库存', '已售', '人工发货', '自动发货', '实物配送', '固定内容', '会员价', '件'];
    qsa('.product-meta, .pd-sub, .cart-item-sku, .summary-item, .opt-label span').forEach((el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const list = [];
      while (walk.nextNode()) list.push(walk.currentNode);
      list.forEach((node) => {
        let text = node.nodeValue;
        tokens.forEach((tk) => { if (dict[tk]) text = text.split(tk).join(dict[tk]); });
        if (text !== node.nodeValue) node.nodeValue = text;
      });
    });
    qsa('input[placeholder], textarea[placeholder]').forEach((el) => {
      const key = el.getAttribute('placeholder');
      if (dict[key] && el.getAttribute('placeholder') !== dict[key]) el.setAttribute('placeholder', dict[key]);
    });
    translating = false;
  }

  /* ------------------------- 工具 ------------------------- */
  function loadCart() {
    try { return JSON.parse(localStorage.getItem('fh-cart-v1') || '[]'); } catch (e) { return []; }
  }
  function saveCart() {
    localStorage.setItem('fh-cart-v1', JSON.stringify(S.cart));
    updateCartCount();
  }
  function cartCount() { return S.cart.reduce((s, i) => s + i.qty, 0); }

  /** 与后端 calcUnit 对齐：秒杀 → 阶梯批发 → 会员价 → 卡密预选加价 */
  function cartUnit(it) {
    let unit = Number(it.list_cents ?? it.base_price_cents ?? it.price_cents ?? 0);
    if (it.seckill_cents != null && it.seckill_cents < unit && (!it.seckill_ends || Date.now() <= it.seckill_ends)) {
      unit = Number(it.seckill_cents);
    }
    const tiers = Array.isArray(it.tiers) ? it.tiers : [];
    const tier = [...tiers].reverse().find((t) => Number(it.qty) >= Number(t.min_qty) && Number(t.price_cents) < unit);
    if (tier) unit = Number(tier.price_cents);
    if (S.user && it.member_price_cents != null && Number(it.member_price_cents) < unit) unit = Number(it.member_price_cents);
    if (it.pick_card_id) unit += Number(it.pick_fee_cents || 0);
    return unit;
  }
  function cartTotal() { return S.cart.reduce((s, i) => s + cartUnit(i) * i.qty, 0); }
  function updateCartCount() {
    const el = document.getElementById('cartCount');
    if (el) el.textContent = cartCount();
  }

  function emojiFor(seed) {
    return EMOJIS[Math.abs(Number(seed) || 0) % EMOJIS.length];
  }
  function thumb(p, extraClass = '') {
    const alt = `alt-${(Number(p.id) || 0) % 5}`;
    if (p.images && p.images.length) {
      return `<img src="${esc(p.images[0])}" alt="${esc(p.name)}" loading="lazy">`;
    }
    return `<div class="thumb-fallback ${alt} ${extraClass}">${emojiFor(p.id)}</div>`;
  }
  function productPrice(p) {
    const seckill = p.seckill && p.seckill.price_cents < p.price_cents;
    if (seckill) return { now: p.seckill.price_cents, was: p.price_cents, tag: '秒杀' };
    if (S.user && p.member_price_cents != null && p.member_price_cents < p.price_cents) {
      return { now: p.member_price_cents, was: p.price_cents, tag: '会员价' };
    }
    return { now: p.price_cents, was: null, tag: null };
  }
  function statusText(s) {
    return ({ pending: '待支付', paid: '已支付', manual: '待发货', shipped: '配送中', delivered: '已完成', closed: '已关闭', refunded: '已退款' })[s] || s;
  }
  function setTitle(t) {
    document.title = t ? `${t} · ${S.site?.name || 'Slogan'}` : (S.site?.seo_title || 'Slogan');
  }

  async function loadSite() {
    // ?merchant=slug 可直接进入指定店铺；同一标签页内后续请求自动带上该店铺
    try {
      const fromUrl = new URLSearchParams(location.search).get('merchant');
      if (fromUrl) sessionStorage.setItem('fh-merchant:' + location.host, fromUrl);
    } catch (e) { /* ignore */ }
    const data = await request('/api/site');
    S.site = data.site;
    S.merchant = data.merchant || null;
    if (S.merchant?.slug) {
      try { sessionStorage.setItem('fh-merchant:' + location.host, S.merchant.slug); } catch (e) { /* ignore */ }
    }
    S.categories = data.categories || [];
    S.channels = data.channels || [];
    S.stats = data.stats || { today_orders: 0, total_orders: 0, product_count: 0 };
    S.recent_sales = data.recent_sales || [];

    // 语言 / 货币（前台可切换，价格按汇率展示，结算仍以 CNY 记账）
    S.lang = localStorage.getItem('fh-lang') || S.site.lang || 'zh-CN';
    S.site.lang = S.lang;
    const wanted = localStorage.getItem('fh-cur') || S.site.currency_code || 'CNY';
    if (S.site.currency_rates && S.site.currency_rates[wanted] != null) S.site.currency_code = wanted;
    setMoney(S.site.currency_code, S.site.currency_rates, S.site.currency_symbols);
    syncSelectors();
    setTitle(null);
  }

  function syncSelectors() {
    const langSel = document.getElementById('langSel');
    if (langSel) langSel.value = S.lang || 'zh-CN';
    const curSel = document.getElementById('curSel');
    if (curSel && S.site?.currency_rates) {
      const codes = Object.keys(S.site.currency_rates);
      if (!codes.length) codes.push('CNY');
      curSel.innerHTML = codes.map((code) =>
        `<option value="${esc(code)}">${esc(code)}</option>`).join('');
      curSel.value = S.site.currency_code || 'CNY';
    }
  }

  async function refreshUser() {
    try {
      S.user = await request('/api/auth/me', { silent: true });
    } catch (e) { S.user = null; }
  }

  /* ------------------------- 外壳 ------------------------- */
  function renderShell() {
    const site = S.site || {};
    const mark = document.getElementById('brandMark');
    const name = document.getElementById('brandName');
    if (mark) mark.textContent = site.logo || (site.name || 'F').slice(0, 1);
    if (name) name.textContent = site.name || 'Slogan';
    const meta = document.querySelector('meta[name="description"]');
    if (meta && site.seo_description) meta.setAttribute('content', site.seo_description);

    const bg = document.getElementById('bgShop');
    if (bg) {
      if (site.background_image) bg.style.backgroundImage = `url("${site.background_image}")`;
      else bg.style.backgroundImage = '';
      bg.style.opacity = site.background_image ? '.85' : '';
    }

    const foot = document.getElementById('siteFooter');
    if (foot) {
      foot.innerHTML = `<div class="container footer-inner">
        <div class="footer-brand"><span class="dot"></span>${esc(site.name || 'Slogan')} · 自动发货</div>
        <div>${site.contact ? esc(site.contact) : ''}${site.icp ? ` · <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">${esc(site.icp)}</a>` : ''}</div>
        <div>${esc(site.footer || 'Powered by Slogan on Cloudflare Workers')}</div>
      </div>`;
    }

    document.getElementById('themeToggle').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon');
    document.getElementById('orderIcon').innerHTML = icon('order');
    document.getElementById('cartIcon').innerHTML = icon('cart', 17);
    document.getElementById('drawerClose').innerHTML = icon('close');
    const tb = { tbHome: 'home', tbSeckill: 'bolt', tbOrders: 'order', tbTickets: 'ticket', tbAccount: 'user' };
    Object.entries(tb).forEach(([id, name]) => { const el = document.getElementById(id); if (el) el.innerHTML = icon(name, 20); });

    // 左侧店铺卡
    const avatar = document.getElementById('shopAvatar');
    if (avatar) avatar.innerHTML = site.logo_image
      ? `<img src="${esc(site.logo_image)}" alt="">`
      : site.logo
        ? `<span>${esc(site.logo.slice(0, 1))}</span>`
        : '<img src="/assets/img/avatar.webp" alt="店铺头像">';
    const asideName = document.getElementById('shopName');
    if (asideName) asideName.textContent = site.name || 'Slogan';
    const asideDesc = document.getElementById('shopDesc');
    if (asideDesc) asideDesc.textContent = site.description || '卡密自动发货 · 会员折扣 · 多支付渠道';
    const statProducts = document.getElementById('statProducts');
    const statOrders = document.getElementById('statOrders');
    const statSold = document.getElementById('statSold');
    if (statProducts) statProducts.textContent = String(S.stats?.product_count ?? S.categories.length ?? 0);
    if (statOrders) statOrders.textContent = String(S.stats?.today_orders ?? 0);
    if (statSold) statSold.textContent = String(S.stats?.total_orders ?? 0);

    const asideAnn = document.getElementById('asideAnnouncement');
    const asideAnnText = document.getElementById('asideAnnouncementText');
    if (site.announcement) {
      asideAnn.hidden = false;
      asideAnnText.textContent = site.announcement;
    } else asideAnn.hidden = true;

    const links = document.getElementById('shopLinks');
    if (links) {
      links.innerHTML = [
        site.contact ? `<a href="${esc(site.contact.startsWith('http') ? site.contact : '#')}" ${site.contact.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${icon('chat', 13)} 联系客服</a>` : '',
        site.icp ? `<a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener">${icon('shield', 13)} ${esc(site.icp)}</a>` : '',
        `<a href="/orders">${icon('order', 13)} 订单查询</a>`,
      ].filter(Boolean).join('');
    }

    renderUserArea();
    updateCartCount();
    markNav();
    translateDom();
  }

  function markNav() {
    const path = location.pathname;
    qsa('[data-nav]').forEach((a) => {
      const key = a.dataset.nav;
      const active =
        (key === 'home' && (path === '/' || path.startsWith('/category'))) ||
        (key === 'seckill' && path.startsWith('/seckill')) ||
        (key === 'orders' && (path.startsWith('/orders') || path.startsWith('/order/'))) ||
        (key === 'tickets' && path.startsWith('/tickets')) ||
        (key === 'account' && (path.startsWith('/account') || path.startsWith('/login')));
      a.classList.toggle('active', active);
    });
  }

  function renderUserArea() {
    const el = document.getElementById('userArea');
    if (!el) return;
    if (S.user) {
      el.innerHTML = `<div class="user-menu" id="userMenu">
        <button class="avatar-btn" id="userMenuBtn">${esc(S.user.email.slice(0, 1).toUpperCase())}</button>
        <div class="user-menu-pop" id="userMenuPop">
          <div class="user-menu-head">
            <strong>${esc(S.user.email)}</strong>
            <span>${esc(S.user.level_name)} · 余额 ${money(S.user.balance_cents, S.site?.currency_code || 'CNY')}</span>
          </div>
          ${S.user.is_admin ? `<a href="${esc(S.user.admin_url || '/admin')}" class="admin-entry" data-external="1">${icon('lock', 16)} 进入后台</a>` : ''}
          <a href="/account">${icon('user', 16)} 个人中心</a>
          <a href="/orders">${icon('order', 16)} 我的订单</a>
          <a href="/tickets">${icon('ticket', 16)} 工单中心</a>
          <button id="logoutBtn">${icon('logout', 16)} 退出登录</button>
        </div>
      </div>`;
      const btn = qs('#userMenuBtn');
      const pop = qs('#userMenuPop');
      btn.setAttribute('aria-haspopup', 'true');
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = pop.classList.toggle('open');
        btn.setAttribute('aria-expanded', String(open));
      });
      qs('#logoutBtn').addEventListener('click', async () => {
        await request('/api/auth/logout', { method: 'POST' });
        S.user = null;
        toast('已退出登录');
        renderUserArea();
        navigate('/');
      });
    } else {
      el.innerHTML = `<a class="btn btn-ghost btn-sm" href="/login" style="height:38px">${icon('user', 15)} 登录</a>`;
    }
  }

  function bindShell() {
    document.getElementById('themeToggle').addEventListener('click', () => {
      UI.toggleTheme();
      document.getElementById('themeToggle').innerHTML = icon(UI.getTheme() === 'dark' ? 'sun' : 'moon');
    });
    document.getElementById('cartBtn').addEventListener('click', openCart);
    document.getElementById('asideCart')?.addEventListener('click', openCart);

    const langSel = document.getElementById('langSel');
    if (langSel) {
      langSel.value = localStorage.getItem('fh-lang') || 'zh-CN';
      langSel.addEventListener('change', () => {
        localStorage.setItem('fh-lang', langSel.value);
        location.reload();
      });
    }
    const curSel = document.getElementById('curSel');
    if (curSel) {
      curSel.value = localStorage.getItem('fh-cur') || 'CNY';
      curSel.addEventListener('change', () => {
        localStorage.setItem('fh-cur', curSel.value);
        location.reload();
      });
    }
    document.getElementById('drawerClose').addEventListener('click', closeCart);
    document.getElementById('drawerMask').addEventListener('click', closeCart);
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('userMenu');
      if (menu && !menu.contains(e.target)) {
        document.getElementById('userMenuPop')?.classList.remove('open');
        document.getElementById('userMenuBtn')?.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('mailto:') || href.startsWith('#') || href.startsWith('javascript')) return;
      if (a.target === '_blank' || a.dataset.external) return;
      e.preventDefault();
      navigate(href);
    });

    window.addEventListener('popstate', route);
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  }

  /* ------------------------- 购物车 ------------------------- */
  function addToCart(product, sku, qty, pickCardId) {
    const key = `${product.id}:${sku?.id || 0}:${pickCardId || 0}`;
    const found = S.cart.find((i) => i.key === key);
    const unit = sku ? (sku.price_cents ?? product.price_cents) : product.price_cents;
    const extra = pickCardId ? (product.pick_fee_cents || 0) : 0;
    if (found) {
      found.qty += qty;
    } else {
      S.cart.push({
        key,
        product_id: product.id,
        sku_id: sku?.id || null,
        pick_card_id: pickCardId || null,
        name: product.name,
        sku_name: sku?.name || null,
        image: product.images?.[0] || null,
        price_cents: unit + extra,
        base_price_cents: unit,
        list_cents: sku ? (sku.price_cents ?? product.price_cents) : product.price_cents,
        member_price_cents: sku?.member_price_cents ?? product.member_price_cents ?? null,
        seckill_cents: product.seckill?.price_cents ?? null,
        seckill_ends: product.seckill?.ends_at ?? null,
        tiers: Array.isArray(product.tiers) ? product.tiers : [],
        pick_fee_cents: product.pick_fee_cents || 0,
        delivery_mode: product.delivery_mode,
        qty,
      });
    }
    saveCart();
    toast('已加入购物车', 'success');
    openCart();
  }

  function openCart() {
    document.getElementById('drawerMask').hidden = false;
    document.getElementById('cartDrawer').classList.add('open');
    renderCart();
  }
  function closeCart() {
    document.getElementById('drawerMask').hidden = true;
    document.getElementById('cartDrawer').classList.remove('open');
  }

  function renderCart() {
    const body = document.getElementById('cartBody');
    const foot = document.getElementById('cartFoot');
    if (!S.cart.length) {
      body.innerHTML = `<div class="cart-empty"><div class="big">🛒</div>购物车还是空的<br><a class="btn btn-soft btn-sm" href="/" style="margin-top:14px">去逛逛</a></div>`;
      foot.innerHTML = '';
      return;
    }
    body.innerHTML = S.cart.map((it, idx) => `
      <div class="cart-item">
        <div class="cart-item-thumb">${it.image ? `<img src="${esc(it.image)}" alt="">` : emojiFor(it.product_id)}</div>
        <div class="cart-item-main">
          <div class="cart-item-name">${esc(it.name)}</div>
          <div class="cart-item-sku">${esc(it.sku_name || '默认规格')}${it.pick_card_id ? ' · 已选卡号' : ''}</div>
          <div class="cart-item-row">
            <div class="stepper" style="transform:scale(.82);transform-origin:left center">
              <button data-cart-minus="${idx}" aria-label="减少">${icon('minus', 14)}</button>
              <input value="${it.qty}" readonly>
              <button data-cart-plus="${idx}" aria-label="增加">${icon('plus', 14)}</button>
            </div>
            <div class="price">${money(cartUnit(it) * it.qty, S.site?.currency_code || 'CNY')}</div>
          </div>
        </div>
        <button class="icon-btn" data-cart-del="${idx}" style="height:32px;width:32px" aria-label="删除">${icon('trash', 15)}</button>
      </div>`).join('');
    foot.innerHTML = `
      <div class="cart-total"><span>共 ${cartCount()} 件 · 合计</span><strong>${money(cartTotal(), S.site?.currency_code || 'CNY')}</strong></div>
      <button class="btn btn-primary btn-block" id="goCheckout">去结算 ${icon('arrow', 16)}</button>`;

    qsa('[data-cart-del]').forEach((b) => b.addEventListener('click', () => { S.cart.splice(Number(b.dataset.cartDel), 1); saveCart(); renderCart(); }));
    qsa('[data-cart-plus]').forEach((b) => b.addEventListener('click', () => { S.cart[Number(b.dataset.cartPlus)].qty += 1; saveCart(); renderCart(); }));
    qsa('[data-cart-minus]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.cartMinus);
      S.cart[i].qty -= 1;
      if (S.cart[i].qty <= 0) S.cart.splice(i, 1);
      saveCart(); renderCart();
    }));
    qs('#goCheckout')?.addEventListener('click', () => { closeCart(); navigate('/checkout'); });
  }

  /* ------------------------- 路由 ------------------------- */
  function navigate(path, replace = false) {
    if (replace) history.replaceState({}, '', path);
    else history.pushState({}, '', path);
    route();
  }

  async function route() {
    const app = document.getElementById('app');
    if (!S.site) return;
    const path = location.pathname;
    const parts = path.split('/').filter(Boolean);
    closeCart();
    markNav();
    window.scrollTo({ top: 0 });

    try {
      if (parts.length === 0) return renderHome(app);
      if (parts[0] === 'category' && parts[1]) return renderHome(app, parts[1]);
      if (parts[0] === 'seckill') return renderSeckill(app);
      if (parts[0] === 'product' && parts[1]) return renderProduct(app, parts[1]);
      if (parts[0] === 'checkout') return renderCheckout(app);
      if (parts[0] === 'order' && parts[1]) return renderOrder(app, parts[1]);
      if (parts[0] === 'orders') return renderOrders(app);
      if (parts[0] === 'login') return renderLogin(app);
      if (parts[0] === 'reset') return renderReset(app);
      if (parts[0] === 'account') return renderAccount(app);
      if (parts[0] === 'tickets') return renderTickets(app);
      if (parts[0] === 'ticket' && parts[1]) return renderTicket(app, parts[1]);
      return render404(app);
    } catch (e) {
      console.error(e);
      if (e && e.status === 401) {
        navigate('/login', true);
        return;
      }
      app.innerHTML = `<div class="empty"><div class="big">😵</div><h3>页面加载失败</h3><p>${esc(e.message || '请稍后再试')}</p>
        <button class="btn btn-primary" onclick="location.reload()">重新加载</button></div>`;
    }
  }

  /* ------------------------- 首页 ------------------------- */
  async function renderHome(app, categorySlug = null) {
    setTitle('首页');
    const q = new URLSearchParams(location.search).get('q') || '';
    app.innerHTML = `
      <section class="shop-head">
        <div>
          <span class="eyebrow">FAKA SHOP · AUTO DELIVERY</span>
          <h1>今天需要一点<span class="grad">什么</span>？</h1>
          <p>${esc(S.site.description || '搜索商品，或按分类逛逛 · 支付成功后自动发货')}</p>
        </div>
        <div class="search-box">${icon('search', 18)}<input id="searchInput" placeholder="搜索商品名称 / 关键词" value="${esc(q)}"></div>
      </section>

      <div class="chips" id="categoryChips"></div>

      <div class="grid" id="productGrid" style="margin-top:18px"></div>
      <div id="productMore" style="text-align:center;margin-top:26px"></div>`;

    const chips = qs('#categoryChips');
    chips.innerHTML = `<a class="chip ${!categorySlug ? 'active' : ''}" href="/">全部</a>` +
      S.categories.map((c) => `<a class="chip ${c.slug === categorySlug ? 'active' : ''}" href="/category/${encodeURIComponent(c.slug)}">${esc(c.icon || '')} ${esc(c.name)}</a>`).join('');

    const grid = qs('#productGrid');
    grid.innerHTML = Array.from({ length: 8 }).map(() => `<div class="product-card"><div class="skeleton" style="aspect-ratio:16/10"></div><div style="padding:16px"><div class="skeleton" style="height:16px;width:70%"></div><div class="skeleton" style="height:12px;width:45%;margin-top:10px"></div></div></div>`).join('');

    let page = 1;
    let total = 0;
    let pageSize = 24;

    async function load(reset = true) {
      if (reset) page = 1;
      const params = new URLSearchParams({ page: String(page), size: String(pageSize) });
      if (categorySlug) params.set('category', categorySlug);
      if (q) params.set('q', q);
      const data = await request(`/api/products?${params}`);
      total = data.total;
      const list = data.list || [];
      grid.innerHTML = list.length
        ? list.map(productCard).join('')
        : `<div class="empty" style="grid-column:1/-1"><div class="big">🔍</div><h3>没有找到商品</h3><p>换个关键词或看看其他分类吧</p></div>`;
      const more = qs('#productMore');
      if (page * pageSize < total) {
        more.innerHTML = `<button class="btn btn-ghost" id="loadMore">加载更多（还有 ${total - page * pageSize} 件）</button>`;
        qs('#loadMore').addEventListener('click', async () => {
          page += 1;
          const btn = qs('#loadMore');
          btn.textContent = '加载中…';
          btn.disabled = true;
          const d = await request(`/api/products?${new URLSearchParams({ page: String(page), size: String(pageSize), ...(categorySlug ? { category: categorySlug } : {}), ...(q ? { q } : {}) })}`);
          grid.insertAdjacentHTML('beforeend', d.list.map(productCard).join(''));
          if (page * pageSize >= total) more.innerHTML = '';
          else { btn.textContent = '加载更多'; btn.disabled = false; }
        });
      } else more.innerHTML = '';
      bindProductCards();
    }

    await load(true);

    const search = qs('#searchInput');
    if (search) {
      const apply = debounce(() => {
        const value = search.value.trim();
        const url = new URL(location.href);
        if (value) url.searchParams.set('q', value); else url.searchParams.delete('q');
        history.replaceState({}, '', url);
        const q2 = value;
        q2 !== q && renderHome(app, categorySlug);
      }, 500);
      search.addEventListener('input', apply);
    }
  }

  function productCard(p) {
    const price = productPrice(p);
    const soldOut = p.stock <= 0;
    return `<article class="product-card" data-product="${p.id}">
      <div class="product-thumb">
        ${thumb(p)}
        <div class="product-badges">
          ${p.seckill ? `<span class="badge seckill">${icon('bolt', 11)} 秒杀</span>` : ''}
          ${p.is_recommend && !p.seckill ? `<span class="badge hot">🔥 热销</span>` : ''}
          ${p.delivery_mode === 'auto' ? `<span class="badge auto">${icon('bolt', 11)} 自动发货</span>` : ''}
        </div>
      </div>
      <div class="product-body">
        <h3 class="product-name">${esc(p.name)}</h3>
        <p class="product-desc">${esc(p.description || '')}</p>
        <div class="product-meta">
          ${p.delivery_mode === 'auto'
            ? (soldOut ? '<span class="stock-low">已售罄</span>' : `<span class="stock-ok">库存 ${p.stock}</span>`)
            : `<span>${p.delivery_mode === 'manual' ? '人工发货' : p.delivery_mode === 'physical' ? '实物配送' : '自动发货'}</span>`}
          <span>· 已售 ${p.sales_count || 0}</span>
        </div>
        <div class="product-foot">
          <div class="price">
            <span class="now">${money(price.now, S.site?.currency_code || 'CNY')}</span>
            ${price.was ? `<span class="was">${money(price.was, S.site?.currency_code || 'CNY')}</span>` : ''}
          </div>
          <button class="buy-mini" data-buy="${p.id}" ${soldOut ? 'disabled' : ''}>${soldOut ? '缺货' : '购买'}</button>
        </div>
      </div>
    </article>`;
  }

  function bindProductCards() {
    qsa('[data-product]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        navigate(`/product/${card.dataset.product}`);
      });
    });
    qsa('[data-buy]').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = b.dataset.buy;
        const p = await request(`/api/products/${id}`);
        const sku = p.skus && p.skus.length ? p.skus[0] : null;
        addToCart(p, sku, p.min_qty || 1, null);
      });
    });
  }

  /* ------------------------- 秒杀 ------------------------- */
  async function renderSeckill(app) {
    setTitle('限时秒杀');
    app.innerHTML = `
      <div class="page-head"><h1>⚡ 限时秒杀</h1><p>手快有手慢无，秒杀价与库存实时同步</p></div>
      <div class="grid" id="seckillGrid" style="margin-top:22px"></div>`;
    const data = await request('/api/seckill');
    const grid = qs('#seckillGrid');
    grid.innerHTML = data.length
      ? data.map((p) => {
          const end = p.seckill.ends_at;
          return `<article class="product-card" data-product="${p.id}">
            <div class="product-thumb">${thumb(p)}<div class="product-badges"><span class="badge seckill">${icon('bolt', 11)} 秒杀</span></div></div>
            <div class="product-body">
              <h3 class="product-name">${esc(p.name)}</h3>
              <div class="countdown" style="margin:4px 0">距结束 <b data-cd="${end}">--:--:--</b></div>
              <div class="product-foot">
                <div class="price"><span class="now">${money(p.seckill.price_cents, S.site?.currency_code || 'CNY')}</span><span class="was">${money(p.price_cents, S.site?.currency_code || 'CNY')}</span></div>
                <button class="buy-mini" data-buy="${p.id}" ${p.stock <= 0 ? 'disabled' : ''}>${p.stock <= 0 ? '已抢光' : '立即抢'}</button>
              </div>
            </div>
          </article>`;
        }).join('')
      : `<div class="empty" style="grid-column:1/-1"><div class="big">⏰</div><h3>当前没有秒杀活动</h3><p>去看看其他商品吧</p><a class="btn btn-primary" href="/">返回首页</a></div>`;
    bindProductCards();
    startCountdowns();
  }

  function startCountdowns() {
    qsa('[data-cd]').forEach((el) => {
      const end = Number(el.dataset.cd);
      const timer = setInterval(() => {
        const left = end - Date.now();
        if (left <= 0) { clearInterval(timer); el.textContent = '已结束'; return; }
        const h = String(Math.floor(left / 3600000)).padStart(2, '0');
        const m = String(Math.floor((left % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
        el.textContent = `${h}:${m}:${s}`;
      }, 1000);
    });
  }

  /* ------------------------- 商品详情 ------------------------- */
  async function renderProduct(app, id) {
    const p = await request(`/api/products/${id}`);
    setTitle(p.name);
    let sku = p.skus && p.skus.length ? p.skus[0] : null;
    let qty = p.min_qty || 1;
    let picked = null;

    app.innerHTML = `
      <nav class="breadcrumb"><a href="/">首页</a>${p.category ? `<span>/</span><a href="/category/${encodeURIComponent(p.category.slug)}">${esc(p.category.name)}</a>` : ''}<span>/</span><span>${esc(p.name)}</span></nav>
      <div class="product-layout">
        <div class="gallery">
          <div class="gallery-main" id="galleryMain">${thumb(p)}</div>
          ${p.images && p.images.length > 1 ? `<div class="gallery-thumbs">${p.images.map((img, i) => `<button data-thumb="${i}" class="${i === 0 ? 'active' : ''}"><img src="${esc(img)}" alt=""></button>`).join('')}</div>` : ''}
        </div>
        <div class="pd-info">
          <h1>${esc(p.name)}</h1>
          <div class="pd-sub">
            <span>库存 ${p.delivery_mode === 'auto' ? p.stock : p.stock_text}</span>
            <span>已售 ${p.sales_count || 0}</span>
            <span>${p.delivery_mode === 'auto' ? '自动发货' : p.delivery_mode === 'manual' ? '人工发货' : p.delivery_mode === 'physical' ? '实物配送' : '固定内容'}</span>
          </div>
          <div class="pd-pricebox">
            <div class="price">
              <span class="now" id="pdPrice">${money(productPrice(p).now, S.site?.currency_code || 'CNY')}</span>
              ${productPrice(p).was ? `<span class="was">${money(productPrice(p).was, S.site?.currency_code || 'CNY')}</span>` : ''}
              ${S.user && productPrice(p).tag === '会员价' ? '<span class="member">会员价</span>' : ''}
            </div>
            ${p.seckill ? `<div class="countdown">距结束 <b id="pdCd">--:--:--</b></div>` : ''}
          </div>

          ${p.skus && p.skus.length ? `
          <div class="opt-group">
            <div class="opt-label">选择规格 <span id="skuStock"></span></div>
            <div class="sku-list" id="skuList">
              ${p.skus.map((s, i) => `<button class="sku-item ${i === 0 ? 'active' : ''}" data-sku="${s.id}" data-price="${s.price_cents ?? p.price_cents}">${esc(s.name)}</button>`).join('')}
            </div>
          </div>` : ''}

          ${p.pick_enabled ? `
          <div class="opt-group">
            <div class="opt-label">卡密预选 <span>自选卡号${p.pick_fee_cents ? `，加价 ${money(p.pick_fee_cents, S.site?.currency_code || 'CNY')}` : '免费'}</span></div>
            <div class="pick-grid" id="pickGrid">
              <button class="pick-card active" data-pick="">随机分配</button>
              ${(p.pick_cards || []).map((c) => `<button class="pick-card" data-pick="${c.id}">${esc(c.content)}</button>`).join('')}
            </div>
          </div>` : ''}

          <div class="opt-group">
            <div class="opt-label">购买数量 <span>${p.min_qty > 1 ? `起购 ${p.min_qty} 件` : ''}${p.max_qty < 99 ? `，单次限购 ${p.max_qty} 件` : ''}</span></div>
            <div class="qty-row">
              <div class="stepper">
                <button id="qtyMinus" aria-label="减少">${icon('minus', 15)}</button>
                <input id="qtyInput" value="${qty}" inputmode="numeric">
                <button id="qtyPlus" aria-label="增加">${icon('plus', 15)}</button>
              </div>
              <span style="font-size:12.5px;color:var(--muted)" id="subtotalText"></span>
            </div>
          </div>

          ${(p.tiers && p.tiers.length) ? `
          <div class="opt-group">
            <div class="opt-label">批发阶梯价</div>
            <table class="tier-table"><thead><tr><th>数量</th><th>单价</th></tr></thead>
            <tbody>${p.tiers.map((t) => `<tr><td>≥ ${t.min_qty} 件</td><td>${money(t.price_cents, S.site?.currency_code || 'CNY')}</td></tr>`).join('')}</tbody></table>
          </div>` : ''}

          <div class="pd-actions">
            <button class="btn btn-primary btn-lg" id="buyNow">${icon('bolt', 17)} 立即购买</button>
            <button class="btn btn-ghost btn-lg" id="addCart">${icon('cart', 17)} 加入购物车</button>
          </div>
          <div class="pd-note"><b>发货说明：</b>${esc(S.site.notice || '支付成功后自动发货，卡密显示在订单页并同步发送至邮箱。')}</div>
        </div>
      </div>

      <div class="tabs" id="tabs">
        <button class="tab active" data-tab="desc">商品详情</button>
        <button class="tab" data-tab="notice">购买须知</button>
        <button class="tab" data-tab="faq">常见问题</button>
      </div>
      <div class="tab-panel" id="tab-desc">${p.description_html || '<p>暂无详细介绍</p>'}</div>
      <div class="tab-panel" id="tab-notice" hidden>
        <p>${esc(S.site.notice || '卡密类商品具有可复制性，一经售出原则上不支持退款。')}</p>
        <p>下单前请确认商品规格与数量；支付成功后卡密会即时展示，并通过邮件发送至你的邮箱。</p>
      </div>
      <div class="tab-panel" id="tab-faq" hidden>
        <p><b>Q：支付后多久到账？</b><br>A：卡密类商品支付成功后立即发货；人工/实物商品由客服在 24 小时内处理。</p>
        <p><b>Q：卡密在哪里查看？</b><br>A：订单详情页、邮件通知，以及「个人中心 → 我的订单」均可查看。</p>
        <p><b>Q：可以退款吗？</b><br>A：卡密未使用且非买家原因导致无法使用时，可提交工单申请售后。</p>
      </div>`;

    const priceEl = qs('#pdPrice');
    const subEl = qs('#subtotalText');
    const qtyInput = qs('#qtyInput');
    const skuStockEl = qs('#skuStock');

    function unitPrice() {
      let base = sku ? (sku.price_cents ?? p.price_cents) : p.price_cents;
      if (p.seckill) base = Math.min(base, p.seckill.price_cents);
      else if (S.user && (sku?.member_price_cents ?? p.member_price_cents) != null) {
        base = Math.min(base, sku?.member_price_cents ?? p.member_price_cents);
      }
      const tier = [...(p.tiers || [])].reverse().find((t) => qty >= t.min_qty && t.price_cents < base);
      if (tier) base = tier.price_cents;
      if (picked && p.pick_fee_cents) base += p.pick_fee_cents;
      return base;
    }
    function refresh() {
      const u = unitPrice();
      priceEl.textContent = money(u, S.site?.currency_code || 'CNY');
      subEl.textContent = `小计 ${money(u * qty, S.site?.currency_code || 'CNY')}`;
      if (skuStockEl && p.sku_stock) {
        const n = p.sku_stock[String(sku?.id || 0)] ?? p.stock;
        skuStockEl.textContent = `库存 ${n}`;
      }
    }
    refresh();

    qsa('#skuList .sku-item').forEach((b) => b.addEventListener('click', () => {
      qsa('#skuList .sku-item').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      sku = p.skus.find((s) => String(s.id) === b.dataset.sku) || null;
      refresh();
    }));

    qsa('#pickGrid .pick-card').forEach((b) => b.addEventListener('click', () => {
      qsa('#pickGrid .pick-card').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      picked = b.dataset.pick ? Number(b.dataset.pick) : null;
      refresh();
    }));

    qs('#qtyMinus').addEventListener('click', () => { qty = Math.max(p.min_qty || 1, qty - 1); qtyInput.value = qty; refresh(); });
    qs('#qtyPlus').addEventListener('click', () => { qty = Math.min(p.max_qty || 99, qty + 1); qtyInput.value = qty; refresh(); });
    qtyInput.addEventListener('change', () => {
      qty = Math.max(p.min_qty || 1, Math.min(p.max_qty || 99, Number(qtyInput.value) || 1));
      qtyInput.value = qty;
      refresh();
    });

    qsa('#tabs .tab').forEach((t) => t.addEventListener('click', () => {
      qsa('#tabs .tab').forEach((x) => x.classList.remove('active'));
      t.classList.add('active');
      ['desc', 'notice', 'faq'].forEach((k) => { qs(`#tab-${k}`).hidden = k !== t.dataset.tab; });
    }));

    qs('#addCart').addEventListener('click', () => addToCart(p, sku, qty, picked));
    qs('#buyNow').addEventListener('click', () => {
      addToCartSilent(p, sku, qty, picked);
      navigate('/checkout');
    });

    qsa('[data-thumb]').forEach((b) => b.addEventListener('click', () => {
      qsa('[data-thumb]').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      qs('#galleryMain').innerHTML = `<img src="${esc(p.images[Number(b.dataset.thumb)])}" alt="">`;
    }));

    if (p.seckill) {
      const cd = qs('#pdCd');
      const timer = setInterval(() => {
        const left = p.seckill.ends_at - Date.now();
        if (left <= 0) { clearInterval(timer); cd.textContent = '已结束'; return; }
        const h = String(Math.floor(left / 3600000)).padStart(2, '0');
        const m = String(Math.floor((left % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
        cd.textContent = `${h}:${m}:${s}`;
      }, 1000);
    }
  }

  function addToCartSilent(product, sku, qty, pickCardId) {
    const key = `${product.id}:${sku?.id || 0}:${pickCardId || 0}`;
    const found = S.cart.find((i) => i.key === key);
    const unit = sku ? (sku.price_cents ?? product.price_cents) : product.price_cents;
    const extra = pickCardId ? (product.pick_fee_cents || 0) : 0;
    if (found) found.qty += qty;
    else S.cart.push({
      key, product_id: product.id, sku_id: sku?.id || null, pick_card_id: pickCardId || null,
      name: product.name, sku_name: sku?.name || null, image: product.images?.[0] || null,
      price_cents: unit + extra, base_price_cents: unit, delivery_mode: product.delivery_mode, qty,
      list_cents: sku ? (sku.price_cents ?? product.price_cents) : product.price_cents,
      member_price_cents: sku?.member_price_cents ?? product.member_price_cents ?? null,
      seckill_cents: product.seckill?.price_cents ?? null,
      seckill_ends: product.seckill?.ends_at ?? null,
      tiers: Array.isArray(product.tiers) ? product.tiers : [],
      pick_fee_cents: product.pick_fee_cents || 0,
    });
    saveCart();
  }

  /* ------------------------- 结算 ------------------------- */
  async function renderCheckout(app) {
    setTitle('确认订单');
    if (!S.cart.length) {
      app.innerHTML = `<div class="empty"><div class="big">🛒</div><h3>购物车是空的</h3><p>先去挑选喜欢的商品吧</p><a class="btn btn-primary" href="/">去逛逛</a></div>`;
      return;
    }
    const hasPhysical = S.cart.some((i) => i.delivery_mode === 'physical');
    let channel = S.channels[0]?.id || 'epay';
    let coupon = null;
    let couponCode = '';

    app.innerHTML = `
      <div class="page-head"><h1>确认订单</h1><p>请核对商品信息与联系方式，卡密将发送至邮箱</p></div>
      <div class="checkout-layout">
        <div>
          <div class="card">
            <h2 class="card-title"><span class="num">1</span>商品清单</h2>
            ${S.cart.map((it) => `
              <div class="summary-item">
                <div class="n">${esc(it.name)}${it.sku_name ? ` <span style="color:var(--muted)">/ ${esc(it.sku_name)}</span>` : ''}<br>
                  <span style="font-size:11.5px;color:var(--muted)">${it.delivery_mode === 'auto' ? '自动发货' : it.delivery_mode === 'manual' ? '人工发货' : it.delivery_mode === 'physical' ? '实物配送' : '固定内容'}</span></div>
                <div style="font-size:12px;color:var(--muted)">× ${it.qty}</div>
                <div class="p">${money(cartUnit(it) * it.qty, S.site?.currency_code || 'CNY')}</div>
              </div>`).join('')}
          </div>

          <div class="card">
            <h2 class="card-title"><span class="num">2</span>联系方式</h2>
            <div class="field">
              <label>接收邮箱 *</label>
              <input id="coEmail" type="email" placeholder="用于接收卡密与订单通知" value="${esc(S.user?.email || '')}">
              <div class="hint">卡密会发送到这个邮箱，请确认填写正确</div>
            </div>
            <div class="field">
              <label>订单备注（选填）</label>
              <input id="coNote" maxlength="200" placeholder="如有特殊要求可在此说明">
            </div>
            ${hasPhysical ? `
            <h2 class="card-title" style="margin-top:20px"><span class="num">3</span>收货信息</h2>
            <div class="field-row">
              <div class="field"><label>收货人 *</label><input id="addrName" placeholder="姓名"></div>
              <div class="field"><label>手机号 *</label><input id="addrPhone" placeholder="11 位手机号"></div>
            </div>
            <div class="field"><label>所在地区 *</label><input id="addrRegion" placeholder="省 / 市 / 区"></div>
            <div class="field"><label>详细地址 *</label><textarea id="addrDetail" placeholder="街道、门牌号等"></textarea></div>` : ''}
          </div>

          <div class="card">
            <h2 class="card-title"><span class="num">${hasPhysical ? 4 : 3}</span>支付方式</h2>
            <div class="pay-methods" id="payMethods">
              ${S.channels.map((ch, i) => `
                <label class="pay-method ${i === 0 ? 'active' : ''}" data-channel="${ch.id}">
                  <input type="radio" name="pay" value="${ch.id}" ${i === 0 ? 'checked' : ''}>
                  <span class="pay-radio"></span>
                  <span class="pay-icon ${ch.id === 'epay' ? 'alipay' : ch.id}">${payIconText(ch.id)}</span>
                  <span class="n">${esc(ch.name)}<div class="d">${esc(ch.desc)}</div></span>
                </label>`).join('')}
            </div>
            ${!S.channels.length ? '<p style="color:var(--danger);font-size:13px">站点尚未配置支付方式，请联系客服。</p>' : ''}
          </div>
        </div>

        <div class="card summary">
          <h2 class="card-title">订单汇总</h2>
          <div class="summary-line"><span>商品金额</span><span id="sumSub">--</span></div>
          <div class="summary-line"><span>优惠券</span><span id="sumCoupon" style="color:var(--success)">- ¥0.00</span></div>
          <div class="field" style="margin-top:12px">
            <label>优惠码</label>
            <div style="display:flex;gap:8px">
              <input id="couponInput" placeholder="输入优惠码" style="flex:1">
              <button class="btn btn-soft btn-sm" id="applyCoupon" style="height:44px">使用</button>
            </div>
          </div>
          <div class="summary-total"><span>应付金额</span><strong id="sumTotal">--</strong></div>
          <button class="btn btn-primary btn-block btn-lg" id="submitOrder" style="margin-top:16px">${icon('shield', 17)} 提交订单</button>
          <p style="font-size:11.5px;color:var(--muted);text-align:center;margin:12px 0 0">支付即表示同意《购买须知》</p>
        </div>
      </div>`;

    const refreshSummary = () => {
      const sub = cartTotal();
      const discount = coupon ? coupon.discount_cents : 0;
      qs('#sumSub').textContent = money(sub, S.site?.currency_code || 'CNY');
      qs('#sumCoupon').textContent = `-${money(discount, S.site?.currency_code || 'CNY')}`;
      qs('#sumTotal').textContent = money(Math.max(0, sub - discount), S.site?.currency_code || 'CNY');
    };
    refreshSummary();

    qsa('#payMethods .pay-method').forEach((el) => el.addEventListener('click', () => {
      qsa('#payMethods .pay-method').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      channel = el.dataset.channel;
    }));

    qs('#applyCoupon').addEventListener('click', async () => {
      const code = qs('#couponInput').value.trim();
      if (!code) return toast('请输入优惠码', 'error');
      try {
        coupon = await request('/api/coupons/check', {
          method: 'POST',
          body: { code, subtotal: cartTotal(), product_ids: S.cart.map((i) => i.product_id), email: qs('#coEmail').value.trim() },
        });
        couponCode = code;
        refreshSummary();
        toast(`优惠码可用，已减免 ${money(coupon.discount_cents, S.site?.currency_code || 'CNY')}`, 'success');
      } catch (e) {
        coupon = null;
        couponCode = '';
        refreshSummary();
      }
    });

    qs('#submitOrder').addEventListener('click', async () => {
      const email = qs('#coEmail').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('请填写有效的邮箱地址', 'error');
      if (!S.channels.length) return toast('站点尚未配置支付方式', 'error');
      const payload = {
        items: S.cart.map((i) => ({ product_id: i.product_id, sku_id: i.sku_id, qty: i.qty, pick_card_id: i.pick_card_id })),
        email,
        coupon_code: couponCode || null,
        note: qs('#coNote').value.trim(),
        pay_channel: channel,
        merchant_id: S.merchant?.id ?? null,
      };
      if (hasPhysical) {
        payload.address = {
          name: qs('#addrName').value.trim(),
          phone: qs('#addrPhone').value.trim(),
          region: qs('#addrRegion').value.trim(),
          detail: qs('#addrDetail').value.trim(),
        };
        if (!payload.address.name || !payload.address.phone || !payload.address.detail) {
          return toast('请完整填写收货信息', 'error');
        }
      }
      const btn = qs('#submitOrder');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:18px;height:18px;margin:0;border-width:2px"></span> 正在创建订单…';
      try {
        const order = await request('/api/orders', { method: 'POST', body: payload });
        const pay = await request(`/api/orders/${order.order_no}/pay?token=${encodeURIComponent(order.token)}`, { method: 'POST', body: { channel } });
        const action = pay.action;
        if (action.type === 'paid') {
          S.cart = [];
          saveCart();
          navigate(action.redirect);
          toast('支付成功，正在跳转订单', 'success');
        } else if (action.type === 'redirect') {
          window.location.href = action.url;
        } else if (action.type === 'form') {
          document.open();
          document.write(action.html);
          document.close();
        }
      } catch (e) {
        btn.disabled = false;
        btn.innerHTML = `${icon('shield', 17)} 提交订单`;
      }
    });
  }

  function payIconText(id) {
    return ({ epay: '支', alipay: '支', usdt: '₮', balance: '¥', mock: '测' })[id] || '付';
  }

  /* ------------------------- 订单结果 ------------------------- */
  async function renderOrder(app, orderNo) {
    const token = new URLSearchParams(location.search).get('token') || '';
    let detail;
    try {
      detail = await request(`/api/orders/${encodeURIComponent(orderNo)}?token=${encodeURIComponent(token)}`);
    } catch (e) {
      app.innerHTML = `<div class="empty"><div class="big">🔍</div><h3>找不到订单</h3><p>${esc(e.message || '请核对订单链接')}</p><a class="btn btn-primary" href="/orders">订单查询</a></div>`;
      return;
    }
    setTitle('订单详情');
    const pending = detail.status === 'pending';

    app.innerHTML = `
      <div class="order-hero">
        <div class="order-icon ${pending ? 'pending' : detail.status === 'closed' || detail.status === 'refunded' ? 'closed' : 'success'}">
          ${pending ? '⏳' : detail.status === 'closed' ? '✕' : detail.status === 'refunded' ? '↩' : '✓'}
        </div>
        <h1>${pending ? '等待支付' : statusText(detail.status)}</h1>
        <p>订单号 ${esc(detail.order_no)}${detail.email ? ` · ${esc(detail.email)}` : ''}</p>
        <div class="amount">${money(detail.amount_cents, detail.currency)}</div>
        ${pending ? `<p id="expireTip" style="margin-top:10px">请在 <b id="expireCd">--:--</b> 内完成支付，超时订单将自动关闭</p>
          <button class="btn btn-primary" id="repayBtn" style="margin-top:14px">继续支付</button>` : ''}
        ${detail.status === 'refunded' && detail.remark ? `<p style="margin-top:10px;color:var(--danger)">${esc(detail.remark)}</p>` : ''}
      </div>

      <div class="timeline">
        <div class="step done"><div class="dot">1</div><span>提交订单</span></div>
        <div class="step ${!pending ? 'done' : ''}"><div class="dot">2</div><span>支付成功</span></div>
        <div class="step ${['delivered', 'shipped'].includes(detail.status) ? 'done' : ''}"><div class="dot">3</div><span>${detail.items.some((i) => i.delivery_mode === 'auto') ? '自动发货' : '商家处理'}</span></div>
        <div class="step ${detail.status === 'delivered' ? 'done' : ''}"><div class="dot">4</div><span>交易完成</span></div>
      </div>

      <div class="checkout-layout" style="padding-top:20px">
        <div>
          <div class="card">
            <h2 class="card-title">商品信息</h2>
            ${detail.items.map((it) => `
              <div class="summary-item">
                <div class="n">${esc(it.product_name)}${it.sku_name ? ` / ${esc(it.sku_name)}` : ''}<br>
                  <span style="font-size:11.5px;color:var(--muted)">${({ auto: '自动发货', manual: '人工发货', physical: '实物配送', fixed: '固定内容' })[it.delivery_mode] || ''}</span></div>
                <div style="font-size:12px;color:var(--muted)">× ${it.qty}</div>
                <div class="p">${money(it.amount_cents, detail.currency)}</div>
              </div>`).join('')}
            <div class="summary-line" style="margin-top:8px"><span>商品金额</span><span>${money(detail.subtotal_cents, detail.currency)}</span></div>
            ${detail.discount_cents ? `<div class="summary-line"><span>优惠码 ${detail.coupon ? esc(detail.coupon.code) : ''}</span><span style="color:var(--success)">-${money(detail.discount_cents, detail.currency)}</span></div>` : ''}
            <div class="summary-total"><span>实付</span><strong>${money(detail.amount_cents, detail.currency)}</strong></div>
          </div>

          ${detail.items.some((it) => it.delivered && it.delivered.length) ? `
          <div class="card">
            <h2 class="card-title">${icon('gift', 18)} 卡密信息
              <button class="btn btn-soft btn-sm" id="copyAll" style="margin-left:auto">复制全部</button>
            </h2>
            <div class="cards-panel">
              ${detail.items.filter((it) => it.delivered && it.delivered.length).map((it) => `
                <div style="margin-bottom:14px">
                  <div style="font-size:12.5px;color:var(--muted);margin-bottom:8px">${esc(it.product_name)}</div>
                  ${it.delivered.map((c, i) => `
                    <div class="card-secret">
                      <code>${esc(c)}</code>
                      <button class="copy-btn" data-copy="${esc(c)}">${icon('copy', 13)} 复制</button>
                    </div>`).join('')}
                </div>`).join('')}
            </div>
            <p style="font-size:11.5px;color:var(--muted);margin:14px 0 0">卡密已同步发送至 ${esc(detail.email)}，请注意查收（含垃圾邮件箱）。</p>
          </div>` : ''}

          ${detail.status === 'manual' || detail.status === 'shipped' ? `
          <div class="card"><h2 class="card-title">发货进度</h2>
            <p style="font-size:13.5px;color:var(--muted);margin:0">该订单包含人工发货商品，商家会在 24 小时内处理，处理完成后可在此查看内容。</p>
          </div>` : ''}

          ${detail.note ? `<div class="card"><h2 class="card-title">订单备注</h2><p style="margin:0;font-size:13.5px;color:var(--text-2)">${esc(detail.note)}</p></div>` : ''}
        </div>

        <div class="card summary">
          <h2 class="card-title">订单信息</h2>
          <div class="summary-line"><span>订单状态</span><span class="status-pill status-${detail.status}">${statusText(detail.status)}</span></div>
          <div class="summary-line"><span>创建时间</span><span>${date(detail.created_at)}</span></div>
          ${detail.paid_at ? `<div class="summary-line"><span>支付时间</span><span>${date(detail.paid_at)}</span></div>` : ''}
          <div class="summary-line"><span>支付方式</span><span>${esc(detail.pay_channel || (pending ? '未支付' : '-'))}</span></div>
          ${detail.pay_trade_no ? `<div class="summary-line"><span>交易号</span><span style="word-break:break-all">${esc(detail.pay_trade_no)}</span></div>` : ''}
          ${detail.address ? `<div class="summary-line"><span>收货地址</span><span style="text-align:right;max-width:200px">${esc(detail.address.name)} ${esc(detail.address.phone)}<br>${esc(detail.address.region)} ${esc(detail.address.detail)}</span></div>` : ''}
          <a class="btn btn-ghost btn-block" href="/orders" style="margin-top:14px">查看全部订单</a>
          ${pending ? `<a class="btn btn-ghost btn-block" href="/tickets" style="margin-top:8px">支付遇到问题？提交工单</a>` : ''}
        </div>
      </div>`;

    qsa('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
    const copyAll = qs('#copyAll');
    if (copyAll) {
      copyAll.addEventListener('click', () => {
        const all = detail.items.flatMap((it) => it.delivered || []).join('\n');
        copyText(all);
      });
    }

    if (pending) {
      const cdEl = qs('#expireCd');
      const end = detail.expire_at;
      const timer = setInterval(() => {
        const left = end - Date.now();
        if (left <= 0) { clearInterval(timer); cdEl.textContent = '已超时'; return; }
        const m = String(Math.floor(left / 60000)).padStart(2, '0');
        const s = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
        cdEl.textContent = `${m}:${s}`;
      }, 1000);

      qs('#repayBtn').addEventListener('click', async () => {
        const channel = S.channels[0]?.id || 'epay';
        const pay = await request(`/api/orders/${detail.order_no}/pay?token=${encodeURIComponent(token)}`, { method: 'POST', body: { channel } });
        if (pay.action.type === 'paid') navigate(pay.action.redirect);
        else if (pay.action.type === 'redirect') window.location.href = pay.action.url;
        else if (pay.action.type === 'form') { document.open(); document.write(pay.action.html); document.close(); }
      });

      // 轮询支付状态
      const poll = setInterval(async () => {
        try {
          const st = await request(`/api/orders/${detail.order_no}/status?token=${encodeURIComponent(token)}`, { silent: true });
          if (st.status !== 'pending') {
            clearInterval(poll);
            navigate(`/order/${detail.order_no}?token=${encodeURIComponent(token)}&from=pay`, true);
            toast('支付成功', 'success');
          }
        } catch (e) { /* ignore */ }
      }, 3500);
      setTimeout(() => clearInterval(poll), 10 * 60 * 1000);
    }
  }

  /* ------------------------- 订单列表 / 查询 ------------------------- */
  async function renderOrders(app) {
    setTitle('我的订单');
    if (!S.user) {
      app.innerHTML = `
        <div class="page-head"><h1>订单查询</h1><p>输入订单号与下单邮箱查询订单状态与卡密</p></div>
        <div class="auth-wrap">
          <div class="card">
            <div class="field"><label>订单号</label><input id="lookupNo" placeholder="例如 FH20260101123456ABCD"></div>
            <div class="field"><label>下单邮箱</label><input id="lookupEmail" type="email" placeholder="you@example.com"></div>
            <button class="btn btn-primary btn-block" id="lookupBtn">${icon('search', 16)} 查询订单</button>
          </div>
          <div class="card" style="margin-top:14px;text-align:center">
            <p style="margin:0 0 12px;font-size:13.5px;color:var(--muted)">登录后可查看全部历史订单</p>
            <a class="btn btn-soft btn-block" href="/login">登录 / 注册</a>
          </div>
        </div>`;
      qs('#lookupBtn').addEventListener('click', async () => {
        const no = qs('#lookupNo').value.trim();
        const email = qs('#lookupEmail').value.trim();
        if (!no || !email) return toast('请填写订单号和邮箱', 'error');
        const data = await request(`/api/order-lookup?order_no=${encodeURIComponent(no)}&email=${encodeURIComponent(email)}`);
        navigate(`/order/${encodeURIComponent(data.order_no)}?token=${encodeURIComponent(data.token)}`);
      });
      return;
    }

    app.innerHTML = `
      <div class="page-head"><h1>我的订单</h1><p>最近 50 笔订单，点击查看卡密详情</p></div>
      <div class="card">
        <div id="orderList"><div class="page-loading"><div class="spinner"></div><p>加载中…</p></div></div>
      </div>`;
    const data = await request('/api/auth/orders');
    const list = qs('#orderList');
    if (!data.list.length) {
      list.innerHTML = `<div class="empty"><div class="big">📦</div><h3>还没有订单</h3><p>去首页挑点什么吧</p><a class="btn btn-primary" href="/">去逛逛</a></div>`;
      return;
    }
    list.innerHTML = data.list.map((o) => `
      <a class="order-row" href="/order/${o.order_no}?token=${encodeURIComponent(o.token || '')}">
        <div class="order-row-main">
          <div class="t">${o.order_no}</div>
          <div class="s">${date(o.created_at)} · ${(o.items || []).map((i) => i.product_name).join('、')}</div>
        </div>
        <span class="status-pill status-${o.status}">${statusText(o.status)}</span>
        <div class="a">${money(o.amount_cents, S.site?.currency_code || 'CNY')}</div>
      </a>`).join('');
  }

  /* ------------------------- 登录注册 ------------------------- */
  let turnstileScriptPromise = null;

  function loadTurnstileScript() {
    if (window.turnstile?.render) return Promise.resolve(window.turnstile);
    if (turnstileScriptPromise) return turnstileScriptPromise;
    turnstileScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        if (window.turnstile?.render) resolve(window.turnstile);
        else reject(new Error('Turnstile API 未就绪'));
      };
      script.onerror = () => reject(new Error('Turnstile 脚本加载失败'));
      document.head.appendChild(script);
    }).catch((error) => {
      // 允许下一次进入登录页时重试
      turnstileScriptPromise = null;
      throw error;
    });
    return turnstileScriptPromise;
  }

  async function renderLogin(app) {
    setTitle('登录');
    let mode = 'login';
    const turnstileOn = !!S.site?.turnstile_enabled;
    const turnstileSiteKey = S.site?.turnstile_site_key || '';
    let turnstileWidgetId = null;
    let turnstileToken = '';
    const turnstileError = (message) => {
      const el = qs('#turnstileError');
      if (!el) return;
      el.textContent = message;
      el.hidden = false;
    };
    const resetTurnstile = () => {
      turnstileToken = '';
      if (turnstileWidgetId !== null && window.turnstile) {
        try { window.turnstile.reset(turnstileWidgetId); } catch (e) { /* ignore */ }
      }
      const el = qs('#turnstileError');
      if (el) el.hidden = true;
    };
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <h1>${esc(S.site.name || 'Slogan')}</h1>
          <div class="sub">登录后可查看历史订单、余额与专属会员价</div>
          <div class="auth-tabs">
            <button data-mode="login" class="active">登录</button>
            <button data-mode="register">注册</button>
            <button data-mode="forgot">找回密码</button>
          </div>
          <form id="authForm" onsubmit="return false">
            <div class="field"><label>邮箱</label><input id="authEmail" type="email" placeholder="you@example.com" autocomplete="email"></div>
            <div class="field" id="pwdField"><label>密码</label><input id="authPassword" type="password" placeholder="至少 8 位" autocomplete="current-password"></div>
            <div class="field" id="inviteField" hidden><label>邀请码（选填）</label><input id="authInvite" placeholder="好友邀请码"></div>
            <div class="field" id="forgotHint" hidden><p class="muted" style="margin:0">输入注册邮箱，我们会发送一封含重置链接的邮件（30 分钟内有效）。</p></div>
            ${turnstileOn ? `<div class="turnstile-wrap">
              <div id="turnstileWidget"></div>
              <p class="turnstile-error" id="turnstileError" ${turnstileSiteKey ? 'hidden' : ''}>${turnstileSiteKey ? '' : 'Turnstile 未配置 Site Key，请联系管理员'}</p>
            </div>` : ''}
            <button class="btn btn-primary btn-block btn-lg" id="authSubmit">登录</button>
          </form>
          <div class="auth-foot"><a href="/orders">游客订单查询</a></div>
        </div>
      </div>`;

    qsa('[data-mode]').forEach((b) => b.addEventListener('click', () => {
      mode = b.dataset.mode;
      qsa('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
      qs('#inviteField').hidden = mode !== 'register';
      qs('#pwdField').hidden = mode === 'forgot';
      qs('#forgotHint').hidden = mode !== 'forgot';
      qs('#authSubmit').textContent = mode === 'login' ? '登录' : mode === 'register' ? '注册并登录' : '发送重置邮件';
      qs('#authPassword').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
      resetTurnstile();
    }));

    const mountTurnstile = async () => {
      if (!turnstileOn || !turnstileSiteKey) return;
      const container = qs('#turnstileWidget');
      if (!container) return;
      try {
        const api = await loadTurnstileScript();
        if (!qs('#turnstileWidget')) return;
        turnstileWidgetId = api.render(container, {
          sitekey: turnstileSiteKey,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          callback: (token) => {
            turnstileToken = token;
            const el = qs('#turnstileError');
            if (el) el.hidden = true;
          },
          'expired-callback': () => {
            turnstileToken = '';
            turnstileError('验证已过期，请重新完成验证');
          },
          'error-callback': () => {
            turnstileToken = '';
            turnstileError('人机验证加载失败，请刷新页面重试');
            return true;
          },
        });
        window.setTimeout(() => {
          const el = qs('#turnstileWidget');
          if (el && !el.querySelector('iframe')) turnstileError('人机验证加载失败，请刷新页面重试');
        }, 8000);
      } catch (e) {
        turnstileError('人机验证加载失败，请刷新页面重试');
      }
    };
    mountTurnstile();

    qs('#authSubmit').addEventListener('click', async () => {
      const email = qs('#authEmail').value.trim();
      const password = qs('#authPassword').value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('邮箱格式不正确', 'error');
      if (password.length < 8) return toast('密码至少 8 位', 'error');
      if (turnstileOn) {
        if (!turnstileSiteKey) return toast('Turnstile 未配置 Site Key，请联系管理员', 'error');
        if (!turnstileToken) {
          turnstileError('请先完成人机验证');
          return toast('请先完成人机验证', 'error');
        }
      }
      const btn = qs('#authSubmit');
      btn.disabled = true;
      try {
        if (mode === 'forgot') {
          const forgotBody = { email };
          if (turnstileOn) forgotBody.turnstile_token = turnstileToken;
          await request('/api/auth/forgot', { method: 'POST', body: forgotBody });
          toast('如果邮箱已注册，重置邮件已发出', 'success');
          btn.disabled = false;
          return;
        }
        const path = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
        const body = { email, password };
        if (mode === 'register') body.invite_code = qs('#authInvite').value.trim();
        if (turnstileOn) body.turnstile_token = turnstileToken;
        S.user = await request(path, { method: 'POST', body });
        toast(mode === 'login' ? '登录成功' : '注册成功', 'success');
        renderUserArea();
        navigate('/account');
      } catch (e) {
        btn.disabled = false;
        if (turnstileOn) resetTurnstile();
      }
    });
  }

  async function renderReset(app) {
    setTitle('重置密码');
    const token = new URLSearchParams(location.search).get('token') || '';
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card">
          <h1>设置新密码</h1>
          <div class="sub">请输入不少于 8 位的新密码</div>
          <form id="resetForm" onsubmit="return false">
            <div class="field"><label>新密码</label><input id="resetPwd" type="password" placeholder="至少 8 位" autocomplete="new-password"></div>
            <div class="field"><label>确认新密码</label><input id="resetPwd2" type="password" placeholder="再输入一次" autocomplete="new-password"></div>
            <button class="btn btn-primary btn-block btn-lg" id="resetSubmit">保存新密码</button>
          </form>
          <div class="auth-foot"><a href="/login">返回登录</a></div>
        </div>
      </div>`;
    qs('#resetSubmit').addEventListener('click', async () => {
      const p1 = qs('#resetPwd').value;
      const p2 = qs('#resetPwd2').value;
      if (p1.length < 8) return toast('密码至少 8 位', 'error');
      if (p1 !== p2) return toast('两次输入的密码不一致', 'error');
      const btn = qs('#resetSubmit');
      btn.disabled = true;
      try {
        await request('/api/auth/reset', { method: 'POST', body: { token, password: p1 } });
        toast('密码已重置，请使用新密码登录', 'success');
        navigate('/login');
      } catch (e) {
        btn.disabled = false;
      }
    });
  }

  /* ------------------------- 个人中心 ------------------------- */
  async function renderAccount(app) {
    if (!S.user) return navigate('/login', true);
    setTitle('个人中心');
    const [orders, logs, refs] = await Promise.all([
      request('/api/auth/orders'),
      request('/api/auth/balance-logs').catch(() => ({ list: [] })),
      request('/api/auth/referrals').catch(() => ({ total_cents: 0, invitees: 0 })),
    ]);
    const u = S.user;
    const next = u.next_level;
    const progress = next ? Math.min(100, Math.round((u.total_spent_cents / next.min_spent_cents) * 100)) : 100;

    app.innerHTML = `
      <div class="page-head"><h1>个人中心</h1><p>管理订单、余额与推广收益</p></div>
      <div class="account-grid">
        <div class="account-side">
          <div class="card">
            <div class="profile-head">
              <div class="profile-avatar">${esc(u.email.slice(0, 1).toUpperCase())}</div>
              <div><strong>${esc(u.email)}</strong><span>${esc(u.level_name)} · 累计消费 ${money(u.total_spent_cents, S.site?.currency_code || 'CNY')}</span></div>
            </div>
            <div class="stat-row">
              <div class="stat-box"><span>账户余额</span><strong>${money(u.balance_cents, S.site?.currency_code || 'CNY')}</strong></div>
              <div class="stat-box"><span>会员折扣</span><strong>${u.level_discount >= 100 ? '无' : u.level_discount / 10 + ' 折'}</strong></div>
            </div>
            ${next ? `<div style="margin-top:14px">
              <div style="font-size:11.5px;color:var(--muted)">距 ${esc(next.name)} 还差 ${money(next.gap_cents, S.site?.currency_code || 'CNY')}</div>
              <div class="level-bar"><i style="width:${progress}%"></i></div>
            </div>` : `<div style="font-size:11.5px;color:var(--muted);margin-top:12px">已是最高等级</div>`}
            <button class="btn btn-primary btn-block" id="rechargeBtn" style="margin-top:16px">${icon('wallet', 16)} 余额充值</button>
            <div style="font-size:11.5px;color:var(--muted);margin:14px 0 6px">我的邀请码</div>
            <div class="invite-box">
              <input id="inviteCode" readonly value="${esc(u.invite_code)}">
              <button class="btn btn-soft btn-sm" id="copyInvite" style="height:38px">${icon('copy', 14)}</button>
            </div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:10px">已邀请 ${refs.invitees || 0} 人 · 返佣累计 ${money(refs.total_cents || 0, S.site?.currency_code || 'CNY')}</div>
          </div>
        </div>

        <div>
          <div class="card">
            <h2 class="card-title">${icon('order', 17)} 我的订单</h2>
            <div id="accOrders">
              ${orders.list.length ? orders.list.map((o) => `
                <a class="order-row" href="/order/${o.order_no}?token=${encodeURIComponent(o.token || '')}">
                  <div class="order-row-main"><div class="t">${o.order_no}</div>
                    <div class="s">${date(o.created_at)} · ${(o.items || []).map((i) => i.product_name).join('、') || '余额充值'}</div></div>
                  <span class="status-pill status-${o.status}">${statusText(o.status)}</span>
                  <div class="a">${money(o.amount_cents, S.site?.currency_code || 'CNY')}</div>
                </a>`).join('') : '<div class="empty" style="padding:36px 0"><div class="big">📦</div><h3>暂无订单</h3><a class="btn btn-soft btn-sm" href="/">去逛逛</a></div>'}
            </div>
          </div>
          <div class="card">
            <h2 class="card-title">${icon('wallet', 17)} 余额明细</h2>
            ${logs.list.length ? logs.list.map((l) => `
              <div class="summary-line"><span>${esc(({ recharge: '余额充值', consume: '消费', refund: '退款', commission: '推广返佣', adjust: '管理员调整' })[l.type] || l.type)}${l.note ? ' · ' + esc(l.note) : ''}<br>
                <span style="font-size:11px;color:var(--muted)">${date(l.created_at)}</span></span>
                <span style="color:${l.amount_cents >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600">${l.amount_cents >= 0 ? '+' : ''}${money(l.amount_cents, S.site?.currency_code || 'CNY')}</span></div>`).join('') : '<p style="color:var(--muted);font-size:13px">暂无记录</p>'}
          </div>
          <div class="card">
            <h2 class="card-title">${icon('ticket', 17)} 售后与工单</h2>
            <p style="font-size:13px;color:var(--muted);margin:0 0 12px">卡密无法使用、支付异常或需要退款时，请提交工单，客服会尽快处理。</p>
            <a class="btn btn-ghost btn-block" href="/tickets">进入工单中心</a>
          </div>
        </div>
      </div>`;

    qs('#copyInvite').addEventListener('click', () => copyText(u.invite_code));
    qs('#rechargeBtn').addEventListener('click', () => {
      const modal = openModal({
        title: '余额充值',
        body: `
          <p style="font-size:13px;color:var(--muted);margin:0 0 14px">充值后可用于下单抵扣，余额支付可享受秒级发货。</p>
          <div class="field"><label>充值金额（元）</label><input id="rcAmount" type="number" min="1" step="1" value="50"></div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">
            ${[20, 50, 100, 500].map((n) => `<button class="btn btn-ghost btn-sm" data-rc="${n}">¥${n}</button>`).join('')}
          </div>
          <div class="pay-methods" id="rcMethods">
            ${S.channels.filter((c) => c.id !== 'balance').map((ch, i) => `
              <label class="pay-method ${i === 0 ? 'active' : ''}" data-rc-channel="${ch.id}">
                <input type="radio" name="rcpay" value="${ch.id}" ${i === 0 ? 'checked' : ''}>
                <span class="pay-radio"></span><span class="pay-icon ${ch.id === 'epay' ? 'alipay' : ch.id}">${payIconText(ch.id)}</span>
                <span class="n">${esc(ch.name)}</span>
              </label>`).join('') || '<p style="font-size:12px;color:var(--muted)">请先在后台配置支付方式</p>'}
          </div>`,
        footer: `<button class="btn btn-ghost" data-modal-close="1">取消</button>
                 <button class="btn btn-primary" id="rcSubmit">去支付</button>`,
      });
      let channel = S.channels.find((c) => c.id !== 'balance')?.id || 'epay';
      qsa('[data-rc]', modal.el).forEach((b) => b.addEventListener('click', () => { qs('#rcAmount', modal.el).value = b.dataset.rc; }));
      qsa('[data-rc-channel]', modal.el).forEach((el) => el.addEventListener('click', () => {
        qsa('[data-rc-channel]', modal.el).forEach((x) => x.classList.remove('active'));
        el.classList.add('active');
        channel = el.dataset.rcChannel;
      }));
      qs('#rcSubmit', modal.el).addEventListener('click', async () => {
        const amount = Math.round(Number(qs('#rcAmount', modal.el).value) * 100);
        if (!amount || amount < 100) return toast('请输入有效金额', 'error');
        const order = await request('/api/auth/recharge', { method: 'POST', body: { amount_cents: amount } });
        const pay = await request(`/api/orders/${order.order_no}/pay?token=${encodeURIComponent(order.token)}`, { method: 'POST', body: { channel } });
        if (pay.action.type === 'redirect') window.location.href = pay.action.url;
        else if (pay.action.type === 'form') { document.open(); document.write(pay.action.html); document.close(); }
        else if (pay.action.type === 'paid') navigate(pay.action.redirect);
      });
    });
  }

  /* ------------------------- 工单 ------------------------- */
  async function renderTickets(app) {
    if (!S.user) return navigate('/login', true);
    setTitle('工单中心');
    app.innerHTML = `
      <div class="page-head" style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px">
        <div><h1>工单中心</h1><p>提交售后问题，客服会尽快回复</p></div>
        <button class="btn btn-primary" id="newTicket">${icon('plus', 16)} 新建工单</button>
      </div>
      <div class="card"><div id="ticketList"><div class="page-loading"><div class="spinner"></div><p>加载中…</p></div></div></div>`;
    const data = await request('/api/tickets');
    const list = qs('#ticketList');
    list.innerHTML = data.list.length
      ? data.list.map((t) => `
        <a class="ticket-item" href="/ticket/${t.id}">
          <div class="ticket-icon">${icon('ticket', 18)}</div>
          <div class="ticket-main">
            <div class="t">${esc(t.subject)}</div>
            <div class="s">${date(t.updated_at)} · ${t.status === 'open' ? '处理中' : t.status === 'waiting' ? '客服已回复' : '已关闭'}</div>
          </div>
          <span class="status-pill status-${t.status === 'closed' ? 'closed' : 'paid'}">${t.status === 'open' ? '处理中' : t.status === 'waiting' ? '待查看' : '已关闭'}</span>
        </a>`).join('')
      : `<div class="empty"><div class="big">🎫</div><h3>暂无工单</h3><p>遇到问题时可以随时提交</p></div>`;

    qs('#newTicket').addEventListener('click', () => {
      const modal = openModal({
        title: '新建工单',
        body: `<div class="field"><label>问题标题</label><input id="tkSubject" placeholder="例如：购买的卡密无法登录"></div>
          <div class="field"><label>问题描述</label><textarea id="tkContent" placeholder="请描述订单号、商品名称与具体问题…"></textarea></div>`,
        footer: `<button class="btn btn-ghost" data-modal-close="1">取消</button>
                 <button class="btn btn-primary" id="tkSubmit">提交工单</button>`,
      });
      qs('#tkSubmit', modal.el).addEventListener('click', async () => {
        const subject = qs('#tkSubject', modal.el).value.trim();
        const content = qs('#tkContent', modal.el).value.trim();
        await request('/api/tickets', { method: 'POST', body: { subject, content } });
        modal.close();
        toast('工单已提交', 'success');
        renderTickets(app);
      });
    });
  }

  async function renderTicket(app, id) {
    if (!S.user) return navigate('/login', true);
    setTitle('工单详情');
    const t = await request(`/api/tickets/${id}`);
    app.innerHTML = `
      <nav class="breadcrumb"><a href="/tickets">工单中心</a><span>/</span><span>#${t.id}</span></nav>
      <div class="page-head" style="padding-top:0">
        <h1>${esc(t.subject)}</h1>
        <p>${date(t.created_at)} · <span class="status-pill status-${t.status === 'closed' ? 'closed' : 'paid'}">${t.status === 'open' ? '处理中' : t.status === 'waiting' ? '客服已回复' : '已关闭'}</span></p>
      </div>
      <div class="card">
        <div class="chat-list" id="chatList">
          ${t.messages.map((m) => `
            <div class="chat-msg ${m.sender_type === 'user' ? 'me' : ''}">
              <div class="chat-avatar">${m.sender_type === 'user' ? '我' : '客'}</div>
              <div><div class="chat-bubble">${esc(m.content)}</div>
                <div style="font-size:10.5px;color:var(--muted);margin-top:4px;${m.sender_type === 'user' ? 'text-align:right' : ''}">${date(m.created_at)}</div></div>
            </div>`).join('')}
        </div>
        ${t.status !== 'closed' ? `
        <div style="display:flex;gap:10px">
          <input id="replyInput" placeholder="输入回复内容…" style="flex:1;height:44px;padding:0 14px;border-radius:11px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;outline:none">
          <button class="btn btn-primary" id="replyBtn">发送</button>
        </div>` : '<p style="font-size:12.5px;color:var(--muted);margin:0">工单已关闭，如仍有问题请提交新工单。</p>'}
      </div>`;

    qs('#replyBtn')?.addEventListener('click', async () => {
      const content = qs('#replyInput').value.trim();
      if (!content) return;
      await request(`/api/tickets/${id}/messages`, { method: 'POST', body: { content } });
      renderTicket(app, id);
    });
  }

  function render404(app) {
    app.innerHTML = `<div class="empty" style="padding:100px 0"><div class="big">🧭</div><h3>页面不存在</h3><p>你访问的页面可能已被移除</p><a class="btn btn-primary" href="/">返回首页</a></div>`;
  }

  /* ------------------------- 启动 ------------------------- */
  async function boot() {
    bindShell();
    const mo = new MutationObserver(() => translateDom());
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    try {
      await loadSite();
    } catch (e) {
      document.getElementById('app').innerHTML = `<div class="empty"><div class="big">⚠️</div><h3>无法连接站点</h3><p>请稍后刷新重试</p></div>`;
      return;
    }
    await refreshUser();
    renderShell();
    await route();
  }

  boot();
})();
