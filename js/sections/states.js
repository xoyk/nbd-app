// states — Kickflip's node through the five states as the scroll scrubs the pinned stage:
// locked (dashed ghost) → open (ring + plus, +110 XP bait) → learning (stripes, red pulse, learning·47) →
// landed (the sticker drops, sparks, the light comes on) → on lock (three different days, bullseye, ON LOCK).
//
// The scroll only picks a step; every resting frame is CSS (css/sections/states.css keys on data-* of .st).
// Moving forward one step, on screen, plays the physical move between two frames — hard starts, spring stops,
// the app's own sequences (DESIGN.md §8.1 sticker drop, §8.2 unlock ripple, §8.4 on lock). Backwards, or under
// reduced motion, it is a hard cut to the frame. The node is the map's own drawing (renderNodeSVG, anatomy.js).

import { renderNodeSVG } from '../map/svg.js';
import { STANCE_RING, polar } from '../map/anatomy.js';

const NS = 'http://www.w3.org/2000/svg';
const LINE = 'flip-kickflip';
const E = 28; // viewBox half-size in map pt: room for the learning pulse (r 26)
const STANCES = ['normal', 'fakie', 'nollie', 'switch']; // reading order
// Resting frame of each step. Steps 3 and 4 are both "landed": day 1, then day 2 of the three on-lock days.
const FRAMES = [
  { state: 'locked', say: 0, days: 0, lit: 0, out: 0 },
  { state: 'available', say: 1, days: 0, lit: 0, out: 0 },
  { state: 'learning', say: 2, days: 0, lit: 0, out: 0 },
  { state: 'landed', say: 3, days: 1, lit: 1, out: 1 },
  { state: 'landed', say: 3, days: 2, lit: 1, out: 1 },
  { state: 'onLock', say: 4, days: 3, lit: 1, out: 1 },
];
// Progress at which steps 1…5 begin. The pin is 3.8 viewports: 2.8 of scrubbing, about 0.6 per state. Locked
// is shorter (it is already on screen while the stage slides in) and on lock keeps the stage as it slides out;
// landed's 0.6 is day one (the drop, the light) then a shorter day two.
const EDGES = [0.15, 0.35, 0.565, 0.695, 0.785];
const stepAt = (p) => EDGES.reduce((s, e) => (p >= e ? s + 1 : s), 0);
// The five states' ranges of progress, for the rail under the counter (landed spans days one and two).
const SPANS = [[0, EDGES[0]], [EDGES[0], EDGES[1]], [EDGES[1], EDGES[2]], [EDGES[2], EDGES[4]], [EDGES[4], 1]];

const fmt = (v) => String(Math.round(v * 1000) / 1000);

function fromMarkup(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  const el = t.content.firstElementChild;
  el.removeAttribute('width');
  el.removeAttribute('height');
  return el;
}

/** When a spring first reaches its rest value (the sticker touching down) and how long it runs, in ms. */
function springContact(motion, spec) {
  const { samples, duration } = motion.solveSpring(spec);
  let i = 1;
  while (i < samples.length - 1 && samples[i] < 1) i++;
  return { contactMs: Math.round((i / (samples.length - 1)) * duration), duration };
}

function svg(cls, children = '') {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `${-E} ${-E} ${2 * E} ${2 * E}`);
  el.setAttribute('class', cls);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = children;
  return el;
}

function arcD(r, a0, a1) {
  const [x0, y0] = polar(0, 0, r, a0);
  const [x1, y1] = polar(0, 0, r, a1);
  return `M${fmt(x0)} ${fmt(y0)}A${r} ${r} 0 0 1 ${fmt(x1)} ${fmt(y1)}`;
}

export default async function init(root, ctx) {
  const { motion, sound, dom } = ctx;
  const { h, prng } = dom;
  const st = root.querySelector('.st');
  const box = st.querySelector('[data-node]');
  const $ = (sel) => st.querySelector(sel);
  const $$ = (sel) => Array.from(st.querySelectorAll(sel));

  // ---------------------------------------------------------------- the node, layer by layer

  const nodeSVG = (state) => fromMarkup(renderNodeSVG({ state, lineId: LINE, extent: E, size: 100, pulse: 'none' }));

  // Pulse (CSS loop on transform/opacity, running only while the section is on screen).
  const pulse = h('div', { class: 'st__pulse' }, h('i', { class: 'st__ember' }), h('i', { class: 'st__wave' }), h('i', { class: 'st__still' }));

  // Stance ring: four arcs, each drawn through its own mask so it can grow clockwise and keep its dash.
  const ring = svg(
    'st__ring',
    `<defs>${STANCES.map((s) => {
      const [a0, a1] = STANCE_RING.arcs[s];
      return `<mask id="st-arc-${s}" maskUnits="userSpaceOnUse" x="${-E}" y="${-E}" width="${2 * E}" height="${2 * E}"><path d="${arcD(STANCE_RING.r, a0, a1)}" fill="none" stroke="#fff" stroke-width="7" pathLength="1" stroke-dasharray="1 1"/></mask>`;
    }).join('')}</defs>${STANCES.map((s) => {
      const [a0, a1] = STANCE_RING.arcs[s];
      return `<path class="st__arc st__arc--${s}" d="${arcD(STANCE_RING.r, a0, a1)}" mask="url(#st-arc-${s})"/>`;
    }).join('')}`,
  );
  const arcMask = Object.fromEntries(STANCES.map((s) => [s, ring.querySelector(`#st-arc-${s} path`)]));

  // Bodies: the map's node per state. The landed one is split so its hard shadow can snap in on contact.
  const landed = nodeSVG('landed');
  const shadowCircle = landed.querySelector('circle[cx="2"]');
  const landedShadow = landed.cloneNode(false);
  if (shadowCircle) landedShadow.append(shadowCircle);
  const check = landed.querySelector('path');
  const onLock = nodeSVG('onLock');

  // On-lock move pieces, measured off the canonical on-lock drawing so they match it exactly.
  const discs = Array.from(onLock.querySelectorAll('circle'))
    .filter((c) => !+c.getAttribute('cx'))
    .map((c) => ({ r: +c.getAttribute('r'), fill: c.getAttribute('fill') }))
    .sort((a, b) => b.r - a.r); // paper 14.9, ink 13.7, paper 12.5, lit 10, ink core 5.5, paper bullseye 2
  const [outer, keyline, border] = discs;
  const core = discs[discs.length - 2];
  const bull = discs[discs.length - 1];
  const band = (r0, r1, color) =>
    `<circle r="${fmt((r0 + r1) / 2)}" fill="none" stroke="${color}" stroke-width="${fmt(r1 - r0)}" pathLength="1" stroke-dasharray="1 1" transform="rotate(-90)"/>`;
  const fxRings = svg('st__fx st__fx--rings', band(border.r, keyline.r, keyline.fill) + band(keyline.r, outer.r, outer.fill));
  const fxCore = svg('st__fx st__fx--core', `<circle r="${core.r}" fill="${core.fill}"/><circle r="${bull.r}" fill="${bull.fill}"/>`);
  const ringBands = Array.from(fxRings.querySelectorAll('circle'));

  // Grind sparks: 10 bars in the upper half-plane, paper and red (deterministic).
  const rnd = prng(69);
  const sparks = h(
    'div',
    { class: 'st__sparks' },
    Array.from({ length: 10 }, (_, i) => {
      const a = -168 + (i + 0.15 + rnd() * 0.7) * (156 / 10);
      return h('i', {
        class: ['st__spark', i % 3 === 1 && 'st__spark--red'],
        style: { '--len': `calc(var(--u) * ${fmt(6 + rnd() * 7)})`, '--th': `calc(var(--u) * ${fmt(1.05 + rnd() * 0.75)})` },
        dataset: { a: fmt(a), r: fmt(14.2 + rnd() * 1.4), d: String(Math.round(rnd() * 36)) },
      });
    }),
  );

  const layer = (state, ...children) => h('div', { class: `st__layer st__layer--${state}` }, ...children);
  const L = {
    locked: layer('locked', nodeSVG('locked')),
    available: layer('available', nodeSVG('available')),
    learning: layer('learning', nodeSVG('learning')),
    landed: layer('landed', h('div', { class: 'st__layer st__shadow' }, landedShadow), h('div', { class: 'st__layer st__sticker' }, landed)),
    onLock: layer('onLock', onLock),
  };
  const sticker = L.landed.querySelector('.st__sticker');
  const shadow = L.landed.querySelector('.st__shadow');
  sticker.style.visibility = shadow.style.visibility = 'inherit';
  // One paper-white frame on the node at the moment of contact (the celebration's hit-stop frame).
  const flash = h('i', { class: 'st__flash' });
  box.prepend(pulse, ring, L.locked, L.available, L.learning, L.landed, L.onLock, fxRings, fxCore, flash, sparks);

  // Building the node's layers is the heavy step; measuring and fitting run as a new task.
  await ctx.yield?.();

  // ---------------------------------------------------------------- the rest of the stage

  const pool = $('.st__pool');
  const edgeIn = $('.st__edge--in');
  const edgeOut = $('.st__edge--out');
  const tag = $('.st__tag');
  const bait = $('.st__bait');
  const cells = $$('.st__day');
  const dots = $$('.st__daydot');
  const stamp = $('.st__stamp');
  const plus = $('.st__plus');
  const wordLight = $('.st__half--light .st__word');
  const labels = Object.fromEntries(STANCES.map((s) => [s, $(`.st__sl--${s}`)]));
  const bySay = (sel, i) => $(`${sel} > :nth-child(${i + 1})`);

  // ---------------------------------------------------------------- fit (phones)
  // In the stacked layout the node gets whatever height the headline and the panel leave (the panel's type is in
  // rem, so it grows with the reader's text size and takes room from the stage). --u (one map pt) is lowered
  // from its CSS value until the ring, its stance labels, the name and the day cells fit. The labels have a
  // readable floor in px: when the ring gets too small to hold them inside its own square (15u + label > 22u),
  // the track takes that overflow as margin above and below, so they never reach the headline or the name.
  // When even that leaves the node small (an iPhone SE, a phone inside a chat app's browser, text at 200 %),
  // the stage goes .is-tight: the XP lines under the stance names step aside, the sentence takes the panel's
  // full width, and the ON LOCK stamp lands across the three day cells instead of under them; still smaller,
  // .is-tighter drops the panel's footnote too (the list keeps all of it for screen readers). Nothing overlaps
  // at any size.
  const stage = $('.st__stage');
  const track = $('.st__track');
  const under = $('.st__under');
  const TIGHT_U = 4.2; // below this the stage goes .is-tight
  const TIGHTER_U = 3.6; // and below this, still tight, .is-tighter
  function solve() {
    const cssU = track.offsetHeight / 44;
    const stageH = stage.clientHeight;
    const underH = under.offsetHeight;
    const slH = labels.normal.offsetHeight;
    let u = Math.min(cssU, (stageH - underH - 8) / 44);
    if (slH > 7 * u) u = Math.min(u, (stageH - underH - 8 - 2 * slH) / 30);
    u = Math.max(2.5, u);
    return { u, cssU, over: Math.max(0, slH - 7 * u) };
  }
  function fit() {
    st.style.removeProperty('--u');
    st.style.removeProperty('--over');
    st.classList.remove('is-tight', 'is-tighter');
    if (getComputedStyle(stage).position === 'absolute') return;
    let r = solve();
    if (r.u < TIGHT_U) {
      st.classList.add('is-tight');
      r = solve();
      if (r.u < TIGHTER_U) {
        st.classList.add('is-tighter');
        r = solve();
      }
    }
    if (r.u < r.cssU) st.style.setProperty('--u', `${r.u.toFixed(2)}px`);
    if (r.over > 0) st.style.setProperty('--over', `${Math.ceil(r.over)}px`);
  }
  fit();
  if ('ResizeObserver' in window) {
    // the stage's box, and the panel's: its rem type grows when the reader changes the text size
    const ro = new ResizeObserver(() => requestAnimationFrame(fit));
    ro.observe(st);
    ro.observe($('.st__panel'));
  }
  else addEventListener('resize', fit);
  document.fonts?.ready?.then(fit);

  // ---------------------------------------------------------------- frames and moves

  let timers = [];
  let anims = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms));
  const keep = (a) => (anims.push(a), a);
  const play = (el, keyframes, opts) => keep(motion.animate(el, keyframes, opts));

  function set(attrs) {
    for (const [k, v] of Object.entries(attrs)) if (st.dataset[k] !== String(v)) st.dataset[k] = String(v);
  }
  function stopAll() {
    timers.forEach(clearTimeout);
    timers = [];
    anims.forEach((a) => a.cancel?.());
    anims = [];
    fxRings.style.visibility = fxCore.style.visibility = '';
  }
  const apply = (s) => set(FRAMES[s]);

  const unit = () => box.offsetWidth / (2 * E);

  // The panel: counter slams, chip pops, the sentence lands with a settle.
  function say(i) {
    set({ say: i });
    keep(motion.slam(bySay('.st__count .st__stack', i), { from: 1.45, dy: -8 }));
    keep(motion.pop(bySay('.st__chip', i), { from: 1.35 }));
    play(bySay('.st__say', i), [{ transform: 'translateY(16px)' }, { transform: 'none' }], { spring: 'settle' });
  }

  // A paper head runs along an edge and leaves it reachable (DESIGN §8.2).
  function runEdge(edge, ms) {
    const w = edge.offsetWidth;
    const run = edge.querySelector('.st__run');
    const sweep = edge.querySelector('.st__sweep');
    const hw = run.offsetWidth;
    play(run, [{ opacity: 1, transform: `translateX(${-hw}px)` }, { opacity: 1, transform: `translateX(${w}px)` }], { duration: ms, easing: 'linear', fill: 'none' });
    play(sweep, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
  }
  const edgeMs = (edge) => Math.max(320, Math.min(620, edge.offsetWidth * 0.75));

  function sparksOut() {
    const u = unit();
    for (const el of sparks.children) {
      const a = +el.dataset.a;
      const r = +el.dataset.r * u;
      const len = el.offsetWidth;
      play(
        el,
        [
          { transform: `rotate(${a}deg) translateX(${r}px) scaleX(0)` },
          { transform: `rotate(${a}deg) translateX(${r}px) scaleX(1)`, offset: 0.42 },
          { transform: `rotate(${a}deg) translateX(${r + len}px) scaleX(0)` },
        ],
        { duration: 240, delay: +el.dataset.d, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'none' },
      );
    }
  }

  const slap = (dot, delay = 0) => keep(motion.pop(dot, { from: 1.9, delay }));

  const MOVES = {
    // 0 → 1: the head runs in from Ollie, the node pops open, the dashes close, the bait comes up.
    1() {
      say(1);
      const ms = edgeMs(edgeIn);
      runEdge(edgeIn, ms);
      later(ms - 40, () => {
        set({ state: 'available' });
        play(L.available, (v) => ({ transform: `scale(${(0.7 + 0.3 * v).toFixed(4)})` }), { spring: 'pop' });
        play(bait, [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: 90, easing: 'out' });
        sound.play('tick');
      });
    },
    // 1 → 2: stripes slam on, the pulse starts, the ring grows its arcs in reading order, the tag slaps on.
    2() {
      say(2);
      set({ state: 'learning' });
      play(L.learning, (v) => ({ transform: `scale(${(1.32 - 0.32 * v).toFixed(4)})` }), { spring: 'slam' });
      STANCES.forEach((s, k) => {
        play(arcMask[s], [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], { duration: 240, delay: 140 + k * 130, easing: 'out' });
        play(labels[s], (v) => ({ opacity: v > 0 ? 1 : 0, transform: `scale(${(0.55 + 0.45 * v).toFixed(4)})` }), { spring: 'pop', delay: 190 + k * 130 });
      });
      keep(motion.pop(tag, { from: 1.6, delay: 90 }));
      play($('.st__note'), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 420, easing: 'out' });
      sound.play('tick');
    },
    // 2 → 3: the sticker drops (1.6× → 1, pop spring, −10°), the shadow snaps in on contact, sparks, the light
    // comes on, the head runs on to Varial Kickflip, day one is in.
    3() {
      set({ state: 'landed' });
      const drop = motion.animate(sticker, (v) => ({ transform: `rotate(${(-14 * (1 - v)).toFixed(3)}deg) scale(${(1.6 - 0.6 * v).toFixed(4)})` }), { spring: 'pop' });
      keep(drop);
      const { contactMs, duration } = springContact(motion, 'pop');
      const c = Math.min(0.99, contactMs / duration);
      play(shadow, [{ opacity: 0 }, { opacity: 0, offset: c }, { opacity: 1, offset: c }, { opacity: 1 }], { duration, easing: 'linear' });
      later(contactMs, () => {
        set({ lit: 1 });
        say(3);
        play(flash, [{ opacity: 1 }, { opacity: 1, offset: 0.99 }, { opacity: 0 }], { duration: 50, easing: 'linear', fill: 'none' });
        sparksOut();
        keep(motion.shake(box, 3));
        play(pool, [{ opacity: 0 }, { opacity: 0.62 }], { duration: 520, easing: 'out' });
        keep(motion.slam(wordLight, { from: 1.1, dy: 0 }));
        sound.play('sticker');
      });
      later(contactMs + 150, () => runEdge(edgeOut, edgeMs(edgeOut)));
      later(contactMs + 230, () => {
        set({ days: 1 });
        cells.forEach((cell, k) => keep(motion.pop(cell, { from: 0.8, delay: k * 70 })));
        slap(dots[0], 140);
      });
      later(contactMs + 150 + edgeMs(edgeOut), () => set({ out: 1 }));
    },
    // 3 → 4: a second day.
    4() {
      set({ days: 2 });
      slap(dots[1]);
      sound.play('tick');
    },
    // 4 → 5: the third day, then on lock: the check wipes out, core and bullseye punch in, the second ring
    // draws clockwise from 12 o'clock, the stamp hits across the three days, +55 XP rises (DESIGN §8.4).
    5() {
      set({ days: 3 });
      slap(dots[2]);
      sound.play('tick');
      const len = check.getTotalLength?.() || 16;
      later(250, () => {
        play(check, [{ strokeDasharray: `${len} ${len}`, strokeDashoffset: '0' }, { strokeDasharray: `${len} ${len}`, strokeDashoffset: `${-len}` }], { duration: 110, easing: 'in', fill: 'forwards' });
      });
      later(360, () => {
        say(4);
        fxRings.style.visibility = fxCore.style.visibility = 'visible';
        play(fxCore, (v) => ({ transform: `scale(${(1.9 - 0.9 * v).toFixed(4)})` }), { spring: 'slam' });
        ringBands.forEach((b) => play(b, [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], { duration: 300, easing: 'standard' }));
        sound.play('lock');
      });
      later(670, () => {
        set({ state: 'onLock' });
        fxRings.style.visibility = fxCore.style.visibility = '';
        play(stamp, [{ opacity: 0, transform: 'scale(1.5)', easing: 'cubic-bezier(.7,0,.84,0)' }, { opacity: 1, transform: 'none', offset: 0.5 }, { transform: 'translate(2px, 2px)', offset: 0.72 }, { transform: 'none' }], { duration: 190, delay: 30, easing: 'linear' });
        play(plus, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 160, easing: 'out' });
      });
    },
  };
  const SOUND = { 1: 'tick', 2: 'tick', 3: 'sticker', 4: 'tick', 5: 'lock' };

  // ---------------------------------------------------------------- scroll

  let step = -1;
  let visible = false;
  const rail = $$('.st__rail b');
  const railAt = rail.map(() => -1);
  function fillRail(p) {
    SPANS.forEach(([a, b], k) => {
      const f = Math.round(Math.min(1, Math.max(0, (p - a) / (b - a))) * 1000) / 1000;
      if (f !== railAt[k]) {
        railAt[k] = f;
        rail[k].style.transform = `scaleX(${f})`;
      }
    });
  }

  function go(next) {
    if (next === step) return;
    const prev = step;
    step = next;
    stopAll();
    const forward = prev >= 0 && next > prev;
    if (forward && visible && !ctx.reduced) {
      apply(next - 1);
      MOVES[next]();
      return;
    }
    apply(next);
    if (forward && visible) sound.play(SOUND[next]);
  }

  ctx.onReducedChange(() => {
    stopAll();
    if (step >= 0) apply(step);
  });

  return {
    progress(p) {
      fillRail(p);
      go(stepAt(p));
    },
    enter() {
      visible = true;
      st.classList.add('is-on');
    },
    leave() {
      visible = false;
      st.classList.remove('is-on');
      stopAll();
      if (step >= 0) apply(step);
    },
  };
}
