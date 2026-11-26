/* Slogan · 通用 UI 工具 */
(function () {
  'use strict';

  const ICONS = {
    cart: '<path d="M3 3h2l2.4 12.2a2 2 0 0 0 2 1.8h8.9a2 2 0 0 0 2-1.6L21.5 8H6.2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.2-3.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    order: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="m5 12 5 5L20 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    chevron: '<path d="m9 6 6 6-6 6"/>',
    back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    trash: '<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    ticket: '<path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8Z"/><path d="M12 6v12"/>',
    wallet: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8M12 8v12M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.4L4 9"/><path d="M4 4v5h5M4 13a8 8 0 0 0 14.6 4.4L20 15"/><path d="M20 20v-5h-5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
    chat: '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z"/><path d="M8 11h8M8 14h5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
  };

  function icon(name, size = 18, cls = '') {
    const body = ICONS[name] || '';
    return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const MONEY = {
    code: 'CNY',
    rates: { CNY: 1 },
    symbols: { CNY: '¥' },
  };

  function setMoney(code, rates, symbols) {
    if (rates && typeof rates === 'object') MONEY.rates = rates;
    if (symbols && typeof symbols === 'object') MONEY.symbols = symbols;
    MONEY.code = MONEY.rates[code] != null ? code : 'CNY';
  }

  function money(cents, currency) {
    const n = Number(cents) || 0;
    const neg = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    const code = typeof currency === 'string' && /^[A-Z]{3}$/.test(currency)
      ? (MONEY.rates[currency] != null ? currency : MONEY.code)
      : MONEY.code;
    const rate = Number(MONEY.rates[code]) || 1;
    const symbol = MONEY.symbols[code]
      || (typeof currency === 'string' && !/^[A-Z]{3}$/.test(currency) && currency)
      || '¥';
    const value = (abs * rate) / 100;
    const digits = code === 'JPY' ? 0 : 2;
    const formatted = new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
    return `${neg}${symbol}${formatted}`;
  }

  function date(ts, withTime = true) {
    if (!ts) return '-';
    const d = new Date(Number(ts));
    const p = (n) => String(n).padStart(2, '0');
    const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
  }

  async function request(path, options = {}) {
    const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const opts = { method: options.method || 'GET', headers: isForm ? {} : { 'Content-Type': 'application/json' } };
    if (options.body !== undefined) opts.body = isForm ? options.body : JSON.stringify(options.body);
    if (options.headers) Object.assign(opts.headers, options.headers);
    // 多商户：同一标签页内记住当前店铺，所有 API 请求自动带上店铺标识
    try {
      const slug = sessionStorage.getItem('fh-merchant:' + location.host);
      if (slug) opts.headers['X-Merchant-Slug'] = slug;
    } catch (e) { /* 隐私模式下忽略 */ }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      toast('网络异常，请检查连接', 'error');
      throw e;
    }
    let json = null;
    const text = await res.text();
    try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
    if (!res.ok || (json && json.ok === false)) {
      const msg = (json && json.error) || `请求失败（${res.status}）`;
      if (!options.silent) toast(msg, 'error');
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return json ? json.data : null;
  }

  const toastRoot = () => document.getElementById('toastRoot');
  function toast(message, type = 'info', duration = 2600) {
    const root = toastRoot();
    if (!root) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="toast-dot"></span><span>${esc(message)}</span>`;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  function openModal(opts = {}) {
    const root = document.getElementById('modalRoot');
    if (!root) return { close() {}, el: null };
    const prev = root.innerHTML;
    root.hidden = false;
    root.innerHTML = `
      <div class="modal-mask" data-modal-close="${opts.maskClose === false ? '0' : '1'}"></div>
      <div class="modal" role="dialog" aria-modal="true" style="max-width:${opts.width || 520}px">
        <div class="modal-head">
          <h3>${esc(opts.title || '')}</h3>
          <button class="icon-btn" data-modal-close="1" aria-label="关闭">${icon('close')}</button>
        </div>
        <div class="modal-body">${opts.body || ''}</div>
        ${opts.footer ? `<div class="modal-foot">${opts.footer}</div>` : ''}
      </div>`;
    const el = root.querySelector('.modal');
    const close = () => {
      root.hidden = true;
      root.innerHTML = prev;
      if (opts.onClose) opts.onClose();
    };
    root.querySelectorAll('[data-modal-close="1"]').forEach((n) => n.addEventListener('click', close));
    document.addEventListener('keydown', function escKey(e) {
      if (e.key === 'Escape') {
        close();
        document.removeEventListener('keydown', escKey);
      }
    });
    return { close, el, root };
  }

  function confirmDialog(message, { title = '请确认', okText = '确定', danger = false } = {}) {
    return new Promise((resolve) => {
      const modal = openModal({
        title,
        body: `<p class="confirm-text">${esc(message)}</p>`,
        footer: `<button class="btn btn-ghost" data-act="cancel">取消</button>
                 <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(okText)}</button>`,
      });
      modal.el?.querySelector('[data-act="cancel"]').addEventListener('click', () => { modal.close(); resolve(false); });
      modal.el?.querySelector('[data-act="ok"]').addEventListener('click', () => { modal.close(); resolve(true); });
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制到剪贴板', 'success');
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('已复制', 'success'); return true; }
      catch (err) { toast('复制失败，请手动选择', 'error'); return false; }
      finally { ta.remove(); }
    }
  }

  function getTheme() {
    return document.documentElement.dataset.theme || 'light';
  }

  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('fh-theme', theme);
    document.querySelectorAll('[data-theme-toggle-icon]').forEach((el) => {
      el.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
    });
  }

  function toggleTheme() {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  }

  function debounce(fn, wait = 250) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function qs(selector, root = document) { return root.querySelector(selector); }
  function qsa(selector, root = document) { return [...root.querySelectorAll(selector)]; }

  window.UI = {
    icon, esc, money, setMoney, date, request, toast, openModal, confirmDialog,
    copyText, getTheme, setTheme, toggleTheme, debounce, qs, qsa,
  };
})();
