/* ============================================================
   Slogan · 后台逻辑（Cloudflare Workers + D1）
   模块：商品 / 卡密池 / 批发价 / 优惠券 / 工单 / 支付配置
         购物车 / 会员等级 / 秒杀 / 卡密预选 / 限购 / 三级返佣
   ============================================================ */
(function () {
  'use strict';

  const { icon, esc, money, date, request, toast, openModal, confirmDialog, copyText, qs, qsa } = UI;
  const API = '/api/admin';
  let ACTIVE_MERCHANT = '';
  try { ACTIVE_MERCHANT = localStorage.getItem('fh-admin-merchant') || ''; } catch (e) { /* ignore */ }
  const api = (path, opts = {}) => {
    // 平台管理员可切换店铺；商户管理员由服务端强制只看自己
    if (ME && !ME.merchant_id && ACTIVE_MERCHANT && !path.startsWith('/merchants') && !path.startsWith('/merchant/profile')) {
      path += (path.includes('?') ? '&' : '?') + 'merchant_id=' + encodeURIComponent(ACTIVE_MERCHANT);
    }
    return request(API + path, opts);
  };

  let ME = null;
  const state = { page: 1, filters: {} };

  /* ================= 通用 ================= */
  const STATUS_MAP = {
    pending: ['待支付', 'badge-orange'],
    paid: ['已支付', 'badge-blue'],
    manual: ['待发货', 'badge-purple'],
    shipped: ['配送中', 'badge-blue'],
    delivered: ['已完成', 'badge-green'],
    closed: ['已关闭', 'badge-gray'],
    refunded: ['已退款', 'badge-red'],
  };
  function statusBadge(s) {
    const [txt, cls] = STATUS_MAP[s] || [s, 'badge-gray'];
    return `<span class="badge ${cls}">${txt}</span>`;
  }
  function setPage(html) {
    qs('#adminApp').innerHTML = html;
  }
  function setCrumb(title, sub) {
    qs('#crumb').innerHTML = `${esc(title)}${sub ? ` <span>/ ${esc(sub)}</span>` : ''}`;
  }
  /** 平台管理员处于「全部店铺」视图时的提示 */
  function storeHint() {
    if (!ME || ME.merchant_id || ACTIVE_MERCHANT) return '';
    return `<div class="store-hint">${icon('info', 15)}<span>当前为「全部店铺」聚合视图；新建的商品 / 分组 / 优惠券会归属默认店铺。需要录入其他店铺，请先在顶栏切换店铺。</span></div>`;
  }
  function emptyBlock(big, title, desc, action = '') {
    return `<div class="empty"><div class="big">${big}</div><h3>${esc(title)}</h3><p>${esc(desc || '')}</p>${action}</div>`;
  }
  function tsToInput(ts) {
    if (!ts) return '';
    const d = new Date(Number(ts));
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function inputToTs(v) {
    if (!v) return null;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  function pagerHTML(page, pages, total) {
    if (pages <= 1) return '';
    return `<div class="pager">
      <button class="btn btn-ghost btn-sm" data-pg="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>
      <span>第 ${page} / ${pages} 页 · 共 ${total} 条</span>
      <button class="btn btn-ghost btn-sm" data-pg="${page + 1}" ${page >= pages ? 'disabled' : ''}>下一页</button>
    </div>`;
  }

  /* ================= 登录 / 初始化 ================= */
  function showAuthScreen(mode) {
    qs('.shell').style.display = 'none';
    let el = qs('#authScreen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'authScreen';
      document.body.appendChild(el);
    }
    const isSetup = mode === 'setup';
    el.innerHTML = `<div class="auth-screen"><div class="auth-card">
      <div class="mark">S</div>
      <h1>${isSetup ? '初始化管理员' : '管理后台'}</h1>
      <div class="sub">${isSetup ? '首次部署，请创建第一个管理员账号' : 'Slogan · 数字商品自动发货 · Cloudflare 版'}</div>
      <div class="field"><label>管理员账号</label><input id="authUser" placeholder="3-24 位字母数字" autocomplete="username"></div>
      <div class="field"><label>密码</label><input id="authPass" type="password" placeholder="${isSetup ? '至少 10 位' : '请输入密码'}" autocomplete="current-password"></div>
      <div class="field" id="totpField" ${isSetup ? 'hidden' : ''}><label>动态验证码</label><input id="authTotp" inputmode="numeric" maxlength="6" placeholder="未开启两步验证可留空" autocomplete="one-time-code"></div>
      <button class="btn btn-primary btn-block" id="authSubmit" style="height:42px">${isSetup ? '创建并登录' : '登录'}</button>
      <div class="sub" style="margin:14px 0 0">${isSetup ? '初始化完成后此页面自动失效' : '后台地址可由 ADMIN_PATH 环境变量自定义'}</div>
    </div></div>`;
    const submit = async () => {
      const username = qs('#authUser').value.trim();
      const password = qs('#authPass').value;
      if (!username || !password) return toast('请输入账号和密码', 'error');
      const btn = qs('#authSubmit');
      btn.disabled = true;
      try {
        const body = { username, password };
        if (!isSetup) body.code = qs('#authTotp').value.trim();
        ME = await api(isSetup ? '/setup' : '/login', { method: 'POST', body });
        if (ME.merchant_id) ACTIVE_MERCHANT = '';
        el.remove();
        qs('.shell').style.display = '';
        renderNav();
        renderTopbar();
        route();
        toast(isSetup ? '初始化成功' : '登录成功', 'success');
      } catch (e) {
        btn.disabled = false;
      }
    };
    qs('#authSubmit').addEventListener('click', submit);
    qs('#authPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }

  /* ================= 导航 ================= */
  const NAV = [
    { group: '概览', items: [
      { key: 'dashboard', name: '仪表盘', icon: 'grid' },
      { key: 'orders', name: '订单管理', icon: 'order', badge: true },
    ] },
    { group: '商品', items: [
      { key: 'products', name: '商品管理', icon: 'box' },
      { key: 'categories', name: '商品分组', icon: 'grid' },
      { key: 'cards', name: '卡密管理', icon: 'gift' },
      { key: 'suppliers', name: '上游供应商', icon: 'box' },
      { key: 'coupons', name: '优惠券', icon: 'ticket' },
    ] },
    { group: '用户', items: [
      { key: 'users', name: '用户管理', icon: 'user' },
      { key: 'levels', name: '会员等级', icon: 'spark' },
      { key: 'tickets', name: '工单处理', icon: 'ticket', badge: true },
    ] },
    { group: '系统', items: [
      { key: 'merchants', name: '多商户', icon: 'grid' },
      { key: 'payments', name: '支付配置', icon: 'wallet' },
      { key: 'security', name: '安全设置', icon: 'lock' },
      { key: 'notify', name: '通知设置', icon: 'mail' },
      { key: 'media', name: '媒体库', icon: 'spark' },
      { key: 'templates', name: '邮件模板', icon: 'mail' },
      { key: 'settings', name: '站点设置', icon: 'gear' },
      { key: 'logs', name: '操作日志', icon: 'clock' },
    ] },
  ];

  const NAV_MERCHANT = [
    { group: '概览', items: [
      { key: 'dashboard', name: '仪表盘', icon: 'grid' },
      { key: 'orders', name: '订单管理', icon: 'order', badge: true },
    ] },
    { group: '商品', items: [
      { key: 'products', name: '商品管理', icon: 'box' },
      { key: 'categories', name: '商品分组', icon: 'grid' },
      { key: 'cards', name: '卡密管理', icon: 'gift' },
      { key: 'coupons', name: '优惠券', icon: 'ticket' },
    ] },
    { group: '服务', items: [
      { key: 'tickets', name: '工单处理', icon: 'ticket', badge: true },
      { key: 'store', name: '店铺设置', icon: 'gear' },
    ] },
  ];

  function renderNav() {
    const nav = ME?.merchant_id ? NAV_MERCHANT : NAV;
    qs('#sideNav').innerHTML = nav.map((g) => `
      <div class="nav-group">${g.group}</div>
      ${g.items.map((it) => `<a class="nav-item" href="#/${it.key}" data-nav="${it.key}">
        ${icon(it.icon, 16)}<span>${it.name}</span>${it.badge ? '<span class="badge-nav" data-badge="' + it.key + '"></span>' : ''}
      </a>`).join('')}`).join('');
  }

  function renderTopbar() {
    qs('#who').textContent = ME
      ? `${ME.username} · ${ME.merchant_id ? '商户管理员' : '平台管理员'}`
      : '';
    qs('#themeToggle').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 17);
    const sel = qs('#merchantSwitch');
    if (sel) {
      if (ME && !ME.merchant_id) {
        sel.hidden = false;
        loadMerchantSwitch();
      } else {
        sel.hidden = true;
      }
    }
  }

  let merchantSwitchLoaded = false;
  async function loadMerchantSwitch() {
    if (merchantSwitchLoaded) return;
    const sel = qs('#merchantSwitch');
    if (!sel) return;
    try {
      const list = await api('/merchants');
      sel.innerHTML = `<option value="">全部店铺</option>${list.map((m) =>
        `<option value="${m.id}" ${String(ACTIVE_MERCHANT) === String(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}`;
      sel.value = ACTIVE_MERCHANT || '';
      sel.onchange = () => {
        ACTIVE_MERCHANT = sel.value;
        try { localStorage.setItem('fh-admin-merchant', ACTIVE_MERCHANT); } catch (e) { /* ignore */ }
        const name = sel.value === '' ? '全部店铺' : list.find((m) => String(m.id) === sel.value)?.name || '';
        toast(`已切换到 ${name}`, 'success');
        route();
      };
      merchantSwitchLoaded = true;
    } catch (e) { /* ignore */ }
  }

  function markNav(key) {
    qsa('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  }

  async function loadBadges() {
    try {
      const st = await api('/stats');
      const o = qs('[data-badge="orders"]');
      const t = qs('[data-badge="tickets"]');
      if (o) o.textContent = st.pending_ship || '';
      const tk = await api('/tickets?status=open');
      if (t) t.textContent = tk.length || '';
    } catch (e) { /* ignore */ }
  }

  /* ================= 路由 ================= */
  async function route() {
    if (!ME) return;
    const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
    const [page, arg] = hash.split('/');
    const rootOnly = ['suppliers', 'users', 'levels', 'merchants', 'payments', 'security', 'notify', 'media', 'templates', 'settings', 'logs'];
    if (ME.merchant_id && rootOnly.includes(page)) {
      location.hash = '#/dashboard';
      return;
    }
    if (!ME.merchant_id && page === 'store') {
      location.hash = '#/merchants';
      return;
    }
    markNav(page);
    try {
      switch (page) {
        case 'dashboard': return pageDashboard();
        case 'products': return arg === 'new' ? pageProductEditor(null) : /^\d+$/.test(arg || '') ? pageProductEditor(Number(arg)) : pageProducts();
        case 'categories': return pageCategories();
        case 'cards': return pageCards();
        case 'suppliers': return pageSuppliers();
        case 'orders': return pageOrders();
        case 'coupons': return pageCoupons();
        case 'users': return pageUsers();
        case 'levels': return pageLevels();
        case 'tickets': return pageTickets();
        case 'payments': return pagePayments();
        case 'security': return pageSecurity();
        case 'notify': return pageNotify();
        case 'media': return pageMedia();
        case 'templates': return pageTemplates();
        case 'settings': return pageSettings();
        case 'logs': return pageLogs();
        case 'merchants': return pageMerchants();
        case 'store': return pageStore();
        default: return pageDashboard();
      }
    } catch (e) {
      if (e.status === 401) {
        ME = null;
        showAuthScreen('login');
        return;
      }
      setPage(`<div class="card">${emptyBlock('⚠️', '加载失败', e.message || '请稍后再试', '<a class="btn btn-primary" href="#/dashboard">返回仪表盘</a>')}</div>`);
    }
  }

  /* ================= 仪表盘 ================= */
  async function pageDashboard() {
    setCrumb('仪表盘', '经营概览');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const d = await api('/stats');

    const cards = [
      { label: '今日订单', value: d.today.orders, icon: 'order', cls: '' },
      { label: '今日营收', value: money(d.today.revenue), icon: 'wallet', cls: 'green' },
      { label: '今日毛利', value: money(d.today.profit), icon: 'spark', cls: 'green' },
      { label: '待人工发货', value: d.pending_ship, icon: 'box', cls: 'orange' },
      { label: '在售商品', value: d.total_products, icon: 'gift', cls: '' },
      { label: '可用卡密', value: d.total_cards, icon: 'ticket', cls: '' },
    ];

    setPage(`
      <div class="page-head">
        <div><h1>仪表盘</h1><p>今日经营数据与待办事项</p></div>
        <div class="actions"><a class="btn btn-ghost" href="#/orders">${icon('order', 15)} 全部订单</a><a class="btn btn-primary" href="#/products/new">${icon('plus', 15)} 新建商品</a></div>
      </div>
      <div class="stat-grid">
        ${cards.map((c) => `<div class="stat"><div class="ico ${c.cls}">${icon(c.icon, 18)}</div>
          <div class="label">${c.label}</div><div class="value">${c.value}</div></div>`).join('')}
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-title"><div class="left">${icon('spark', 16)} 近 7 天营收趋势</div><span class="badge badge-gray">实付金额</span></div>
          ${renderChart(d.series)}
        </div>
        <div class="card">
          <div class="card-title">订单状态分布</div>
          ${Object.entries(d.status_count).map(([k, v]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border)">
              ${statusBadge(k)}<strong style="font-size:13px">${v}</strong>
            </div>`).join('') || '<p style="color:var(--muted);font-size:12.5px">暂无订单</p>'}
          <div class="card-title" style="margin-top:22px">销量 TOP</div>
          ${d.top_products.length ? d.top_products.map((p) => `
            <div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;font-size:12.5px">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span>
              <span style="color:var(--muted)">${p.sales_count} 件</span>
            </div>`).join('') : '<p style="color:var(--muted);font-size:12.5px">暂无销量</p>'}
        </div>
      </div>

      <div class="two-col">
        <div class="card">
          <div class="card-title">最近订单<a class="btn btn-soft btn-xs" href="#/orders">查看全部</a></div>
          <div class="table-wrap"><table class="table">
            <thead><tr><th>订单号</th><th>邮箱</th><th class="num">金额</th><th>状态</th><th>时间</th></tr></thead>
            <tbody>${d.recent_orders.map((o) => `<tr>
              <td class="code">${esc(o.order_no)}</td>
              <td class="muted">${esc(o.email)}</td>
              <td class="num">${money(o.amount_cents)}</td>
              <td>${statusBadge(o.status)}</td>
              <td class="muted">${date(o.created_at)}</td></tr>`).join('') || `<tr><td colspan="5">${emptyBlock('📭', '还没有订单', '前台下单后会显示在这里')}</td></tr>`}
            </tbody></table></div>
        </div>
        <div class="card">
          <div class="card-title">库存预警<span class="badge badge-red">${d.low_stock.length}</span></div>
          ${d.low_stock.length ? d.low_stock.map((p) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border)">
              <div><div style="font-size:12.8px;font-weight:600">${esc(p.name)}</div>
                <div class="muted" style="font-size:11px">${p.delivery_mode === 'auto' ? '卡密池' : '人工库存'}</div></div>
              <span class="badge badge-red">${p.delivery_mode === 'auto' ? p.card_count : p.stock} 件</span>
            </div>`).join('') : '<p style="color:var(--muted);font-size:12.5px">库存充足</p>'}
          <a class="btn btn-ghost btn-sm btn-block" href="#/cards" style="margin-top:12px">去补充卡密</a>
        </div>
      </div>`);
  }

  function renderChart(series) {
    const w = 720, h = 200, pl = 46, pr = 12, pt = 14, pb = 26;
    const iw = w - pl - pr, ih = h - pt - pb;
    const max = Math.max(100, ...series.map((s) => s.revenue));
    const step = iw / Math.max(1, series.length - 1);
    const pts = series.map((s, i) => [pl + i * step, pt + ih - (s.revenue / max) * ih]);
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const area = `${line} L${pts[pts.length - 1][0].toFixed(1)} ${pt + ih} L${pts[0][0].toFixed(1)} ${pt + ih} Z`;
    const grid = [0, 0.25, 0.5, 0.75, 1].map((r) => {
      const y = pt + ih - r * ih;
      return `<line class="chart-grid" x1="${pl}" y1="${y}" x2="${w - pr}" y2="${y}"/>
        <text class="chart-axis" x="${pl - 8}" y="${y + 3}" text-anchor="end">${Math.round(max * r)}</text>`;
    }).join('');
    return `<div class="chart-wrap"><svg class="chart-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6366f1" stop-opacity=".28"/>
        <stop offset="100%" stop-color="#6366f1" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#g1)"/>
      <path d="${line}" fill="none" stroke="#6366f1" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
      ${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#fff" stroke="#6366f1" stroke-width="2">
        <title>${series[i].date} · ${money(series[i].revenue)}</title></circle>`).join('')}
      ${series.map((s, i) => `<text class="chart-axis" x="${pl + i * step}" y="${h - 8}" text-anchor="middle">${s.date}</text>`).join('')}
    </svg></div>`;
  }

  /* ================= 商品 ================= */
  async function pageProducts() {
    setCrumb('商品管理', '商品列表');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const params = new URLSearchParams({ page: String(state.page || 1), size: '20' });
    if (state.q) params.set('q', state.q);
    if (state.category) params.set('category', state.category);
    if (state.status) params.set('status', state.status);
    const [d, cats] = await Promise.all([api(`/products?${params}`), api('/categories')]);
    const list = d.list;

    setPage(`
      <div class="page-head">
        <div><h1>商品管理</h1><p>共 ${d.total} 个商品 · 支持多规格 SKU、批发价、秒杀与卡密预选</p></div>
        <div class="actions">
          <a class="btn btn-ghost" href="#/cards">${icon('gift', 15)} 卡密管理</a>
          <a class="btn btn-primary" href="#/products/new">${icon('plus', 15)} 新建商品</a>
        </div>
      </div>
      ${storeHint()}
      <div class="card">
        <div class="filters">
          <input id="pq" placeholder="搜索商品名称" value="${esc(state.q || '')}" style="width:200px">
          <select id="pcat"><option value="">全部分组</option>${cats.map((c) => `<option value="${c.id}" ${String(state.category) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
          <select id="pstatus">
            <option value="">全部状态</option>
            <option value="on" ${state.status === 'on' ? 'selected' : ''}>上架</option>
            <option value="off" ${state.status === 'off' ? 'selected' : ''}>下架</option>
          </select>
          <button class="btn btn-soft btn-sm" id="pSearch">查询</button>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>商品</th><th>分组</th><th class="num">售价</th><th class="num">库存</th><th class="num">销量</th><th>发货</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>${list.map((p) => `
            <tr>
              <td><div class="cell-prod">
                <div class="img">${p.images ? (JSON.parse(p.images || '[]')[0] ? `<img src="${esc(JSON.parse(p.images || '[]')[0])}">` : '🎁') : '🎁'}</div>
                <div><div class="n">${esc(p.name)}</div><div class="s">#${p.id} · 成本 ${money(p.cost_cents)}</div></div>
              </div></td>
              <td class="muted">${esc(p.category_name || '未分组')}</td>
              <td class="num"><strong>${money(p.price_cents)}</strong>${p.member_price_cents != null ? `<div class="muted">会员 ${money(p.member_price_cents)}</div>` : ''}</td>
              <td class="num">${p.delivery_mode === 'auto' ? `<span class="badge ${p.card_count <= 5 ? 'badge-red' : 'badge-green'}">${p.card_count}</span>` : `<span class="badge ${p.stock <= 5 ? 'badge-red' : 'badge-gray'}">${p.stock}</span>`}</td>
              <td class="num">${p.sales_count}</td>
              <td class="muted">${({ auto: '卡密自动', manual: '人工', physical: '实物', fixed: '固定内容' })[p.delivery_mode] || p.delivery_mode}</td>
              <td>${p.status === 'on' ? '<span class="badge badge-green">上架</span>' : '<span class="badge badge-gray">下架</span>'}</td>
              <td><div class="actions">
                <a class="btn btn-ghost btn-xs" href="#/products/${p.id}/edit">编辑</a>
                <button class="btn btn-soft btn-xs" data-toggle="${p.id}">${p.status === 'on' ? '下架' : '上架'}</button>
                <button class="btn btn-danger-ghost btn-xs" data-del="${p.id}">删除</button>
              </div></td>
            </tr>`).join('') || `<tr><td colspan="8">${emptyBlock('📦', '还没有商品', '创建第一个商品开始售卖')}</td></tr>`}</tbody>
        </table></div>
        ${pagerHTML(d.page, d.pages, d.total)}
      </div>`);

    const reload = () => { state.q = qs('#pq').value.trim(); state.category = qs('#pcat').value; state.status = qs('#pstatus').value; state.page = 1; pageProducts(); };
    qs('#pSearch').addEventListener('click', reload);
    qs('#pq').addEventListener('keydown', (e) => { if (e.key === 'Enter') reload(); });
    qsa('[data-pg]').forEach((b) => b.addEventListener('click', () => { state.page = Number(b.dataset.pg); pageProducts(); }));
    qsa('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.toggle;
      const p = list.find((x) => String(x.id) === id);
      await api(`/products/${id}`, { method: 'PUT', body: { ...p, skus: [], status: p.status === 'on' ? 'off' : 'on' } });
      toast('已更新状态', 'success');
      pageProducts();
    }));
    qsa('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('删除后该商品的未售卡密也会被清除，确定删除？', { danger: true, okText: '删除' }))) return;
      await api(`/products/${b.dataset.del}`, { method: 'DELETE' });
      toast('已删除', 'success');
      pageProducts();
    }));
  }

  async function pageProductEditor(id) {
    const isNew = !id;
    setCrumb(isNew ? '新建商品' : '编辑商品', '商品管理');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const cats = await api('/categories');
    const suppliers = await api('/suppliers').catch(() => []);
    let p = {
      name: '', category_id: '', images: [], description: '', delivery_mode: 'auto',
      price_cents: 0, member_price_cents: null, cost_cents: 0, stock: 0,
      min_qty: 1, max_qty: 99, limit_per_user: 0, wholesale_tiers: [],
      seckill_price_cents: null, seckill_starts_at: null, seckill_ends_at: null,
      pick_enabled: 0, pick_fee_cents: 0, content: '', status: 'on', is_recommend: 0, sort: 0, skus: [],
    };
    if (!isNew) p = await api(`/products/${id}`);
    const tiers = Array.isArray(p.wholesale_tiers) ? p.wholesale_tiers : JSON.parse(p.wholesale_tiers || '[]');
    const images = Array.isArray(p.images) ? p.images : JSON.parse(p.images || '[]');

    setPage(`
      <div class="page-head">
        <div><h1>${isNew ? '新建商品' : '编辑商品'}</h1><p>商品基础信息、定价策略与发货方式</p></div>
        <div class="actions"><a class="btn btn-ghost" href="#/products">返回列表</a></div>
      </div>
      <form id="productForm" onsubmit="return false">
        <div class="card">
          <div class="form-section"><h3><span class="dot"></span>基础信息</h3>
            <div class="form-grid">
              <div class="field full"><label>商品名称 *</label><input data-p="name" value="${esc(p.name)}" placeholder="例如：Netflix 一个月会员"></div>
              <div class="field"><label>所属分组</label><select data-p="category_id">
                <option value="">未分组</option>${cats.map((c) => `<option value="${c.id}" ${String(p.category_id) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
              <div class="field"><label>排序</label><input data-p="sort" type="number" value="${p.sort || 0}"><div class="hint">数字越大越靠前</div></div>
              <div class="field full"><label>商品图片</label>
                <div style="display:flex;gap:8px;align-items:flex-start">
                  <textarea data-p="images" rows="3" style="flex:1" placeholder="每行一个图片地址（https://…），留空则使用渐变占位">${esc(images.join('\n'))}</textarea>
                  <button type="button" class="btn btn-ghost" id="pickMedia" style="flex-shrink:0">${icon('spark', 15)} 媒体库</button>
                </div>
                <div class="hint">支持上传到 R2 媒体库后选择，或直接填写外链</div>
              </div>
              <div class="field full"><label>商品详情（支持 HTML）</label><textarea data-p="description" rows="7" placeholder="支持粘贴富文本 HTML">${esc(p.description || '')}</textarea></div>
              <div class="field"><label>状态</label><select data-p="status">
                <option value="on" ${p.status === 'on' ? 'selected' : ''}>上架</option>
                <option value="off" ${p.status === 'off' ? 'selected' : ''}>下架</option></select></div>
              <div class="field"><label>首页推荐</label><label class="switch"><input type="checkbox" data-p="is_recommend" ${p.is_recommend ? 'checked' : ''}><span class="track"></span><span>显示在首页推荐位</span></label></div>
            </div>
          </div>

          <div class="form-section"><h3><span class="dot"></span>定价与库存</h3>
            <div class="form-grid">
              <div class="field"><label>售价（元）*</label><input data-p="price_cents" type="number" step="0.01" value="${(p.price_cents / 100).toFixed(2)}"></div>
              <div class="field"><label>会员价（元，留空同售价）</label><input data-p="member_price_cents" type="number" step="0.01" value="${p.member_price_cents != null ? (p.member_price_cents / 100).toFixed(2) : ''}"></div>
              <div class="field"><label>成本价（元）</label><input data-p="cost_cents" type="number" step="0.01" value="${(p.cost_cents / 100).toFixed(2)}"><div class="hint">用于仪表盘毛利统计</div></div>
              <div class="field"><label>库存（人工/实物）</label><input data-p="stock" type="number" value="${p.stock || 0}" ${p.delivery_mode === 'auto' ? 'readonly' : ''}><div class="hint">卡密自动发货时由卡密池数量决定</div></div>
              <div class="field"><label>起购数量</label><input data-p="min_qty" type="number" value="${p.min_qty || 1}"></div>
              <div class="field"><label>单次限购</label><input data-p="max_qty" type="number" value="${p.max_qty || 99}"></div>
              <div class="field"><label>每人限购（0 不限）</label><input data-p="limit_per_user" type="number" value="${p.limit_per_user || 0}"></div>
              <div class="field"><label>发货方式</label><select data-p="delivery_mode">
                ${[['auto', '卡密自动发货'], ['manual', '人工发货'], ['physical', '实物快递'], ['fixed', '固定内容（重复发货）']].map(([v, t]) => `<option value="${v}" ${p.delivery_mode === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
              <div class="field full" id="contentField" ${p.delivery_mode !== 'fixed' ? 'hidden' : ''}><label>固定发货内容</label><textarea data-p="content" rows="4" placeholder="所有买家都会收到这段内容">${esc(p.content || '')}</textarea></div>
            </div>
          </div>

          <div class="form-section"><h3><span class="dot"></span>批发阶梯价</h3>
            <div class="dynamic-rows" id="tierRows"></div>
            <button class="btn btn-soft btn-sm" id="addTier" type="button" style="margin-top:8px">${icon('plus', 13)} 添加一档</button>
            <div class="hint" style="font-size:11px;color:var(--muted);margin-top:6px">达到数量后自动应用该单价，低于原价才会生效</div>
          </div>

          <div class="form-section"><h3><span class="dot"></span>限时秒杀</h3>
            <div class="form-grid">
              <div class="field"><label>秒杀价（元）</label><input data-p="seckill_price_cents" type="number" step="0.01" value="${p.seckill_price_cents != null ? (p.seckill_price_cents / 100).toFixed(2) : ''}"></div>
              <div class="field"><label>开始时间</label><input data-p="seckill_starts_at" type="datetime-local" value="${tsToInput(p.seckill_starts_at)}"></div>
              <div class="field"><label>结束时间</label><input data-p="seckill_ends_at" type="datetime-local" value="${tsToInput(p.seckill_ends_at)}"></div>
              <div class="field"><label>卡密预选</label><label class="switch"><input type="checkbox" data-p="pick_enabled" ${p.pick_enabled ? 'checked' : ''}><span class="track"></span><span>允许买家自选卡号</span></label></div>
              <div class="field"><label>自选卡号加价（元）</label><input data-p="pick_fee_cents" type="number" step="0.01" value="${(p.pick_fee_cents / 100).toFixed(2)}"></div>
            </div>
          </div>

          <div class="form-section"><h3><span class="dot"></span>多规格 SKU</h3>
            <div class="dynamic-rows" id="skuRows"></div>
            <button class="btn btn-soft btn-sm" id="addSku" type="button" style="margin-top:8px">${icon('plus', 13)} 添加规格</button>
            <div class="hint" style="font-size:11px;color:var(--muted);margin-top:6px">规格价格留空则跟随商品售价；卡密导入时可指定规格</div>
          </div>

          <div class="form-section"><h3><span class="dot"></span>上游供应商（库存不足自动采购）</h3>
            <div class="form-grid">
              <div class="field"><label>供应商</label><select data-p="supplier_id">
                <option value="">不使用</option>${suppliers.map((x) => `<option value="${x.id}" ${String(p.supplier_id || '') === String(x.id) ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
              <div class="field"><label>上游商品 ID</label><input data-p="supplier_goods_id" value="${esc(p.supplier_goods_id || '')}" placeholder="供应商侧的 goods_id"></div>
              <div class="field"><label>上游成本（元）</label><input data-p="supplier_cost_cents" type="number" step="0.01" value="${(p.supplier_cost_cents / 100).toFixed(2)}"></div>
              <div class="field"><label>自动采购</label><label class="switch"><input type="checkbox" data-p="auto_purchase" ${p.auto_purchase !== 0 ? 'checked' : ''}><span class="track"></span><span>卡密不足时自动向上游下单</span></label></div>
            </div>
            <div class="hint" style="margin-top:6px">接口约定与签名方式见 README「上游供应商」；采购失败会记录在供应商日志，订单转为人工发货。</div>
          </div>

          <div style="display:flex;gap:10px;justify-content:flex-end;position:sticky;bottom:0;background:var(--surface);padding-top:14px;border-top:1px solid var(--border)">
            <a class="btn btn-ghost" href="#/products">取消</a>
            <button class="btn btn-primary" id="saveProduct">${isNew ? '创建商品' : '保存修改'}</button>
          </div>
        </div>
      </form>`);

    const tierRows = qs('#tierRows');
    const skuRows = qs('#skuRows');
    const tierHTML = (t = {}) => `<div class="dynamic-row">
      <input data-tier="min_qty" type="number" placeholder="满 X 件" value="${t.min_qty || ''}">
      <input data-tier="price_cents" type="number" step="0.01" placeholder="单价（元）" value="${t.price_cents != null ? (t.price_cents / 100).toFixed(2) : ''}">
      <span></span><button class="btn btn-danger-ghost btn-xs" type="button" data-rm>删除</button></div>`;
    const skuHTML = (s = {}) => `<div class="dynamic-row">
      <input data-sku="name" placeholder="规格名称，如：月卡" value="${esc(s.name || '')}">
      <input data-sku="price_cents" type="number" step="0.01" placeholder="价格（元，留空跟随）" value="${s.price_cents != null ? (s.price_cents / 100).toFixed(2) : ''}">
      <input data-sku="member_price_cents" type="number" step="0.01" placeholder="会员价（元）" value="${s.member_price_cents != null ? (s.member_price_cents / 100).toFixed(2) : ''}">
      <button class="btn btn-danger-ghost btn-xs" type="button" data-rm>${icon('trash', 13)}</button></div>`;

    tiers.forEach((t) => tierRows.insertAdjacentHTML('beforeend', tierHTML(t)));
    (p.skus || []).forEach((s) => skuRows.insertAdjacentHTML('beforeend', skuHTML(s)));
    qs('#addTier').addEventListener('click', () => tierRows.insertAdjacentHTML('beforeend', tierHTML()));
    qs('#addSku').addEventListener('click', () => skuRows.insertAdjacentHTML('beforeend', skuHTML()));
    [tierRows, skuRows].forEach((box) => box.addEventListener('click', (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) rm.closest('.dynamic-row').remove();
    }));

    const modeSel = qs('[data-p="delivery_mode"]');
    modeSel.addEventListener('change', () => {
      qs('#contentField').hidden = modeSel.value !== 'fixed';
      const stock = qs('[data-p="stock"]');
      stock.readOnly = modeSel.value === 'auto';
    });

    qs('#pickMedia')?.addEventListener('click', () => openMediaPicker(qs('[data-p="images"]')));
    qs('#saveProduct').addEventListener('click', async () => {
      const get = (k) => qs(`[data-p="${k}"]`);
      const num = (k, def = 0) => {
        const v = get(k).value;
        return v === '' || v == null ? def : Math.round(Number(v) * 100);
      };
      const imagesVal = get('images').value.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = {
        name: get('name').value.trim(),
        category_id: get('category_id').value ? Number(get('category_id').value) : null,
        description: get('description').value,
        images: imagesVal,
        delivery_mode: modeSel.value,
        price_cents: Math.round(Number(get('price_cents').value || 0) * 100),
        member_price_cents: get('member_price_cents').value === '' ? null : Math.round(Number(get('member_price_cents').value) * 100),
        cost_cents: Math.round(Number(get('cost_cents').value || 0) * 100),
        stock: Number(get('stock').value || 0),
        min_qty: Number(get('min_qty').value || 1),
        max_qty: Number(get('max_qty').value || 99),
        limit_per_user: Number(get('limit_per_user').value || 0),
        seckill_price_cents: get('seckill_price_cents').value === '' ? null : Math.round(Number(get('seckill_price_cents').value) * 100),
        seckill_starts_at: inputToTs(get('seckill_starts_at').value),
        seckill_ends_at: inputToTs(get('seckill_ends_at').value),
        pick_enabled: get('pick_enabled').checked ? 1 : 0,
        pick_fee_cents: Math.round(Number(get('pick_fee_cents').value || 0) * 100),
        content: get('content').value,
        status: get('status').value,
        is_recommend: get('is_recommend').checked ? 1 : 0,
        sort: Number(get('sort').value || 0),
        supplier_id: get('supplier_id')?.value ? Number(get('supplier_id').value) : null,
        supplier_goods_id: get('supplier_goods_id')?.value.trim() || null,
        supplier_cost_cents: Math.round(Number(get('supplier_cost_cents')?.value || 0) * 100),
        auto_purchase: get('auto_purchase')?.checked ? 1 : 0,
        wholesale_tiers: [...tierRows.querySelectorAll('.dynamic-row')].map((row) => ({
          min_qty: Number(row.querySelector('[data-tier="min_qty"]').value || 0),
          price_cents: Math.round(Number(row.querySelector('[data-tier="price_cents"]').value || 0) * 100),
        })).filter((t) => t.min_qty > 0 && t.price_cents > 0),
        skus: [...skuRows.querySelectorAll('.dynamic-row')].map((row) => {
          const val = (k) => row.querySelector(`[data-sku="${k}"]`).value;
          return {
            name: val('name').trim(),
            price_cents: val('price_cents') === '' ? null : Math.round(Number(val('price_cents')) * 100),
            member_price_cents: val('member_price_cents') === '' ? null : Math.round(Number(val('member_price_cents')) * 100),
          };
        }).filter((s) => s.name),
      };
      if (!payload.name) return toast('请填写商品名称', 'error');
      const btn = qs('#saveProduct');
      btn.disabled = true;
      try {
        await api(isNew ? '/products' : `/products/${id}`, { method: isNew ? 'POST' : 'PUT', body: payload });
        toast(isNew ? '商品已创建' : '修改已保存', 'success');
        location.hash = '#/products';
      } catch (e) {
        btn.disabled = false;
      }
    });
  }

  /* ================= 商品分组（分类） ================= */
  async function pageCategories() {
    setCrumb('商品分组', '分类管理');
    const list = await api('/categories');
    setPage(`
      <div class="page-head">
        <div><h1>商品分组</h1><p>按分组组织商品，前台以分类胶囊展示</p></div>
        <div class="actions"><button class="btn btn-primary" id="addCat">${icon('plus', 15)} 新建分组</button></div>
      </div>
      ${storeHint()}
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>排序</th><th>名称</th><th>标识</th><th>图标</th><th class="num">商品数</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>${list.map((c) => `<tr>
          <td class="muted">${c.sort}</td>
          <td><strong>${esc(c.name)}</strong>${c.description ? `<div class="muted">${esc(c.description)}</div>` : ''}</td>
          <td class="code">${esc(c.slug)}</td>
          <td>${esc(c.icon || '')}</td>
          <td class="num">${c.product_count}</td>
          <td>${c.enabled ? '<span class="badge badge-green">启用</span>' : '<span class="badge badge-gray">停用</span>'}</td>
          <td><div class="actions">
            <button class="btn btn-ghost btn-xs" data-edit="${c.id}">编辑</button>
            <button class="btn btn-danger-ghost btn-xs" data-del="${c.id}">删除</button>
          </div></td></tr>`).join('') || `<tr><td colspan="7">${emptyBlock('🗂️', '还没有分组', '创建分组后可在商品中关联')}</td></tr>`}</tbody>
      </table></div></div>`);

    const openCat = (cat = {}) => openForm({
      title: cat.id ? '编辑分组' : '新建分组',
      fields: [
        { key: 'name', label: '分组名称', required: true },
        { key: 'slug', label: '标识（用于 URL）', placeholder: '留空自动生成' },
        { key: 'icon', label: '图标（Emoji）', placeholder: '🎁' },
        { key: 'description', label: '描述', type: 'textarea' },
        { key: 'sort', label: '排序', type: 'number', default: 0 },
        { key: 'enabled', label: '启用', type: 'toggle', default: true },
      ],
      values: cat,
      onSubmit: async (v) => {
        await api(cat.id ? `/categories/${cat.id}` : '/categories', { method: cat.id ? 'PUT' : 'POST', body: v });
        toast('已保存', 'success');
        pageCategories();
      },
    });

    qs('#addCat').addEventListener('click', () => openCat());
    qsa('[data-edit]').forEach((b) => b.addEventListener('click', () => openCat(list.find((x) => String(x.id) === b.dataset.edit))));
    qsa('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('确定删除该分组？', { danger: true }))) return;
      await api(`/categories/${b.dataset.del}`, { method: 'DELETE' });
      toast('已删除', 'success');
      pageCategories();
    }));
  }

  /* ================= 卡密 ================= */
  async function pageCards() {
    setCrumb('卡密管理', '卡密池');
    const params = new URLSearchParams({ page: String(state.cardsPage || 1), size: '20' });
    if (state.cardProduct) params.set('product_id', state.cardProduct);
    if (state.cardStatus) params.set('status', state.cardStatus);
    const [d, products] = await Promise.all([api(`/cards?${params}`), api('/products?page=1&size=100')]);

    setPage(`
      <div class="page-head">
        <div><h1>卡密管理</h1><p>共 ${d.total} 条 · 支持批量导入、导出与预选卡号展示</p></div>
        <div class="actions">
          <button class="btn btn-ghost" id="exportCards">${icon('download', 15)} 导出 CSV</button>
          <button class="btn btn-primary" id="importCards">${icon('plus', 15)} 批量导入</button>
        </div>
      </div>
      <div class="card">
        <div class="filters">
          <select id="cfProduct"><option value="">全部商品</option>
            ${products.list.map((p) => `<option value="${p.id}" ${String(state.cardProduct) === String(p.id) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
          <select id="cfStatus">
            <option value="">全部状态</option>
            <option value="unused" ${state.cardStatus === 'unused' ? 'selected' : ''}>未售出</option>
            <option value="locked" ${state.cardStatus === 'locked' ? 'selected' : ''}>锁定中</option>
            <option value="sold" ${state.cardStatus === 'sold' ? 'selected' : ''}>已售出</option>
          </select>
          <input id="cfQ" placeholder="搜索卡密内容" value="${esc(state.cardQ || '')}" style="width:200px">
          <button class="btn btn-soft btn-sm" id="cfSearch">查询</button>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>ID</th><th>商品</th><th>规格</th><th>卡密内容</th><th>状态</th><th>导入时间</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>${d.list.map((c) => `<tr>
            <td class="muted">${c.id}</td>
            <td>${esc(c.product_name || '-' + c.product_id)}</td>
            <td class="muted">${esc(c.sku_name || '默认')}</td>
            <td class="code" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.content)}">${esc(c.content)}</td>
            <td>${c.status === 'unused' ? '<span class="badge badge-green">未售出</span>' : c.status === 'locked' ? '<span class="badge badge-orange">锁定中</span>' : '<span class="badge badge-gray">已售出</span>'}</td>
            <td class="muted">${date(c.created_at)}</td>
            <td><div class="actions">
              ${c.status === 'sold' ? `<button class="btn btn-soft btn-xs" data-restore="${c.id}">恢复</button>` : ''}
              <button class="btn btn-danger-ghost btn-xs" data-cdel="${c.id}">删除</button>
            </div></td></tr>`).join('') || `<tr><td colspan="7">${emptyBlock('🎟️', '暂无卡密', '先导入一批卡密再开始销售')}</td></tr>`}</tbody>
        </table></div>
        ${pagerHTML(d.page, d.pages, d.total)}
      </div>`);

    const reload = () => {
      state.cardProduct = qs('#cfProduct').value;
      state.cardStatus = qs('#cfStatus').value;
      state.cardQ = qs('#cfQ').value.trim();
      state.cardsPage = 1;
      pageCards();
    };
    qs('#cfSearch').addEventListener('click', reload);
    qsa('[data-pg]').forEach((b) => b.addEventListener('click', () => { state.cardsPage = Number(b.dataset.pg); pageCards(); }));
    qsa('[data-restore]').forEach((b) => b.addEventListener('click', async () => {
      await api(`/cards/${b.dataset.restore}/restore`, { method: 'POST' });
      toast('已恢复为未售出', 'success');
      pageCards();
    }));
    qsa('[data-cdel]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('确定删除该卡密？', { danger: true }))) return;
      await api(`/cards/${b.dataset.cdel}`, { method: 'DELETE' });
      pageCards();
    }));
    qs('#exportCards').addEventListener('click', () => {
      const q = new URLSearchParams();
      if (state.cardProduct) q.set('product_id', state.cardProduct);
      if (state.cardStatus) q.set('status', state.cardStatus);
      window.open(`/api/admin/cards/export?${q}`, '_blank');
    });

    qs('#importCards').addEventListener('click', () => {
      const modal = openModal({
        title: '批量导入卡密',
        width: 640,
        body: `<div class="form-grid">
          <div class="field"><label>所属商品 *</label><select id="imProduct">
            ${products.list.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
          </select></div>
          <div class="field"><label>规格（可选）</label><select id="imSku"><option value="">默认规格</option></select></div>
          <div class="field full"><label>卡密内容（每行一条）</label>
            <textarea id="imText" rows="10" placeholder="支持以下格式：&#10;卡号----密码&#10;卡号 密码&#10;卡号,密码&#10;或直接粘贴 CSV"></textarea>
            <div class="hint">单次最多 5000 条，重复内容会自动去重；首行若为「卡号 卡密」表头会自动跳过</div>
          </div>
        </div>`,
        footer: `<button class="btn btn-ghost" data-modal-close="1">取消</button>
                 <button class="btn btn-primary" id="imSubmit">开始导入</button>`,
      });
      const productSel = qs('#imProduct', modal.el);
      let skuReq = 0;
      const loadSkus = async () => {
        const req = ++skuReq;
        const id = productSel.value;
        const skuSel = qs('#imSku', modal.el);
        skuSel.disabled = true;
        skuSel.innerHTML = '<option value="">加载中…</option>';
        try {
          const detail = await api(`/products/${id}`);
          if (req !== skuReq) return; // 商品已切换，丢弃过期响应
          const skus = detail.skus || [];
          skuSel.innerHTML = '<option value="">默认规格</option>' + skus.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
        } catch (e) {
          if (req === skuReq) skuSel.innerHTML = '<option value="">默认规格</option>';
          toast(e.message || '规格加载失败', 'error');
        } finally {
          if (req === skuReq) skuSel.disabled = false;
        }
      };
      productSel.addEventListener('change', loadSkus);
      loadSkus();
      qs('#imSubmit', modal.el).addEventListener('click', async () => {
        const text = qs('#imText', modal.el).value;
        if (!text.trim()) return toast('请粘贴卡密内容', 'error');
        const res = await api('/cards/import', {
          method: 'POST',
          body: { product_id: Number(productSel.value), sku_id: qs('#imSku', modal.el).value || null, text },
        });
        modal.close();
        toast(`成功导入 ${res.imported} 条，跳过重复 ${res.skipped} 条`, 'success', 4000);
        pageCards();
      });
    });
  }

  /* ================= 订单 ================= */
  const ORDER_TABS = [
    { key: '', name: '全部' },
    { key: 'pending', name: '待支付' },
    { key: 'paid', name: '已支付' },
    { key: 'manual', name: '待发货' },
    { key: 'shipped', name: '配送中' },
    { key: 'delivered', name: '已完成' },
    { key: 'closed', name: '已关闭' },
    { key: 'refunded', name: '已退款' },
  ];

  async function pageOrders() {
    setCrumb('订单管理', '全部订单');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const params = new URLSearchParams({ page: String(state.orderPage || 1), size: '20' });
    if (state.orderStatus) params.set('status', state.orderStatus);
    if (state.orderQ) params.set('q', state.orderQ);
    if (state.orderDate) params.set('date', state.orderDate);
    const d = await api(`/orders?${params}`);

    setPage(`
      <div class="page-head">
        <div><h1>订单管理</h1><p>共 ${d.total} 笔订单</p></div>
        <div class="actions">
          <button class="btn btn-ghost" id="exportOrders">${icon('download', 15)} 导出 CSV</button>
        </div>
      </div>
      <div class="card">
        <div class="tabs">${ORDER_TABS.map((t) => `<button class="tab ${state.orderStatus === t.key ? 'active' : ''}" data-otab="${t.key}">${t.name}</button>`).join('')}</div>
        <div class="filters">
          <input id="oq" placeholder="订单号 / 邮箱 / 交易号" value="${esc(state.orderQ || '')}" style="width:240px">
          <input id="odate" type="date" value="${esc(state.orderDate || '')}">
          <button class="btn btn-soft btn-sm" id="oSearch">查询</button>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>订单号</th><th>邮箱</th><th class="num">金额</th><th>状态</th><th>支付</th><th>时间</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>${d.list.map((o) => `<tr>
            <td class="code">${esc(o.order_no)}</td>
            <td class="muted">${esc(o.email)}</td>
            <td class="num"><strong>${money(o.amount_cents)}</strong>${o.discount_cents ? `<div class="muted">优惠 ${money(o.discount_cents)}</div>` : ''}</td>
            <td>${statusBadge(o.status)}</td>
            <td class="muted">${esc(o.pay_channel || '-')}</td>
            <td class="muted">${date(o.created_at)}</td>
            <td><div class="actions"><button class="btn btn-soft btn-xs" data-ov="${o.id}">详情</button></div></td>
          </tr>`).join('') || `<tr><td colspan="7">${emptyBlock('🧾', '暂无订单', '调整筛选条件试试')}</td></tr>`}</tbody>
        </table></div>
        ${pagerHTML(d.page, d.pages, d.total)}
      </div>`);

    const reload = () => {
      state.orderQ = qs('#oq').value.trim();
      state.orderDate = qs('#odate').value;
      state.orderPage = 1;
      pageOrders();
    };
    qs('#oSearch').addEventListener('click', reload);
    qs('#oq').addEventListener('keydown', (e) => { if (e.key === 'Enter') reload(); });
    qsa('[data-otab]').forEach((b) => b.addEventListener('click', () => { state.orderStatus = b.dataset.otab; state.orderPage = 1; pageOrders(); }));
    qsa('[data-pg]').forEach((b) => b.addEventListener('click', () => { state.orderPage = Number(b.dataset.pg); pageOrders(); }));
    qsa('[data-ov]').forEach((b) => b.addEventListener('click', () => openOrder(Number(b.dataset.ov))));
    qs('#exportOrders').addEventListener('click', () => {
      const q = new URLSearchParams();
      if (state.orderStatus) q.set('status', state.orderStatus);
      window.open(`/api/admin/orders/export?${q}`, '_blank');
    });
  }

  async function openOrder(id) {
    const d = await api(`/orders/${id}`);
    const o = d;
    const manualItems = o.items.filter((it) => ['manual', 'physical'].includes(it.delivery_mode) && !(it.delivered || []).length);
    openDrawer(`订单 ${o.order_no}`, `
      <div class="kv">
        <div class="k">订单状态</div><div class="v">${statusBadge(o.status)}</div>
        <div class="k">下单邮箱</div><div class="v">${esc(o.email)}</div>
        <div class="k">实付金额</div><div class="v"><strong>${money(o.amount_cents)}</strong> ${o.discount_cents ? `<span class="muted">（已减 ${money(o.discount_cents)}）</span>` : ''}</div>
        <div class="k">支付方式</div><div class="v">${esc(o.pay_channel || '-')} ${o.pay_trade_no ? `<span class="code">${esc(o.pay_trade_no)}</span>` : ''}</div>
        <div class="k">创建时间</div><div class="v">${date(o.created_at)}</div>
        ${o.paid_at ? `<div class="k">支付时间</div><div class="v">${date(o.paid_at)}</div>` : ''}
        ${o.note ? `<div class="k">订单备注</div><div class="v">${esc(o.note)}</div>` : ''}
        ${o.address ? `<div class="k">收货地址</div><div class="v">${esc(o.address.name)} ${esc(o.address.phone)}<br>${esc(o.address.region)} ${esc(o.address.detail)}</div>` : ''}
        ${o.remark ? `<div class="k">内部备注</div><div class="v">${esc(o.remark)}</div>` : ''}
      </div>

      <div class="card-title" style="margin-top:20px">商品明细</div>
      ${o.items.map((it) => `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;gap:10px;font-size:12.8px">
          <div><strong>${esc(it.product_name)}</strong>${it.sku_name ? ` <span class="muted">/ ${esc(it.sku_name)}</span>` : ''}
            <div class="muted" style="font-size:11px">${({ auto: '自动发货', manual: '人工发货', physical: '实物配送', fixed: '固定内容' })[it.delivery_mode]} · 数量 ${it.qty}</div></div>
          <div style="font-weight:700">${money(it.amount_cents)}</div>
        </div>
        ${(it.delivered || []).length ? `<div class="secret-box" style="margin-top:8px">${esc(it.delivered.join('\n'))}</div>` : ''}
      </div>`).join('')}

      ${manualItems.length ? `<div class="card-title" style="margin-top:20px">人工发货</div>
        <div class="notice blue" style="margin-bottom:10px">为下面的商品填写发货内容（每行一条卡密），保存后订单标记为已完成。</div>
        ${manualItems.map((it) => `<div class="field" style="margin-bottom:10px">
          <label>${esc(it.product_name)} × ${it.qty}</label>
          <textarea data-ship="${it.id}" rows="3" placeholder="填写卡密 / 发货内容"></textarea></div>`).join('')}` : ''}

      <div class="card-title" style="margin-top:20px">操作</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${o.status === 'pending' ? '<button class="btn btn-danger-ghost btn-sm" data-act="close">关闭订单</button>' : ''}
        ${['paid', 'manual', 'shipped', 'delivered'].includes(o.status) ? '<button class="btn btn-danger-ghost btn-sm" data-act="refund">标记退款</button>' : ''}
        ${manualItems.length ? '<button class="btn btn-primary btn-sm" data-act="ship">确认发货</button>' : ''}
        ${(o.items || []).some((i) => (i.delivered || []).length) ? '<button class="btn btn-ghost btn-sm" data-act="resend">补发邮件</button>' : ''}
        <button class="btn btn-ghost btn-sm" data-act="remark">内部备注</button>
      </div>
    `, `<button class="btn btn-ghost btn-sm" id="drawerCancel">关闭</button>`);

    qs('#drawerCancel').addEventListener('click', closeDrawer);

    const act = async (action, body = {}) => {
      await api(`/orders/${id}/action`, { method: 'POST', body: { action, ...body } });
      toast('操作成功', 'success');
      closeDrawer();
      pageOrders();
    };
    qsa('[data-act]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.act;
      if (a === 'close') {
        if (!(await confirmDialog('关闭订单会释放占用的卡密与库存，确定？', { danger: true }))) return;
        await act('close', { remark: '管理员关闭' });
      } else if (a === 'refund') {
        if (!(await confirmDialog('确定将该订单标记为退款？', { danger: true, okText: '确认退款' }))) return;
        const restock = await confirmDialog('是否同时把卡密/库存恢复为可售？', { okText: '恢复库存', title: '库存处理' });
        await act('refund', { restock, remark: '管理员退款' });
      } else if (a === 'ship') {
        const items = qsa('[data-ship]').map((el) => ({ id: Number(el.dataset.ship), content: el.value.trim() })).filter((x) => x.content);
        if (!items.length) return toast('请填写发货内容', 'error');
        await act('ship', { items });
      } else if (a === 'resend') {
        await api(`/orders/${id}/resend`, { method: 'POST' });
        toast('补发邮件已提交', 'success');
      } else if (a === 'remark') {
        const modal = openForm({
          title: '内部备注',
          fields: [{ key: 'remark', label: '备注内容', type: 'textarea', full: true }],
          values: { remark: o.remark || '' },
          onSubmit: async (v) => { await act('remark', { remark: v.remark }); },
        });
      }
    }));
  }

  /* ================= 优惠券 ================= */
  async function pageCoupons() {
    setCrumb('优惠券', '营销');
    const list = await api('/coupons');
    const typeText = { percent: '按比例折扣', fixed: '固定金额', per_item: '每件立减' };
    setPage(`
      <div class="page-head">
        <div><h1>优惠券</h1><p>支持满减、折扣与每件立减，可限定商品范围与使用次数</p></div>
        <div class="actions"><button class="btn btn-primary" id="addCoupon">${icon('plus', 15)} 新建优惠券</button></div>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>优惠码</th><th>类型</th><th>优惠值</th><th>门槛</th><th class="num">已用/上限</th><th>有效期</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>${list.map((c) => `<tr>
          <td><span class="code">${esc(c.code)}</span></td>
          <td class="muted">${typeText[c.type] || c.type}</td>
          <td>${c.type === 'percent' ? (c.value / 10) + ' 折' : money(c.value)}</td>
          <td class="muted">${c.min_amount_cents ? '满 ' + money(c.min_amount_cents) : '无门槛'}</td>
          <td class="num">${c.used_count} / ${c.max_uses || '不限'}</td>
          <td class="muted">${c.starts_at ? date(c.starts_at, false) : '-'} ~ ${c.ends_at ? date(c.ends_at, false) : '长期'}</td>
          <td>${c.enabled ? '<span class="badge badge-green">启用</span>' : '<span class="badge badge-gray">停用</span>'}</td>
          <td><div class="actions">
            <button class="btn btn-ghost btn-xs" data-edit="${c.id}">编辑</button>
            <button class="btn btn-danger-ghost btn-xs" data-del="${c.id}">删除</button>
          </div></td></tr>`).join('') || `<tr><td colspan="8">${emptyBlock('🏷️', '还没有优惠券', '创建优惠码用于活动促销')}</td></tr>`}</tbody>
      </table></div></div>`);

    const openCoupon = (c = {}) => openForm({
      title: c.id ? '编辑优惠券' : '新建优惠券',
      width: 600,
      fields: [
        { key: 'code', label: '优惠码', required: true, placeholder: '例如 NEWYEAR2026' },
        { key: 'type', label: '类型', type: 'select', options: [
          { value: 'percent', label: '按比例折扣（如 90 = 9 折）' },
          { value: 'fixed', label: '固定金额（元）' },
          { value: 'per_item', label: '每件立减（元）' },
        ] },
        { key: 'value', label: '优惠值', type: 'number', hint: '折扣填 90 表示 9 折；金额填 10 表示 10 元' },
        { key: 'min_amount_cents', label: '最低消费（元）', type: 'number', default: 0 },
        { key: 'max_uses', label: '总使用次数（0 不限）', type: 'number', default: 0 },
        { key: 'per_user_limit', label: '每人限用次数', type: 'number', default: 1 },
        { key: 'starts_at', label: '开始时间', type: 'datetime' },
        { key: 'ends_at', label: '结束时间', type: 'datetime' },
        { key: 'enabled', label: '启用', type: 'toggle', default: true },
      ],
      values: c,
      onSubmit: async (v) => {
        const body = {
          ...v,
          code: v.code.toUpperCase(),
          value: v.type === 'percent' ? Number(v.value) : Math.round(Number(v.value) * 100),
          min_amount_cents: Math.round(Number(v.min_amount_cents) * 100),
          product_ids: [],
        };
        await api(c.id ? `/coupons/${c.id}` : '/coupons', { method: c.id ? 'PUT' : 'POST', body });
        toast('已保存', 'success');
        pageCoupons();
      },
    });

    qs('#addCoupon').addEventListener('click', () => openCoupon());
    qsa('[data-edit]').forEach((b) => b.addEventListener('click', () => openCoupon(list.find((x) => String(x.id) === b.dataset.edit))));
    qsa('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('确定删除该优惠券？', { danger: true }))) return;
      await api(`/coupons/${b.dataset.del}`, { method: 'DELETE' });
      pageCoupons();
    }));
  }

  /* ================= 用户 ================= */
  async function pageUsers() {
    setCrumb('用户管理', '会员');
    const params = new URLSearchParams({ page: String(state.userPage || 1), size: '20' });
    if (state.userQ) params.set('q', state.userQ);
    const [d, levels] = await Promise.all([api(`/users?${params}`), api('/levels')]);
    setPage(`
      <div class="page-head">
        <div><h1>用户管理</h1><p>共 ${d.total} 位用户 · 支持余额调整、等级变更与账号停用</p></div>
      </div>
      <div class="card">
        <div class="filters">
          <input id="uq" placeholder="搜索邮箱 / 邀请码" value="${esc(state.userQ || '')}" style="width:240px">
          <button class="btn btn-soft btn-sm" id="uSearch">查询</button>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>ID</th><th>邮箱</th><th>等级</th><th class="num">余额</th><th class="num">累计消费</th><th class="num">订单</th><th>状态</th><th>邀请码</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>${d.list.map((u) => `<tr>
            <td class="muted">${u.id}</td>
            <td><strong>${esc(u.email)}</strong><div class="muted">${date(u.created_at, false)} 注册</div></td>
            <td><span class="badge badge-blue">${esc(u.level_name || '普通会员')}</span></td>
            <td class="num">${money(u.balance_cents)}</td>
            <td class="num">${money(u.total_spent_cents)}</td>
            <td class="num">${u.order_count}</td>
            <td>${u.status === 'active' ? '<span class="badge badge-green">正常</span>' : '<span class="badge badge-red">停用</span>'}</td>
            <td class="code">${esc(u.invite_code)}</td>
            <td><div class="actions"><button class="btn btn-soft btn-xs" data-uv="${u.id}">管理</button></div></td>
          </tr>`).join('') || `<tr><td colspan="9">${emptyBlock('👥', '还没有用户', '前台注册后会显示在这里')}</td></tr>`}</tbody>
        </table></div>
        ${pagerHTML(d.page, d.pages, d.total)}
      </div>`);

    qs('#uSearch').addEventListener('click', () => { state.userQ = qs('#uq').value.trim(); state.userPage = 1; pageUsers(); });
    qsa('[data-pg]').forEach((b) => b.addEventListener('click', () => { state.userPage = Number(b.dataset.pg); pageUsers(); }));
    qsa('[data-uv]').forEach((b) => b.addEventListener('click', async () => {
      const u = await api(`/users/${b.dataset.uv}`);
      openDrawer(`用户 #${u.user.id}`, `
        <div class="kv">
          <div class="k">邮箱</div><div class="v">${esc(u.user.email)}</div>
          <div class="k">余额</div><div class="v"><strong>${money(u.user.balance_cents)}</strong></div>
          <div class="k">累计消费</div><div class="v">${money(u.user.total_spent_cents)}</div>
          <div class="k">邀请码</div><div class="v" class="code">${esc(u.user.invite_code)}</div>
          <div class="k">上级</div><div class="v">${u.user.inviter_id ? '#' + u.user.inviter_id : '无'}</div>
        </div>
        <div class="card-title" style="margin-top:20px">账户操作</div>
        <div class="field"><label>调整余额（元，可正可负）</label><input id="uaAmount" type="number" step="0.01" placeholder="例如 50 或 -10"></div>
        <div class="field"><label>备注</label><input id="uaNote" placeholder="例如：活动补偿"></div>
        <div class="field"><label>会员等级</label><select id="uaLevel">${levels.map((l) => `<option value="${l.id}" ${l.id === u.user.level_id ? 'selected' : ''}>${esc(l.name)}（${l.discount >= 100 ? '无折扣' : l.discount / 10 + ' 折'}）</option>`).join('')}</select></div>
        <div class="field"><label>账号状态</label><select id="uaStatus">
          <option value="active" ${u.user.status === 'active' ? 'selected' : ''}>正常</option>
          <option value="banned" ${u.user.status === 'banned' ? 'selected' : ''}>停用</option>
        </select></div>
        <div class="card-title" style="margin-top:18px">余额明细</div>
        ${(u.logs || []).slice(0, 8).map((l) => `<div class="summary-line"><span>${esc(l.type)} · ${esc(l.note || '')}<br><span class="muted" style="font-size:11px">${date(l.created_at)}</span></span>
          <span style="color:${l.amount_cents >= 0 ? 'var(--success)' : 'var(--danger)'}">${l.amount_cents >= 0 ? '+' : ''}${money(l.amount_cents)}</span></div>`).join('') || '<p class="muted" style="font-size:12.5px">暂无记录</p>'}
      `, `<button class="btn btn-ghost btn-sm" id="drawerCancel">取消</button>
          <button class="btn btn-primary btn-sm" id="uaSave">保存</button>`);
      qs('#drawerCancel').addEventListener('click', closeDrawer);
      qs('#uaSave').addEventListener('click', async () => {
        const delta = qs('#uaAmount').value;
        await api(`/users/${u.user.id}`, {
          method: 'PATCH',
          body: {
            level_id: Number(qs('#uaLevel').value),
            status: qs('#uaStatus').value,
            balance_delta: delta === '' ? 0 : Math.round(Number(delta) * 100),
            note: qs('#uaNote').value.trim(),
          },
        });
        toast('已保存', 'success');
        closeDrawer();
        pageUsers();
      });
    }));
  }

  /* ================= 会员等级 ================= */
  async function pageLevels() {
    setCrumb('会员等级', '折扣体系');
    const list = await api('/levels');
    setPage(`
      <div class="page-head">
        <div><h1>会员等级</h1><p>按累计消费自动升级，等级折扣与商品会员价可叠加使用</p></div>
        <div class="actions"><button class="btn btn-primary" id="addLevel">${icon('plus', 15)} 新建等级</button></div>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>排序</th><th>等级名称</th><th>折扣</th><th class="num">升级门槛（累计消费）</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>${list.map((l) => `<tr>
          <td class="muted">${l.sort}</td>
          <td><strong>${esc(l.name)}</strong></td>
          <td>${l.discount >= 100 ? '<span class="badge badge-gray">无折扣</span>' : `<span class="badge badge-blue">${l.discount / 10} 折</span>`}</td>
          <td class="num">${money(l.min_spent_cents)}</td>
          <td><div class="actions">
            <button class="btn btn-ghost btn-xs" data-edit="${l.id}">编辑</button>
            ${l.id !== 1 ? `<button class="btn btn-danger-ghost btn-xs" data-del="${l.id}">删除</button>` : ''}
          </div></td></tr>`).join('')}</tbody>
      </table></div></div>`);

    const openLevel = (l = {}) => openForm({
      title: l.id ? '编辑等级' : '新建等级',
      fields: [
        { key: 'name', label: '等级名称', required: true },
        { key: 'discount', label: '折扣（100 = 原价，90 = 9 折）', type: 'number', default: 100 },
        { key: 'min_spent_cents', label: '升级门槛（元）', type: 'number', default: 0 },
        { key: 'sort', label: '排序', type: 'number', default: 0 },
      ],
      values: { ...l, min_spent_cents: (l.min_spent_cents || 0) / 100 },
      onSubmit: async (v) => {
        const body = { ...v, min_spent_cents: Math.round(Number(v.min_spent_cents) * 100), discount: Number(v.discount) };
        await api(l.id ? `/levels/${l.id}` : '/levels', { method: l.id ? 'PUT' : 'POST', body });
        toast('已保存', 'success');
        pageLevels();
      },
    });
    qs('#addLevel').addEventListener('click', () => openLevel());
    qsa('[data-edit]').forEach((b) => b.addEventListener('click', () => openLevel(list.find((x) => String(x.id) === b.dataset.edit))));
    qsa('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('确定删除该等级？', { danger: true }))) return;
      await api(`/levels/${b.dataset.del}`, { method: 'DELETE' });
      pageLevels();
    }));
  }

  /* ================= 工单 ================= */
  async function pageTickets() {
    setCrumb('工单处理', '客服');
    const list = await api('/tickets');
    setPage(`
      <div class="page-head">
        <div><h1>工单处理</h1><p>共 ${list.length} 条工单 · 用户提交后会在此显示</p></div>
        <div class="actions"><button class="btn btn-ghost" id="refreshTickets">${icon('clock', 15)} 刷新</button></div>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>ID</th><th>主题</th><th>用户</th><th>状态</th><th>消息</th><th>更新时间</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>${list.map((t) => `<tr>
          <td class="muted">#${t.id}</td>
          <td><strong>${esc(t.subject)}</strong></td>
          <td class="muted">${esc(t.email)}</td>
          <td>${t.status === 'open' ? '<span class="badge badge-orange">待处理</span>' : t.status === 'waiting' ? '<span class="badge badge-blue">已回复</span>' : '<span class="badge badge-gray">已关闭</span>'}</td>
          <td class="muted">${t.user_msgs || 0} 条</td>
          <td class="muted">${date(t.updated_at)}</td>
          <td><div class="actions"><button class="btn btn-soft btn-xs" data-tv="${t.id}">处理</button></div></td>
        </tr>`).join('') || `<tr><td colspan="7">${emptyBlock('🎫', '暂无工单', '用户提交后会显示在这里')}</td></tr>`}</tbody>
      </table></div></div>`);

    qs('#refreshTickets').addEventListener('click', pageTickets);
    qsa('[data-tv]').forEach((b) => b.addEventListener('click', async () => {
      const t = await api(`/tickets/${b.dataset.tv}`);
      openDrawer(`工单 #${t.id} · ${t.subject}`, `
        <div class="kv">
          <div class="k">用户</div><div class="v">${esc(t.email)}</div>
          <div class="k">状态</div><div class="v">${t.status === 'open' ? '<span class="badge badge-orange">待处理</span>' : t.status === 'waiting' ? '<span class="badge badge-blue">已回复</span>' : '<span class="badge badge-gray">已关闭</span>'}</div>
          <div class="k">创建时间</div><div class="v">${date(t.created_at)}</div>
        </div>
        <div class="chat-list" style="margin-top:16px">
          ${t.messages.map((m) => `<div style="display:flex;gap:10px;margin-bottom:10px;${m.sender_type === 'admin' ? 'flex-direction:row-reverse' : ''}">
            <div style="width:30px;height:30px;border-radius:9px;background:var(--surface-3);display:grid;place-items:center;font-size:11px;color:var(--muted);flex-shrink:0">${m.sender_type === 'admin' ? '客' : '用'}</div>
            <div style="max-width:80%">
              <div style="padding:10px 13px;border-radius:12px;background:${m.sender_type === 'admin' ? 'var(--brand)' : 'var(--surface-2)'};color:${m.sender_type === 'admin' ? '#fff' : 'var(--text)'};font-size:12.8px;white-space:pre-wrap">${esc(m.content)}</div>
              <div class="muted" style="font-size:10.5px;margin-top:3px">${date(m.created_at)}</div>
            </div>
          </div>`).join('') || '<p class="muted" style="font-size:12.5px">暂无消息</p>'}
        </div>
        <div class="field"><label>回复内容</label><textarea id="tkReply" rows="3" placeholder="输入回复，会通过邮件通知用户"></textarea></div>
      `, `<button class="btn btn-ghost btn-sm" id="drawerCancel">关闭</button>
          <button class="btn btn-ghost btn-sm" id="tkClose">关闭工单</button>
          <button class="btn btn-primary btn-sm" id="tkSend">发送回复</button>`);
      qs('#drawerCancel').addEventListener('click', closeDrawer);
      qs('#tkClose').addEventListener('click', async () => {
        await api(`/tickets/${t.id}`, { method: 'PATCH', body: { status: 'closed' } });
        toast('工单已关闭', 'success');
        closeDrawer();
        pageTickets();
      });
      qs('#tkSend').addEventListener('click', async () => {
        const content = qs('#tkReply').value.trim();
        if (!content) return toast('请输入回复内容', 'error');
        await api(`/tickets/${t.id}/reply`, { method: 'POST', body: { content } });
        toast('回复已发送', 'success');
        closeDrawer();
        pageTickets();
      });
    }));
  }


  /* ================= 上游供应商 ================= */
  async function pageSuppliers() {
    setCrumb('上游供应商', '自动采购');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const [list, logs] = await Promise.all([api('/suppliers'), api('/suppliers/logs').catch(() => [])]);

    const render = () => setPage(`
      <div class="page-head">
        <div><h1>上游供应商</h1><p>商品卡密不足时自动向上游采购，采购记录可追溯</p></div>
        <div class="actions"><button class="btn btn-primary" id="addSupplier">${icon('plus', 15)} 添加供应商</button></div>
      </div>
      <div class="card">
        <div class="card-title">${icon('box', 16)} 供应商列表 <span class="badge badge-gray">${list.length}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>名称</th><th>接口地址</th><th>密钥</th><th class="num">余额</th><th class="num">关联商品</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>${list.map((s) => `
            <tr>
              <td><strong>${esc(s.name)}</strong><div class="muted">${esc(s.note || '')}</div></td>
              <td class="code" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.api_url)}</td>
              <td class="code">${esc(s.api_key || '—')}</td>
              <td class="num">${money(s.balance_cents)}</td>
              <td class="num">${s.product_count}</td>
              <td>${s.enabled ? '<span class="badge badge-green">启用</span>' : '<span class="badge badge-gray">停用</span>'}</td>
              <td><div class="actions">
                <button class="btn btn-xs btn-ghost" data-test="${s.id}">测试</button>
                <button class="btn btn-xs btn-ghost" data-edit="${s.id}">编辑</button>
                <button class="btn btn-xs btn-danger-ghost" data-del="${s.id}">删除</button>
              </div></td>
            </tr>`).join('')}</tbody>
        </table></div>` : emptyBlock('🔗', '还没有供应商', '添加上游接口后，商品库存不足时会自动采购')}
      </div>
      <div class="card">
        <div class="card-title">${icon('clock', 16)} 采购记录</div>
        ${logs.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>时间</th><th>供应商</th><th>商品</th><th class="num">数量</th><th class="num">成本</th><th>上游单号</th><th>状态</th></tr></thead>
          <tbody>${logs.map((l) => `<tr>
            <td class="muted">${date(l.created_at)}</td>
            <td>${esc(l.supplier_name || '')}</td>
            <td>${esc(l.product_name || '')}</td>
            <td class="num">${l.qty}</td>
            <td class="num">${money(l.cost_cents)}</td>
            <td class="code">${esc(l.remote_order_no || '—')}</td>
            <td>${l.status === 'success' ? '<span class="badge badge-green">成功</span>' : '<span class="badge badge-red">失败</span>'}</td>
          </tr>`).join('')}</tbody>
        </table></div>` : '<p class="muted" style="font-size:12.5px">暂无采购记录</p>'}
      </div>`);

    render();

    const openForm = (sup = { name: '', api_url: '', api_key: '', balance_cents: 0, enabled: 1, note: '' }) => {
      openDrawer(sup.id ? '编辑供应商' : '添加供应商', `
        <div class="field"><label>名称</label><input id="supName" value="${esc(sup.name)}"></div>
        <div class="field" style="margin-top:12px"><label>接口地址</label><input id="supUrl" value="${esc(sup.api_url)}" placeholder="https://upstream.example.com/api"></div>
        <div class="field" style="margin-top:12px"><label>API Key</label><input id="supKey" value="${esc(sup.api_key || '')}" placeholder="用于 HMAC-SHA256 签名"></div>
        <div class="form-grid" style="margin-top:12px">
          <div class="field"><label>余额（元）</label><input id="supBalance" type="number" step="0.01" value="${(sup.balance_cents / 100).toFixed(2)}"></div>
          <div class="field"><label>状态</label><select id="supEnabled"><option value="1" ${sup.enabled ? 'selected' : ''}>启用</option><option value="0" ${!sup.enabled ? 'selected' : ''}>停用</option></select></div>
        </div>
        <div class="field" style="margin-top:12px"><label>备注</label><input id="supNote" value="${esc(sup.note || '')}"></div>`,
        `<button class="btn btn-ghost" data-drawer-close="1">取消</button>
         <button class="btn btn-primary" id="saveSupplier">${icon('check', 15)} 保存</button>`);
      qs('[data-drawer-close]').addEventListener('click', closeDrawer);
      qs('#saveSupplier').addEventListener('click', async () => {
        const body = {
          name: qs('#supName').value.trim(),
          api_url: qs('#supUrl').value.trim(),
          api_key: qs('#supKey').value.trim(),
          balance_cents: Math.round(Number(qs('#supBalance').value || 0) * 100),
          enabled: qs('#supEnabled').value === '1',
          note: qs('#supNote').value.trim(),
        };
        if (!body.name || !body.api_url) return toast('请填写名称与接口地址', 'error');
        await api(sup.id ? `/suppliers/${sup.id}` : '/suppliers', { method: sup.id ? 'PUT' : 'POST', body });
        closeDrawer();
        toast('已保存', 'success');
        pageSuppliers();
      });
    };

    qs('#addSupplier').addEventListener('click', () => openForm());
    qsa('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(list.find((x) => String(x.id) === b.dataset.edit))));
    qsa('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('删除该供应商？')) return;
      await api(`/suppliers/${b.dataset.del}`, { method: 'DELETE' });
      toast('已删除', 'success');
      pageSuppliers();
    }));
    qsa('[data-test]').forEach((b) => b.addEventListener('click', async () => {
      const r = await api(`/suppliers/${b.dataset.test}/test`, { method: 'POST' });
      toast(r.ok ? `连接成功（${r.latency_ms}ms）` : `连接失败：${r.body}`, r.ok ? 'success' : 'error');
    }));
  }

  /* ================= 邮件模板 ================= */
  const TPL_META = {
    order_paid: {
      name: '订单发货',
      desc: '订单支付成功后发送给买家，包含卡密',
      vars: ['site_name', 'order_no', 'amount', 'email', 'created_at', 'items', 'cards'],
    },
    ticket_reply: {
      name: '工单回复',
      desc: '客服回复工单后通知买家',
      vars: ['site_name', 'ticket_id', 'subject', 'content', 'created_at'],
    },
    password_reset: {
      name: '找回密码',
      desc: '用户申请重置密码时发送',
      vars: ['site_name', 'email', 'link', 'expire_minutes'],
    },
  };

  function tplSample(key, siteName, email) {
    if (key === 'order_paid') return {
      site_name: siteName, order_no: 'FK20261126001', amount: '¥19.90', email,
      created_at: new Date().toLocaleString('zh-CN'),
      items: '<tr><td style="padding:10px;border-bottom:1px solid #eee">Netflix 高级会员 · 月卡</td><td style="padding:10px;text-align:center">1</td><td style="padding:10px;text-align:right">¥19.90</td></tr>',
      cards: '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;font-family:monospace">demo@example.com----Abc123456</div>',
    };
    if (key === 'ticket_reply') return {
      site_name: siteName, ticket_id: '1024', subject: '购买的卡密无法登录',
      content: '您好，已为您重新补发，请查看订单页。', created_at: new Date().toLocaleString('zh-CN'),
    };
    return { site_name: siteName, email, link: `${location.origin}/reset?token=demo`, expire_minutes: '30' };
  }

  async function pageTemplates() {
    setCrumb('邮件模板', '通知内容');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const templates = await api('/templates');
    let active = 'order_paid';

    const render = () => {
      const meta = TPL_META[active];
      const tpl = templates[active] || { subject: '', html: '' };
      setPage(`
        <div class="page-head">
          <div><h1>邮件模板</h1><p>留空则使用内置模板；支持 HTML 与变量占位符</p></div>
          <div class="actions">
            <input id="tplTestTo" type="email" placeholder="测试收件邮箱" style="height:36px;width:200px">
            <button class="btn btn-ghost" id="tplTest">${icon('mail', 15)} 发送测试</button>
            <button class="btn btn-primary" id="tplSave">${icon('check', 15)} 保存模板</button>
          </div>
        </div>
        <div class="tabs">${Object.entries(TPL_META).map(([k, m]) => `
          <button class="tab ${k === active ? 'active' : ''}" data-tpl="${k}">${m.name}</button>`).join('')}
        </div>
        <div class="two-col" style="margin-top:0">
          <div class="card">
            <div class="card-title">${icon('mail', 16)} ${meta.name} <span class="badge badge-gray">${meta.desc}</span></div>
            <div class="field"><label>邮件主题</label><input id="tplSubject" value="${esc(tpl.subject || '')}" placeholder="留空使用默认主题"></div>
            <div class="field" style="margin-top:12px"><label>HTML 正文</label><textarea id="tplHtml" rows="16" style="font-family:ui-monospace,Menlo,monospace;font-size:12px" placeholder="留空使用内置模板">${esc(tpl.html || '')}</textarea></div>
            <div class="hint" style="margin-top:8px">可用变量：${meta.vars.map((v) => `<button type="button" class="badge badge-blue" data-var="${v}" style="border:0;cursor:pointer">{{${v}}}</button>`).join(' ')}</div>
          </div>
          <div class="card">
            <div class="card-title">${icon('spark', 16)} 实时预览</div>
            <iframe id="tplPreview" style="width:100%;height:460px;border:1px solid var(--border);border-radius:12px;background:#fff"></iframe>
          </div>
        </div>`);

      const subjectEl = qs('#tplSubject');
      const htmlEl = qs('#tplHtml');
      const preview = qs('#tplPreview');
      const fill = (tplStr) => {
        const vars = tplSample(active, ME?.site_name || 'Slogan', 'buyer@example.com');
        return String(tplStr || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k) => vars[k] ?? '');
      };
      const refresh = () => {
        preview.srcdoc = fill(htmlEl.value) || '<p style="color:#94a3b8;font-family:sans-serif;padding:20px">暂无内容，将使用内置模板</p>';
      };
      refresh();
      htmlEl.addEventListener('input', refresh);
      subjectEl.addEventListener('input', refresh);

      qsa('[data-tpl]').forEach((b) => b.addEventListener('click', async () => {
        active = b.dataset.tpl;
        const latest = await api('/templates');
        Object.assign(templates, latest);
        render();
      }));
      qsa('[data-var]').forEach((b) => b.addEventListener('click', () => {
        const token = `{{${b.dataset.var}}}`;
        const pos = htmlEl.selectionStart || htmlEl.value.length;
        htmlEl.value = htmlEl.value.slice(0, pos) + token + htmlEl.value.slice(pos);
        htmlEl.focus();
        htmlEl.selectionStart = htmlEl.selectionEnd = pos + token.length;
        refresh();
      }));
      qs('#tplSave').addEventListener('click', async () => {
        await api('/templates', { method: 'PUT', body: { key: active, subject: subjectEl.value.trim(), html: htmlEl.value } });
        templates[active] = { subject: subjectEl.value.trim(), html: htmlEl.value };
        toast('模板已保存', 'success');
      });
      qs('#tplTest').addEventListener('click', async () => {
        const to = qs('#tplTestTo').value.trim();
        if (!to) return toast('请填写测试收件邮箱', 'error');
        await api('/templates/test', { method: 'POST', body: { key: active, to } });
        toast('测试邮件已发送', 'success');
      });
    };

    render();
  }

  /* ================= 媒体库 ================= */
  async function pageMedia() {
    setCrumb('媒体库', '图片素材');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const d = await api('/media');

    const render = () => setPage(`
      <div class="page-head">
        <div><h1>媒体库</h1><p>商品图与站点素材存放在 Cloudflare R2，复制地址即可使用</p></div>
        <div class="actions">
          <label class="btn btn-primary" style="cursor:pointer">${icon('plus', 15)} 上传图片<input id="mediaUpload" type="file" accept="image/*" hidden></label>
        </div>
      </div>
      ${d.available ? '' : `<div class="notice" style="margin-bottom:14px">媒体库尚未启用：请先创建 R2 桶（<code>npx wrangler r2 bucket create slogan-media</code>），并在 wrangler.jsonc 的 r2_buckets 中绑定 <code>BUCKET</code>。</div>`}
      <div class="card">
        <div class="card-title">${icon('spark', 16)} 全部图片 <span class="badge badge-gray">${d.list.length}</span></div>
        ${d.list.length ? `<div class="media-grid">${d.list.map((m) => `
          <div class="media-item">
            <img src="${esc(m.url)}" alt="" loading="lazy">
            <div class="media-meta">
              <span>${(m.size / 1024).toFixed(0)} KB</span>
              <button class="btn btn-xs btn-ghost" data-media-copy="${esc(m.url)}">${icon('copy', 12)} 复制</button>
              <button class="btn btn-xs btn-danger-ghost" data-media-del="${esc(m.key)}">${icon('trash', 12)}</button>
            </div>
          </div>`).join('')}</div>`
          : emptyBlock('🖼️', d.available ? '还没有图片' : '媒体库未启用', d.available ? '点击右上角上传第一张图片' : '按提示绑定 R2 后即可使用')}
      </div>`);

    render();

    qs('#mediaUpload')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      await api('/media', { method: 'POST', body: fd });
      toast('上传成功', 'success');
      pageMedia();
    });
    qsa('[data-media-copy]').forEach((b) => b.addEventListener('click', () => {
      copyText(b.dataset.mediaCopy);
      toast('地址已复制', 'success');
    }));
    qsa('[data-media-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('删除这张图片？')) return;
      await api(`/media/${encodeURIComponent(b.dataset.mediaDel)}`, { method: 'DELETE' });
      toast('已删除', 'success');
      pageMedia();
    }));
  }

  async function openMediaPicker(textarea) {
    const d = await api('/media');
    if (!d.available) return toast('媒体库未启用，请先绑定 R2', 'error');
    openDrawer('从媒体库选择图片', `
      <div class="media-grid">${d.list.map((m) => `
        <button type="button" class="media-pick" data-pick="${esc(m.url)}">
          <img src="${esc(m.url)}" alt="" loading="lazy">
        </button>`).join('')}</div>`,
      '<button class="btn btn-ghost" data-drawer-close="1">取消</button>');
    qs('[data-drawer-close]')?.addEventListener('click', closeDrawer);
    qsa('[data-pick]').forEach((b) => b.addEventListener('click', () => {
      const cur = textarea.value.trim();
      textarea.value = cur ? `${cur}\n${b.dataset.pick}` : b.dataset.pick;
      closeDrawer();
      toast('已添加图片地址', 'success');
    }));
  }

  /* ================= 安全设置（两步验证） ================= */
  async function pageSecurity() {
    setCrumb('安全设置', '两步验证');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const me = await api('/me');
    let secret = '';
    let otpauth = '';

    const render = () => setPage(`
      <div class="page-head">
        <div><h1>安全设置</h1><p>为管理员账号开启两步验证（TOTP），登录时需要输入 6 位动态码</p></div>
      </div>
      <div class="card">
        <div class="card-title">${icon('lock', 16)} 两步验证
          <span class="badge ${me.totp_enabled ? 'badge-green' : 'badge-gray'}">${me.totp_enabled ? '已开启' : '未开启'}</span>
        </div>
        <div class="form-grid">
          <div class="field full">
            <label>状态</label>
            <p class="muted" style="margin:0">${me.totp_enabled ? '登录时需输入动态验证码。' : '建议开启，防止密码泄露导致后台被入侵。'}</p>
          </div>
          ${!me.totp_enabled ? `
          <div class="field full">
            <label>密钥（Base32）</label>
            <input id="totpSecret" readonly value="${esc(secret)}" placeholder="点击下方按钮生成">
            <p class="muted" style="margin:8px 0 0">将密钥手动添加到 Google Authenticator / 1Password / Authy，或复制下面的 otpauth 链接。</p>
          </div>
          <div class="field full">
            <label>otpauth 链接</label>
            <textarea id="otpauthUrl" rows="2" readonly placeholder="生成后显示">${esc(otpauth)}</textarea>
          </div>
          <div class="field full" style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-ghost" id="genTotp">${icon('refresh', 15)} ${secret ? '重新生成密钥' : '生成密钥'}</button>
            <input id="totpEnableCode" inputmode="numeric" maxlength="6" placeholder="输入 6 位动态码" style="max-width:180px">
            <button class="btn btn-primary" id="enableTotp">${icon('check', 15)} 启用两步验证</button>
          </div>` : `
          <div class="field full" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
            <input id="totpDisableCode" inputmode="numeric" maxlength="6" placeholder="输入动态码以关闭" style="max-width:220px">
            <button class="btn btn-danger" id="disableTotp">${icon('close', 15)} 关闭两步验证</button>
          </div>`}
        </div>
      </div>

      <div class="card">
        <div class="card-title">${icon('lock', 16)} 修改登录密码</div>
        <div class="form-grid">
          <div class="field"><label>当前密码</label><input id="oldPwd" type="password" autocomplete="current-password"></div>
          <div class="field"><label>新密码</label><input id="newPwd" type="password" placeholder="至少 10 位" autocomplete="new-password"></div>
          <div class="field"><label>确认新密码</label><input id="newPwd2" type="password" autocomplete="new-password"></div>
        </div>
        <button class="btn btn-primary" id="changePwd">${icon('check', 15)} 保存新密码</button>
      </div>`);

    render();

    const changePwd = qs('#changePwd');
    if (changePwd) changePwd.addEventListener('click', async () => {
      const old_password = qs('#oldPwd').value;
      const new_password = qs('#newPwd').value;
      const confirm = qs('#newPwd2').value;
      if (new_password.length < 10) return toast('新密码至少 10 位', 'error');
      if (new_password !== confirm) return toast('两次输入的新密码不一致', 'error');
      await api('/password', { method: 'POST', body: { old_password, new_password } });
      toast('密码已更新，下次登录生效', 'success');
      pageSecurity();
    });

    const gen = qs('#genTotp');
    if (gen) gen.addEventListener('click', async () => {
      const data = await api('/2fa/setup', { method: 'POST' });
      secret = data.secret;
      otpauth = data.otpauth_url;
      render();
      toast('密钥已生成，请添加到验证器', 'success');
    });

    const enable = qs('#enableTotp');
    if (enable) enable.addEventListener('click', async () => {
      const code = qs('#totpEnableCode').value.trim();
      if (!/^\d{6}$/.test(code)) return toast('请输入 6 位动态码', 'error');
      await api('/2fa/enable', { method: 'POST', body: { code } });
      toast('两步验证已开启', 'success');
      pageSecurity();
    });

    const disable = qs('#disableTotp');
    if (disable) disable.addEventListener('click', async () => {
      const code = qs('#totpDisableCode').value.trim();
      if (!/^\d{6}$/.test(code)) return toast('请输入 6 位动态码', 'error');
      await api('/2fa/disable', { method: 'POST', body: { code } });
      toast('两步验证已关闭', 'success');
      pageSecurity();
    });
  }

  /* ================= 支付配置 ================= */
  async function pagePayments() {
    setCrumb('支付配置', '收款渠道');
    const d = await api('/settings');
    const p = d.payment;
    setPage(`
      <div class="page-head">
        <div><h1>支付配置</h1><p>支持易支付、支付宝当面付、USDT、HashPay、Stripe、PayPal、余额与模拟支付</p></div>
        <div class="actions"><button class="btn btn-primary" id="savePay">${icon('check', 15)} 保存配置</button></div>
      </div>

      <div class="card">
        <div class="card-title">${icon('wallet', 16)} 易支付（彩虹协议）<span class="badge badge-blue">推荐</span></div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-epay="enabled" ${p.epay.enabled ? 'checked' : ''}><span class="track"></span><span>开启易支付</span></label></div>
          <div class="field"><label>接口地址</label><input data-epay="api_url" value="${esc(p.epay.api_url)}" placeholder="https://pay.example.com"></div>
          <div class="field"><label>商户 PID</label><input data-epay="pid" value="${esc(p.epay.pid)}"></div>
          <div class="field"><label>商户密钥</label><input data-epay="key" type="password" value="${esc(p.epay.key)}"></div>
        </div>
        <div class="hint" style="font-size:11.5px;color:var(--muted);margin-top:10px">
          回调地址：<span class="code">${location.origin}/api/pay/notify/epay</span> · 跳转地址：<span class="code">${location.origin}/api/pay/return?channel=epay</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${icon('wallet', 16)} 支付宝当面付（RSA2）</div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-ali="enabled" ${p.alipay.enabled ? 'checked' : ''}><span class="track"></span><span>开启支付宝</span></label></div>
          <div class="field"><label>AppID</label><input data-ali="app_id" value="${esc(p.alipay.app_id)}"></div>
          <div class="field full"><label>应用私钥（PKCS8）</label><textarea data-ali="private_key" rows="3" placeholder="-----BEGIN PRIVATE KEY-----">${esc(p.alipay.private_key)}</textarea></div>
          <div class="field full"><label>支付宝公钥</label><textarea data-ali="public_key" rows="3" placeholder="-----BEGIN PUBLIC KEY-----">${esc(p.alipay.public_key)}</textarea></div>
          <div class="field"><label>网关地址</label><input data-ali="gateway" value="${esc(p.alipay.gateway)}"></div>
        </div>
        <div class="hint" style="font-size:11.5px;color:var(--muted);margin-top:10px">
          回调地址：<span class="code">${location.origin}/api/pay/notify/alipay</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${icon('wallet', 16)} USDT（BEpusdt / TokenPay）</div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-usdt="enabled" ${p.usdt.enabled ? 'checked' : ''}><span class="track"></span><span>开启 USDT</span></label></div>
          <div class="field"><label>网关地址</label><input data-usdt="api_url" value="${esc(p.usdt.api_url)}" placeholder="https://your-bepusdt.example.com"></div>
          <div class="field"><label>App Secret</label><input data-usdt="app_secret" type="password" value="${esc(p.usdt.app_secret)}"></div>
          <div class="field"><label>回调 Token</label><input data-usdt="token" value="${esc(p.usdt.token)}"></div>
        </div>
        <div class="hint" style="font-size:11.5px;color:var(--muted);margin-top:10px">
          回调地址：<span class="code">${location.origin}/api/pay/notify/usdt</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${icon('wallet', 16)} HashPay（USDT / TRC20）</div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-hashpay="enabled" ${p.hashpay?.enabled ? 'checked' : ''}><span class="track"></span><span>开启 HashPay</span></label></div>
          <div class="field"><label>Organization ID</label><input data-hashpay="organization_id" value="${esc(p.hashpay?.organization_id || '')}" placeholder="org_..."></div>
          <div class="field"><label>API Key</label><input data-hashpay="api_key" type="password" value="${esc(p.hashpay?.api_key || '')}" placeholder="X-HashPay-Key"></div>
          <div class="field"><label>Webhook Signing Secret</label><input data-hashpay="signing_secret" type="password" value="${esc(p.hashpay?.signing_secret || '')}" placeholder="whsec_..."></div>
          <div class="field"><label>接口地址</label><input data-hashpay="api_url" value="${esc(p.hashpay?.api_url || 'https://api.hashpay.me/v1')}"></div>
          <div class="field"><label>结算币种</label><input data-hashpay="currency" value="${esc(p.hashpay?.currency || 'USD')}" placeholder="USD"></div>
        </div>
        <div class="hint" style="font-size:11.5px;color:var(--muted);margin-top:10px">
          事件：<span class="code">invoice.paid</span> · 回调地址：<span class="code">${location.origin}/api/pay/notify/hashpay</span> · 金额按站点 USD 汇率换算
        </div>
      </div>

      <div class="card">
        <div class="card-title">${icon('wallet', 16)} Stripe（国际卡 / 钱包）</div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-stripe="enabled" ${p.stripe.enabled ? 'checked' : ''}><span class="track"></span><span>开启 Stripe</span></label></div>
          <div class="field"><label>Secret Key</label><input data-stripe="secret_key" type="password" value="${esc(p.stripe.secret_key)}" placeholder="sk_live_..."></div>
          <div class="field"><label>Publishable Key</label><input data-stripe="publishable_key" value="${esc(p.stripe.publishable_key)}" placeholder="pk_live_..."></div>
          <div class="field"><label>Webhook Secret</label><input data-stripe="webhook_secret" type="password" value="${esc(p.stripe.webhook_secret)}" placeholder="whsec_..."></div>
          <div class="field"><label>收款币种</label><input data-stripe="currency" value="${esc(p.stripe.currency || 'cny')}" placeholder="cny / usd / hkd"></div>
        </div>
        <div class="hint" style="font-size:11.5px;color:var(--muted);margin-top:10px">
          Webhook 事件：<span class="code">checkout.session.completed</span> · 回调地址：<span class="code">${location.origin}/api/pay/notify/stripe</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">${icon('wallet', 16)} PayPal（国际）</div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-paypal="enabled" ${p.paypal.enabled ? 'checked' : ''}><span class="track"></span><span>开启 PayPal</span></label></div>
          <div class="field"><label>Client ID</label><input data-paypal="client_id" value="${esc(p.paypal.client_id)}"></div>
          <div class="field"><label>Client Secret</label><input data-paypal="client_secret" type="password" value="${esc(p.paypal.client_secret)}"></div>
          <div class="field"><label>环境</label><select data-paypal="mode"><option value="sandbox" ${p.paypal.mode === 'sandbox' ? 'selected' : ''}>Sandbox 沙箱</option><option value="live" ${p.paypal.mode === 'live' ? 'selected' : ''}>Live 正式</option></select></div>
          <div class="field"><label>收款币种</label><input data-paypal="currency" value="${esc(p.paypal.currency || 'CNY')}" placeholder="CNY / USD"></div>
        </div>
        <div class="hint" style="font-size:11.5px;color:var(--muted);margin-top:10px">
          Webhook 事件：<span class="code">CHECKOUT.ORDER.APPROVED</span> · 回调地址：<span class="code">${location.origin}/api/pay/notify/paypal</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">其他渠道</div>
        <div class="form-grid">
          <div class="field"><label>余额支付</label><label class="switch"><input type="checkbox" data-bal="enabled" ${p.balance.enabled ? 'checked' : ''}><span class="track"></span><span>允许使用账户余额</span></label></div>
          <div class="field"><label>模拟支付</label><label class="switch"><input type="checkbox" data-mock="enabled" ${p.mock.enabled ? 'checked' : ''}><span class="track"></span><span>仅测试环境开启</span></label></div>
        </div>
      </div>`);

    const collectGroup = (prefix) => {
      const out = {};
      qsa(`[data-${prefix}]`).forEach((el) => {
        out[el.dataset[prefix]] = el.type === 'checkbox' ? el.checked : el.value.trim();
      });
      return out;
    };
    qs('#savePay').addEventListener('click', async () => {
      await api('/settings', {
        method: 'PUT',
        body: {
          section: 'payment',
          data: {
            epay: collectGroup('epay'),
            alipay: collectGroup('ali'),
            usdt: collectGroup('usdt'),
            stripe: collectGroup('stripe'),
            paypal: collectGroup('paypal'),
            hashpay: collectGroup('hashpay'),
            balance: collectGroup('bal'),
            mock: collectGroup('mock'),
          },
        },
      });
      toast('支付配置已保存', 'success');
    });
  }

  /* ================= 通知设置 ================= */
  async function pageNotify() {
    setCrumb('通知设置', '消息推送');
    const d = await api('/settings');
    const n = d.notify;
    setPage(`
      <div class="page-head">
        <div><h1>通知设置</h1><p>订单支付成功后可通过邮件、Telegram、Webhook 通知</p></div>
        <div class="actions">
          <button class="btn btn-ghost" id="testMail">${icon('mail', 15)} 发送测试邮件</button>
          <button class="btn btn-primary" id="saveNotify">${icon('check', 15)} 保存配置</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">电子邮件</div>
        <div class="form-grid">
          <div class="field"><label>启用邮件通知</label><label class="switch"><input type="checkbox" data-mail="enabled" ${n.email.enabled ? 'checked' : ''}><span class="track"></span><span>发送订单与卡密邮件</span></label></div>
          <div class="field"><label>发送方式</label><select data-mail="provider">
            ${[['smtp', 'SMTP（465/587）'], ['resend', 'Resend HTTP API'], ['http', '自定义 HTTP Webhook'], ['send_email', 'Cloudflare Email Binding']].map(([v, t]) => `<option value="${v}" ${n.email.provider === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div class="field"><label>SMTP 主机</label><input data-mail="host" value="${esc(n.email.host)}" placeholder="smtp.example.com"></div>
          <div class="field"><label>端口</label><input data-mail="port" type="number" value="${n.email.port}"></div>
          <div class="field"><label>用户名</label><input data-mail="username" value="${esc(n.email.username)}"></div>
          <div class="field"><label>密码 / API Key</label><input data-mail="password" type="password" value="${esc(n.email.password)}"></div>
          <div class="field"><label>发件人地址</label><input data-mail="from" value="${esc(n.email.from)}" placeholder="noreply@example.com"></div>
          <div class="field"><label>SSL/TLS</label><label class="switch"><input type="checkbox" data-mail="ssl" ${n.email.ssl ? 'checked' : ''}><span class="track"></span><span>465 端口请开启</span></label></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Telegram 机器人</div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-tg="enabled" ${n.telegram.enabled ? 'checked' : ''}><span class="track"></span><span>推送新订单</span></label></div>
          <div class="field"><label>Bot Token</label><input data-tg="bot_token" value="${esc(n.telegram.bot_token)}" placeholder="123456:ABC-DEF..."></div>
          <div class="field"><label>Chat ID</label><input data-tg="chat_id" value="${esc(n.telegram.chat_id)}"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Webhook</div>
        <div class="form-grid">
          <div class="field"><label>启用</label><label class="switch"><input type="checkbox" data-wh="enabled" ${n.webhook.enabled ? 'checked' : ''}><span class="track"></span><span>POST JSON 到指定地址</span></label></div>
          <div class="field full"><label>Webhook 地址</label><input data-wh="url" value="${esc(n.webhook.url)}" placeholder="https://example.com/webhook"></div>
        </div>
      </div>`);

    const collectGroup = (prefix) => {
      const out = {};
      qsa(`[data-${prefix}]`).forEach((el) => {
        out[el.dataset[prefix]] = el.type === 'checkbox' ? el.checked : el.value.trim();
      });
      if (out.port) out.port = Number(out.port);
      return out;
    };
    qs('#saveNotify').addEventListener('click', async () => {
      await api('/settings', {
        method: 'PUT',
        body: {
          section: 'notify',
          data: { email: collectGroup('mail'), telegram: collectGroup('tg'), webhook: collectGroup('wh') },
        },
      });
      toast('通知配置已保存', 'success');
    });
    qs('#testMail').addEventListener('click', () => {
      const modal = openForm({
        title: '发送测试邮件',
        fields: [{ key: 'to', label: '收件邮箱', required: true }],
        values: { to: '' },
        onSubmit: async (v) => {
          await api('/settings/test-mail', { method: 'POST', body: v });
          toast('测试邮件已发送', 'success');
        },
      });
    });
  }

  /* ================= 站点设置 ================= */
  async function pageSettings() {
    setCrumb('站点设置', '基础参数');
    const d = await api('/settings');
    const s = d.site;
    const c = d.commission;
    setPage(`
      <div class="page-head">
        <div><h1>站点设置</h1><p>站点信息、购买规则与推广返佣</p></div>
        <div class="actions"><button class="btn btn-primary" id="saveSettings">${icon('check', 15)} 保存设置</button></div>
      </div>
      <div class="card">
        <div class="card-title">基础信息</div>
        <div class="form-grid">
          <div class="field"><label>站点名称</label><input data-site="name" value="${esc(s.name)}"></div>
          <div class="field"><label>Logo 文字</label><input data-site="logo" value="${esc(s.logo)}" placeholder="留空取站点名首字"></div>
          <div class="field full"><label>站点描述</label><input data-site="description" value="${esc(s.description)}"></div>
          <div class="field full"><label>首页公告</label><textarea data-site="announcement" rows="2">${esc(s.announcement)}</textarea></div>
          <div class="field full"><label>购买须知 / 发货说明</label><textarea data-site="notice" rows="3">${esc(s.notice)}</textarea></div>
          <div class="field"><label>客服方式</label><input data-site="contact" value="${esc(s.contact)}"></div>
          <div class="field"><label>备案号</label><input data-site="icp" value="${esc(s.icp)}"></div>
          <div class="field"><label>货币符号</label><input data-site="currency" value="${esc(s.currency)}"></div>
          <div class="field"><label>主题色</label><input data-site="theme_color" value="${esc(s.theme_color)}"></div>
          <div class="field full"><label>页脚文字</label><input data-site="footer" value="${esc(s.footer)}"></div>
          <div class="field"><label>SEO 标题</label><input data-site="seo_title" value="${esc(s.seo_title)}"></div>
          <div class="field"><label>SEO 关键词</label><input data-site="seo_keywords" value="${esc(s.seo_keywords)}"></div>
          <div class="field"><label>分享封面图</label><input data-site="og_image" value="${esc(s.og_image || '')}" placeholder="/og-image.png 或 https://…"></div>
          <div class="field full"><label>SEO 描述</label><textarea data-site="seo_description" rows="2">${esc(s.seo_description)}</textarea></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">购买规则</div>
        <div class="form-grid">
          <div class="field"><label>订单超时（分钟）</label><input data-site="order_expire_minutes" type="number" value="${s.order_expire_minutes}"></div>
          <div class="field"><label>最低订单金额（元）</label><input id="minAmount" type="number" step="0.01" value="${(s.min_amount_cents / 100).toFixed(2)}"></div>
          <div class="field"><label>库存预警阈值</label><input data-site="stock_alert" type="number" value="${s.stock_alert}"></div>
          <div class="field"><label>开放注册</label><label class="switch"><input type="checkbox" data-site="allow_register" ${s.allow_register ? 'checked' : ''}><span class="track"></span><span>允许用户注册</span></label></div>
          <div class="field"><label>强制登录下单</label><label class="switch"><input type="checkbox" data-site="force_login" ${s.force_login ? 'checked' : ''}><span class="track"></span><span>未登录不可下单</span></label></div>
          <div class="field"><label>维护模式</label><label class="switch"><input type="checkbox" data-site="maintenance" ${s.maintenance ? 'checked' : ''}><span class="track"></span><span>前台显示维护页</span></label></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">推广返佣（三级分销）</div>
        <div class="form-grid">
          <div class="field"><label>启用返佣</label><label class="switch"><input type="checkbox" id="cmEnabled" ${c.enabled ? 'checked' : ''}><span class="track"></span><span>按订单实付比例返给上级</span></label></div>
          <div class="field"><label>一级返佣比例（%）</label><input id="cm1" type="number" value="${c.levels[0] ?? 10}"></div>
          <div class="field"><label>二级返佣比例（%）</label><input id="cm2" type="number" value="${c.levels[1] ?? 5}"></div>
          <div class="field"><label>三级返佣比例（%）</label><input id="cm3" type="number" value="${c.levels[2] ?? 2}"></div>
        </div>
      </div>`);

    qs('#saveSettings').addEventListener('click', async () => {
      const data = {};
      qsa('[data-site]').forEach((el) => {
        data[el.dataset.site] = el.type === 'checkbox' ? el.checked : el.value.trim();
      });
      data.order_expire_minutes = Number(data.order_expire_minutes);
      data.stock_alert = Number(data.stock_alert);
      data.min_amount_cents = Math.round(Number(qs('#minAmount').value || 0) * 100);
      await api('/settings', { method: 'PUT', body: { section: 'site', data } });
      await api('/settings', {
        method: 'PUT',
        body: {
          section: 'commission',
          data: { enabled: qs('#cmEnabled').checked, levels: [Number(qs('#cm1').value), Number(qs('#cm2').value), Number(qs('#cm3').value)] },
        },
      });
      toast('设置已保存', 'success');
    });
  }

  /* ================= 日志 ================= */
  async function pageLogs() {
    setCrumb('操作日志', '审计');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const [audit, notify] = await Promise.all([api('/logs/audit'), api('/logs/notify')]);
    setPage(`
      <div class="page-head"><div><h1>操作日志</h1><p>管理员操作与通知发送记录</p></div></div>
      <div class="card">
        <div class="card-title">管理员操作</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>时间</th><th>动作</th><th>详情</th><th>IP</th></tr></thead>
          <tbody>${audit.map((l) => `<tr><td class="muted">${date(l.created_at)}</td><td>${esc(l.action)}</td><td class="muted">${esc(l.detail || '')}</td><td class="code">${esc(l.ip || '')}</td></tr>`).join('') || `<tr><td colspan="4">${emptyBlock('📋', '暂无记录', '')}</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-title">通知记录</div>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>时间</th><th>渠道</th><th>目标</th><th>主题</th><th>状态</th><th>错误</th></tr></thead>
          <tbody>${notify.map((l) => `<tr><td class="muted">${date(l.created_at)}</td><td>${esc(l.channel)}</td><td class="code">${esc(l.target || '')}</td><td class="muted">${esc(l.subject || '')}</td>
            <td>${l.status === 'ok' ? '<span class="badge badge-green">成功</span>' : '<span class="badge badge-red">失败</span>'}</td>
            <td class="muted" style="max-width:260px;overflow:hidden;text-overflow:ellipsis">${esc(l.error || '')}</td></tr>`).join('') || `<tr><td colspan="6">${emptyBlock('📭', '暂无记录', '')}</td></tr>`}</tbody>
        </table></div>
      </div>`);
  }

  /* ================= 表单弹窗 ================= */
  function openForm({ title, fields, values = {}, onSubmit, submitText = '保存', width = 560 }) {
    const body = `<div class="form-grid">${fields.map((f) => {
      const val = values[f.key] ?? f.default ?? '';
      let input = '';
      if (f.type === 'select') {
        input = `<select data-f="${f.key}">${(f.options || []).map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea data-f="${f.key}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(val)}</textarea>`;
      } else if (f.type === 'toggle') {
        input = `<label class="switch"><input type="checkbox" data-f="${f.key}" ${val ? 'checked' : ''}><span class="track"></span><span>${esc(f.on || '启用')}</span></label>`;
      } else if (f.type === 'datetime') {
        input = `<input type="datetime-local" data-f="${f.key}" value="${tsToInput(val)}">`;
      } else {
        input = `<input type="${f.type || 'text'}" data-f="${f.key}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" step="${f.step || 'any'}">`;
      }
      return `<div class="field ${f.full ? 'full' : ''}"><label>${esc(f.label)}${f.required ? ' *' : ''}</label>${input}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    }).join('')}</div>`;
    const modal = openModal({
      title, body, width,
      footer: `<button class="btn btn-ghost" data-modal-close="1">取消</button>
               <button class="btn btn-primary" id="formSubmit">${esc(submitText)}</button>`,
    });
    qs('#formSubmit', modal.el).addEventListener('click', async () => {
      const out = {};
      fields.forEach((f) => {
        const el = qs(`[data-f="${f.key}"]`, modal.el);
        if (!el) return;
        if (f.type === 'toggle') out[f.key] = el.checked;
        else if (f.type === 'number') out[f.key] = el.value === '' ? 0 : Number(el.value);
        else if (f.type === 'datetime') out[f.key] = inputToTs(el.value);
        else out[f.key] = el.value.trim();
      });
      const missing = fields.filter((f) => f.required && !out[f.key]);
      if (missing.length) return toast(`请填写${missing[0].label}`, 'error');
      const btn = qs('#formSubmit', modal.el);
      btn.disabled = true;
      try {
        await onSubmit(out);
        modal.close();
      } catch (e) {
        btn.disabled = false;
      }
    });
    return modal;
  }

  /* ================= 多商户 ================= */
  async function pageMerchants() {
    setCrumb('多商户', '店铺管理');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const list = await api('/merchants');
    merchantSwitchLoaded = false;
    setPage(`
      <div class="page-head">
        <div><h1>多商户</h1><p>一个平台管理多个独立店铺；每个商户拥有自己的商品、订单、优惠券与工单</p></div>
        <div class="actions"><button class="btn btn-primary" id="addMerchant">${icon('plus', 15)} 新建店铺</button></div>
      </div>
      <div class="stat-grid" style="margin-bottom:18px">
        <div class="stat"><div class="ico">${icon('grid', 18)}</div><div class="label">店铺总数</div><div class="value">${list.length}</div></div>
        <div class="stat"><div class="ico green">${icon('box', 18)}</div><div class="label">在售商品</div><div class="value">${list.reduce((s, m) => s + Number(m.product_count || 0), 0)}</div></div>
        <div class="stat"><div class="ico green">${icon('wallet', 18)}</div><div class="label">累计营收</div><div class="value">${money(list.reduce((s, m) => s + Number(m.revenue_cents || 0), 0))}</div></div>
        <div class="stat"><div class="ico">${icon('order', 18)}</div><div class="label">累计订单</div><div class="value">${list.reduce((s, m) => s + Number(m.order_count || 0), 0)}</div></div>
      </div>
      <div class="card"><div class="table-wrap"><table class="table">
        <thead><tr><th>店铺</th><th>访问地址</th><th class="num">商品</th><th class="num">订单</th><th class="num">营收</th><th>管理员</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
        <tbody>${list.map((m) => `<tr>
          <td><div class="cell-prod"><div class="img">${esc(m.logo || m.name.slice(0, 1))}</div>
            <div><div class="n">${esc(m.name)}${m.is_default ? ' <span class="badge badge-blue">自营</span>' : ''}</div><div class="s">${esc(m.slug)}</div></div></div></td>
          <td class="code">${esc(m.domain || `?merchant=${m.slug}`)}</td>
          <td class="num">${m.product_count}</td>
          <td class="num">${m.order_count}</td>
          <td class="num">${money(m.revenue_cents)}</td>
          <td class="muted">${esc(m.admin_username || '-')}</td>
          <td>${m.status === 'on' ? '<span class="badge badge-green">营业中</span>' : '<span class="badge badge-gray">已停用</span>'}</td>
          <td><div class="actions">
            <a class="btn btn-ghost btn-xs" href="/?merchant=${encodeURIComponent(m.slug)}" target="_blank" rel="noopener">访问</a>
            <button class="btn btn-ghost btn-xs" data-edit="${m.id}">编辑</button>
            <button class="btn btn-soft btn-xs" data-admin="${m.id}">管理员</button>
            ${m.is_default ? '' : `<button class="btn btn-soft btn-xs" data-toggle="${m.id}">${m.status === 'on' ? '停用' : '启用'}</button>
            <button class="btn btn-danger-ghost btn-xs" data-del="${m.id}">删除</button>`}
          </div></td>
        </tr>`).join('') || `<tr><td colspan="8">${emptyBlock('🏪', '还没有店铺', '新建一个店铺开始多商户运营')}</td></tr>`}</tbody>
      </table></div></div>`);

    const openMerchant = (m = {}) => openForm({
      title: m.id ? '编辑店铺' : '新建店铺',
      width: 680,
      fields: [
        { key: 'name', label: '店铺名称', required: true },
        { key: 'slug', label: '店铺标识', placeholder: '小写字母 / 数字 / 连字符，留空自动生成', hint: '用于 ?merchant=标识 访问' },
        { key: 'domain', label: '绑定域名', placeholder: 'shop.example.com', full: true, hint: '可选；需将域名 CNAME 到当前 Worker' },
        { key: 'description', label: '店铺描述', type: 'textarea', full: true },
        { key: 'announcement', label: '店铺公告', type: 'textarea', full: true },
        { key: 'contact', label: '客服方式' },
        { key: 'footer', label: '页脚文字' },
        { key: 'logo', label: 'Logo 文字 / Emoji' },
        { key: 'logo_image', label: 'Logo 图片地址', full: true },
        { key: 'seo_title', label: 'SEO 标题' },
        { key: 'seo_keywords', label: 'SEO 关键词' },
        { key: 'seo_description', label: 'SEO 描述', type: 'textarea', full: true },
        ...(m.id ? [] : [
          { key: 'admin_username', label: '商户管理员账号', placeholder: '留空自动生成', full: true },
          { key: 'admin_password', label: '商户管理员初始密码', type: 'password', placeholder: '留空自动生成 14 位密码', full: true },
        ]),
      ],
      values: m,
      onSubmit: async (v) => {
        const res = await api(m.id ? `/merchants/${m.id}` : '/merchants', {
          method: m.id ? 'PUT' : 'POST',
          body: { ...v, status: m.status || 'on' },
        });
        toast(m.id ? '店铺已更新' : '店铺已创建', 'success');
        if (!m.id && res.generated_password) {
          const cred = {
            title: '店铺管理员已创建',
            body: `<div class="field"><label>登录账号</label><input value="${esc(res.admin_username)}" readonly></div>
              <div class="field"><label>初始密码</label><input value="${esc(res.generated_password)}" readonly></div>
              <p class="hint">请立即保存。密码只显示这一次，可在「管理员」中重置。</p>`,
            footer: `<button class="btn btn-primary" data-modal-close="1">我已保存</button>`,
          };
          // 等表单弹窗完全关闭后再显示，避免弹窗堆叠导致关闭时回到旧表单
          setTimeout(() => openModal(cred), 60);
        }
        pageMerchants();
      },
    });

    qs('#addMerchant').addEventListener('click', () => openMerchant());
    qsa('[data-edit]').forEach((b) => b.addEventListener('click', () => openMerchant(list.find((x) => String(x.id) === b.dataset.edit))));
    qsa('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
      const m = list.find((x) => String(x.id) === b.dataset.toggle);
      await api(`/merchants/${m.id}`, { method: 'PUT', body: { status: m.status === 'on' ? 'off' : 'on' } });
      toast(m.status === 'on' ? '店铺已停用' : '店铺已启用', 'success');
      pageMerchants();
    }));
    qsa('[data-admin]').forEach((b) => b.addEventListener('click', () => {
      const m = list.find((x) => String(x.id) === b.dataset.admin);
      openForm({
        title: `设置店铺管理员 · ${m.name}`,
        fields: [
          { key: 'username', label: '登录账号', required: true, default: m.admin_username || `${m.slug}-admin` },
          { key: 'password', label: '新密码', type: 'password', placeholder: '留空自动生成 14 位密码' },
        ],
        onSubmit: async (v) => {
          const res = await api(`/merchants/${m.id}/admin`, { method: 'POST', body: v });
          if (res.generated_password) {
            const cred = {
              title: '管理员密码已生成',
              body: `<div class="field"><label>登录账号</label><input value="${esc(res.admin_username)}" readonly></div>
                <div class="field"><label>新密码</label><input value="${esc(res.generated_password)}" readonly></div>`,
              footer: `<button class="btn btn-primary" data-modal-close="1">我已保存</button>`,
            };
            setTimeout(() => openModal(cred), 60);
          } else toast('管理员已更新', 'success');
          pageMerchants();
        },
      });
    }));
    qsa('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog('删除店铺会同时删除其管理员账号；已有订单的店铺不能删除。确定继续？', { danger: true, okText: '删除' }))) return;
      try {
        await api(`/merchants/${b.dataset.del}`, { method: 'DELETE' });
      } catch (e) {
        return; // 后端拒绝（如仍有商品/订单）时保留当前列表，错误已由 request 统一提示
      }
      toast('店铺已删除', 'success');
      pageMerchants();
    }));
  }

  async function pageStore() {
    setCrumb('店铺设置', '商户资料');
    setPage('<div class="page-loading" style="text-align:center;padding:100px 0;color:var(--muted)">加载中…</div>');
    const m = await api('/merchant/profile');
    setPage(`
      <div class="page-head">
        <div><h1>店铺设置</h1><p>维护你的店铺名称、公告、客服与 SEO 信息</p></div>
        <div class="actions"><a class="btn btn-ghost" href="/?merchant=${encodeURIComponent(m.slug)}" target="_blank" rel="noopener">${icon('arrow', 15)} 查看店铺</a></div>
      </div>
      <div class="card">
        <div class="card-title">店铺资料</div>
        <div class="form-grid">
          <div class="field"><label>店铺名称</label><input data-store="name" value="${esc(m.name)}"></div>
          <div class="field"><label>店铺标识（只读）</label><input value="${esc(m.slug)}" readonly></div>
          <div class="field full"><label>店铺描述</label><textarea data-store="description" rows="2">${esc(m.description)}</textarea></div>
          <div class="field full"><label>店铺公告</label><textarea data-store="announcement" rows="2">${esc(m.announcement)}</textarea></div>
          <div class="field"><label>客服方式</label><input data-store="contact" value="${esc(m.contact)}"></div>
          <div class="field"><label>页脚文字</label><input data-store="footer" value="${esc(m.footer)}"></div>
          <div class="field"><label>Logo 文字 / Emoji</label><input data-store="logo" value="${esc(m.logo)}"></div>
          <div class="field"><label>Logo 图片地址</label><input data-store="logo_image" value="${esc(m.logo_image)}"></div>
          <div class="field full"><label>SEO 标题</label><input data-store="seo_title" value="${esc(m.seo_title)}"></div>
          <div class="field full"><label>SEO 关键词</label><input data-store="seo_keywords" value="${esc(m.seo_keywords)}"></div>
          <div class="field full"><label>SEO 描述</label><textarea data-store="seo_description" rows="2">${esc(m.seo_description)}</textarea></div>
        </div>
        <div style="padding:0 18px 18px"><button class="btn btn-primary" id="saveStore">${icon('check', 15)} 保存店铺资料</button></div>
      </div>`);

    qs('#saveStore').addEventListener('click', async () => {
      const data = {};
      qsa('[data-store]').forEach((el) => { data[el.dataset.store] = el.value.trim(); });
      if (!data.name) return toast('请填写店铺名称', 'error');
      await api('/merchant/profile', { method: 'PUT', body: data });
      toast('店铺资料已保存', 'success');
    });
  }

  /* ================= 抽屉 ================= */
  function openDrawer(title, body, foot = '') {
    qs('#drawerTitle').textContent = title;
    qs('#drawerBody').innerHTML = body;
    qs('#drawerFoot').innerHTML = foot;
    qs('#drawer').hidden = false;
    qs('#drawerMask').hidden = false;
    qs('#drawerClose').innerHTML = icon('close');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    qs('#drawer').hidden = true;
    qs('#drawerMask').hidden = true;
    document.body.style.overflow = '';
  }

  /* ================= 启动 ================= */
  async function boot() {
    document.getElementById('menuBtn').innerHTML = icon('grid', 18);
    document.getElementById('themeToggle').innerHTML = icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', 17);
    document.getElementById('themeToggle').addEventListener('click', () => {
      UI.toggleTheme();
      document.getElementById('themeToggle').innerHTML = icon(UI.getTheme() === 'dark' ? 'sun' : 'moon', 17);
    });
    document.getElementById('menuBtn').addEventListener('click', () => qs('#sidebar').classList.toggle('open'));
    qs('#drawerClose').addEventListener('click', closeDrawer);
    qs('#drawerMask').addEventListener('click', closeDrawer);
    qs('#logoutLink').addEventListener('click', async (e) => {
      e.preventDefault();
      await api('/logout', { method: 'POST' });
      location.reload();
    });
    window.addEventListener('hashchange', route);

    const boot = await api('/bootstrap');
    if (!boot.initialized) return showAuthScreen('setup');
    try {
      ME = await api('/me');
    } catch (e) {
      return showAuthScreen('login');
    }
    if (ME.merchant_id) ACTIVE_MERCHANT = '';
    renderNav();
    renderTopbar();
    loadBadges();
    route();
  }

  boot();
})();
