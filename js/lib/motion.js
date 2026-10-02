// Motion: the app's easings and springs (docs/design/DESIGN.md §8) for the Web Animations API.
//
//   import * as motion from './motion.js'           (sections get it as ctx.motion)
//   motion.animate(el, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'out' })
//   motion.animate(el, (v) => ({ transform: `scale(${1.6 - 0.6 * v})` }), { spring: 'pop' })   // sampled spring
//   motion.animate(el, [{ transform: 'scale(.8)' }, { transform: 'none' }], { spring: 'pop' })  // spring as easing
//   await motion.slam(nameEl).finished;  motion.pop(stickerEl, { from: 1.6 });  motion.shake(screenEl, 3)
//   await motion.countUp(xpEl, 0, 160, 600);  await motion.sleep(80);  await motion.frame();
//
// Reduced motion (live): animate() jumps to the last keyframe (or does a 120 ms opacity fade with
// { reduced: 'fade' }); slam/pop cross-fade 120 ms; shake does nothing; countUp writes the final number.
// Animate transform and opacity only. Primitives tilt with the CSS `rotate` / `translate` properties, so
// a `transform` animation composes with their tilt instead of replacing it.
// A finished fill does not stay alive for nothing: once the element rests on the end state without it, it is let
// go at idle (dropFill, below; { keep: true } opts out). Where the CSS already holds the end state, pass
// fill: 'backwards' and there is nothing to let go.

import { formatNumber } from './dom.js';

// ---------------------------------------------------------------- reduced motion

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedListeners = new Set();
let forcedReduced = null;
export const isReduced = () => (forcedReduced ?? mq?.matches) === true;
/** fn(reduced) on every change; returns an unsubscribe. */
export function onReducedChange(fn) {
  reducedListeners.add(fn);
  return () => reducedListeners.delete(fn);
}
mq?.addEventListener?.('change', () => reducedListeners.forEach((fn) => fn(isReduced())));
/** QA / kit only: force reduced motion on (true), off (false) or back to the system setting (null). */
export function forceReduced(value) {
  forcedReduced = value;
  reducedListeners.forEach((fn) => fn(isReduced()));
}

// ---------------------------------------------------------------- durations and easings

export const DURATION = { instant: 80, fast: 120, base: 200, slow: 350, enter: 450, screen: 320 };

/** CSS easing strings (the same as the --ease-* tokens). */
export const EASING = {
  standard: 'cubic-bezier(.2,0,0,1)',
  out: 'cubic-bezier(.16,1,.3,1)',
  in: 'cubic-bezier(.7,0,.84,0)',
  linear: 'linear',
  stampOvershoot: 'cubic-bezier(.34,1.56,.64,1)',
};

function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      const d = dx(t);
      if (Math.abs(err) < 1e-5) break;
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    if (t < 0 || t > 1) {
      // Bisection fallback.
      let lo = 0;
      let hi = 1;
      t = x;
      for (let i = 0; i < 24; i++) {
        if (sx(t) < x) lo = t;
        else hi = t;
        t = (lo + hi) / 2;
      }
    }
    return sy(t);
  };
}

/** JS easing functions t → value for scrubbing in progress handlers: ease.out(p), ease.standard(p)… */
export const ease = {
  standard: bezier(0.2, 0, 0, 1),
  out: bezier(0.16, 1, 0.3, 1),
  in: bezier(0.7, 0, 0.84, 0),
  linear: (t) => t,
  stampOvershoot: bezier(0.34, 1.56, 0.64, 1),
};

// ---------------------------------------------------------------- springs

/** DESIGN.md §8 springs (mass 1). */
export const SPRINGS = {
  slam: { stiffness: 520, damping: 22, mass: 1 },
  pop: { stiffness: 380, damping: 18, mass: 1 },
  settle: { stiffness: 180, damping: 20, mass: 1 },
  sheet: { stiffness: 260, damping: 28, mass: 1 },
};

const springCache = new Map();
const SAMPLE_HZ = 120;

/**
 * Solves a damped spring from 0 to 1 (initial velocity `velocity`, units per second) by semi-implicit
 * Euler at 1 ms steps, until it rests (|x − 1| < 0.002 and |v| < 0.02, at most 2 s).
 * Returns { duration (ms), samples (Float32Array at 120 Hz, last = 1), at(t01) → value }.
 */
export function solveSpring(spec = 'pop', velocity = 0) {
  const s = typeof spec === 'string' ? SPRINGS[spec] : spec;
  if (!s) throw new Error(`motion: no spring "${spec}"`);
  const key = `${s.stiffness}/${s.damping}/${s.mass ?? 1}/${velocity}`;
  const cached = springCache.get(key);
  if (cached) return cached;
  const m = s.mass ?? 1;
  let x = 0;
  let v = velocity;
  const out = [0];
  const dt = 0.001;
  const stepEvery = Math.round(1 / SAMPLE_HZ / dt);
  let t = 0;
  for (let i = 1; i <= 2000; i++) {
    const a = (-s.stiffness * (x - 1) - s.damping * v) / m;
    v += a * dt;
    x += v * dt;
    t = i;
    if (i % stepEvery === 0) out.push(x);
    if (i > 50 && Math.abs(x - 1) < 0.002 && Math.abs(v) < 0.02) break;
  }
  out.push(1);
  const samples = Float32Array.from(out);
  const duration = Math.max(t, (samples.length - 1) * (1000 / SAMPLE_HZ));
  const at = (p) => {
    if (p <= 0) return 0;
    if (p >= 1) return 1;
    const f = p * (samples.length - 1);
    const i = Math.floor(f);
    return samples[i] + (samples[i + 1] - samples[i]) * (f - i);
  };
  const result = { duration: Math.round(duration), samples, at };
  springCache.set(key, result);
  return result;
}

const linearSupported = typeof CSS !== 'undefined' && CSS.supports?.('animation-timing-function', 'linear(0, 1)');

/**
 * The spring as a WAAPI/CSS easing + duration: { easing: 'linear(…)', duration }. Where linear() is not
 * supported (Safari < 17.2) the easing falls back to the `out` curve (no overshoot) over the same duration.
 */
export function springEasing(spec = 'pop', velocity = 0) {
  const s = solveSpring(spec, velocity);
  if (!linearSupported) return { easing: EASING.out, duration: s.duration };
  const n = s.samples.length;
  const stride = Math.max(1, Math.round(n / 48));
  const points = [];
  for (let i = 0; i < n; i += stride) points.push(`${+s.samples[i].toFixed(4)} ${+((i / (n - 1)) * 100).toFixed(2)}%`);
  points.push('1 100%');
  return { easing: `linear(${points.join(', ')})`, duration: s.duration };
}

/**
 * Sampled WAAPI keyframes for a spring: `frame(v)` maps the spring value (0 → 1, overshooting) to a
 * keyframe object. Returns { keyframes, duration }. Works in every browser (no linear() needed).
 */
export function springKeyframes(spec, frame, velocity = 0) {
  const s = solveSpring(spec, velocity);
  const n = s.samples.length;
  const stride = Math.max(1, Math.round(n / 40));
  const keyframes = [];
  for (let i = 0; i < n; i += stride) keyframes.push({ ...frame(s.samples[i]), offset: i / (n - 1) });
  keyframes.push({ ...frame(1), offset: 1 });
  return { keyframes, duration: s.duration };
}

// ---------------------------------------------------------------- animate

const DONE = Object.freeze({ finished: Promise.resolve(), cancel() {}, finish() {}, pause() {}, play() {} });

function lastFrame(keyframes) {
  if (typeof keyframes === 'function') return keyframes(1);
  if (Array.isArray(keyframes)) {
    const { offset, easing, composite, ...rest } = keyframes[keyframes.length - 1] ?? {};
    return rest;
  }
  // Property-indexed form: { opacity: [0, 1] }.
  const out = {};
  for (const [k, v] of Object.entries(keyframes)) if (k !== 'offset' && k !== 'easing') out[k] = Array.isArray(v) ? v[v.length - 1] : v;
  return out;
}

// ---------------------------------------------------------------- finished fills

// A finished animation with fill 'both' / 'forwards' stays in its element's animation stack and overrides its style
// on every recalc for as long as the element lives — after one scroll that was 56 of them (the trick's dealt parts,
// the plan's deck…). Most finish exactly where the element rests without them: the part was dealt in to its place,
// and the CSS or inline style already holds that end. Those are let go (fill → 'none'): nothing on screen changes and
// nothing keeps them alive. One whose end differs from what the element would show keeps filling, so a reset that
// cancels it — a stored animation's cancel(), or el.getAnimations().forEach((a) => a.cancel()) — works as before.
// Checked in one batch when the main thread is idle: two style reads for the whole batch.

const fillQueue = new Set();
let fillQueued = false;
const idle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1000 }) : setTimeout(fn, 250));

/** The CSS properties an effect animates (camelCase as getKeyframes gives them, custom properties as --name). */
function propsOf(effect) {
  const out = new Set();
  try {
    for (const k of effect.getKeyframes()) for (const p of Object.keys(k)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(p)) out.add(p);
  } catch {
    /* no keyframes */
  }
  return out;
}
const read = (cs, p) => (p.startsWith('--') ? cs.getPropertyValue(p) : cs[p]) ?? '';
const nums = (v) => (String(v).match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
const IDENTITY = { scale: '1', rotate: '0deg', translate: '0px' };
/** Two computed values that look the same on screen (transforms compared as matrices). */
function sameValue(p, a, b) {
  if (a === b) return true;
  if (p === 'transform') {
    try {
      const ma = new DOMMatrixReadOnly(a === 'none' ? undefined : a).toFloat64Array();
      const mb = new DOMMatrixReadOnly(b === 'none' ? undefined : b).toFloat64Array();
      return ma.every((v, i) => Math.abs(v - mb[i]) < 1e-3);
    } catch {
      return false;
    }
  }
  if (p in IDENTITY || p === 'opacity') {
    const na = nums(a === 'none' ? IDENTITY[p] : a);
    const nb = nums(b === 'none' ? IDENTITY[p] : b);
    const n = Math.max(na.length, nb.length);
    const pad = (arr, i) => arr[i] ?? (p === 'scale' && i === 1 ? arr[0] : p === 'scale' ? 1 : 0);
    if (p === 'rotate' && na.length !== nb.length) return false; // an axis on one side only: compare as strings
    for (let i = 0; i < n; i++) if (Math.abs(pad(na, i) - pad(nb, i)) > 1e-3) return false;
    return n > 0;
  }
  return false;
}

function releaseFills() {
  fillQueued = false;
  const items = [];
  for (const anim of fillQueue) {
    const effect = anim.effect;
    const el = effect?.target;
    if (!el?.isConnected || effect.pseudoElement || anim.playState !== 'finished') continue;
    const fill = effect.getTiming().fill;
    if (fill !== 'both' && fill !== 'forwards') continue;
    const props = propsOf(effect);
    if (!props.size) continue;
    // Another animation on the element touching the same properties (running, paused or held): leave it all be.
    const shared = el.getAnimations().some((other) => other !== anim && [...propsOf(other.effect ?? {})].some((p) => props.has(p)));
    if (shared) continue;
    items.push({ anim, effect, fill, el, props: [...props] });
  }
  fillQueue.clear();
  if (!items.length) return;
  const styles = new Map();
  const cs = (el) => styles.get(el) ?? styles.set(el, getComputedStyle(el)).get(el);
  for (const it of items) it.held = it.props.map((p) => read(cs(it.el), p)); // with the fill
  for (const it of items) it.effect.updateTiming({ fill: 'none' });
  for (const it of items) {
    const bare = it.props.map((p) => read(cs(it.el), p)); // without it
    if (!it.props.every((p, i) => sameValue(p, it.held[i], bare[i]))) it.effect.updateTiming({ fill: it.fill }); // keep it
  }
}

/**
 * Lets a fill-forward animation go once it has finished, if the element then rests on its end state anyway (see
 * above). motion.animate() does this by itself (unless { keep: true }); for a raw el.animate(…) call it yourself.
 */
export function dropFill(anim) {
  anim?.finished
    ?.then(() => {
      fillQueue.add(anim);
      if (!fillQueued) {
        fillQueued = true;
        idle(releaseFills);
      }
    })
    .catch(() => {}); // cancelled: nothing to let go
  return anim;
}

/**
 * el.animate with the design's vocabulary. Returns the Animation (or an already-finished stand-in).
 *   keyframes  array / property-indexed object, or a function v → keyframe (sampled along `spring`)
 *   opts       duration (ms) · easing ('standard' | 'out' | 'in' | 'linear' | any CSS easing)
 *              spring ('slam' | 'pop' | 'settle' | 'sheet' | { stiffness, damping, mass }) — sets easing + duration
 *              delay · fill (default 'both') · composite · reduced ('end' default | 'fade' | 'run')
 *              keep (default false): a finished fill is let go at idle when the element already rests on its end
 *              state (dropFill); true keeps it alive. Where the CSS holds the end state, fill: 'backwards' is
 *              cheaper still (nothing to check).
 */
export function animate(el, keyframes, opts = {}) {
  if (!el?.animate) return DONE;
  const { spring, delay = 0, fill = 'both', composite, reduced = 'end', keep = false } = opts;
  const settle = (anim) => (keep || (fill !== 'both' && fill !== 'forwards') ? anim : dropFill(anim));
  if (isReduced() && reduced !== 'run') {
    const end = lastFrame(keyframes);
    const a = el.animate([end, end], { duration: 0, fill: 'forwards', delay: 0 });
    if (reduced === 'fade') {
      const fade = el.animate([{ opacity: 0 }, { opacity: end.opacity ?? 1 }], { duration: DURATION.fast, easing: EASING.out, fill: 'backwards' });
      if (!keep) fade.finished.then(() => dropFill(a), () => {}); // the end state, once the fade over it is done
      return fade;
    }
    return keep ? a : dropFill(a);
  }
  let frames = keyframes;
  let duration = opts.duration ?? DURATION.base;
  let easing = EASING[opts.easing] ?? opts.easing ?? EASING.standard;
  if (typeof keyframes === 'function') {
    const s = springKeyframes(spring ?? 'pop', keyframes, opts.velocity ?? 0);
    frames = s.keyframes;
    duration = opts.duration ?? s.duration;
    easing = 'linear';
  } else if (spring) {
    const s = springEasing(spring, opts.velocity ?? 0);
    easing = s.easing;
    duration = opts.duration ?? s.duration;
  }
  const options = { duration, easing, delay, fill };
  if (composite) options.composite = composite;
  return settle(el.animate(frames, options));
}

/**
 * The name slam (DESIGN §8.1): from scale `from` (1.35) and `dy` (−6 px, i.e. from above) to rest, spring
 * slam. Visible from the first frame (a hard cut, not a fade).
 */
export function slam(el, { from = 1.35, dy = -6, spring = 'slam', delay = 0 } = {}) {
  if (isReduced()) return animate(el, [{ opacity: 1, transform: 'none' }], { reduced: 'fade' });
  return animate(
    el,
    (v) => ({ opacity: 1, transform: `translate3d(0, ${(dy * (1 - v)).toFixed(2)}px, 0) scale(${(from + (1 - from) * v).toFixed(4)})` }),
    { spring, delay },
  );
}

/** Spring pop from scale `from` (0.8 unlock pop; 1.6 for the sticker drop) to 1. */
export function pop(el, { from = 0.8, spring = 'pop', delay = 0 } = {}) {
  if (isReduced()) return animate(el, [{ opacity: 1, transform: 'none' }], { reduced: 'fade' });
  return animate(el, (v) => ({ opacity: 1, transform: `scale(${(from + (1 - from) * v).toFixed(4)})` }), { spring, delay });
}

/** One hard shake of `px` (the celebration's 3 pt), ~260 ms. Nothing under reduced motion. */
export function shake(el, px = 3) {
  if (isReduced()) return DONE;
  const k = [0, -1, 0.85, -0.6, 0.35, -0.15, 0];
  return el.animate(
    k.map((f, i) => ({ transform: `translate3d(${(f * px).toFixed(2)}px, ${(i % 2 ? 0.4 : -0.4) * f * px}px, 0)`, offset: i / (k.length - 1) })),
    { duration: 260, easing: 'linear' },
  );
}

/**
 * Counts el's text from `from` to `to` over `ms` (ease-out), formatted with formatNumber (or opts.format).
 * Resolves when done. Reduced motion: writes the final value at once.
 */
export function countUp(el, from, to, ms = 600, { format = formatNumber, easing = ease.out, prefix = '', suffix = '' } = {}) {
  const write = (v) => {
    el.textContent = `${prefix}${format(v)}${suffix}`;
  };
  if (isReduced() || ms <= 0) {
    write(to);
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const start = performance.now();
    let last = null;
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const v = Math.round(from + (to - from) * easing(p));
      if (v !== last) write(v);
      last = v;
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Resolves after `ms`. */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves on the next animation frame (with its timestamp). */
export const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Resolves after two frames: styles applied and painted. */
export const frames2 = () => frame().then(frame);
