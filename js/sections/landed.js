// Section "landed" — Land it. Stamp it. The page's climax.
//
// On grip: one quiet line, the poster centred over the live map around Kickflip (learning, 47 tries), and the app's
// red [LANDED! +110 XP], poster-sized, right under the node. LANDED! is hold-to-confirm (DESIGN.md §6): 600 ms, a
// paper edge fills along the bottom, 8 rising ticks, the rolling bed speeds up; the map dims around Kickflip, its red
// pulse swells and the node trembles (map.focus / map.tremble), the button joins the tremble in the last 30 %. Let go
// early and it rolls back with a nudge and a "hold" tag — but only for a press that stayed put: a swipe that starts
// on the button scrolls the page (touch-action: pan-y) and the browser's pointercancel ends the hold silently.
// Pointer, Space / Enter held, and a plain activation from assistive tech (click with detail 0) all land it.
//
// Landing plays DESIGN.md §8.1 beat by beat in a full-viewport paper overlay (z = --z-overlay), timed from the hit:
//     0  hit-stop: everything freezes, one paper-white frame on the node (map.flash), `land`
//    80  hard cut to paper; KICKFLIP slams (spring slam) with one 3 px shake
//   380  the sticker drops 1.6 → 1 at −10° (spring pop)        560  contact: shadow snaps in, sparks, `sticker`
//   700  the stamp swings in (1.5 → 1, 90 ms ease-in)           790  the hit: `stamp`, 2 px recoil
//  1000  the ink XP block rises 12 px, +160 counts up, the rows type in (60 ms stagger)
//  1900  the level bar: 7 415 → 7 575 / 8 500 in yellow
//  2700  "14 opened": chips pop one by one, a `tick` each, a whole tone higher each
//  3500  ADD CLIP / SHARE / CONTINUE fade up
// A tap after 0.8 s settles it — a tap that starts on the paper: the finger still down from a long hold lifts onto
// the card without skipping anything. CONTINUE, the cross or Esc hard-cut back to the page at the same scroll
// position, where the map runs the unlock ripple (§8.2) with a rising tick per opened trick — framed between the
// title and the button, and on into the map under it (on a phone the button steps back while the heads run) — and,
// the first time, the real Landed screen slides in: beside the ripple on desktop, under the stage elsewhere once it
// comes into view. From then on the stage says landed: the map's label, no XP on the button, the line under it.
// The page is locked while the overlay is up: scrolling at once (one frame after the paper is on screen), the rest of
// the page made inert once the stamp has landed and the XP has counted up — the inert sweep restyles the whole
// document and must not land in the name's slam. Replayable: hold again.
//
// The first landing is announced to the rest of the page: `nbd:landed` on document, and data-landed on the section
// (for a section that initialises later). The session's kicker says "landed" only after it.

import { createMap, renderNodeSVG } from '../map/index.js';

const HOLD_MS = 600;
const HOLD_TICKS = 8;
/** A press has to stay this long — and the finger this long still — before the hold speaks up (ticks, dim, swell;
 *  the button and its edge answer at once). A swipe keeps moving until the browser takes it as a scroll and sends
 *  pointercancel, so it never gets to make a sound. */
const SLOP_MS = 150;
/** …and a release that moved further than this was not a press: no "hold" tag. */
const SLOP_PX = 10;
/** src/features/trick/TrickActions.tsx HOLD_ROLL: the bed's speed at the first tick. */
const ROLL_FROM = 0.25;
const SKIP_AFTER = 800;
/** Beats in ms from the hit (src/features/celebration/model.ts LANDED_BASE_MS). */
const T = { cut: 80, sticker: 380, contact: 560, stamp: 700, stampHit: 790, xp: 1000, bar: 1900, unlocked: 2700, actions: 3500 };
const COUNT_MS = 600;
const ROW_STAGGER = 60;
const BAR_MS = 800;
const CHIP_STAGGER = 80;
/** The invented progress of the store screenshots (preset "intermediate"). */
const XP = { total: 160, from: 7415, to: 7575, next: 8500 };
/** src/sound/mix.ts: ripple ticks climb a whole tone each, up to an octave. */
const toneUp = (i) => 2 ** (Math.min(2 * i, 12) / 12);
/** The map's grip around Kickflip during the hold: 1 − this = how bright the rest of the city stays (60 %). */
const HOLD_DIM = 0.4;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default async function init(root, ctx) {
  const { motion, sound, ticker } = ctx;
  const { $, $$, clamp, formatNumber } = ctx.dom;

  const mapEl = $('[data-ld-map]', root);
  const title = $('.ld__title', root);
  const charge = $('[data-ld-charge]', root);
  const dock = $('.ld__dock', root);
  const btn = $('[data-ld-hold]', root);
  const edge = $('[data-ld-edge]', root);
  const tip = $('[data-ld-tip]', root);
  const how = $('[data-ld-how]', root);
  const proof = $('[data-ld-proof]', root);
  const proofPhone = $('.ld__phone', proof);
  const proofCap = $('.ld__cap', proof);
  const proofImg = $('img', proof);
  const template = $('template[data-ld-overlay]', root);

  let visible = false;
  let isOpen = false;
  let hitOnce = false; // the visitor has landed it (the overlay opened once)
  let landedOnce = false; // …and come back to the page from it

  // ---------------------------------------------------------------- the map around Kickflip

  let map = null;
  /** 'close': Kickflip being learned, close up. 'opened': after landing, Kickflip with what it opened. */
  let camMode = 'close';
  let openedBox = null; // world box of Kickflip and the tricks it opens nearby
  let glideOff = null;
  const isWide = () => window.innerWidth >= 1000;
  /** The stage's marks on the map, in CSS px from its top: the title's foot and LANDED!'s top edge (the map runs on
   *  under the button). Layout reads only, no transforms involved. */
  function stageMarks(h) {
    const top = mapEl.getBoundingClientRect().top;
    const head = title.getBoundingClientRect().bottom - top;
    const button = dock.getBoundingClientRect().top - top;
    return { head: clamp(head, 0, h * 0.4), button: button > 0 && button < h ? button : h * 0.5 };
  }
  /** Where the opened box is framed: between the title's foot and the button's top (DESIGN §8.1: the camera on the
   *  node and what it opened); a taller box runs on under the button, into the map below it. On desktop the real
   *  screen stands on the right once it is in. */
  function stageView(w, h) {
    const m = stageMarks(h);
    const top = m.head + 8;
    const bottom = Math.max(top + 120, m.button - 8);
    if (!isWide()) return { left: 8, right: w - 8, top, bottom };
    let right = w * 0.86;
    if (landedOnce && proof.offsetWidth) right = Math.min(right, proof.offsetLeft - mapEl.offsetLeft - 36);
    return { left: w * 0.14, right, top, bottom };
  }
  function closeCamera(w, h) {
    const wide = isWide();
    const zoom = wide ? 1 : 0.9;
    // Kickflip right over LANDED!, a little left of the middle on a phone (its label left, its tag right).
    const sx = w * (wide ? 0.5 : 0.47);
    const sy = stageMarks(h).button * 0.61;
    return map.frame('kickflip', { width: w, height: h }, { zoom, dx: (w / 2 - sx) / zoom, dy: (h / 2 - sy) / zoom });
  }
  /** DESIGN §8.1: back on the map, the camera frames the node and what it opened (mid tier, never below it). */
  function openedCamera(w, h) {
    if (!openedBox) return closeCamera(w, h);
    const v = stageView(w, h);
    const [x0, y0, x1, y1] = openedBox;
    const zoom = Math.max(0.52, Math.min(0.85, (v.right - v.left) / (x1 - x0), (v.bottom - v.top) / (y1 - y0)));
    // The box's centre at the centre of the seen area; a box taller than the view keeps Kickflip (its top) in view.
    const cy = Math.min((y0 + y1) / 2, y0 + (v.bottom - v.top) / 2 / zoom - 24 / zoom);
    const x = (x0 + x1) / 2 - ((v.left + v.right) / 2 - w / 2) / zoom;
    const y = cy - ((v.top + v.bottom) / 2 - h / 2) / zoom;
    return { x, y, zoom };
  }
  function frameMap() {
    if (!map) return;
    const w = mapEl.clientWidth;
    const h = mapEl.clientHeight;
    if (!w || !h) return;
    glideOff?.();
    map.setCamera(camMode === 'opened' ? openedCamera(w, h) : closeCamera(w, h));
    if (hold) placeCharge();
  }
  /** Kickflip and the tricks landing it opens within reach of the stage (map.opens: nothing is changed). */
  function measureOpened() {
    const k = map.trick('kickflip');
    const near = map
      .opens('kickflip')
      .map((id) => map.trick(id))
      .filter((t) => Math.hypot(t.x - k.x, t.y - k.y) < 720);
    const xs = [k.x, ...near.map((t) => t.x)];
    const ys = [k.y, ...near.map((t) => t.y)];
    const pad = 70; // room for labels
    openedBox = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad + 60, Math.max(...ys) + pad];
  }
  function placeCharge() {
    const point = map?.trickPoint('kickflip');
    if (!point) return;
    charge.style.left = `${mapEl.offsetLeft + point.x}px`;
    charge.style.top = `${mapEl.offsetTop + point.y}px`;
  }
  ctx
    .data('map')
    .then(async (data) => {
      // Two tasks, not one long one mid-scroll: the canvases first, the framing on the next.
      const m = createMap(mapEl, { data, preset: 'intermediate', reduced: ctx.reduced, lang: ctx.lang, onResize: frameMap });
      m.setActive(false);
      await ctx.yield?.();
      map = m;
      frameMap();
      measureOpened();
      map.setActive(visible && !isOpen);
    })
    .catch((error) => console.warn('[section landed] the map did not load; the moment still works', error));
  ctx.onReducedChange((reduced) => map?.setReduced(reduced));

  // ---------------------------------------------------------------- hold to confirm

  let hold = null; // { t0, ticks, pointerId, x, y, px, py, movedAt, moved, live, unsubscribe }
  let tipTimer = 0;

  /** The real screen downloads once a landing is on its way (it is shown after the first one). */
  function preloadProof() {
    if (proofImg.loading === 'lazy') proofImg.loading = 'eager';
  }

  function startHold(pointerId = null, x = 0, y = 0) {
    if (hold || isOpen) return;
    const t0 = performance.now();
    hold = { t0, ticks: 0, pointerId, x, y, px: x, py: y, movedAt: -Infinity, moved: false, live: false, unsubscribe: null };
    btn.classList.add('is-pressed', 'is-holding');
    dock.classList.remove('is-tip', 'is-quiet');
    clearTimeout(tipTimer);
    edge.getAnimations().forEach((a) => a.cancel());
    hold.unsubscribe = ticker.subscribe((dt, now) => stepHold(now));
    stepHold(hold.t0);
  }

  /** Past the slop: this is a hold, not a swipe — the map dims around Kickflip and its pulse starts to swell. */
  function goLive() {
    hold.live = true;
    preloadProof();
    map?.focus('kickflip', { dim: HOLD_DIM });
    if (!ctx.reduced) {
      placeCharge();
      charge.classList.add('is-on');
    }
  }

  function stepHold(now) {
    if (!hold) return;
    const elapsed = now - hold.t0;
    const p = clamp(elapsed / HOLD_MS);
    edge.style.transform = `scaleX(${p.toFixed(4)})`;
    if (!hold.live && elapsed >= SLOP_MS && now - hold.movedAt >= SLOP_MS) goLive();
    if (hold.live) {
      // 8 rising ticks spread evenly from the slop to the end; the board rolls faster as the edge fills.
      while (hold.ticks < HOLD_TICKS && elapsed >= SLOP_MS + (hold.ticks * (HOLD_MS - SLOP_MS)) / HOLD_TICKS) {
        sound.play('tick', { rate: 2 ** (hold.ticks / 7), volume: 0.75 });
        hold.ticks++;
      }
      sound.roll(ROLL_FROM + (1 - ROLL_FROM) * p);
      if (!ctx.reduced) {
        // The node trembles up to ±1 pt with the hold (DESIGN §8.1), its red pulse swells r 14 → 40, and the button
        // joins the tremble in the last 30 %.
        map?.tremble('kickflip', p);
        charge.style.transform = `scale(${(0.35 + 0.65 * p).toFixed(4)})`;
        charge.style.opacity = (0.3 + 0.6 * p).toFixed(3);
        btn.style.transform = p > 0.7 ? `translate3d(${Math.random() < 0.5 ? -1 : 1}px, ${Math.random() < 0.5 ? -0.5 : 0.5}px, 0)` : '';
      }
    }
    if (p >= 1) completeHold();
  }

  /** Ends the hold's look. keepDim: the hit keeps the dimmed map under its white frame (the freeze). */
  function endHoldVisuals({ keepDim = false } = {}) {
    hold?.unsubscribe?.();
    btn.classList.remove('is-pressed', 'is-holding');
    btn.style.transform = '';
    charge.classList.remove('is-on');
    charge.style.transform = '';
    charge.style.opacity = '';
    map?.tremble(null);
    if (!keepDim) map?.clearFocus();
  }

  /** Let go early. quiet: a swipe, a slide-off or the page going away — the edge just rolls back, nothing scolds. */
  function cancelHold({ quiet = false } = {}) {
    if (!hold) return;
    const p = clamp((performance.now() - hold.t0) / HOLD_MS);
    const { pointerId } = hold;
    endHoldVisuals();
    hold = null;
    if (pointerId !== null && btn.hasPointerCapture?.(pointerId)) btn.releasePointerCapture(pointerId);
    sound.roll(0); // the board rolls away
    // The edge rolls back.
    edge.style.transform = 'scaleX(0)';
    motion.animate(edge, [{ transform: `scaleX(${p})` }, { transform: 'scaleX(0)' }], { duration: 160, easing: 'out', fill: 'none' });
    if (quiet) return;
    // A nudge, and the tag over the button says to hold.
    if (!ctx.reduced) {
      btn.animate(
        [0, -4, 4, -2, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 200, easing: 'linear' },
      );
    }
    tip.textContent = ctx.t('hint');
    dock.classList.add('is-tip');
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => dock.classList.remove('is-tip'), 2400);
  }

  function completeHold() {
    if (!hold) return;
    const { pointerId } = hold;
    hold.unsubscribe?.();
    hold = null;
    if (pointerId !== null && btn.hasPointerCapture?.(pointerId)) btn.releasePointerCapture(pointerId);
    hit();
  }

  btn.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || isOpen) return;
    // Mouse and pen: no text drag or selection. Touch keeps its default, so a vertical pan stays the page's.
    if (event.pointerType !== 'touch') event.preventDefault();
    try {
      btn.setPointerCapture(event.pointerId);
    } catch {
      /* the pointer is gone already */
    }
    btn.focus({ preventScroll: true });
    startHold(event.pointerId, event.clientX, event.clientY);
  });
  btn.addEventListener('pointermove', (event) => {
    if (!hold || hold.pointerId !== event.pointerId) return;
    // A finger on the move is probably starting a scroll: the hold stays quiet until it rests.
    if (Math.hypot(event.clientX - hold.px, event.clientY - hold.py) > 2) hold.movedAt = performance.now();
    hold.px = event.clientX;
    hold.py = event.clientY;
    if (!hold.moved && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > SLOP_PX) hold.moved = true;
    // Slid far off the button: that is not a hold.
    const r = btn.getBoundingClientRect();
    const out = 28;
    if (event.clientX < r.left - out || event.clientX > r.right + out || event.clientY < r.top - out || event.clientY > r.bottom + out) {
      cancelHold({ quiet: true });
    }
  });
  btn.addEventListener('pointerup', (event) => {
    // Too short: say so only to a press that stayed where it went down.
    if (hold && hold.pointerId === event.pointerId) cancelHold({ quiet: hold.moved });
  });
  // The browser took the touch for a scroll (pan-y), or the capture went away: end the hold without a word.
  for (const type of ['pointercancel', 'lostpointercapture']) {
    btn.addEventListener(type, (event) => {
      if (hold && hold.pointerId === event.pointerId) cancelHold({ quiet: true });
    });
  }
  btn.addEventListener('contextmenu', (event) => event.preventDefault());
  btn.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (event.repeat || isOpen) return;
    startHold(null);
  });
  btn.addEventListener('keyup', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    if (hold && hold.pointerId === null) cancelHold();
  });
  btn.addEventListener('blur', () => {
    if (hold && hold.pointerId === null) cancelHold({ quiet: true });
  });
  // Assistive tech activates without holding (VoiceOver, NVDA browse mode): a click that no pointer or key made.
  btn.addEventListener('click', (event) => {
    if (event.detail === 0 && !hold && !isOpen) hit();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelHold({ quiet: true });
  });

  // ---------------------------------------------------------------- the overlay

  let ov = null;
  function buildOverlay() {
    const fragment = template.content.cloneNode(true);
    ctx.icons.hydrate(fragment);
    const el = fragment.querySelector('.ldo');
    for (const chip of $$('[data-node]', el)) {
      chip.querySelector('i').innerHTML = renderNodeSVG({
        state: 'available',
        lineId: chip.dataset.node,
        interchange: 'combo' in chip.dataset,
        tier: 'mid',
        size: 18,
        extent: 10.5,
      });
    }
    document.body.appendChild(el);
    const q = (sel) => el.querySelector(sel);
    const beats = Object.fromEntries($$('[data-ldo-beat]', el).map((node) => [node.dataset.ldoBeat, node]));
    const refs = {
      el,
      beats,
      scroll: q('[data-ldo-scroll]'),
      card: q('[data-ldo-card]'),
      name: beats.name,
      stamp: beats.stamp,
      date: q('[data-ldo-date]'),
      shadow: q('[data-ldo-shadow]'),
      count: q('[data-ldo-count]'),
      rows: $$('[data-ldo-row]', el),
      gain: q('[data-ldo-gain]'),
      total: q('[data-ldo-total]'),
      toNext: q('[data-ldo-tonext]'),
      chips: $$('[data-ldo-chip]', el),
      toast: q('[data-ldo-toast]'),
      live: q('[data-ldo-live]'),
      close: q('[data-ldo-close]'),
      clip: q('[data-ldo-clip]'),
      share: q('[data-ldo-share]'),
      next: q('[data-ldo-continue]'),
    };

    refs.close.addEventListener('click', close);
    refs.next.addEventListener('click', close);
    refs.clip.addEventListener('click', () => showToast(ctx.t('addClip')));
    refs.share.addEventListener('click', share);
    // A tap anywhere that is not a button settles the sequence (after 0.8 s, DESIGN.md §8) — a tap that went down
    // on the paper. The finger of a long hold lifts onto the card after the cut; its click must not skip the beats.
    el.addEventListener('pointerdown', () => {
      armed = true;
    });
    el.addEventListener('click', (event) => {
      if (!armed || event.target.closest('button')) return;
      skip();
    });
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      } else if ((event.key === ' ' || event.key === 'Enter') && event.target === el) {
        event.preventDefault();
        if (!event.repeat) skip();
      }
    });
    return refs;
  }

  // ---------------------------------------------------------------- the sequence

  let timers = [];
  let runToken = 0;
  let cutAt = 0;
  let settled = false;
  let armed = false; // a pointer went down inside the overlay since it opened
  const unlocks = []; // the page lock's two steps (scroll, then inert), released last first
  let inertTimer = 0;
  const after = (ms, fn) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  function todayStrings() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    // The stamp is the app's UI (lang="en" on both pages): its spoken date is English too ("2 October 2026").
    const long = `${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
    return { short: `${dd}.${mm}.${yy}`, long };
  }

  /** The hit: freeze for 80 ms with one paper-white frame on the node, then the hard cut. */
  function hit() {
    if (isOpen) return;
    isOpen = true;
    sound.roll(0);
    sound.play('land');
    endHoldVisuals({ keepDim: true });
    edge.style.transform = 'scaleX(1)';
    preloadProof();
    if (map) {
      map.flash('kickflip', { ms: T.cut }); // one paper-white frame on the node, drawn now
      map.setActive(false); // the freeze
    }
    setTimeout(open, T.cut);
    if (!hitOnce) {
      hitOnce = true;
      // The rest of the page may now say it (the session's kicker): after the cut, off the hit's frame.
      setTimeout(() => {
        root.setAttribute('data-landed', '');
        document.dispatchEvent(new CustomEvent('nbd:landed', { detail: { trick: 'kickflip' } }));
      }, T.cut + 40);
    }
  }

  function resetOverlay() {
    for (const anim of ov.el.getAnimations({ subtree: true })) anim.cancel();
    for (const node of Object.values(ov.beats)) node.classList.remove('is-on');
    ov.shadow.style.opacity = '0';
    ov.rows.forEach((row) => row.classList.remove('is-on'));
    ov.count.textContent = '+0';
    ov.total.textContent = formatNumber(XP.from);
    ov.toNext.textContent = formatNumber(XP.next - XP.from);
    ov.toast.textContent = '';
    ov.toast.classList.remove('is-on');
    ov.scroll.scrollTop = 0;
    const date = todayStrings();
    ov.date.textContent = date.short;
    ov.stamp.setAttribute('aria-label', ctx.t('stampA11y', { date: date.long }));
  }

  function open() {
    ov ??= buildOverlay();
    resetOverlay();
    settled = false;
    armed = false;
    const token = ++runToken;
    ov.el.hidden = false; // the hard cut: no fade
    cutAt = performance.now();
    // The page lock comes in two steps, both off the slam. Once the paper is on screen: focus moves in (before
    // anything dirties style, so it costs nothing) and the page stops scrolling — a lock that keeps every branch of
    // <body> live, so nothing is made inert yet. Once the stamp has landed and +160 has counted up — the one quiet
    // moment on the main thread before the level bar — the rest of the page goes inert: a whole-document restyle
    // (~10 ms here, ~80 on a slow phone) that the name's slam must not pay for. The dialog is focused and modal from
    // the first frame, so assistive tech is inside it already.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (token !== runToken || !isOpen) return;
        ov.el.focus({ preventScroll: true });
        unlocks.push(ctx.lockPage({ keep: [...document.body.children], scrollable: ov.scroll }));
      }),
    );
    // Its own timer, not a beat: a skip must not cancel it.
    clearTimeout(inertTimer);
    inertTimer = setTimeout(() => {
      if (token === runToken && isOpen) unlocks.push(ctx.lockPage({ keep: ov.el, scrollable: ov.scroll }));
    }, T.xp + COUNT_MS + 40 - T.cut);
    edge.style.transform = 'scaleX(0)';
    // Under the paper the map goes back to Kickflip-in-progress, close up, so the way back can land it again.
    if (map) {
      map.clearFocus();
      map.setPreset('intermediate');
      camMode = 'close';
      frameMap();
    }
    ov.live.textContent = '';

    const beat = (name) => ov.beats[name].classList.add('is-on');
    const at = (ms, fn) => after(ms - T.cut, () => token === runToken && !settled && fn());

    // 80: the name slams, the screen shakes once.
    beat('name');
    motion.slam(ov.name, { from: 1.35, dy: -6 });
    motion.shake(ov.card, 3);

    // 380: the sticker drops at −10°.
    at(T.sticker, () => {
      beat('sticker');
      motion.pop(ov.beats.sticker, { from: 1.6 });
    });
    // 560: contact — the shadow snaps in, the grind sparks shoot out of the upper half-plane and settle.
    at(T.contact, () => {
      ov.shadow.style.opacity = '1';
      beat('sparks');
      sound.play('sticker');
      motion.animate(
        ov.beats.sparks,
        [
          { transform: 'scale(0.62)', easing: 'cubic-bezier(.16,1,.3,1)' },
          { transform: 'scale(1.1)', offset: 90 / 310, easing: 'cubic-bezier(.2,0,0,1)' },
          { transform: 'scale(1)' },
        ],
        { duration: 310, reduced: 'fade' },
      );
    });
    // 700: the stamp swings in, 1.5 → 1 in 90 ms (ease-in), hits at 790, recoils 2 px.
    at(T.stamp, () => {
      beat('stamp');
      motion.animate(
        ov.stamp,
        [
          { transform: 'scale(1.5)', opacity: 0, easing: 'cubic-bezier(.7,0,.84,0)' },
          { transform: 'scale(1.18)', opacity: 0.85, offset: 0.2, easing: 'cubic-bezier(.7,0,.84,0)' },
          { transform: 'scale(1)', opacity: 1, offset: 0.4, easing: 'cubic-bezier(.16,1,.3,1)' },
          { transform: 'translate(1px, -2px) scale(1.012)', opacity: 1, offset: 0.62, easing: 'cubic-bezier(.2,0,0,1)' },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 225, reduced: 'fade' },
      );
    });
    at(T.stampHit, () => sound.play('stamp'));
    // 1000: XP — the block rises, +160 counts up, the rows type in.
    at(T.xp, () => {
      beat('xp');
      motion.animate(ov.beats.xp, [{ transform: 'translateY(12px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'out', reduced: 'fade' });
      count(ov.count, 0, XP.total, COUNT_MS, (v) => `+${formatNumber(v)}`, token);
      ov.rows.forEach((row, i) => {
        const cover = row.querySelector('.ldo__type');
        motion.animate(cover, [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: 170, delay: 40 + i * ROW_STAGGER, easing: 'steps(9, end)' });
      });
    });
    // 1900: the level bar grows in yellow.
    at(T.bar, () => {
      beat('level');
      motion.animate(ov.beats.level, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', reduced: 'fade' });
      const from = Number(getComputedStyle(ov.gain).getPropertyValue('--from')) || 0;
      const gain = Number(getComputedStyle(ov.gain).getPropertyValue('--gain')) || 0;
      motion.animate(
        ov.gain,
        [{ transform: `translateX(${from * 100}%) scaleX(0)` }, { transform: `translateX(${from * 100}%) scaleX(${gain})` }],
        { duration: BAR_MS, easing: 'out' },
      );
      count(ov.total, XP.from, XP.to, BAR_MS, formatNumber, token);
      count(ov.toNext, XP.next - XP.from, XP.next - XP.to, BAR_MS, formatNumber, token);
    });
    // 2700: "14 opened" — the chips pop in one by one, a tick each.
    at(T.unlocked, () => {
      beat('opened');
      motion.animate(ov.beats.opened, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'linear', reduced: 'fade' });
      ov.chips.forEach((chip, i) => {
        motion.animate(chip, (v) => ({ opacity: Math.min(1, v * 4), transform: `scale(${(0.8 + 0.2 * v).toFixed(4)})` }), { spring: 'pop', delay: i * CHIP_STAGGER, reduced: 'fade' });
        after(i * CHIP_STAGGER, () => token === runToken && !settled && sound.play('tick', { rate: toneUp(i) }));
      });
    });
    // 3500: the actions fade up.
    at(T.actions, () => {
      beat('actions');
      motion.animate(ov.beats.actions, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 120, easing: 'out', reduced: 'fade' });
      settled = true;
      ov.live.textContent = ctx.t('announce');
    });
  }

  /** Counts el's text on the shared ticker (ease-out); a newer run or a skip stops it. Reduced motion: jumps. */
  function count(el, from, to, ms, format, token) {
    if (ctx.reduced) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    let last = null;
    const off = ticker.subscribe((dt, now) => {
      if (token !== runToken || settled) return off();
      const p = Math.min(1, (now - start) / ms);
      const v = Math.round(from + (to - from) * motion.ease.out(p));
      if (v !== last) el.textContent = format((last = v));
      if (p >= 1) off();
    });
  }

  /** Tap after 0.8 s: jump to the settled card. */
  function skip() {
    if (!isOpen || settled || performance.now() - cutAt < SKIP_AFTER) return;
    settled = true;
    clearTimers();
    for (const anim of ov.el.getAnimations({ subtree: true })) {
      try {
        anim.finish();
      } catch {
        anim.cancel();
      }
    }
    for (const node of Object.values(ov.beats)) node.classList.add('is-on');
    ov.shadow.style.opacity = '1';
    ov.count.textContent = `+${formatNumber(XP.total)}`;
    ov.total.textContent = formatNumber(XP.to);
    ov.toNext.textContent = formatNumber(XP.next - XP.to);
    ov.live.textContent = ctx.t('announce');
  }

  /** CONTINUE / the cross / Esc: hard cut back to the page, same scroll position; the map lands Kickflip there. */
  function close() {
    if (!isOpen) return;
    runToken++;
    clearTimers();
    clearTimeout(toastTimer);
    ov.el.hidden = true;
    clearTimeout(inertTimer);
    while (unlocks.length) unlocks.pop()();
    isOpen = false;
    btn.focus({ preventScroll: true });
    how.firstElementChild.textContent = ctx.t('after');
    how.classList.add('is-done');
    dock.classList.add('is-landed');
    const first = !landedOnce;
    if (first) {
      landedOnce = true;
      // The stage says landed from now on: the map's label (the map itself lands Kickflip with the ripple).
      mapEl.setAttribute('aria-label', ctx.t('mapLabelLanded'));
      showProof(); // before the ripple: on desktop the camera frames what opened beside it
    }
    let rippled = Promise.resolve();
    if (map) {
      map.setActive(visible);
      if (visible) rippled = ripple();
    }
    if (first) playProof(rippled);
  }

  let rippleRun = 0;
  /** The unlock ripple; resolves when the last opened trick has popped. On a phone the dock steps back meanwhile:
   *  the tricks opening under LANDED! and the line under it show through. */
  function ripple() {
    map.setPreset('intermediate');
    const run = ++rippleRun;
    if (!isWide() && !ctx.reduced) dock.classList.add('is-quiet');
    // A tick as each head reaches its node, a whole tone higher each (the app's wave of openings).
    const done = map.ripple('kickflip', { onArrive: (k) => !ctx.reduced && sound.play('tick', { rate: toneUp(k) }) });
    glideToOpened();
    return done.then(() => {
      if (run === rippleRun) dock.classList.remove('is-quiet');
    });
  }

  /** The first landing earns the proof: the app's own Landed screen. It takes its place now (on a phone it joins
   *  the flow under the stage: everything below moves down)… */
  function showProof() {
    proof.classList.add('is-in');
    proof.parentElement.classList.add('has-proof');
    ctx.scroll.measure();
  }
  /** …and slides in at +3°: on desktop at once, beside the ripple; on phones and tablets, where it stands under the
   *  stage (below the fold while LANDED! is mid-screen), after the ripple and once it comes into view — the eye stays
   *  on the heads while they run. */
  function playProof(after) {
    const slide = (delay) => {
      proof.classList.remove('is-waiting');
      motion.animate(proofPhone, [{ transform: 'translate3d(56px, 22px, 0) rotate(6deg)' }, { transform: 'none' }], { spring: 'settle', delay, reduced: 'fade' });
      motion.animate(proofPhone, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, delay, easing: 'linear', reduced: 'fade' });
      motion.animate(proofCap, [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, delay: delay + 200, easing: 'out', reduced: 'fade' });
    };
    if (isWide()) {
      slide(320);
      return;
    }
    proof.classList.add('is-waiting');
    after.then(() => {
      let played = false;
      let off = null;
      off = ctx.scroll.track(
        proof,
        (p) => {
          if (played || p <= 0) return;
          played = true;
          off?.();
          slide(0);
        },
        { enter: 0.92, exit: 0 },
      );
      if (played) off();
    });
  }

  /** The camera pulls back from Kickflip to frame what it opened while the heads run (reduced motion: a cut). */
  function glideToOpened() {
    const w = mapEl.clientWidth;
    const h = mapEl.clientHeight;
    const target = openedCamera(w, h);
    camMode = 'opened';
    glideOff?.();
    if (ctx.reduced) {
      map.setCamera(target);
      return;
    }
    const fly = map.flight(map.getCamera(), target, { rho: 0 });
    const start = performance.now() + 240; // the node lands first
    const off = ticker.subscribe((dt, now) => {
      const p = clamp((now - start) / 1500);
      map.setCamera(fly(p));
      if (p >= 1) stop();
    });
    const stop = () => {
      off();
      if (glideOff === stop) glideOff = null;
    };
    glideOff = stop;
  }

  // ---------------------------------------------------------------- the buttons that leave the app

  let toastTimer = 0;
  function showToast(text) {
    ov.toast.textContent = text;
    ov.toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ov.toast.classList.remove('is-on'), 3600);
  }

  async function share() {
    showToast(ctx.t('share'));
    const url = (document.querySelector('link[rel="canonical"]')?.href || location.href).split('#')[0];
    try {
      if (navigator.share) {
        await navigator.share({ title: ctx.t('shareTitle'), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showToast(ctx.t('copied'));
    } catch {
      /* the visitor closed the sheet, or the clipboard is not ours: the note already says what this does */
    }
  }

  // ---------------------------------------------------------------- QA hooks

  // NBD.sections.landed.handlers.qa.play() / .at(ms) / .skip() / .close() — for the screenshot camera.
  const qa = {
    get map() {
      return map;
    },
    play: () => hit(),
    /** Opens the overlay and settles it as it stands `ms` after the hit (no sounds, no timers). */
    async at(ms = 4000) {
      if (!isOpen) {
        hit();
        await motion.sleep(T.cut + 20);
      }
      if (ms >= T.actions) {
        cutAt = -Infinity;
        skip();
      }
      return true;
    },
    skip: () => {
      cutAt = -Infinity;
      skip();
    },
    close,
    /** Starts a hold already `p` of the way; `freeze` stops it there (a still for the camera; .cancel() lets go). */
    holdFor: (p, { freeze = false } = {}) => {
      startHold(null);
      hold.t0 = performance.now() - p * HOLD_MS;
      stepHold(performance.now());
      if (freeze) hold?.unsubscribe?.();
    },
    cancel: () => cancelHold(),
  };

  return {
    qa,
    /** True once the visitor has landed it (the page hears it as `nbd:landed`, or reads [data-landed]). */
    get landed() {
      return hitOnce;
    },
    enter() {
      visible = true;
      if (!isOpen) map?.setActive(true);
    },
    leave() {
      visible = false;
      cancelHold({ quiet: true });
      if (glideOff) {
        glideOff();
        frameMap();
      }
      map?.setActive(false);
    },
  };
}
