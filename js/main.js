// Boot: language, reduced motion, sound, the scroll engine, the chrome (top bar, HUD) and the sections.
//
// ───────────────────────────────────────────────────────────── how a section plugs in
// Markup (site/_src/sections/<id>.html):
//   <section class="s s-<id>" id="<id>" data-section="<id>" data-pin="4">   ← data-pin only when pinned
//     <div class="pin"> … the sticky stage, 100svh … </div>                  ← only when pinned
//   </section>
//   data-nojs           the section has no module (nothing is requested)
//   data-module="url"   load another module (dev pages / QA); default js/sections/<id>.js
//   data-surface="paper|grip"  what the top bar sees under it (a .paper half the viewport wide or more counts as
//                       paper); the bar flips to ink
//   data-hud-end        the HUD reaches 100 % at the end of this section (default: the last pinned section)
//   data-hud-from="0.17"  the HUD stays hidden until this section's p gets there (default: the first section at
//                       0.17, when the hero's poster has ripped)
//   .s-pad-top          content under the fixed chrome: safe area + top bar + HUD + 20 px
//
// Module (site/js/sections/<id>.js): fetched at idle within three viewports, initialised at idle within 1.5 and at
// once within one viewport (or on NBD.goto):
//   export default function init(root, ctx) {          // may be async; split long work with await ctx.yield()
//     return {
//       progress(p) {},  // pinned only: every scroll frame while near the viewport, p 0…1, plus once at init
//                        // and once when it leaves (so it rests at 0 or 1). Write transforms/opacity only.
//       enter() {},      // started intersecting the viewport (start ticker subscriptions here)
//       leave() {},      // stopped intersecting (stop them here)
//     };
//   }
// A module that fails to load or throws is logged and switched off; the rest of the page carries on.
//
// ctx = {
//   id, root, lang ('en' | 'ru'), base ('./' or '../': prefix for site files), asset(path) → base + path,
//   reduced (live boolean), onReducedChange(fn) → off,
//   t(key, vars)        the section's own strings: _src/i18n/<id>.json → "js" object. {name} interpolation,
//                       numbers grouped as in the app (7 415), plural objects { one, few, many, other } by vars.n
//   i18n                every namespace: i18n.t('site.soundOn'), i18n.plural(n, forms), i18n.format(n)
//   data(name)          cached fetch of assets/data/<name>.json → Promise (achievements, ranks, quests,
//                       segments, screens, map…)
//   sound               play(name, { rate, volume }) · ladder(k) · roll(level01) · enabled · ready · onChange(fn)
//   motion              animate(el, keyframes|fn, { duration, easing, spring, delay }) · slam · pop · shake ·
//                       countUp · sleep · frame · ease.* (JS curves) · springEasing · springKeyframes · SPRINGS
//   scroll              y · vh (100svh) · page · story · goto(id, p) · anchor() · restore(a) · track(el, fn(p),
//                       { enter, exit }) → off (any number per element, section roots too) · onFrame(fn({ y, vh,
//                       dy, page, story }), { early, late }) → off · measure() · progressOf(id) · rangeOf(id) →
//                       { start, end } px · boxOf(id) → { top, bottom, height } px · storyAt(y)
//   ticker              subscribe(fn(dt, now)) → unsubscribe. One shared rAF; runs only while subscribed.
//   yield()             → Promise: a new task (scheduler.yield or a timeout) — await it between the steps of a
//                       long init (DOM, data, map, first render) so none of them lands as one long task mid-scroll
//   hud                 the page HUD (LIT % · 10 cells). It follows scroll.story: 85 % where the finale starts,
//                       100 % at the end of its range; lead(f) shows max(scroll, f) while a section drives it
//                       ahead (the finale's lights take it 85 → 100), lead(null) / release() hands it back ·
//                       range(id?) → { start, end } HUD fractions of a section's p 0 and 1 · value · scroll
//   lockPage({ keep, scrollable }) → unlock    page lock for an overlay (iOS-safe: overflow hidden + stable
//                       gutter, the rest inert, touch/wheel guarded, exact scroll restore); unlockPage() releases
//                       this section's latest lock; pageLocked
//   icons / icon        icon(name, { size, stroke, label }) → SVG markup; icons.names; icons.hydrate(root)
//   dom                 $, $$, h, clamp, lerp, invlerp, mapRange, smoothstep, formatNumber, prng
// }
//
// window.NBD = { goto(id, p), addSection(el), sound, sections, lang, base, reduced, motion, scroll, ticker,
//                i18n, data, icons, hud, pageLock } — NBD.goto is what scripts/site/shoot.mjs --eval uses to frame
//                a picture.

import { $, $$, clamp } from './lib/dom.js';
import * as dom from './lib/dom.js';
import { createI18n } from './lib/i18n.js';
import { icon, iconNames, hydrateIcons } from './lib/icons.js';
import { createPageLock } from './lib/lock.js';
import * as motion from './lib/motion.js';
import { createScroll, measureSince, yieldTask } from './lib/scroll.js';
import { createSound } from './lib/sound.js';

const html = document.documentElement;
const lang = window.NBD_LANG || html.lang || 'en';
const base = window.NBD_BASE || './';
const I18N = window.NBD_I18N || {};
const i18n = createI18n(lang, I18N, 'site');
const site = createI18n(lang, I18N.site || {}, 'site');

html.classList.remove('no-js');
html.classList.add('js');

// ---------------------------------------------------------------- reduced motion (live)

const syncReduced = () => html.classList.toggle('reduced', motion.isReduced());
syncReduced();
motion.onReducedChange(syncReduced);

// ---------------------------------------------------------------- services

const sound = createSound({ base });
const engine = createScroll();
const scroll = engine.api;
const ticker = engine.ticker;
const pageLock = createPageLock();

const dataCache = new Map();
/** Cached fetch of assets/data/<name>.json → Promise<object>. */
function data(name) {
  if (!dataCache.has(name)) {
    dataCache.set(
      name,
      fetch(`${base}assets/data/${name}.json`).then((response) => {
        if (!response.ok) throw new Error(`data(${name}): HTTP ${response.status}`);
        return response.json();
      }),
    );
  }
  return dataCache.get(name);
}

const icons = { icon, names: iconNames, hydrate: hydrateIcons };

// ---------------------------------------------------------------- sections

const sections = {};

function makeCtx(entry) {
  const own = createI18n(lang, I18N[entry.id] || {}, entry.id);
  const locks = [];
  return {
    id: entry.id,
    root: entry.root,
    lang,
    base,
    /** Live: true while the visitor prefers reduced motion. */
    get reduced() {
      return motion.isReduced();
    },
    /** fn(reduced) whenever the preference changes; returns an unsubscribe. */
    onReducedChange: motion.onReducedChange,
    /** The section's own js strings (i18n/<id>.json → js). */
    t: own.t,
    i18n,
    sound,
    motion,
    data,
    icons,
    icon,
    scroll,
    ticker,
    dom,
    /** A new task: await it between the steps of a long init. */
    yield: yieldTask,
    /** The page HUD, led by this section: see hudFor(). */
    hud: hudFor(entry.id),
    /**
     * Locks the page under an overlay: { keep: element(s) that stay live, scrollable: element(s) inside them
     * that may still scroll }. Returns the unlock. See js/lib/lock.js.
     */
    lockPage(options) {
      const unlock = pageLock.lock(options);
      locks.push(unlock);
      return () => {
        const i = locks.indexOf(unlock);
        if (i >= 0) locks.splice(i, 1);
        unlock();
      };
    },
    /** Releases this section's most recent page lock (no-op without one). */
    unlockPage() {
      locks.pop()?.();
    },
    /** True while any section holds the page lock. */
    get pageLocked() {
      return pageLock.locked;
    },
    /** URL of a site file from this page: ctx.asset('assets/img/screens/01-map-540.webp'). */
    asset: (path) => `${base}${path}`,
  };
}

/** The section's module URL: data-module="<url>" (dev pages, QA) or js/sections/<id>.js. */
const moduleUrl = (entry) =>
  entry.root.dataset.module ? new URL(entry.root.dataset.module, document.baseURI).href : new URL(`./sections/${entry.id}.js`, import.meta.url).href;

async function loadSection(entry) {
  if ('nojs' in entry.root.dataset) {
    entry.status = 'static';
    return null;
  }
  entry.status = 'loading';
  let mod;
  try {
    mod = await import(moduleUrl(entry));
  } catch (error) {
    entry.status = 'failed';
    entry.error = error;
    if (error instanceof SyntaxError) console.error(`[section ${entry.id}] module does not parse`, error);
    else console.info(`[section ${entry.id}] no module (${error.message}) — add data-nojs if that is intended`);
    return null;
  }
  const init = mod.default ?? mod.init;
  if (typeof init !== 'function') {
    entry.status = 'static';
    return null;
  }
  // Fetching and evaluating the module and running its init are two tasks, not one.
  await yieldTask();
  const t0 = performance.now();
  try {
    entry.handlers = (await init(entry.root, makeCtx(entry))) || {};
    measureSince(`nbd:init:${entry.id}`, t0); // the QA camera names a long task's section by these
    entry.status = 'ready';
    entry.root.classList.add('is-live');
    watchSurfaces(entry.root); // paper the init may have added
    return entry.handlers;
  } catch (error) {
    entry.status = 'failed';
    entry.error = error;
    console.error(`[section ${entry.id}] init threw — the section stays static`, error);
    return null;
  }
}

/** Registers a [data-section] element (all of them are registered at boot; dev pages may add more later). */
function addSection(root) {
  const id = root.dataset.section;
  if (!id || sections[id]) return sections[id];
  if (root.dataset.pin) root.style.setProperty('--pin', root.dataset.pin);
  const entry = { id, root, status: 'idle', handlers: null, error: null };
  sections[id] = entry;
  engine.addSection({
    id,
    el: root,
    pinned: root.hasAttribute('data-pin'),
    stage: root.querySelector(':scope > .pin'),
    init: () => loadSection(entry),
    // Fetched (and evaluated) at idle a few viewports ahead, so its init does not wait for the network.
    prefetch: () => ('nojs' in root.dataset ? null : import(moduleUrl(entry)).catch(() => null)),
  });
  return entry;
}

// ---------------------------------------------------------------- top bar

const topbar = $('.topbar');
const hud = $('.hud');
const firstSection = $('[data-section]');

/** Sets or removes a boolean data attribute, touching the DOM only on a change. */
function flag(el, name, on) {
  if (el && el.hasAttribute(name) !== on) el.toggleAttribute(name, on);
}
function setData(el, name, value) {
  if (el && el.dataset[name] !== value) el.dataset[name] = value;
}

// Language links. The build marks the page's own one (aria-current); this is the fallback for dev pages.
// Switching language keeps the place: the link carries the section as #id (the other page lands on it with or
// without JS) and sessionStorage carries { id, p } for the exact spot, restored after load. The choice is
// remembered (localStorage nbd.lang): the page's inline script sends a later visit to the chosen language.
// The page's own language is a link too (the pair reads as one control), but tapping it does nothing: no reload,
// no lost place (EN and RU are 44 px boxes 4 px apart, so it is an easy mis-tap).
const RESUME_KEY = 'nbd.resume';
const LANG_KEY = 'nbd.lang';
/** A plain left click: not one that opens a new tab or window. */
const plainClick = (e) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
for (const a of $$('[data-lang-link]')) {
  const target = a.getAttribute('hreflang');
  if (target === lang) a.setAttribute('aria-current', 'page');
  a.addEventListener('click', (e) => {
    try {
      localStorage.setItem(LANG_KEY, target);
    } catch {
      /* blocked storage: the switch still works for this visit */
    }
    if (target === lang) {
      if (plainClick(e)) e.preventDefault();
      return;
    }
    const at = scroll.anchor();
    if (!at.id) return;
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ ...at, t: Date.now() }));
    } catch {
      /* the hash alone still lands on the section */
    }
    a.setAttribute('href', `${a.getAttribute('href').split('#')[0]}#${at.id}`); // read by the navigation that follows
  });
}

// The wordmark ("NBD., back to the top") goes to the top of this page and never navigates: no language switch, no
// reload, nothing replayed or reset (the poster reassembles as the hero scrolls back, sound stays unlocked).
// Its href="#top" is the HTML spec's top of the document, so it works without JS too; with JS the jump is instant
// (smooth scrolling through 24 viewports would wake every section on the way) and leaves no #top in the address.
$('[data-to-top]')?.addEventListener('click', (e) => {
  if (!plainClick(e)) return;
  e.preventDefault();
  if (pageLock.locked) return;
  window.scrollTo(0, 0);
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search);
});

// Sound toggle: a stable name ("Sound") with aria-pressed for the state, so a screen reader never hears the
// state twice; the visible capsule label is the same word.
const soundButton = $('[data-sound-toggle]');
function renderSound(state = sound.state) {
  if (!soundButton) return;
  soundButton.setAttribute('aria-pressed', String(state.enabled && state.available));
  soundButton.setAttribute('aria-label', state.available ? site.t('sound') : site.t('soundUnavailable'));
  soundButton.dataset.state = !state.available ? 'unavailable' : state.enabled ? (state.status === 'loading' ? 'loading' : 'on') : 'off';
  if (!state.available) soundButton.setAttribute('aria-disabled', 'true');
  else soundButton.removeAttribute('aria-disabled');
  const text = soundButton.querySelector('[data-sound-label]');
  if (text) text.textContent = state.available ? site.t('sound') : site.t('soundNone');
}
soundButton?.addEventListener('click', () => {
  if (!sound.available && sound.status === 'unavailable') return;
  // toggle() resolves once the context is running and the sounds are decoded: the confirmation plays for real.
  sound.toggle().then(() => {
    if (sound.enabled) sound.play('select');
  });
  renderSound();
});

// iPhone and iPad: the ring/silent switch mutes web audio (the page asks for an 'ambient' session, like the app,
// so it mixes with the visitor's music) and no page can read the switch. So whenever sound comes on there, a tag
// under the chrome says it plainly for a few seconds.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let hint = null;
let hintTimer = 0;
function showSilentHint() {
  if (!hint) {
    hint = document.createElement('p');
    hint.className = 'snd-hint';
    hint.setAttribute('role', 'status');
    hint.hidden = true;
    document.body.appendChild(hint);
  }
  clearTimeout(hintTimer);
  hint.classList.toggle('snd-hint--high', !hudShown); // right under the bar while the HUD is not there
  hint.hidden = false;
  requestAnimationFrame(() => {
    if (hint) hint.textContent = site.t('soundSilent'); // after it is shown, so the live region announces it
  });
  hintTimer = setTimeout(hideSilentHint, 4200);
}
function hideSilentHint() {
  clearTimeout(hintTimer);
  if (hint) hint.hidden = true;
}
let soundWasOn = sound.enabled && sound.available;
sound.onChange((state) => {
  renderSound(state);
  const on = state.enabled && state.available;
  if (on && !soundWasOn && IOS) showSilentHint();
  if (!on) hideSilentHint();
  soundWasOn = on;
});
renderSound();

// What lies under the bar: one IntersectionObserver whose root is a 1 px band at the bar's probe line (where the
// bar rests, slid away or not), over every .paper / [data-surface] element — no per-frame hit test. The last
// surface in document order that crosses the band wins (a grip block inside a paper section beats its paper).
// data-surface always counts; a bare .paper counts when it spans at least half the viewport, so a paper card or a
// note never flips the bar. The state lives on the bar and the HUD (data-over), never on <html>.
const surfaces = new Map(); // element → { in, wide }
let surfaceIO = null;
let probeY = 32;
function pickSurface() {
  let best = null;
  for (const [el, s] of surfaces) {
    if (!s.in || !(s.wide || el.hasAttribute('data-surface'))) continue;
    if (!best || best.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) best = el;
  }
  const over = best ? best.dataset.surface || 'paper' : 'grip';
  setData(topbar, 'over', over);
  setData(hud, 'over', over);
}
function onSurfaces(entries) {
  for (const e of entries) {
    const s = surfaces.get(e.target);
    if (!s) continue;
    s.in = e.isIntersecting;
    s.wide = e.boundingClientRect.width >= window.innerWidth * 0.5;
  }
  pickSurface();
}
function buildSurfaceIO() {
  surfaceIO?.disconnect();
  probeY = Math.max(4, (topbar?.offsetHeight ?? 56) - 24);
  const below = Math.max(0, window.innerHeight - probeY - 1);
  surfaceIO = new IntersectionObserver(onSurfaces, { rootMargin: `-${probeY}px 0px -${below}px 0px` });
  for (const [el, s] of surfaces) {
    s.in = false;
    surfaceIO.observe(el);
  }
}
/** Starts watching the surfaces inside `root` (the page at boot; a section's root after its init). */
function watchSurfaces(root = document) {
  if (!topbar) return;
  for (const el of root.querySelectorAll('.paper, [data-surface]')) {
    if (surfaces.has(el) || el.closest('.topbar, .hud')) continue;
    surfaces.set(el, { in: false, wide: false });
    surfaceIO?.observe(el);
  }
}
if (topbar) {
  watchSurfaces(document);
  buildSurfaceIO();
  let resizeQueued = false;
  window.addEventListener(
    'resize',
    () => {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(() => {
        resizeQueued = false;
        buildSurfaceIO(); // the band is in px: a new viewport height moves its bottom margin
      });
    },
    { passive: true },
  );
}

// Hide the bar on the way down, bring it back on the way up (data-up on the bar and the HUD). Past the first
// section its scrim turns solid down to the HUD (data-solid).
let travel = 0;
const CHROME_TOP = 64;
function setChromeHidden(hidden) {
  flag(topbar, 'data-up', hidden);
  flag(hud, 'data-up', hidden);
}
scroll.onFrame(
  ({ y, dy }) => {
    if (firstSection && topbar) {
      const box = scroll.boxOf(firstSection.dataset.section);
      flag(topbar, 'data-solid', Boolean(box) && y + probeY + 24 > box.bottom);
    }
    if (y < CHROME_TOP) {
      travel = 0;
      setChromeHidden(false);
      return;
    }
    if (Math.sign(dy) !== Math.sign(travel)) travel = 0;
    travel += dy;
    if (travel > 32) setChromeHidden(true);
    else if (travel < -16) setChromeHidden(false);
  },
  { early: true },
);
// Keyboard users: focusing anything in the bar brings it back.
topbar?.addEventListener('focusin', () => setChromeHidden(false));

// ---------------------------------------------------------------- HUD

// The page as a map: LIT % and the 10 cells follow scroll.story — 0 at the top, 85 % where the finale starts,
// 100 % at the end of its range (and over the footer). A section may lead it ahead of the scroll (the finale does,
// with its lights, 85 → 100 %): the HUD shows the highest of the scroll and every lead. Written in a late frame
// listener and compared with what the DOM holds, so it always ends the frame showing that value.
// It is the visitor's progress through the page, not a count of tricks, so it shows no n/215. It stays hidden on
// the poster (a "LIT 0 %" over a lit map, competing with the strongest picture on the page) and slaps on when the
// story starts — when the gate section (data-hud-from, default the first section at the poster's rip) gets there.
// Reaching 100 % flashes it paper and bumps it (.is-hit, DESIGN §8.3).
const cells = hud ? $$('.spectrum__cell > b', hud) : [];
const pctEl = hud ? $('[data-hud-pct]', hud) : null;
const leads = new Map(); // section id → HUD fraction it leads to
const HUD_FROM = 0.17; // hero.js TL.tearEnd: the poster has ripped
const hudGate = $('[data-hud-from]') ?? firstSection;
const hudGateP = Number(hudGate?.dataset.hudFrom ?? HUD_FROM);
let hudShown = false;
let hudPct = -1;
function hudValue() {
  let f = scroll.story;
  for (const v of leads.values()) if (v > f) f = v;
  return clamp(f);
}
function renderHud() {
  if (!hud) return;
  const f = hudValue();
  let shown = true;
  if (hudGate) {
    const r = scroll.rangeOf(hudGate.dataset.section);
    if (r) shown = scroll.y >= r.start + clamp(hudGateP) * (r.end - r.start) - 0.5;
  }
  if (shown !== hudShown) {
    hudShown = shown;
    flag(hud, 'data-off', !shown);
  }
  for (let i = 0; i < cells.length; i++) {
    const v = `scaleX(${Math.round(clamp(f * cells.length - i) * 1000) / 1000})`;
    if (cells[i].style.transform !== v) cells[i].style.transform = v;
  }
  const pct = Math.round(f * 100);
  const pctText = `${pct}%`;
  if (pctEl && pctEl.textContent !== pctText) pctEl.textContent = pctText;
  if (hud.classList.contains('is-full') !== pct >= 100) hud.classList.toggle('is-full', pct >= 100);
  // The moment it fills (seen climbing, not on a load at the bottom of the page).
  if (pct >= 100 && hudPct >= 0 && hudPct < 100 && shown && !motion.isReduced()) {
    hud.classList.remove('is-hit');
    void hud.offsetWidth; // restart the animation if it is still running
    hud.classList.add('is-hit');
  }
  hudPct = pct;
}
hud?.addEventListener('animationend', (e) => {
  if (e.animationName === 'hud-hit') hud.classList.remove('is-hit');
});
scroll.onFrame(renderHud, { late: true });

/** ctx.hud for section `id`. */
function hudFor(id) {
  return {
    /** Shows max(scroll, f) until lead(null): f is a HUD fraction 0…1 (null / undefined / NaN hands it back). */
    lead(f) {
      if (f === null || f === undefined || !Number.isFinite(f)) leads.delete(id);
      else leads.set(id, clamp(f));
      renderHud();
    },
    /** Hands the HUD back to the scroll. */
    release() {
      if (leads.delete(id)) renderHud();
    },
    /** HUD fractions at which section `sectionId` (default: this one) is at p 0 and p 1: { start, end } or null. */
    range(sectionId = id) {
      const r = scroll.rangeOf(sectionId);
      return r ? { start: scroll.storyAt(r.start), end: scroll.storyAt(r.end) } : null;
    },
    /** What the HUD shows now (0…1). */
    get value() {
      return hudValue();
    },
    /** What the scroll alone would show (scroll.story). */
    get scroll() {
      return scroll.story;
    },
    /** This section's current lead, or null. */
    get leading() {
      return leads.has(id) ? leads.get(id) : null;
    },
  };
}

// ---------------------------------------------------------------- sections, registered

$$('[data-section]').forEach(addSection);

// Back from the other language: the browser has already jumped to #id (the section's top); once the page has
// loaded (so no fragment scroll follows), land on the exact spot — unless the visitor has scrolled meanwhile.
(function resumeAfterSwitch() {
  let r = null;
  try {
    r = JSON.parse(sessionStorage.getItem(RESUME_KEY) || 'null');
    sessionStorage.removeItem(RESUME_KEY);
  } catch {
    return;
  }
  if (!r || !r.id || Date.now() - (r.t || 0) > 60000 || location.hash !== `#${r.id}` || !sections[r.id]) return;
  let touched = false;
  const touch = () => {
    touched = true;
  };
  const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
  events.forEach((e) => window.addEventListener(e, touch, { passive: true, once: true }));
  const go = () => {
    events.forEach((e) => window.removeEventListener(e, touch));
    if (touched) return;
    engine.restore(r).then(() => {
      history.replaceState(history.state, '', location.pathname + location.search);
      travel = 0;
      setChromeHidden(false); // the visitor just used the bar: it stays in view
    });
  };
  if (document.readyState === 'complete') requestAnimationFrame(go);
  else window.addEventListener('load', () => requestAnimationFrame(go), { once: true });
})();

// ---------------------------------------------------------------- global hook

window.NBD = {
  version: 2,
  lang,
  base,
  /** NBD.goto(id, p): instant jump to a section at progress p; resolves after two painted frames. */
  goto: engine.goto,
  /** NBD.anchor() → where the visitor is ({ id, p } / { id, f }); NBD.restore(anchor) → back there. */
  anchor: () => scroll.anchor(),
  restore: engine.restore,
  /** Dev / QA: register a section element added after boot. */
  addSection,
  sound,
  sections,
  get reduced() {
    return motion.isReduced();
  },
  motion,
  scroll,
  ticker,
  i18n,
  data,
  icons,
  /** QA: the HUD — value (what it shows), story (the scroll's part), leads (section id → fraction). */
  hud: {
    get value() {
      return hudValue();
    },
    get story() {
      return scroll.story;
    },
    leads,
  },
  /** The page lock (lock({ keep, scrollable }) → unlock, unlock(), locked, onChange(fn)). */
  pageLock,
};

// The page's static markup may carry <i data-icon="name"> placeholders.
hydrateIcons(document);
