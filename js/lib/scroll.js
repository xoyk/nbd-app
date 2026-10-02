// The scroll engine: one requestAnimationFrame per scroll frame for the whole page.
//
// - Pinned sections (<section data-pin="4.2"> with a sticky .pin stage) get progress p = clamp((scrollY − top) /
//   (height − stage height), 0, 1) every frame while they are near the viewport, from cached geometry
//   (re-measured on resize, font and image loads, and any change of the page's height).
// - Sections initialise lazily and off the critical path: the module is fetched when the section is within three
//   viewports (at idle), init runs at idle once it is within 1.5 viewports, and at once if it gets within one
//   viewport first (or on goto). The first progress()/enter() runs in a task of its own after init.
// - enter() / leave() when a section starts / stops intersecting the viewport.
// - `vh` is the small viewport height (100svh, from a probe element): it does not jump while a phone browser's
//   toolbar slides in and out, so track thresholds and goto targets stay put. Only the maximum scroll uses the
//   live innerHeight.
// - The page's overall progress: `page` (0 at the top, 1 at the bottom of the document) and `story` — what the HUD
//   shows: 0 at the top, HUD_CAP (85 %) where the last pinned section (or the one marked data-hud-end) starts, 1 at
//   the end of its range. The scroll alone never fills the last 15 %: the finale's lights do (ctx.hud.lead).
// - goto(id, p): instant jump to a section at progress p; resolves after the section is initialised and two
//   frames have painted (what the QA camera waits for). anchor() / restore(anchor): where the visitor is, as
//   { id, p } (pinned) or { id, f } (fraction of an unpinned section above the line just under the chrome), and
//   back there on another geometry — the
//   language switch carries it to the other page, and a rotation (a resize that changes the width) keeps it.
// - A shared ticker: ticker.subscribe(fn(dt, now)) → unsubscribe. It runs only while someone is subscribed,
//   in the same frame as the scroll work, so sections never run their own rAF loops.
// - track(el, fn, { enter, exit }): scrubbed progress of any element in normal flow as it crosses the viewport.
//   Any number of tracks per element, section roots included. A track is measured before it is first reported
//   (also when it was registered by a section's init inside goto), then reported whenever its p changes.
//
// Frame order: measure (if needed) → onFrame({ early }) listeners → pinned sections' progress(p) → tracks →
// onFrame listeners → onFrame({ late }) listeners (the HUD) → ticker subscribers.

import { clamp } from './dom.js';

/** The share of the HUD the scroll fills by itself before the last pinned section (the finale) starts. */
export const HUD_CAP = 0.85;

/** A new task, so a long piece of work can be split: scheduler.yield() where it exists, else a timeout. */
export const yieldTask = () =>
  typeof globalThis.scheduler?.yield === 'function' ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A User Timing measure from `start` (performance.now()) to now, named `nbd:<what>:<section id>`: the QA camera
 * (shoot.mjs --trace) names the section behind a long task with these. Costs next to nothing; never throws.
 */
export function measureSince(name, start) {
  try {
    performance.measure(name, { start, end: performance.now() });
  } catch {
    /* no User Timing L3 */
  }
}

/**
 * fn() when the main thread is idle (requestIdleCallback with a timeout), or — Safari has none — in a task right
 * after the next frame, which leaves it the most room before the frame after.
 */
export function whenIdle(fn, timeout = 600) {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => fn(), { timeout });
  else requestAnimationFrame(() => setTimeout(fn, 0));
}

export function createScroll() {
  const sections = [];
  const byId = new Map();
  const tracks = new Set();
  const earlyListeners = new Set();
  const frameListeners = new Set();
  const lateListeners = new Set();
  const ticks = new Set();

  let y = window.scrollY;
  let prevY = y;
  let vh = window.innerHeight;
  let docH = document.documentElement.scrollHeight;
  let page = 0;
  let story = 0;
  let storyEnd = 1; // scroll position (px) at which `story` reaches 1
  let storyBreak = 1; // … and HUD_CAP (where the end section's p is 0)
  let storyCap = 1; // HUD_CAP when there is an end section, else 1
  let dirty = true;
  let needsMeasure = true;
  let rafId = 0;
  let lastNow = 0;
  // A rotation keeps the visitor's place: the anchor taken before the width changed, re-applied for a moment.
  let lastW = window.innerWidth;
  let keep = null;
  let keepUntil = 0;

  // 100svh, measured: the small viewport does not change while a phone's toolbar slides in and out.
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:100vh;height:100svh;visibility:hidden;pointer-events:none';
  (document.body || document.documentElement).appendChild(probe);

  // ---------------------------------------------------------------- frame loop

  function schedule() {
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function loop(now) {
    rafId = 0;
    const dt = lastNow ? Math.min(100, now - lastNow) : 1000 / 60;
    lastNow = now;
    if (needsMeasure) measureNow();
    if (dirty) {
      dirty = false;
      update();
    }
    for (const fn of ticks) {
      try {
        fn(dt, now);
      } catch (error) {
        ticks.delete(fn);
        console.error('[ticker] a subscriber threw and was removed', error);
      }
    }
    if (ticks.size) schedule();
    else lastNow = 0;
  }

  // ---------------------------------------------------------------- geometry

  function measureNow() {
    needsMeasure = false;
    const sy = window.scrollY;
    vh = probe.offsetHeight || window.innerHeight;
    docH = document.documentElement.scrollHeight;
    readLine = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 108) + 4;
    for (const s of sections) {
      const r = s.el.getBoundingClientRect();
      s.top = r.top + sy;
      s.height = r.height;
      s.stageH = s.stage ? s.stage.offsetHeight || vh : vh;
    }
    for (const t of tracks) measureTrack(t, sy);
    measureStory();
    dirty = true;
    // Rotated: back to the same place in the same section on the new geometry (for a moment, as the layout settles).
    if (keep && performance.now() < keepUntil && !document.documentElement.classList.contains('page-locked')) {
      const target = Math.round(targetOf(keep));
      if (Number.isFinite(target) && Math.abs(target - window.scrollY) > 1) window.scrollTo(0, target);
    } else {
      keep = null;
    }
  }

  /** Largest scroll position (the live viewport, which may be taller than vh while a toolbar is away). */
  const maxScroll = () => Math.max(1, docH - window.innerHeight);

  function measureTrack(t, sy = window.scrollY) {
    const r = t.el.getBoundingClientRect();
    t.top = r.top + sy;
    t.height = r.height;
    // An element that is not rendered (display: none) has no geometry: it waits for the next measure.
    t.measured = r.width > 0 || r.height > 0 || t.el.getClientRects().length > 0;
  }

  /** Where the story ends: the section marked data-hud-end, else the last pinned section (end of its pin). */
  function measureStory() {
    const max = maxScroll();
    let end = null;
    for (const s of sections) {
      if (s.el.hasAttribute('data-hud-end')) {
        end = s;
        break;
      }
      if (s.pinned && (!end || s.top >= end.top)) end = s;
    }
    storyEnd = end ? clamp(end.top + rangeOf(end), 1, max) : max;
    storyBreak = end ? clamp(end.top, 1, storyEnd) : storyEnd;
    storyCap = end && storyBreak < storyEnd ? HUD_CAP : 1;
  }

  /** The HUD's scroll part at `at`: 0 → HUD_CAP up to where the end section starts, then → 1 over its range. */
  function storyOf(at) {
    if (at <= storyBreak) return storyCap * clamp(at / storyBreak);
    return clamp(storyCap + (1 - storyCap) * ((at - storyBreak) / Math.max(1, storyEnd - storyBreak)));
  }

  /** Re-measure on the next frame (call after a section changes its own height). */
  function measure() {
    needsMeasure = true;
    dirty = true;
    schedule();
  }

  /** Scroll length (px) over which a section's p runs from 0 to 1. */
  const rangeOf = (s) => (s.pinned ? Math.max(0, s.height - s.stageH) : Math.max(0, s.height - vh));
  const progressOf = (s, at = y) => clamp((at - s.top) / Math.max(1, rangeOf(s)));
  const trackProgress = (t, at = y) => {
    // p = 0 when the element's top is at `enter` × vh; p = 1 when its bottom is at `exit` × vh.
    const start = t.top - vh * t.enter;
    const end = t.top + t.height - vh * t.exit;
    return clamp((at - start) / Math.max(1, end - start));
  };

  function safeCall(s, name, ...args) {
    const fn = s.handlers?.[name];
    if (typeof fn !== 'function' || s.failed) return;
    try {
      fn.apply(s.handlers, args);
    } catch (error) {
      s.failed = true;
      console.error(`[section ${s.id}] ${name}() threw — the section is switched off`, error);
    }
  }

  function update() {
    y = window.scrollY;
    const dy = y - prevY;
    prevY = y;
    page = clamp(y / maxScroll());
    story = storyOf(y);
    const info = { y, vh, dy, page, story };
    for (const fn of earlyListeners) callListener(fn, info);
    for (const s of sections) {
      if (!s.handlers || !s.pinned) continue;
      if (!s.near && !s.settle) continue;
      s.settle = false;
      const p = progressOf(s);
      if (Math.abs(p - s.lastP) < 1e-5) continue;
      s.lastP = p;
      safeCall(s, 'progress', p);
    }
    // Tracks: p from cached geometry for every measured track, reported only when it changes — so a track far
    // from the screen costs a subtraction, a jump past it still lands it at 0 or 1, and one that has not been
    // measured yet (registered since the last measure) waits for its geometry instead of reporting top = 0.
    for (const t of tracks) {
      if (!t.measured) continue;
      const p = trackProgress(t);
      if (Math.abs(p - t.lastP) < 1e-5) continue;
      t.lastP = p;
      try {
        t.fn(p);
      } catch (error) {
        tracks.delete(t);
        console.error('[scroll.track] callback threw and was removed', error);
      }
    }
    for (const fn of frameListeners) callListener(fn, info);
    for (const fn of lateListeners) callListener(fn, info);
  }

  function callListener(fn, info) {
    try {
      fn(info);
    } catch (error) {
      console.error('[scroll] listener threw', error);
    }
  }

  // ---------------------------------------------------------------- observers

  // Soon (three viewports): fetch the module at idle. Init (1.5 viewports): run init at idle. Near (one viewport):
  // init now if it has not run yet, and per-frame progress while near.
  const soonIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const s = entry.target.__nbdSection;
        if (!s || !entry.isIntersecting || s.prefetched) continue;
        s.prefetched = true;
        if (s.prefetch) whenIdle(() => Promise.resolve(s.prefetch()).catch(() => {}), 1500);
      }
    },
    { rootMargin: '300% 0px 300% 0px' },
  );
  const initIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const s = entry.target.__nbdSection;
        if (!s || !entry.isIntersecting || s.ready || s.queued) continue;
        s.queued = true;
        whenIdle(() => initSection(s), 500);
      }
    },
    { rootMargin: '150% 0px 150% 0px' },
  );
  const nearIO = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const s = entry.target.__nbdSection;
        if (!s) continue;
        s.near = entry.isIntersecting;
        if (!s.near) s.settle = true; // one last call so it rests at 0 or 1
        if (s.near) initSection(s);
      }
      dirty = true;
      schedule();
    },
    { rootMargin: '100% 0px 100% 0px' },
  );
  // In view: enter() / leave().
  const viewIO = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const s = entry.target.__nbdSection;
      if (!s) continue;
      s.visible = entry.isIntersecting;
      if (s.handlers) safeCall(s, s.visible ? 'enter' : 'leave');
    }
  });

  window.addEventListener(
    'scroll',
    () => {
      dirty = true;
      schedule();
    },
    { passive: true },
  );
  window.addEventListener(
    'resize',
    () => {
      // A width change (a rotation, a desktop window) keeps the place; a height-only one (a phone's toolbar) just
      // re-measures (vh is the small viewport, so nothing jumps).
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        const now = performance.now();
        if (!keep || now > keepUntil) keep = anchorAt(y); // from the last frame's geometry, before the new layout
        keepUntil = now + 700;
      }
      measure();
    },
    { passive: true },
  );
  window.addEventListener('load', measure);
  document.fonts?.ready?.then(measure);
  document.addEventListener('load', (e) => e.target?.tagName === 'IMG' && measure(), true);
  if ('ResizeObserver' in window) {
    let lastH = 0;
    new ResizeObserver(() => {
      const h = document.documentElement.scrollHeight;
      if (h !== lastH) {
        lastH = h;
        measure();
      }
    }).observe(document.body);
  }

  // ---------------------------------------------------------------- sections

  /**
   * Registers a section: { id, el, pinned, stage, init: () => Promise<handlers|null> }.
   * `init` is called once, when the section first comes near the viewport (or on goto).
   */
  function addSection({ id, el, pinned = false, stage = null, init, prefetch = null }) {
    const s = { id, el, pinned, stage, init, prefetch, handlers: null, ready: null, queued: false, prefetched: false, near: false, visible: false, settle: false, failed: false, lastP: -1, top: 0, height: 0, stageH: vh };
    el.__nbdSection = s;
    sections.push(s);
    byId.set(id, s);
    soonIO.observe(el);
    initIO.observe(el);
    nearIO.observe(el);
    viewIO.observe(el);
    measure();
    return s;
  }

  function initSection(s) {
    if (s.ready) return s.ready;
    s.ready = Promise.resolve()
      .then(() => s.init?.())
      .then(async (handlers) => {
        if (!handlers) return null;
        // The first paint of the section's state in a task of its own: init and first frame never add up to one
        // long task in the middle of a scroll.
        await yieldTask();
        const t0 = performance.now();
        s.handlers = handlers;
        // First paint of the section's state: progress at once (pinned), enter if already on screen.
        // (the live scroll position: inside goto the cached one is still the old place)
        if (s.pinned) {
          s.lastP = progressOf(s, window.scrollY);
          safeCall(s, 'progress', s.lastP);
        }
        if (s.visible) safeCall(s, 'enter');
        measureSince(`nbd:first:${s.id}`, t0);
        return s.handlers;
      });
    return s.ready;
  }

  /** Where the visitor is at scroll position `at`: { id, p } in a pinned section, { id, f } (the fraction of the
   *  section above the top of the viewport) in any other, { page } past the last section. */
  // The line that says where the visitor is: just under the fixed chrome (top bar + HUD: the page's
  // scroll-padding-top, measured), not the viewport's very top, which the chrome covers and where a focus or anchor
  // jump leaves the end of the previous section.
  let readLine = 112;
  function anchorAt(at = y) {
    const line = at + readLine;
    let hit = null;
    for (const s of sections) if (s.height > 0 && s.top <= line) hit = s;
    if (hit && line < hit.top + hit.height) {
      return hit.pinned ? { id: hit.id, p: progressOf(hit, at) } : { id: hit.id, f: clamp((line - hit.top) / Math.max(1, hit.height)) };
    }
    return { page: clamp(at / maxScroll()) };
  }

  /** The scroll position of an anchor on the current geometry. */
  function targetOf(a) {
    const s = a?.id ? byId.get(a.id) : null;
    if (s) {
      if (s.pinned && Number.isFinite(a.p)) return s.top + clamp(a.p) * rangeOf(s);
      if (Number.isFinite(a.f)) return Math.max(0, s.top + clamp(a.f) * s.height - readLine);
      if (Number.isFinite(a.p)) return s.top + clamp(a.p) * rangeOf(s);
    }
    return clamp(Number(a?.page) || 0) * maxScroll();
  }

  /** Jumps to `target()` (re-evaluated once the section has initialised and changed its geometry). */
  async function jump(s, target) {
    measureNow();
    let to = Math.round(target());
    window.scrollTo(0, to); // two-argument form: instant (the page never sets smooth scrolling)
    if (s) await initSection(s);
    // The init may have changed the section's height and registered tracks: measure them before anything is
    // reported, and land on the same place of the new geometry.
    measureNow();
    if (Math.round(target()) !== to) {
      to = Math.round(target());
      window.scrollTo(0, to);
    }
    dirty = true;
    update();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  /**
   * Jumps (no smooth scrolling) to section `id` at progress `p`: for a pinned section p runs over its sticky
   * range; for any other, p = 0 puts its top at the top of the viewport and p = 1 its bottom at the bottom.
   * Resolves after the section has initialised and two frames have painted.
   */
  async function goto(id, p = 0) {
    const s = byId.get(id);
    if (!s) throw new Error(`NBD.goto: no section "${id}" (have: ${[...byId.keys()].join(', ') || 'none'})`);
    await jump(s, () => s.top + clamp(p) * rangeOf(s));
    return { id, p: s.pinned ? progressOf(s, window.scrollY) : clamp(p), y: window.scrollY };
  }

  /** Back to an anchor from anchor() (this page or the other language's): initialises its section first. */
  async function restore(a) {
    const s = a?.id ? byId.get(a.id) : null;
    await jump(s, () => targetOf(a));
    return { ...anchorAt(window.scrollY), y: window.scrollY };
  }

  // ---------------------------------------------------------------- public

  const ticker = {
    /** fn(dt ms (capped at 100), now ms) every frame until unsubscribed. Returns the unsubscribe. */
    subscribe(fn) {
      ticks.add(fn);
      schedule();
      return () => ticks.delete(fn);
    },
    get size() {
      return ticks.size;
    },
  };

  const api = {
    /** Current scroll position (px). */
    get y() {
      return y;
    },
    /** Viewport height (px): the small viewport (100svh), steady while a phone's toolbar slides in and out. */
    get vh() {
      return vh;
    },
    /** Page progress, 0 at the top, 1 at the bottom of the document. */
    get page() {
      return page;
    },
    /**
     * Story progress — what the HUD shows: 0 at the top, HUD_CAP (0.85) where the last pinned section (the finale)
     * or the section marked data-hud-end starts, 1 at the end of its range; it stays at 1 over the footer.
     */
    get story() {
      return story;
    },
    /** The story progress at scroll position `at` (px). */
    storyAt(at) {
      return storyOf(at);
    },
    goto,
    /** Where the visitor is now: { id, p } (pinned), { id, f } (unpinned: fraction above the viewport top), { page }. */
    anchor() {
      return anchorAt(window.scrollY);
    },
    /** Back to an anchor (from anchor(), here or on the other language's page). Resolves like goto. */
    restore,
    measure,
    /** Current progress of a section, 0…1 (pinned: over its sticky range). */
    progressOf(id) {
      const s = byId.get(id);
      return s ? progressOf(s, window.scrollY) : 0;
    },
    /**
     * Scroll positions (px, cached geometry) where section `id`'s p is 0 and 1: { start, end }, or null.
     * For a pinned section, start = its top at the top of the viewport, end = the end of its sticky range.
     */
    rangeOf(id) {
      const s = byId.get(id);
      return s ? { start: s.top, end: s.top + rangeOf(s) } : null;
    },
    /** Cached box of section `id` in page px: { top, bottom, height }, or null. */
    boxOf(id) {
      const s = byId.get(id);
      return s ? { top: s.top, bottom: s.top + s.height, height: s.height } : null;
    },
    /**
     * Scrubbed progress of an element in normal flow (not inside a sticky stage) as it crosses the viewport:
     * p = 0 when its top is at `enter` × viewport height (default 1: the bottom edge), p = 1 when its bottom is
     * at `exit` × viewport height (default 0: the top edge). fn(p) once its geometry is measured (the next
     * frame, or inside goto before goto reports anything), then on every scroll frame in which p changes —
     * so it rests at 0 or 1 once the element is past, even after a jump. Any number of tracks per element;
     * a section root works too. Returns an unsubscribe.
     */
    track(el, fn, { enter = 1, exit = 0 } = {}) {
      const t = { el, fn, enter, exit, measured: false, lastP: -1, top: 0, height: 0 };
      tracks.add(t);
      measure();
      return () => {
        tracks.delete(t);
      };
    },
    /**
     * fn({ y, vh, dy, page, story }) on every scroll frame, after the sections' progress and the tracks.
     * { early: true }: before them (layout is still clean: read geometry there). { late: true }: after every
     * other listener. Returns an unsubscribe.
     */
    onFrame(fn, { early = false, late = false } = {}) {
      const set = early ? earlyListeners : late ? lateListeners : frameListeners;
      set.add(fn);
      dirty = true;
      schedule();
      return () => set.delete(fn);
    },
  };

  return { api, ticker, addSection, initSection, goto, restore, measure };
}
