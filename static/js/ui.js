export function qs(sel, ctx = document) {
  return ctx.querySelector(sel);
}

export function qsa(sel, ctx = document) {
  return [...ctx.querySelectorAll(sel)];
}

export function show(el) {
  if (el) el.hidden = false;
}

export function hide(el) {
  if (el) el.hidden = true;
}

export function create(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else if (child) el.appendChild(child);
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function animateCSS(el, animation, duration = 300) {
  if (prefersReducedMotion()) return;
  return new Promise(resolve => {
    el.style.animation = 'none';
    void el.offsetHeight;
    el.style.animation = `${animation} ${duration}ms var(--ease) forwards`;
    setTimeout(resolve, duration);
  });
}

export function debounce(fn, ms = 50) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'm';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

export function copyToClipboard(text) {
  if (navigator.clipboard) {
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  return Promise.resolve();
}
