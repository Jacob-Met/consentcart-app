(() => {
  const APP_PORT = 4178; // default port of `npm run demo` / `node server.mjs`
  const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`;
  const APP_URL = `${APP_ORIGIN}/?embed=1`;
  if (window.top !== window || document.getElementById('consentcart-host')) return;

  // ---- read the page ----
  const clean = s => (s || '').replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const textOf = el => clean(el.innerText || el.textContent);
  const KEYWORDS = /\b(returns?|refunds?|terms|restocking|exchange|final sale|cancellation|warranty)\b/i;
  function longestTermsBlock() {
    let best = '';
    for (const el of document.body.querySelectorAll('p, li, section, article, div, details, dd, td, blockquote')) {
      if (el.closest('#consentcart-host')) continue;
      const t = textOf(el);
      if (t.length < 80 || t.length > 8000 || !KEYWORDS.test(t) || t.length <= best.length) continue;
      if ([...el.children].some(c => textOf(c).length > 0.85 * t.length)) continue; // prefer the tighter child
      best = t;
    }
    return best;
  }
  function collect() {
    const q = s => document.querySelector(s);
    const marked = q('[data-terms]');
    const selection = clean(String(window.getSelection ? window.getSelection() : ''));
    const terms = marked ? textOf(marked) : selection.length > 40 ? selection : longestTermsBlock();
    const title = clean(q('[data-offer-title]')?.textContent);
    const price = clean(q('[data-offer-price]')?.textContent);
    const merchant = clean(q('[data-merchant]')?.textContent) || location.hostname;
    // Optional cart lines: <li data-cart-item data-name="..." data-price="12.00" data-qty="2">
    const items = [...document.querySelectorAll('[data-cart-item]')].slice(0, 30).map(el => ({
      name: clean(el.dataset.name || el.textContent).slice(0, 100), qty: Number(el.dataset.qty) || 1,
      priceCents: Math.round(Number(String(el.dataset.price || '').replace(/[^0-9.]/g, '')) * 100) || 0})).filter(i => i.name);
    return {type: 'consentcart:terms', title, price, terms, merchant, ...(items.length ? {items} : {})};
  }

  // ---- shadow DOM UI ----
  const host = document.createElement('div');
  host.id = 'consentcart-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0 0 auto auto;z-index:2147483647;';
  const root = host.attachShadow({mode: 'open'});
  root.innerHTML = `
<style>
  :host{all:initial}
  *{box-sizing:border-box}
  .pill{position:fixed;right:20px;bottom:20px;display:flex;align-items:center;gap:8px;height:42px;padding:0 16px 0 12px;border:0;border-radius:999px;
    background:#111;color:#f7f3e8;font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;letter-spacing:.01em;cursor:pointer;
    box-shadow:0 6px 20px rgba(0,0,0,.28),0 0 0 1px rgba(244,198,61,.55);transition:transform .15s ease,box-shadow .15s ease}
  .pill:hover{transform:translateY(-1px);box-shadow:0 10px 26px rgba(0,0,0,.32),0 0 0 1px #f4c63d}
  .pill:focus-visible,.close:focus-visible{outline:3px solid #f4c63d;outline-offset:2px}
  .pill svg{width:20px;height:20px}
  .drawer{position:fixed;top:0;right:0;bottom:0;width:440px;max-width:100vw;display:flex;flex-direction:column;background:#fff;
    box-shadow:-12px 0 40px rgba(0,0,0,.22);transform:translateX(105%);transition:transform .25s cubic-bezier(.2,.8,.2,1);visibility:hidden}
  .open .drawer{transform:none;visibility:visible}
  .open .pill{display:none}
  header{display:flex;align-items:center;gap:10px;height:52px;padding:0 10px 0 16px;background:#111;color:#f7f3e8;flex:none;
    font:600 15px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  header svg{width:20px;height:20px}
  header span{flex:1}
  header small{font-weight:400;font-size:12px;opacity:.7}
  .close{width:34px;height:34px;border:0;border-radius:8px;background:transparent;color:#f7f3e8;font-size:22px;line-height:1;cursor:pointer}
  .close:hover{background:rgba(255,255,255,.14)}
  iframe{flex:1;width:100%;border:0;background:#fff}
</style>
<button class="pill" part="pill" aria-label="Open ConsentCart" aria-expanded="false">${'<svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5 4.5 5.5v5.7c0 4.5 3.1 8.4 7.5 10.3 4.4-1.9 7.5-5.8 7.5-10.3V5.5z" fill="#f4c63d"/><path d="m8.6 12.2 2.4 2.4 4.6-4.9" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'}<span>ConsentCart</span></button>
<aside class="drawer" role="dialog" aria-label="ConsentCart" aria-hidden="true">
  <header><svg viewBox="0 0 24 24" fill="none"><path d="M12 2.5 4.5 5.5v5.7c0 4.5 3.1 8.4 7.5 10.3 4.4-1.9 7.5-5.8 7.5-10.3V5.5z" fill="#f4c63d"/><path d="m8.6 12.2 2.4 2.4 4.6-4.9" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>ConsentCart <small>know what you agree to</small></span><button class="close" aria-label="Close ConsentCart">&times;</button></header>
</aside>`;
  const pill = root.querySelector('.pill');
  const drawer = root.querySelector('.drawer');
  const wrap = document.createElement('div');
  root.append(wrap);
  wrap.append(pill, drawer);
  let frame = null, ready = false, lastSent = '';

  function send() {
    if (!frame || !ready) return;
    const msg = collect();
    const key = JSON.stringify(msg);
    if (key === lastSent) return;
    lastSent = key;
    frame.contentWindow.postMessage(msg, APP_ORIGIN);
  }
  function open() {
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = 'ConsentCart';
      frame.src = APP_URL;
      frame.setAttribute('allow', 'clipboard-write');
      drawer.append(frame);
      // the app announces itself with consentcart:ready (handled below), then receives the terms
    } else send();
    wrap.classList.add('open'); root.host.toggleAttribute('data-open', true);
    drawer.setAttribute('aria-hidden', 'false'); pill.setAttribute('aria-expanded', 'true');
  }
  function close() {
    wrap.classList.remove('open'); root.host.removeAttribute('data-open');
    drawer.setAttribute('aria-hidden', 'true'); pill.setAttribute('aria-expanded', 'false');
    pill.focus();
  }
  const toggle = () => (wrap.classList.contains('open') ? close() : open());
  pill.addEventListener('click', open);
  root.querySelector('.close').addEventListener('click', close);
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && wrap.classList.contains('open')) close(); });
  window.addEventListener('message', e => { if (e.origin === APP_ORIGIN && e.data?.type === 'consentcart:ready') { ready = true; lastSent = ''; send(); } });
  chrome.runtime.onMessage.addListener(m => { if (m?.type === 'consentcart:toggle') toggle(); });
  wrap.className = '';
  document.documentElement.append(host);
})();
