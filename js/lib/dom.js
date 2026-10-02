// DOM and math helpers shared by every module. No dependencies.

/** First match of `sel` inside `root` (default document). */
export const $ = (sel, root = document) => root.querySelector(sel);

/** Every match of `sel` inside `root`, as an array. */
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Creates an element.
 *   h('div', { class: 'card', style: { '--f': 0.4 }, dataset: { id: 'x' }, onclick: fn, html: '<b>…</b>' }, child, 'text', …)
 * `class` may be a string or an array (falsy entries dropped); `style` an object (custom properties allowed)
 * or a string; `on<event>` adds a listener; `html` sets innerHTML (trusted strings only); any other key is
 * set as an attribute (true → empty attribute, false/null/undefined → skipped). Children: nodes, strings,
 * numbers, arrays, falsy (skipped).
 */
export function h(tag, attrs, ...children) {
  const el = tag.includes(':') ? document.createElementNS('http://www.w3.org/2000/svg', tag.split(':')[1]) : document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === false || value === null || value === undefined) continue;
    if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, String(v));
        else el.style[prop] = v;
      }
    } else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'html') el.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  const add = (child) => {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(add);
    else el.append(child instanceof Node ? child : String(child));
  };
  children.forEach(add);
  return el;
}

/** Clamps `v` to [min, max]. */
export const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);

/** Linear interpolation: a at t = 0, b at t = 1. */
export const lerp = (a, b, t) => a + (b - a) * t;

/** Where `v` sits between a and b, as 0…1 (not clamped). */
export const invlerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));

/** Maps `v` from [a, b] to [c, d]; clamped to [c, d] unless `clampIt` is false. */
export function mapRange(v, a, b, c, d, clampIt = true) {
  const t = invlerp(a, b, v);
  return lerp(c, d, clampIt ? clamp(t) : t);
}

/** Hermite smoothstep: 0 below e0, 1 above e1, smooth in between. */
export function smoothstep(e0, e1, x) {
  const t = clamp(invlerp(e0, e1, x));
  return t * t * (3 - 2 * t);
}

/** The no-break space the app groups thousands with (a thin space has no advance in the display face). */
export const NBSP = ' ';

/**
 * Whole number with thousands grouped by a no-break space and a real minus sign: 7415 → "7 415",
 * −30 → "−30". Same as the app's src/i18n/number.ts, so numbers read the same in both.
 */
export function formatNumber(n) {
  const r = Math.round(Number(n) || 0);
  const digits = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return r < 0 ? `−${digits}` : digits;
}

/** Deterministic PRNG (mulberry32, the app's TornEdge one): same seed, same sequence. Returns () → 0…1. */
export function prng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
