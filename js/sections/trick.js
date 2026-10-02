// Section "trick": Kickflip's page of the app at poster scale (DESIGN §6 "Trick detail").
//
// - The paper hero unrolls from the top as it comes in (the app's 8.6 "sheet → full trick detail": height 0 →
//   full, ease-out, torn edge last). Done with two counter-moving transforms: the masked outer box slides
//   down with the torn edge while the content inside slides the opposite way, so the words stay put.
// - Kickflip's own node (renderNodeSVG) slaps on as a sticker at −6°; the stance tiles carry the mini rings
//   (stanceRingSVG); the route strip draws its real nodes: needs Ollie → you are here → needed for 22.
// - Stance tiles are a radio group like in the app: the name, the status row and the hero's node follow the
//   selected stance (Kickflip learning → Fakie Flip locked: the dashed ghost, no pulse).
// - Parts deal in once as they cross the lower part of the screen (scroll.track thresholds, spring stops,
//   transform/opacity only). The route runs with the page: a paper head draws the line out from "you are
//   here" through the 22 tricks that need Kickflip, and the strip pans along with it (until the visitor
//   takes it over). Step 3 lands, then the margin note beside it slams on like a pen hitting the page.
// - Reduced motion: nothing is hidden or moved; the still page tells the story.
//
// Sound (docs/design/sound.md): the learning sticker slapping on → `sticker`; a stance tile → `tick`.

import { renderNodeSVG, stanceRingSVG } from '../map/index.js';

const K1 = { lit: '#FE429D', reachable: '#A32F67', unlit: '#6A2244' };
const HAIRLINE = '#3A3A35';
const STANCES = ['normal', 'fakie', 'nollie', 'switch'];
const UNROLL_MS = 760;
const UNROLL_EASE = 'cubic-bezier(.22,.61,.2,1)';

export default async function init(root, ctx) {
  const { motion, scroll, sound } = ctx;
  const $ = (sel, el = root) => el.querySelector(sel);
  const $$ = (sel, el = root) => Array.from(el.querySelectorAll(sel));
  const timers = new Set();
  const later = (ms, fn) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };

  // ---------------------------------------------------------------- drawings (the map's own SVG nodes)

  // The hero's node: Kickflip learning (the glow is the CSS .pulse under it, compositor only), and the dashed
  // ghost a locked stance slot shows instead. Both are drawn once; select() swaps them.
  const sticker = $('[data-tk-sticker]');
  sticker.insertAdjacentHTML(
    'beforeend',
    renderNodeSVG({
      state: 'learning',
      lineId: 'flip-kickflip',
      size: 300,
      stances: { normal: 'learning', fakie: 'none', nollie: 'none', switch: 'none' },
      pulse: 'none',
    }) + renderNodeSVG({ state: 'locked', lineId: 'flip-kickflip', size: 300, pulse: 'none' }),
  );
  const [stickerLearning, stickerLocked] = $$('svg', sticker);
  stickerLocked.setAttribute('hidden', ''); // an SVG element has no .hidden property

  // Mini rings: this tile's quadrant in its state (learning = lit, dashed; locked = unlit), the rest hairline.
  for (const tile of $$('.tk-tile')) {
    const own = tile.dataset.state === 'learning' ? K1.lit : K1.unlit;
    const stances = Object.fromEntries(STANCES.map((s) => [s, s === tile.dataset.stance ? (tile.dataset.state === 'learning' ? 'learning' : 'landed') : 'none']));
    $('[data-tk-ring]', tile).innerHTML = stanceRingSVG({ stances, colors: { lit: own, reachable: own, unlit: HAIRLINE }, size: 26, r: 10, width: 3 });
  }

  for (const node of $$('.tk-rn')) {
    const stances = node.dataset.stances ? Object.fromEntries(node.dataset.stances.split(',').map((v, i) => [STANCES[i], v])) : null;
    $('.tk-rn__glyph', node).insertAdjacentHTML(
      'beforeend',
      renderNodeSVG({ state: node.dataset.state, lineId: node.dataset.line, size: 44, stances, interchange: 'ic' in node.dataset, pulse: 'none' }),
    );
  }

  // The 26 drawings are this init's heavy step: the rest runs as a new task, so no single long task lands
  // mid-scroll (main.js inits the section at idle, 1.5 viewports ahead).
  await ctx.yield?.();

  // ---------------------------------------------------------------- the name: auto-fit to the full width

  const nameBox = $('[data-tk-name-box]');
  const nameEl = $('[data-tk-name]');
  const probe = document.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;font-size:100px;pointer-events:none';
  nameBox.style.position = 'relative';
  nameBox.append(probe);
  const widthAt = (text, px) => {
    probe.style.fontSize = `${px}px`;
    probe.textContent = text;
    return probe.getBoundingClientRect().width || 1;
  };
  /** The size at which `text` spans `available` px: a guess at 100 px, then one correction at that size
   *  (glyph advances do not scale exactly linearly). */
  const sizeFor = (text, available) => {
    const guess = (100 * available) / widthAt(text, 100);
    return (guess * available) / widthAt(text, guess);
  };
  // Capped below the page's loud lines: the name is the explainer's, never louder than LAND IT. STAMP IT., the
  // celebration's KICKFLIP slam two screens later (DESIGN §8.1 "the name slams") or the finale's poster.
  // Phones: 26vw (a hair under the finale's ~28vw) and 13svh (on a short phone, Telegram's 664 or an SE, the
  // slam steps down to 92 px). From 600 px, where the landed title steps down to 16vw and the finale's to
  // 15vw: 12vw, and 22svh for a phone held sideways (its slam is 24vh). The small viewport, so a toolbar sliding
  // away never refits it.
  const maxSize = () => {
    const w = window.innerWidth;
    const h = scroll.vh || window.innerHeight;
    return w >= 600 ? Math.min(480, w * 0.12, h * 0.22) : Math.min(w * 0.26, h * 0.13);
  };
  function fitName() {
    const available = nameBox.clientWidth * 0.985;
    if (!available) return;
    const kick = Math.min(maxSize(), sizeFor('Kickflip', available));
    const name = nameEl.textContent;
    const now = name === 'Kickflip' ? kick : Math.min(kick, sizeFor(name, available));
    // on the hero's content box: the name keeps KICKFLIP's height, and from 700 px the sticker rises beside it
    nameBox.parentElement.style.setProperty('--name-h', `${(kick * 0.86).toFixed(1)}px`);
    nameBox.style.setProperty('--name-size', `${now.toFixed(1)}px`);
  }
  fitName();
  document.fonts?.load?.('900 100px "Sofia Sans Extra Condensed"').then(fitName, () => {});
  document.fonts?.ready?.then(fitName);
  if ('ResizeObserver' in window) {
    let lastW = 0;
    new ResizeObserver(() => {
      const w = nameBox.clientWidth;
      if (w !== lastW) {
        lastW = w;
        fitName();
      }
    }).observe(nameBox);
  }

  // ---------------------------------------------------------------- stances: a radio group like the app's

  const tiles = $$('.tk-tile');
  const chip = $('[data-tk-chip]');
  const battle = $('[data-tk-battle]');

  function select(tile, { focus = false } = {}) {
    if (focus) tile.focus();
    if (tile.classList.contains('is-on')) return;
    for (const t of tiles) {
      const on = t === tile;
      t.classList.toggle('is-on', on);
      t.setAttribute('aria-checked', String(on));
      t.tabIndex = on ? 0 : -1;
    }
    const learning = tile.dataset.state === 'learning';
    chip.className = `chip chip--${learning ? 'learning' : 'locked'}`;
    chip.textContent = $('.tk-tile__state', tile).textContent;
    battle.hidden = !learning;
    // The hero's node is the selected slot's: learning with its pulse, or a locked slot's dashed ghost.
    const wasLearning = sticker.dataset.state === 'learning';
    sticker.dataset.state = learning ? 'learning' : 'locked';
    stickerLearning.toggleAttribute('hidden', !learning);
    stickerLocked.toggleAttribute('hidden', learning);
    if (wasLearning !== learning && !sticker.classList.contains('tk-hide')) motion.pop(sticker, { from: learning ? 1.25 : 0.85 });
    nameEl.textContent = tile.dataset.name;
    fitName();
    motion.animate(nameEl, (v) => ({ transform: `translate3d(0, ${(-0.05 * (1 - v)).toFixed(4)}em, 0) scale(${(1.05 - 0.05 * v).toFixed(4)})` }), { spring: 'settle' });
    motion.pop(chip, { from: 0.85 });
    sound.play('tick');
  }

  for (const tile of tiles) tile.addEventListener('click', () => select(tile));
  $('[data-tk-tiles]').addEventListener('keydown', (event) => {
    const i = tiles.indexOf(document.activeElement);
    if (i < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next = null;
    if (step) next = tiles[(i + step + tiles.length) % tiles.length];
    else if (event.key === 'Home') next = tiles[0];
    else if (event.key === 'End') next = tiles[tiles.length - 1];
    if (!next) return;
    event.preventDefault();
    select(next, { focus: true });
  });

  // ---------------------------------------------------------------- route: drag to scroll with a mouse

  const routeScroll = $('[data-tk-route-scroll]');
  // A Tab stop (and a named region) only while there is something to scroll: on a wide screen that shows the
  // whole strip it is just a picture.
  function routeFocusable() {
    const scrolls = routeScroll.scrollWidth - routeScroll.clientWidth > 2;
    if (scrolls) routeScroll.setAttribute('tabindex', '0');
    else routeScroll.removeAttribute('tabindex');
  }
  routeFocusable();
  if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(routeFocusable)).observe(routeScroll);
  let drag = null;
  routeScroll.addEventListener('pointerdown', (event) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    drag = { x: event.clientX, left: routeScroll.scrollLeft, id: event.pointerId };
  });
  routeScroll.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    if (!routeScroll.classList.contains('is-drag')) {
      if (Math.abs(dx) < 4) return;
      run.follow = false; // dragged by hand: the strip stops following the head
      routeScroll.classList.add('is-drag');
      routeScroll.setPointerCapture?.(drag.id);
    }
    routeScroll.scrollLeft = drag.left - dx;
  });
  const endDrag = () => {
    drag = null;
    routeScroll.classList.remove('is-drag');
  };
  routeScroll.addEventListener('pointerup', endDrag);
  routeScroll.addEventListener('pointercancel', endDrag);
  routeScroll.addEventListener('lostpointercapture', endDrag);

  // ---------------------------------------------------------------- deal-in (skipped under reduced motion)

  const hero = $('[data-tk-hero]');
  const heroIn = $('[data-tk-hero-in]');
  const words = $$('.tk-w > span');
  const route = {
    rail: $('.tk-route__rail'),
    build: $('.tk-route__build'),
    head: $('.tk-route__head'),
    caps: $$('.tk-route__cap'),
    nodes: $$('.tk-rn'),
  };
  const groups = {
    label: Array.from($('[data-tk-label]').children),
    status: [chip, battle, $('.tk-diff')],
    tiles,
    notes: $$('[data-tk-reveal]'),
    steps: $$('[data-tk-steps] > li'),
    hand: [$('[data-tk-hand]')],
    refs: [$('[data-tk-find]')],
  };
  const hidden = [
    ...words,
    hero,
    sticker,
    route.rail,
    route.build,
    ...route.caps,
    ...route.nodes,
    ...Object.values(groups).flat(),
  ].filter(Boolean);

  const offs = [];
  let armed = false;

  function revealAll() {
    for (const id of timers) clearTimeout(id);
    timers.clear();
    for (const off of offs.splice(0)) off();
    for (const el of hidden) el.classList.remove('tk-hide');
    route.rail.style.transform = '';
    route.head.style.opacity = '0';
    hero.classList.remove('is-unrolling');
    root.classList.remove('is-armed');
    armed = false;
  }

  /**
   * Where el really is (one layout read, only at decision points): 'below' the trigger line, 'in' view, or
   * 'past' (scrolled above the screen). The engine's p can be stale on the very first call after a jump
   * (a track registered during NBD.goto is reported before it is measured), so p alone never decides.
   */
  function whereIs(el, at) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.top > vh * at) return 'below';
    if (r.bottom < 0) return 'past';
    return 'in';
  }
  /** Progress of el over the track range { enter: at, exit }, from its live rect. */
  function liveProgress(el, at, exit) {
    const r = el.getBoundingClientRect();
    const vh = window.innerHeight;
    const span = r.height + (at - exit) * vh;
    return Math.min(1, Math.max(0, (vh * at - r.top) / Math.max(1, span)));
  }

  /** Runs fn once, when el's top first comes above `at` × viewport height (fn(true) if it is already past). */
  function when(el, fn, at = 0.86) {
    if (!el) return;
    let done = false;
    let off = null;
    off = scroll.track(
      el,
      (p) => {
        if (done || p <= 0 || !armed) return;
        const where = whereIs(el, at);
        if (where === 'below') return;
        done = true;
        off?.();
        fn(where === 'past');
      },
      { enter: at, exit: 0 },
    );
    offs.push(off);
  }

  const shown = (el) => el.classList.remove('tk-hide');
  /** Hard start, spring stop: visible from the first frame of its turn, the move springs to rest. */
  function deal(el, delay, frame, spring = 'pop') {
    if (!el) return;
    later(delay, () => {
      shown(el);
      motion.animate(el, frame, { spring });
    });
  }
  const rise = (dy) => (v) => ({ opacity: 1, transform: `translate3d(0, ${(dy * (1 - v)).toFixed(2)}px, 0)` });
  const popFrom = (from) => (v) => ({ opacity: 1, transform: `scale(${(from + (1 - from) * v).toFixed(4)})` });
  const group = (els, instant, stagger, frame, spring) =>
    els.forEach((el, i) => (instant ? shown(el) : deal(el, i * stagger, frame, spring)));

  let unrolledAt = 0;
  function unroll(instant) {
    shown(hero);
    if (instant) return;
    unrolledAt = performance.now();
    hero.classList.add('is-unrolling');
    const opts = { duration: UNROLL_MS, easing: UNROLL_EASE };
    hero.animate([{ transform: 'translate3d(0, calc(-100% - 4px), 0)' }, { transform: 'translate3d(0, 0, 0)' }], opts);
    const counter = heroIn.animate([{ transform: 'translate3d(0, calc(100% + 4px), 0)' }, { transform: 'translate3d(0, 0, 0)' }], opts);
    counter.finished.then(() => hero.classList.remove('is-unrolling'), () => {});
  }
  /** The sticker slaps on once the paper under it is down and it is on screen. */
  function slapSticker(instant) {
    if (instant) {
      shown(sticker);
      return;
    }
    const wait = Math.max(0, unrolledAt + UNROLL_MS * 0.6 - performance.now());
    later(wait, () => {
      shown(sticker);
      motion.pop(sticker, { from: 1.6 });
      later(90, () => sound.play('sticker', { volume: 0.8 }));
    });
  }

  // The route runs with the page: as the strip crosses the screen, a paper head runs the line out from
  // "you are here", every node it reaches pops in, and the strip pans along with the head (until the visitor
  // scrolls it by hand). It only ever goes forward: scrolling back up leaves the line drawn.
  const run = { q: -1, geom: null, follow: true, lastLeft: -1, started: false, done: false };
  function routeGeom() {
    const { rail, build, nodes } = route;
    const x0 = rail.offsetLeft;
    const nodesX = nodes.map((node) => node.offsetLeft + node.offsetWidth / 2);
    const hereX = x0 + build.offsetWidth;
    const endX = nodesX[nodesX.length - 1] + nodes[0].offsetWidth * 0.5;
    return {
      x0,
      railW: rail.offsetWidth,
      hereX,
      endX,
      nodesX,
      headW: route.head.offsetWidth,
      viewW: routeScroll.clientWidth,
      max: Math.max(0, routeScroll.scrollWidth - routeScroll.clientWidth),
    };
  }
  window.addEventListener('resize', () => (run.geom = null), { passive: true });
  // Taken over by hand: stop following the head. Only a sideways intent counts — the strip spans the screen
  // and the route runs while the visitor scrolls past it, so a page swipe or a wheel turn that merely starts on
  // it must not stop the follow. Decided from the input itself, so nothing reads scrollLeft against the styles
  // runRoute has just written.
  const takeOver = () => (run.follow = false);
  let touch0 = null;
  routeScroll.addEventListener('touchstart', (event) => {
    const t = event.touches[0];
    touch0 = event.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  routeScroll.addEventListener('touchmove', (event) => {
    const t = event.touches[0];
    if (!touch0 || !t || !run.follow) return;
    const dx = Math.abs(t.clientX - touch0.x);
    const dy = Math.abs(t.clientY - touch0.y);
    if (dx > 8 && dx > dy) takeOver();
    else if (dy > 8 && dy >= dx) touch0 = null; // a page scroll: this gesture is decided
  }, { passive: true });
  routeScroll.addEventListener('touchend', () => (touch0 = null), { passive: true });
  routeScroll.addEventListener('wheel', (event) => {
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) takeOver();
  }, { passive: true });
  routeScroll.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) takeOver();
  });

  function startRoute() {
    const { build, caps, nodes } = route;
    run.started = true;
    shown(route.rail);
    shown(build);
    build.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 260, easing: 'linear' });
    deal(nodes[0], 0, popFrom(0.55));
    deal(nodes[1], 220, popFrom(0.55));
    later(0, () => shown(caps[0]));
    later(220, () => shown(caps[1]));
  }

  function runRoute(p, instant) {
    const { rail, head, caps, nodes } = route;
    if (instant) {
      [rail, route.build, ...caps, ...nodes].forEach(shown);
      run.done = true;
      return;
    }
    if (!run.started) startRoute();
    const q = Math.max(run.q, p);
    if (q === run.q) return;
    run.q = q;
    const g = (run.geom ||= routeGeom());
    const headX = g.hereX + q * (g.endX - g.hereX);
    // The pan first, while layout is still clean; the transforms after it (no forced layout in between).
    if (run.follow && g.max > 0) {
      const left = Math.round(Math.min(g.max, Math.max(0, headX - g.viewW * 0.7)));
      if (left !== run.lastLeft) {
        run.lastLeft = left;
        routeScroll.scrollLeft = left;
      }
    }
    rail.style.transform = `scaleX(${((headX - g.x0) / g.railW).toFixed(4)})`;
    const moving = q > 0 && q < 1;
    head.style.opacity = moving ? '1' : '0';
    head.style.transform = `translate3d(${(headX - g.x0 - g.headW).toFixed(1)}px, 0, 0)`;
    for (let i = 2; i < nodes.length; i++) {
      if (g.nodesX[i] > headX + 1 || !nodes[i].classList.contains('tk-hide')) continue;
      nodes[i].classList.remove('tk-hide');
      motion.animate(nodes[i], popFrom(0.5), { spring: 'pop' });
      if (i === 2) shown(caps[2]);
    }
    if (q >= 1) run.done = true;
  }
  function trackRoute() {
    const el = $('[data-tk-route]');
    let off = null;
    off = scroll.track(
      el,
      (p) => {
        if (!armed || run.done) return;
        if (!run.started) {
          if (p <= 0) return;
          const where = whereIs(el, 0.9);
          if (where === 'below') return;
          if (where === 'past') {
            runRoute(1, true);
            off?.();
            return;
          }
          p = liveProgress(el, 0.9, 0.02);
        }
        runRoute(p, false);
        if (run.done) off?.();
      },
      { enter: 0.9, exit: 0.02 },
    );
    offs.push(off);
  }

  function arm() {
    if (ctx.reduced || armed) return;
    armed = true;
    root.classList.add('is-armed');
    for (const el of hidden) el.classList.add('tk-hide');

    when($('[data-tk-intro]'), (past) => {
      group(words, past, 80, (v) => ({ transform: `translate3d(0, ${(108 * (1 - v)).toFixed(2)}%, 0)` }), 'slam');
      // the tape slaps on after the last word, the line under it follows
      if (past) groups.label.forEach(shown);
      else groups.label.forEach((el, i) => deal(el, words.length * 80 + 120 + i * 110, i ? rise(10) : popFrom(1.35), i ? 'settle' : 'slam'));
    }, 0.9);
    when($('[data-tk-hero-wrap]'), unroll, 0.72);
    when($('.tk-foot'), slapSticker, 0.8);
    when($('[data-tk-status]'), (past) => group(groups.status, past, 70, popFrom(0.8)), 0.9);
    when($('[data-tk-tiles]'), (past) => group(tiles, past, 70, rise(22)), 0.9);
    for (const note of groups.notes) when(note, (past) => group([note], past, 0, rise(14), 'settle'), 0.92);
    trackRoute();
    when($('[data-tk-steps]'), (past) => {
      group(groups.steps, past, 90, rise(16));
      // the margin note lands after the step, like a pen hitting the page
      const hand = groups.hand[0];
      if (past) shown(hand);
      else deal(hand, 320, popFrom(1.3), 'slam');
    }, 0.84);
    when($('[data-tk-find]'), (past) => group(groups.refs, past, 0, rise(16)), 0.94);
  }

  arm();
  ctx.onReducedChange((reduced) => {
    if (reduced) revealAll();
  });

  return {
    enter() {
      root.classList.add('is-in');
    },
    leave() {
      root.classList.remove('is-in');
    },
  };
}
