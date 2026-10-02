// Section "yours": No account. No ads. No feed. + "Already skating for years?"
//
// Part 1 — three poster words on paper, each struck through by an ink marker that draws itself as the word
// crosses the middle of the screen (stroke-dashoffset scrubbed by ctx.scroll.track; under reduced motion the
// strokes are simply there).
//
// Part 2 — the app's onboarding import on the live map. The map starts dark (preset 'fresh') and is framed on
// three segments, Ollies, Shuvits and Flips, with Basics' trunk coming in from the top: the whole city is the
// hero's and the finale's picture, not this one's. Tick a chip, or tap any trick on the map, and
// map.focusPrereqs(id, { light: true }) lights the chain root → trick: a 'tick' a semitone higher for every node,
// the rolling bed under the wave and a 'land' on the last node (docs/design/sound.md, the import wave). When the
// wave has played, the chain is committed to the map (setState 'landed') and the focus lets go, so chains add up
// into a lit district. Untick: the trick and everything that stood on it go dark again. 360 Flip ticks itself
// once, the first time the map comes into view (unless the visitor got there first) — and Kickflip, the page's
// trick, lights up on the way as one of the tricks it builds on: the point of an import.

import { createMap, renderNodeSVG } from '../map/index.js';

const STAGGER = 120; // ms between two lit nodes (the map's default is 90; the wave reads better a touch slower)
const LEAD = 180; // the map lights the first node this long after focusPrereqs
const POP = 420; // a node's pop
const HOLD = 700; // the lit chain keeps the focus this long after its last pop
const DIM = 0.62;
const DEMO = '360-flip';
// The frame: these tricks' nodes (Ollie's row down to the 360 Flip row, Bigspin to BS Flip) — every chip's trick in
// view. A zoom between OVERVIEW_MAX and MID_MIN would show the labels half faded in: it snaps to the overview tier.
const FRAME_IDS = ['ollie', 'fs-180', 'heelflip', 'kickflip', 'bigspin', 'varial-heelflip', '360-flip', 'impossible', 'inward-heelflip', 'bs-flip'];
const OVERVIEW_MAX = 0.45;
const MID_MIN = 0.54;
const SNAP_UP = 0.49;
const TAG_MS = 2600; // how long the landed trick's name stays pinned to its node
const QUEUE_HOLD = 260; // the hold before the next queued chain starts

/**
 * A hand-drawn marker stroke across a word, in the SVG box's own pixels (the box overshoots the word by 7 %
 * on each side). Three different hands: a hard double pass, one steep slash, a pass with a short hook back.
 */
function strikePath(i, w, h, rnd) {
  const j = (a) => (rnd() - 0.5) * 2 * a;
  const X = (f) => (f * w).toFixed(1);
  const Y = (f) => (f * h).toFixed(1);
  const c = 0.5; // the middle of the caps
  if (i === 0) {
    // one long pass, rising a little, and a short flick back where the pen leaves the paper
    return (
      `M${X(0.03)} ${Y(c + 0.08 + j(0.015))}` +
      `C${X(0.3)} ${Y(c + 0.07 + j(0.02))} ${X(0.64)} ${Y(c - 0.02 + j(0.02))} ${X(0.975)} ${Y(c - 0.06)}` +
      `C${X(0.992)} ${Y(c - 0.065)} ${X(0.996)} ${Y(c + 0.0)} ${X(0.948)} ${Y(c + 0.04)}`
    );
  }
  if (i === 1) {
    // one steep slash
    return `M${X(0.03)} ${Y(c + 0.17 + j(0.02))}C${X(0.3)} ${Y(c + 0.11)} ${X(0.66)} ${Y(c - 0.05 + j(0.02))} ${X(0.972)} ${Y(c - 0.17)}`;
  }
  // a flat pass with a hook back
  return (
    `M${X(0.035)} ${Y(c + 0.03 + j(0.02))}` +
    `C${X(0.34)} ${Y(c + 0.06)} ${X(0.7)} ${Y(c - 0.03 + j(0.02))} ${X(0.972)} ${Y(c - 0.03)}` +
    `C${X(0.995)} ${Y(c - 0.028)} ${X(0.995)} ${Y(c + 0.05)} ${X(0.955)} ${Y(c + 0.06)}` +
    `C${X(0.9)} ${Y(c + 0.068)} ${X(0.84)} ${Y(c + 0.075)} ${X(0.78)} ${Y(c + 0.085 + j(0.01))}`
  );
}

export default function init(root, ctx) {
  const { $, $$, clamp, prng } = ctx.dom;
  const { ease } = ctx.motion;
  const offs = [];

  // ================================================================ part 1: the marker

  // Each stroke is drawn twice: a wider paper stroke first, cutting the letters around the marker, so the ink
  // line reads as a separate pass over the ink type instead of melting into it.
  const strikes = $$('.yours-word', root).map((word, i) => {
    const svg = $('svg', word);
    const path = $('path', svg);
    const halo = path.cloneNode();
    halo.setAttribute('class', 'is-halo');
    svg.insertBefore(halo, path);
    return { word, i, svg, path, halo, p: 0, v: -1, len: 0, w: 0, h: 0 };
  });

  function drawStrike(s, force = false) {
    if (!s.len) return;
    const v = ctx.reduced ? 1 : s.p;
    if (!force && Math.abs(v - s.v) < 1e-4) return;
    s.v = v;
    const opacity = v > 0.003 ? '1' : '0';
    const offset = (s.len * (1 - v)).toFixed(1);
    for (const el of [s.halo, s.path]) {
      el.style.opacity = opacity;
      el.style.strokeDashoffset = offset;
    }
  }
  function shapeStrike(s) {
    const box = s.svg.getBoundingClientRect();
    const w = Math.round(box.width);
    const h = Math.round(box.height);
    if (!w || !h || (w === s.w && h === s.h)) return;
    s.w = w;
    s.h = h;
    s.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const d = strikePath(s.i, w, h, prng(41 + s.i * 13));
    const ink = h * (s.i === 1 ? 0.115 : 0.105);
    const cut = Math.max(2.5, h * 0.028);
    s.path.setAttribute('d', d);
    s.halo.setAttribute('d', d);
    s.path.setAttribute('stroke-width', ink.toFixed(1));
    s.halo.setAttribute('stroke-width', (ink + 2 * cut).toFixed(1));
    s.len = Math.ceil(s.path.getTotalLength());
    for (const el of [s.halo, s.path]) el.style.strokeDasharray = `${s.len} ${s.len + 80}`;
    drawStrike(s, true);
  }
  for (const s of strikes) {
    offs.push(
      ctx.scroll.track(
        s.word,
        (p) => {
          // Drawn while the word crosses the middle band of the screen, with a hand's speed curve.
          s.p = ease.standard(clamp((p - 0.06) / 0.8));
          drawStrike(s);
        },
        { enter: 0.8, exit: 0.4 },
      ),
    );
  }
  const wordsBox = $('.yours-no__words', root);
  const strikeRO = new ResizeObserver(() => strikes.forEach(shapeStrike));
  if (wordsBox) strikeRO.observe(wordsBox);
  document.fonts?.ready?.then(() => strikes.forEach(shapeStrike));

  // ================================================================ part 2: the import

  const stage = $('[data-yours-stage]', root);
  const chips = $$('.yours-chip', root);
  const resetBtn = $('[data-yours-reset]', root);
  const live = $('[data-yours-live]', root);
  const tag = $('[data-yours-tag]', root);
  const tagName = $('[data-yours-tag-name]', root);
  const tagCode = $('[data-yours-tag-code]', root);
  const hud = {
    count: $('[data-yours-count]', root),
    noun: $('[data-yours-noun]', root),
    cells: $$('.yours-hud__spectrum .spectrum__cell > b', root),
  };

  let model = null;
  let map = null;
  let building = null;
  let visible = false;
  let touched = false;
  let demoTimer = 0;
  let demoPlayed = false;
  const gateways = new Set(); // node indices the visitor ticked
  let lit = new Set(); // node indices committed to the map as landed
  let wave = null;
  let shownTag = -1; // node index of the pinned name tag
  let hoverIdx = -1;
  let countAnim = null;
  const chipByIndex = new Map();
  const segLit = new Array(10).fill(0);
  let segCount = [];

  const dataReady = ctx.data('map').then((d) => {
    drawChipGlyphs(d);
    return d;
  });

  // ---------------------------------------------------------------- chips

  function drawChipGlyphs(d) {
    const index = new Map(d.nodes.map((n, i) => [n.id, i]));
    for (const chip of chips) {
      const i = index.get(chip.dataset.trick);
      if (i === undefined) {
        chip.closest('li')?.setAttribute('hidden', '');
        continue;
      }
      const node = d.nodes[i];
      const line = d.lines[node.l];
      const opts = { lineId: line.id, interchange: node.ix === 1, size: 30, extent: 16.5 };
      $('.yours-chip__glyph', chip).innerHTML =
        renderNodeSVG({ ...opts, state: 'available', className: 'is-off' }) + renderNodeSVG({ ...opts, state: 'landed', className: 'is-on' });
      chip.setAttribute('aria-label', ctx.t('chip', { trick: node.name, code: line.code }));
      chipByIndex.set(i, chip);
    }
  }

  function setChip(chip, on, pop = false) {
    if (!chip) return;
    const was = chip.getAttribute('aria-pressed') === 'true';
    if (was === on) return;
    chip.setAttribute('aria-pressed', String(on));
    if (pop && on) ctx.motion.pop($('.yours-chip__glyph', chip), { from: 0.5 });
  }
  function syncChips() {
    for (const [i, chip] of chipByIndex) setChip(chip, chipOn(i));
  }

  // ---------------------------------------------------------------- graph (the map's own: map.prereqsOf)

  /** Node indices of every trick node `i` builds on, roots first. */
  function upstream(i) {
    return new Set(map.prereqsOf(model.nodes[i].id).map((id) => model.indexOf.get(id)));
  }
  function closure(indices) {
    const out = new Set();
    for (const i of indices) {
      out.add(i);
      for (const j of upstream(i)) out.add(j);
    }
    return out;
  }

  // ---------------------------------------------------------------- HUD (the app's: English on both pages)

  function writeHud(n) {
    const text = String(n);
    if (hud.count.textContent !== text) {
      hud.count.textContent = text;
      if (!ctx.reduced && n > 0) {
        countAnim?.cancel();
        countAnim = ctx.motion.animate(hud.count, (v) => ({ transform: `scale(${(1.22 - 0.22 * v).toFixed(4)})` }), { spring: 'pop' });
      }
    }
    hud.noun.textContent = n === 1 ? ctx.t('trick') : ctx.t('tricks');
    hud.cells.forEach((b, k) => {
      const f = segCount[k] ? segLit[k] / segCount[k] : 0;
      b.style.transform = `scaleX(${f.toFixed(4)})`;
    });
  }
  function recountHud(extra = []) {
    segLit.fill(0);
    for (const i of lit) segLit[model.nodes[i].seg]++;
    for (const i of extra) segLit[model.nodes[i].seg]++;
    writeHud(lit.size + extra.length);
  }

  // ---------------------------------------------------------------- the name tag on the map

  function placeTag(i, popIt = false) {
    if (!map || i < 0) {
      tag.hidden = true;
      return;
    }
    const node = model.nodes[i];
    tagName.textContent = node.name;
    tagCode.textContent = model.lines[node.line].code;
    tag.hidden = false;
    const pt = map.toScreen(node.x, node.y);
    const W = stage.clientWidth;
    const tw = tag.offsetWidth;
    const th = tag.offsetHeight;
    let x = pt.x + 12;
    if (x + tw > W - 6) x = pt.x - 12 - tw;
    x = clamp(x, 6, Math.max(6, W - tw - 6));
    const y = clamp(pt.y - th - 10, 4, stage.clientHeight - th - 4);
    tag.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
    if (popIt) ctx.motion.pop(tag, { from: 0.6 });
  }
  // The landed trick's name pops on the land and comes off again: the lit map stays clean.
  let tagTimer = 0;
  function showTag(i, popIt = false) {
    shownTag = i;
    clearTimeout(tagTimer);
    if (i >= 0) {
      tagTimer = setTimeout(() => {
        shownTag = -1;
        if (hoverIdx < 0) placeTag(-1);
      }, TAG_MS);
    }
    if (hoverIdx < 0) placeTag(i, popIt);
  }

  // ---------------------------------------------------------------- the wave

  // One chain lights at a time; taps that come in while one is lighting wait their turn (their chips are on
  // at once), and the hold between two chains is short, so a quick run of taps reads as one long import.
  const queue = [];

  function startWave(target) {
    // Roots first, the order map.focusPrereqs lights them in (prereqsOf is already depth, then distance).
    const fresh = [...upstream(target), target].filter((i) => !lit.has(i));
    if (!fresh.length) return false;
    map.focusPrereqs(model.nodes[target].id, { light: true, stagger: STAGGER, dim: DIM });
    const reduced = ctx.reduced;
    wave = { target, fresh, start: performance.now(), next: 0, lastAt: reduced ? 0 : LEAD + (fresh.length - 1) * STAGGER, quiet: false, unsub: null };
    wave.unsub = ctx.ticker.subscribe(stepWave);
    return true;
  }

  function stepWave(dt, now) {
    const w = wave;
    if (!w) return;
    const t = now - w.start;
    const reduced = ctx.reduced;
    let fired = false;
    while (w.next < w.fresh.length && t >= (reduced ? 0 : LEAD + w.next * STAGGER)) {
      const k = w.next++;
      const last = k === w.fresh.length - 1;
      if (last) ctx.sound.play('land');
      else if (!reduced) ctx.sound.play('tick', { rate: 2 ** (Math.min(k, 16) / 12) });
      setChip(chipByIndex.get(w.fresh[k]), true, true);
      if (last) showTag(w.target, true);
      fired = true;
    }
    // The rolling bed under the wave (the app's import: "накат"), fading by itself after the last node.
    if (!reduced && t < w.lastAt + 60) ctx.sound.roll(0.55);
    if (fired) recountHud(w.fresh.slice(0, w.next));
    const hold = queue.length ? QUEUE_HOLD : reduced ? 900 : POP + HOLD;
    if (t >= w.lastAt + hold) finishWave({ next: true });
  }

  function commit(indices) {
    for (const i of indices) {
      if (lit.has(i)) continue;
      lit.add(i);
      map.setState(model.nodes[i].id, 'landed');
    }
  }

  /**
   * Commits the running wave at once (its end, a new untick, the section leaving). With `next`, the next queued
   * chain starts lighting; without it, every queued chain is committed too, silently.
   */
  function finishWave({ announce = true, next = false } = {}) {
    const w = wave;
    if (w) {
      wave = null;
      w.unsub?.();
      commit(w.fresh);
      if (announce && !w.quiet) say(ctx.t('lit', { trick: model.nodes[w.target].name, total: lit.size }));
    }
    let started = false;
    while (queue.length) {
      const i = queue.shift();
      if (next) {
        if (startWave(i)) {
          started = true;
          break;
        }
      } else commit(closure([i]));
    }
    if (!started) map?.clearFocus();
    syncChips();
    recountHud(wave ? wave.fresh.slice(0, wave.next) : []);
  }

  function chipOn(i) {
    if (lit.has(i) || queue.includes(i)) return true;
    if (!wave) return false;
    if (wave.target === i) return true;
    const k = wave.fresh.indexOf(i);
    return k >= 0 && k < wave.next;
  }

  function say(text) {
    if (!live) return;
    live.textContent = '';
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  }

  // ---------------------------------------------------------------- tick / untick / reset

  /** "Start over" keeps its place while it waits (data-off: visibility hidden), so showing it moves nothing. */
  function showReset(on) {
    resetBtn?.toggleAttribute('data-off', !on);
  }

  function tickIndex(i, { quiet = false } = {}) {
    if (chipOn(i)) return;
    gateways.add(i);
    setChip(chipByIndex.get(i), true, true);
    showReset(true);
    if (wave) {
      queue.push(i);
      return;
    }
    if (startWave(i)) wave.quiet = quiet;
  }

  function untickIndex(i) {
    finishWave({ announce: false });
    if (!lit.has(i)) return;
    for (const g of [...gateways]) if (g === i || upstream(g).has(i)) gateways.delete(g);
    const keep = closure(gateways);
    for (const j of lit) if (!keep.has(j)) map.setState(model.nodes[j].id, 'none');
    lit = keep;
    syncChips();
    if (!lit.has(shownTag)) showTag(-1);
    recountHud();
    ctx.sound.play('tick', { rate: 0.8 });
    say(ctx.t('off', { trick: model.nodes[i].name, total: lit.size }));
    if (!lit.size) showReset(false);
  }

  function resetAll() {
    finishWave({ announce: false });
    if (!map) return;
    gateways.clear();
    lit = new Set();
    map.setPreset('fresh');
    map.clearFocus();
    syncChips();
    showTag(-1);
    recountHud();
    ctx.sound.play('tick', { rate: 0.7 });
    say(ctx.t('reset'));
  }

  async function onChip(chip) {
    touched = true;
    clearTimeout(demoTimer);
    await ensureMap();
    const i = model.indexOf.get(chip.dataset.trick);
    if (i === undefined) return;
    if (chipOn(i)) untickIndex(i);
    else tickIndex(i);
  }
  for (const chip of chips) chip.addEventListener('click', () => onChip(chip));
  resetBtn?.addEventListener('click', () => {
    touched = true;
    resetAll();
    showReset(false);
    chips[0]?.focus({ preventScroll: true });
  });

  // ---------------------------------------------------------------- the map

  function reframe() {
    if (!map) return;
    const pad = stage.clientWidth >= 600 ? 44 : 22; // room for the labels of the outer rows where they show
    const fit = map.frame({ ids: FRAME_IDS }, null, { pad, maxZoom: 0.8 });
    // Never in the band where the labels are half faded in: up to the mid tier when that crops only a little
    // (the outermost columns' labels), down to the overview tier otherwise.
    const zoom = fit.zoom > OVERVIEW_MAX && fit.zoom < MID_MIN ? (fit.zoom >= SNAP_UP ? MID_MIN : OVERVIEW_MAX) : fit.zoom;
    map.setCamera(zoom === fit.zoom ? fit : map.frame({ ids: FRAME_IDS }, null, { pad, maxZoom: zoom, minZoom: zoom }));
    if (hoverIdx >= 0) placeTag(hoverIdx);
    else placeTag(shownTag);
  }

  function onMapTap(id) {
    touched = true;
    clearTimeout(demoTimer);
    if (!id) return;
    const i = model.indexOf.get(id);
    if (i === undefined) return;
    if (chipOn(i)) untickIndex(i);
    else tickIndex(i);
  }

  function onMapHover(id) {
    const i = id ? model.indexOf.get(id) ?? -1 : -1;
    if (i === hoverIdx) return;
    hoverIdx = i;
    placeTag(i >= 0 ? i : shownTag);
  }

  function ensureMap() {
    if (building) return building;
    building = dataReady.then((d) => {
      map = createMap(stage, {
        data: d,
        preset: 'fresh',
        // No segment tapes: framed on three segments, theirs would be cut at the stage's edges; the HUD row above
        // the map counts instead.
        tapes: false,
        reduced: ctx.reduced,
        lang: ctx.lang,
        tap: onMapTap,
        hover: onMapHover,
        onResize: () => reframe(),
      });
      model = map.model;
      segCount = model.segments.map((s) => s.count);
      reframe();
      map.setActive(visible);
      recountHud();
      return map;
    });
    building.catch((error) => console.error('[yours] the map did not start', error));
    return building;
  }

  function maybeDemo() {
    if (demoPlayed || touched || !visible) return;
    demoPlayed = true;
    clearTimeout(demoTimer);
    demoTimer = setTimeout(() => {
      if (touched || lit.size) return;
      if (!visible || !map) {
        demoPlayed = false; // scrolled past before it started: try again next time the map is in view
        return;
      }
      const i = model.indexOf.get(DEMO);
      // The demo is not the visitor's doing: it plays, but the screen reader is not told about it.
      if (i !== undefined) tickIndex(i, { quiet: true });
    }, ctx.reduced ? 200 : 650);
  }

  // Build the map a viewport ahead; run it only while it is on screen.
  const nearIO = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        ensureMap();
        nearIO.disconnect();
      }
    },
    { rootMargin: '100% 0px 100% 0px' },
  );
  const viewIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        visible = e.isIntersecting && e.intersectionRatio >= 0.35;
        const on = e.isIntersecting;
        map?.setActive(on);
        if (!on) finishWave({ announce: false });
        if (visible) ensureMap().then(maybeDemo);
      }
    },
    { threshold: [0, 0.35, 0.6] },
  );
  if (stage) {
    nearIO.observe(stage);
    viewIO.observe(stage);
  }

  offs.push(
    ctx.onReducedChange((reduced) => {
      map?.setReduced(reduced);
      strikes.forEach((s) => drawStrike(s, true));
    }),
  );

  return {
    enter() {},
    leave() {
      finishWave({ announce: false });
      map?.setActive(false);
    },
    /** QA (NBD.sections.yours.handlers.qa): the live map, once built. */
    qa: {
      get map() {
        return map;
      },
    },
  };
}
