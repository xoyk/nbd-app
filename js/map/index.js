// The live trick map for the web: the app's map (DESIGN.md §3, "One drawing") drawn into a Canvas 2D from the
// real layout (site/assets/data/map.json, built by scripts/site/map-data.mjs). No dependencies.
//
//   import { createMap, loadMapData, renderNodeSVG } from './js/map/index.js';
//   const data = await loadMapData();
//   const map = createMap(container, { data, preset: 'intermediate', reduced, lang });
//   map.setCamera(map.frame('overview'));
//   map.intro({ duration: 3200 });                  // or map.intro.seek(t) from a scroll
//   const fly = map.flight(map.frame('overview'), map.frame('kickflip', null, { zoom: 1 }));
//   map.setCamera(fly(p));                          // p from the scroll, 0…1
//
// Rendering is on demand: setCamera / seek / lightAll schedule one frame; the loop keeps running only while
// something animates (intro, ripple, heads, focus, learning pulse, marching dashes) and the map is active. At rest
// (only the pulse, the dashes and idle heads move) a frame redraws just the boxes around them, not the canvas.
// Every map of the page shares one sprite atlas per pixel ratio, the label declutter and the prewarm; a map ≥ 2
// viewports from the screen gives its canvases' pixels back and takes them again on the way in, unnoticed.
// Positions scale with the zoom; node sizes and stroke widths are per-tier screen constants.

import { COLORS, PULSE, ringSlots, STATES } from './anatomy.js';
import {
  clamp01,
  EASE,
  fitRect,
  cameraAt,
  flight as flightPath,
  route as routePath,
  fullWeight,
  labelScale,
  midWeight,
  nodeRadiusAt,
  popScale,
  tierOf,
  tierValue,
} from './camera.js';
import { BUCKET, bucketOf, createDeclutter } from './declutter.js';
import {
  AVAILABLE,
  buildModel,
  edgeStyle,
  isDone,
  LANDED,
  LEARNING,
  linkPath,
  LOCKED,
  ON_LOCK,
  openedBy,
  resolveAvailability,
  tapeOffset,
  trackPath,
  upstream,
} from './model.js';
import {
  Atlas,
  baitSprite,
  blit,
  bulletSprite,
  fontsLoaded,
  glowSprites,
  labelSprite,
  loadFonts,
  nodeSprite,
  tagSprite,
  TAPE_CHARS,
  tapeBody,
  tapeGlyph,
  tapeGlyphs,
  tapeStrip,
} from './sprites.js';

export { renderNodeSVG, stanceRingSVG } from './svg.js';
export { flight, route, EASE } from './camera.js';
export { COLORS } from './anatomy.js';

const DATA_URL = new URL('../../assets/data/map.json', import.meta.url).href;

/** Fetches site/assets/data/map.json (or `url`). */
export async function loadMapData(url = DATA_URL) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`map: ${url} → HTTP ${response.status}`);
  return response.json();
}

const models = new WeakMap();
function modelOf(data) {
  let model = models.get(data);
  if (!model) {
    model = buildModel(data);
    models.set(data, model);
  }
  return model;
}

// ---------- shared by every map drawn from one data file (one model): the page has four maps, and each one used to
// build its own atlas, declutter and prewarm. A map's destroy() never clears any of this.
//   atlases  one sprite atlas per device-pixel ratio (the ratio is the page's: a new one replaces the old)
//   declutter  the mid-label pass's static geometry per zoom bucket, and its results per (bucket, tapes, states)
//   warmed   the (ratio, states) whose bitmaps were prewarmed, so a second map on the same states skips it

const shareds = new WeakMap();
const KEEP_CACHE = 64;
function sharedOf(model) {
  let shared = shareds.get(model);
  if (!shared) {
    shared = { atlases: new Map(), declutter: createDeclutter(model), keep: new Map(), warmed: new Set() };
    shareds.set(model, shared);
  }
  return shared;
}
function atlasOf(shared, scale) {
  let atlas = shared.atlases.get(scale);
  if (!atlas) {
    // A new ratio (the page's changed): the old atlas goes, and with it what was prewarmed into it.
    shared.atlases.clear();
    shared.warmed.clear();
    atlas = new Atlas(scale);
    shared.atlases.set(scale, atlas);
  }
  return atlas;
}
/** A states array as a string key (215 codes → 215 chars): equal states share their declutter and prewarm. */
const sigOf = (codes) => String.fromCharCode.apply(null, codes);

// One prewarm queue for every map, worked through in 4 ms slices, one slice every 24 ms: jobs only touch the shared
// atlas and the states they were queued with, so a map destroyed meanwhile leaves nothing half made.
const warm = { queue: [], at: 0, timer: 0 };
function enqueueWarm(jobs, delay = 60) {
  if (!jobs.length) return;
  warm.queue.push(...jobs);
  if (!warm.timer) warm.timer = setTimeout(pumpWarm, delay);
}
function pumpWarm() {
  warm.timer = 0;
  const end = performance.now() + 4;
  while (warm.at < warm.queue.length && performance.now() < end) {
    try {
      warm.queue[warm.at++]();
    } catch {
      /* a sprite that cannot be made now is made on demand */
    }
  }
  if (warm.at < warm.queue.length) warm.timer = setTimeout(pumpWarm, 24);
  else {
    warm.queue = [];
    warm.at = 0;
  }
}

// ---------- constants (DESIGN §3, tokens.json, the app's src/map/draw.ts)

const W_UNLIT = [2, 4, 6];
const W_LIT = [3, 4, 6];
const W_BUILD = [3, 4, 6];
const DASH_OV = [3, 2.5];
const DASH_UP = [8, 6];
const MARCH_PT_PER_MS = 24 / 1000;
const POOL_R = 78;
const POOL_OVERVIEW_SCALE = 1.25;
const POOL_MIN_R = 35;
const POOL_OPACITY_UP = 0.55;
/** Backing pixels per CSS px of the pool canvas. */
const POOL_RES = 0.5;
const BREATH_MS = 6000;
const BREATH_AMP = 0.04;
const HEAD_PT = 10;
/** The unlock ripple (DESIGN §8.2): a head runs each edge in this long… */
export const UNLOCK_HEAD_MS = 350;
/** …one head after another, this far apart: opened node k is reached at UNLOCK_HEAD_MS + k · UNLOCK_STAGGER_MS. */
export const UNLOCK_STAGGER_MS = 120;
const POP_MS = 420;
const FLASH_MS = 450;
/** The hit-stop's paper-white frame on the node (DESIGN §8.1, 0 – 80 ms). */
const WHITE_MS = 80;
const MID_IN_SCALE = 0.5;
const IDLE_FAST_MS = 1000 / 30;
const IDLE_SLOW_MS = 1000 / 8;
const HIT_R = 22;
/** Viewports between the screen and a map whose canvases are released (and taken back on the way in). */
const NEAR = 2;

// Intro timeline (t ∈ [0, 1]): lines ink in from the root outward, nodes pop as their line reaches them, pools
// bloom after them, tapes slap on last.
const INTRO = { lines: [0, 0.68], pop: 0.06, pools: [0.42, 0.4, 0.16], tapes: [0.8, 0.014, 0.09] };
const introEase = EASE.inOutSine;
const introEaseInv = (y) => Math.acos(1 - 2 * clamp01(y)) / Math.PI;
// Finale (lightAll t ∈ [0, 1]): the lit front runs outward along the tracks.
const LIGHT = { from: 0.03, to: 0.86, pop: 0.05, bloom: 0.1 };

const reducedQuery = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createMap(container, options = {}) {
  const { data, preset = 'intermediate', lang = 'en' } = options;
  if (!data) throw new Error('createMap: options.data (map.json) is required');
  const model = modelOf(data);
  const shared = sharedOf(model);
  const N = model.nodes.length;
  let reduced = options.reduced ?? reducedQuery();
  const hoverCbs = options.hover ? [options.hover] : [];
  const tapCbs = options.tap ? [options.tap] : [];

  // ---------- canvas

  const canvas = document.createElement('canvas');
  canvas.className = 'nbd-map-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'pan-y pinch-zoom' });
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const poolCanvas = document.createElement('canvas');
  poolCanvas.className = 'nbd-map-pools';
  poolCanvas.setAttribute('aria-hidden', 'true');
  Object.assign(poolCanvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none', opacity: '0' });
  container.insertBefore(poolCanvas, canvas);
  const pctx = poolCanvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let atlas = null;
  // Far from the screen (≥ 2 viewports) the canvases give their pixels back (width = height = 0) and get them again
  // on the way in, redrawn before they show: W, H, the camera and every query keep working meanwhile.
  let released = false;
  let restoreRaf = 0;

  // ---------- state

  const base = { codes: new Uint8Array(N), stances: new Uint8Array(N), attempts: new Map() };
  let baseVersion = 0;
  const eff = { codes: new Uint8Array(N), stances: new Uint8Array(N), key: '', sig: '' };
  let lineStyles = null; // per line: [ [ [s0, s1], … ] × 4 styles ]
  let trackStyle = new Uint8Array(model.tracks.length);
  const scale = new Float32Array(N).fill(1);
  const look = new Int8Array(N).fill(-1);
  const bloom = new Float32Array(N).fill(1);
  const labelAlpha = new Float32Array(N).fill(1);

  let cam = { x: model.world.width / 2, y: model.world.height / 2, zoom: 0.2 };
  let active = true;
  let destroyed = false;
  let raf = 0;
  let lastDraw = 0;
  let lastFrameMs = 0;
  let fontsOk = fontsLoaded();
  const stats = { drawMs: 0, frames: 0, partials: 0, phases: null };
  let profiling = false;
  let idleTimer = 0;
  let stateWarmTimer = 0;
  let usesLight = false; // lightAll was called: the finale's lit states are prewarmed too
  // Partial frames: at rest, when only the learning pulse, the marching dashes and idle heads move, a frame redraws
  // just the boxes around them (screen pt, collected by the last whole frame) instead of the whole canvas.
  let wholePending = true; // something besides the clock changed: the next frame is a whole one
  let lastIdle = 0;
  let restBoxes = []; // pulse and dash boxes of the last whole frame
  let headBoxes = []; // boxes the idle heads covered on the last frame (repainted once more after a head ends)
  let poolsLit = false;
  // Pointer drag and the glide after it.
  let dragging = false;
  let flinging = false;
  let flingStep = null;

  // Animations
  const intro = { t: null, playing: false, start: 0, duration: 3200, resolve: null };
  let light = null; // lightAll t
  const anims = []; // { kind: 'ripple'|'head'|'flash'|'pop'|'white', … }
  const shake = { i: -1, amp: 0, dx: 0, dy: 0 }; // tremble(): the node that jitters, by up to amp pt
  const timers = new Set(); // ripple onArrive callbacks
  const focus = { set: null, links: [], dim: 0, target: 0, lit: null, litStart: 0, stagger: 90, node: -1, clearing: false, keep: null, v: 0 };

  function setPreset(name) {
    const p = model.presets[name] ?? model.presets.intermediate;
    base.codes.set(p.codes);
    base.stances.set(p.stances);
    base.attempts = new Map(p.attempts);
    baseVersion++;
    requestRender();
    prewarm();
  }

  // ---------- effective states (base + finale + focus lighting), recomputed only when they change

  const lightFront = (t) => model.maxDist * clamp01((t - LIGHT.from) / (LIGHT.to - LIGHT.from));
  function stateKey(now) {
    let k = `${baseVersion}`;
    if (light !== null) {
      const F = lightFront(light);
      let promoted = 0;
      for (const i of model.byDist) {
        if (model.nodes[i].dist <= F + 1e-6) promoted++;
        else break;
      }
      k += `|L${promoted}`;
    }
    if (focus.lit) {
      let lit = 0;
      for (const item of focus.lit) if (now >= item.at) lit++;
      k += `|F${focus.v}:${lit}`;
    }
    return k;
  }

  function resolveStates(now) {
    const key = stateKey(now);
    if (key === eff.key) return false;
    eff.key = key;
    eff.codes.set(base.codes);
    eff.stances.set(base.stances);
    if (light !== null) {
      const F = lightFront(light);
      for (const i of model.byDist) {
        const node = model.nodes[i];
        if (node.dist > F + 1e-6) break;
        eff.codes[i] = isDone(base.codes[i]) ? ON_LOCK : LANDED;
        eff.stances[i] = node.stanceMask;
      }
    }
    // focusPrereqs({ keep }): these tricks keep the state they had before the chain lit (a learning trick stays
    // learning, a locked one stays a ghost even once everything it builds on is lit).
    const held = focus.lit && focus.keep ? [...focus.keep].map((i) => [i, eff.codes[i]]) : null;
    if (focus.lit) {
      for (const item of focus.lit) {
        if (now < item.at) continue;
        if (!isDone(eff.codes[item.i])) {
          eff.codes[item.i] = LANDED;
          eff.stances[item.i] |= 1;
        }
      }
    }
    resolveAvailability(model, eff.codes);
    if (held) for (const [i, code] of held) eff.codes[i] = code;
    eff.sig = sigOf(eff.codes);
    rebuildStyles();
    return true;
  }

  function rebuildStyles() {
    trackStyle = new Uint8Array(model.tracks.length);
    lineStyles = model.lines.map((line) => {
      const out = [[], [], [], []];
      for (const ti of line.chain) {
        const track = model.tracks[ti];
        const style = edgeStyle(eff.codes[track.from], eff.codes[track.to]);
        trackStyle[ti] = style;
        const list = out[style];
        const last = list[list.length - 1];
        if (last && Math.abs(last[1] - track.s0) < 1e-6) last[1] = track.s1;
        else list.push([track.s0, track.s1]);
      }
      return out;
    });
  }

  // ---------- declutter (mid labels) and tapes

  // The mid-label declutter: one result per (zoom bucket, tapes shown, display states), shared by every map of the
  // page (a states array is its own key, so equal states on two maps are one pass). Only once the fonts are in.
  const declutter = shared.declutter;
  function midKeep(zoom) {
    return keepFor(bucketOf(zoom), tapes.alpha > 0, eff.codes, eff.sig);
  }
  function keepFor(b, shown, codes, sig) {
    const key = `${b}|${shown ? 1 : 0}|${sig}`;
    let keep = shared.keep.get(key);
    if (!keep) {
      // The segment tapes, where they stand at this bucket's zoom, are the labels' obstacles (while tapes are shown).
      const bz = declutter.bucketZoom(b);
      const obstacles = [];
      if (shown) {
        for (let s = 0; s < model.segments.length; s++) {
          const box = tapeBox(s, bz, codes);
          if (box) obstacles.push(box);
        }
      }
      keep = declutter.pass(b, codes, obstacles);
      if (shared.keep.size >= KEEP_CACHE) shared.keep.delete(shared.keep.keys().next().value);
      shared.keep.set(key, keep);
    }
    return keep;
  }

  // Segment tapes keep their screen size while the map zooms, so where each one stands depends on the camera's own
  // zoom: map.json has its screen offset from the segment's title point per zoom (scripts/site/map-data.mjs: never
  // overlapping, sliding out of each other's way as the camera pulls back, left out where the city is too small).
  const tapes = { alpha: options.tapes === false ? 0 : 1, slap: null };
  /** The strip of segment tape s at zoom z: [left, top, right, bottom] in screen pt from the world origin, or null. */
  function tapeBox(s, z, codes = eff.codes) {
    const off = fontsOk && tapeOffset(model.tapes, s, z);
    if (!off) return null;
    const strip = tapeStrip(model.segments[s], segmentPercent(s, codes));
    const t = model.segments[s].title;
    const x = t.x * z + off[0] + strip.x;
    const y = t.y * z + off[1];
    return [x, y, x + strip.w, y + 20];
  }
  function segmentPercent(s, codes = eff.codes) {
    const list = model.segments[s].nodes;
    let lit = 0;
    for (const i of list) if (isDone(codes[i])) lit++;
    return Math.round((lit / list.length) * 100);
  }
  // ---------- per-frame animation state

  function introTimes(i) {
    const node = model.nodes[i];
    const at = INTRO.lines[0] + (INTRO.lines[1] - INTRO.lines[0]) * introEaseInv(node.dist / model.maxDist);
    return at;
  }
  const introAt = new Float32Array(N);
  for (let i = 0; i < N; i++) introAt[i] = introTimes(i);

  function prepare(now) {
    scale.fill(1);
    look.fill(-1);
    labelAlpha.fill(1);
    for (let i = 0; i < N; i++) bloom[i] = isDone(eff.codes[i]) ? 1 : 0;

    const it = intro.t;
    if (it !== null && !reduced) {
      for (let i = 0; i < N; i++) {
        const k = (it - introAt[i]) / INTRO.pop;
        scale[i] = k <= 0 ? 0 : popScale(k);
        labelAlpha[i] = clamp01(k * 1.5);
        if (bloom[i] > 0) {
          const node = model.nodes[i];
          const [p0, span, dur] = INTRO.pools;
          bloom[i] = EASE.outCubic(clamp01((it - (p0 + span * (node.dist / model.maxDist))) / dur));
        }
      }
    }
    if (light !== null) {
      const t = light;
      for (const i of model.byDist) {
        const node = model.nodes[i];
        const at = LIGHT.from + (LIGHT.to - LIGHT.from) * (node.dist / model.maxDist);
        if (t < at) break;
        if (isDone(base.codes[i]) && base.codes[i] === ON_LOCK) continue;
        const k = (t - at) / LIGHT.pop;
        if (!reduced) scale[i] *= popScale(k, 0.55);
        if (!isDone(base.codes[i])) bloom[i] = Math.min(bloom[i], EASE.outCubic(clamp01((t - at) / LIGHT.bloom)));
      }
    }
    if (focus.lit) {
      for (const item of focus.lit) {
        if (now < item.at) continue;
        if (!reduced) scale[item.i] *= popScale((now - item.at) / POP_MS, 0.6);
        bloom[item.i] = Math.min(bloom[item.i] || 1, EASE.outCubic(clamp01((now - item.at) / 600)));
      }
    }
    for (const a of anims) {
      if (a.kind === 'ripple' && !a.pulseOnly) {
        const arrive = a.t0 + a.delay + a.dur;
        if (now < arrive) look[a.to] = LOCKED;
        else if (!reduced) scale[a.to] *= popScale((now - arrive) / POP_MS, 0.8);
      } else if (a.kind === 'pop' && !reduced) {
        scale[a.i] *= popScale((now - a.t0) / POP_MS, a.from ?? 0.6);
      }
    }
  }

  /** Something besides the clock-driven rest life moves: every frame is a whole one. (Idle heads do not count.) */
  function animating(now) {
    if (intro.playing) return true;
    if (anims.some((a) => a.kind !== 'head')) return true;
    if (shake.i >= 0 && !reduced) return true;
    if (Math.abs(focus.dim - focus.target) > 1e-3) return true;
    if (focus.lit && focus.lit.some((item) => now < item.at + POP_MS + 600)) return true;
    return false;
  }

  // ---------- loop

  /** The scene changed: the next frame redraws the whole canvas. */
  function requestRender() {
    wholePending = true;
    schedule();
  }
  /** A frame for the clock only (rest life, idle heads): it may redraw just their boxes. */
  function schedule() {
    if (destroyed || !active || raf) return;
    raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    raf = 0;
    if (destroyed || !active) return;
    // Released and asked to draw: back at once if the container is near the screen (a jump), else nothing to do.
    if (released && !reclaim()) return;
    // Intro clock.
    if (intro.playing) {
      intro.t = clamp01((now - intro.start) / intro.duration);
      if (intro.t >= 1) {
        intro.playing = false;
        intro.t = null;
        const done = intro.resolve;
        intro.resolve = null;
        done?.();
      }
    }
    // Focus dim.
    const dt = lastFrameMs ? Math.min(64, now - lastFrameMs) : 16;
    lastFrameMs = now;
    if (focus.dim !== focus.target) {
      const step = dt / (reduced ? 120 : 260);
      focus.dim = focus.target > focus.dim ? Math.min(focus.target, focus.dim + step) : Math.max(focus.target, focus.dim - step);
      if (focus.dim === 0 && focus.clearing) {
        focus.set = null;
        focus.links = [];
        focus.lit = null;
        focus.keep = null;
        focus.node = -1;
        focus.clearing = false;
      }
    }
    // Drop finished animations (a finished head is erased by its last boxes, below).
    for (let k = anims.length - 1; k >= 0; k--) {
      const a = anims[k];
      if (now > a.end) {
        anims.splice(k, 1);
        if (a.kind !== 'head') wholePending = true;
        a.done?.();
      }
    }
    if (flingStep) flingStep(dt);
    if (shake.i >= 0) {
      shake.dx = reduced ? 0 : (Math.random() * 2 - 1) * shake.amp;
      shake.dy = reduced ? 0 : (Math.random() * 2 - 1) * shake.amp;
    }

    const busy = animating(now) || dragging || flinging;
    const heads = anims.length > 0;
    let idle;
    const boxes = !busy && !wholePending ? partBoxes(now) : null;
    if (boxes) {
      idle = boxes.length ? draw(now, boxes) : lastIdle;
    } else idle = draw(now);
    if (busy) {
      // The frame after a moving one is a whole one too: what moved may have left marks outside any box.
      requestRender();
    } else if (heads) {
      schedule();
    } else if (idle === 2) {
      // Idle life on the canvas (learning pulse, marching dashes) at 30 Hz, each frame only around them.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(schedule, Math.max(0, IDLE_FAST_MS - (performance.now() - now)));
    } else if (idle === 1) {
      // Only the pools breathe: that is the pool canvas's CSS opacity, no pixels are redrawn.
      clearTimeout(idleTimer);
      idleTimer = setTimeout(breathe, IDLE_SLOW_MS);
    }
  }
  function breathe() {
    if (destroyed || !active || raf || released) return;
    const now = performance.now();
    const m = midWeight(cam.zoom);
    const breath = 1 - BREATH_AMP + BREATH_AMP * Math.sin((now / BREATH_MS) * 2 * Math.PI);
    if (poolCanvas.style.opacity !== '0') poolCanvas.style.opacity = ((1 + (POOL_OPACITY_UP - 1) * m) * breath).toFixed(3);
    idleTimer = setTimeout(breathe, IDLE_SLOW_MS);
  }

  // ---------- partial frames: the boxes (screen pt) around what the clock moves at rest

  /** Screen box of a world rect [l, t, r, b] at the current camera, grown by `pad` pt. */
  function screenBox(b, pad) {
    const zoom = cam.zoom;
    const tx = snap(W / 2 - cam.x * zoom);
    const ty = snap(H / 2 - cam.y * zoom);
    return [b[0] * zoom + tx - pad, b[1] * zoom + ty - pad, b[2] * zoom + tx + pad, b[3] * zoom + ty + pad];
  }
  /** Where the idle heads are this frame: the tracks under each paper head (its trail included). */
  function headBoxesAt(now) {
    const out = [];
    const zoom = cam.zoom;
    const pad = (tierValue(W_LIT, zoom) + 1) / 2 + 3;
    for (const a of anims) {
      if (a.kind !== 'head') continue;
      const t = (now - a.t0) / a.dur;
      if (t < 0 || t > 1) continue;
      const { line } = a;
      const d = EASE.inOutSine(t) * line.length;
      const h = (HEAD_PT * 1.6) / zoom;
      for (const ti of line.chain) {
        const track = model.tracks[ti];
        if (track.s1 >= d - h - 1e-6 && track.s0 <= d + 1e-6) out.push(screenBox(track.bounds, pad));
      }
    }
    return out;
  }
  /**
   * The boxes a clock-only frame redraws: the rest life of the last whole frame (when it had any), and the idle heads
   * where they are now and where they were on the last frame (to erase them). [] when nothing moves (nothing to draw),
   * null when a whole frame is the better deal (the boxes cover much of the canvas).
   */
  function partBoxes(now) {
    if (reduced) return null;
    const current = headBoxesAt(now);
    const boxes = lastIdle === 2 ? [...restBoxes, ...current, ...headBoxes] : [...current, ...headBoxes];
    headBoxes = current;
    if (!boxes.length) return lastIdle === 2 ? null : boxes;
    // Worth it while the boxes are a small part of the canvas.
    let area = 0;
    for (const b of boxes) area += Math.max(0, Math.min(W, b[2]) - Math.max(0, b[0])) * Math.max(0, Math.min(H, b[3]) - Math.max(0, b[1]));
    return area > 0.45 * W * H ? null : boxes;
  }

  // ---------- drawing

  const glow = glowSprites();

  function lineVisible(line, vl, vt, vr, vb, margin) {
    const b = line.bounds;
    return b && b[2] >= vl - margin && b[0] <= vr + margin && b[3] >= vt - margin && b[1] <= vb + margin;
  }

  function setDashIntervals(intervals, total) {
    if (intervals.length === 1 && intervals[0][0] <= 0.01 && intervals[0][1] >= total - 0.01) {
      ctx.setLineDash([]);
      return;
    }
    const arr = [0];
    let pos = 0;
    for (const [a, b] of intervals) {
      arr.push(Math.max(0, a - pos), Math.max(0, b - a));
      pos = b;
    }
    arr.push(total - pos + 100);
    ctx.setLineDash(arr);
  }

  /** Intervals clipped to [lo, hi]. */
  function clipIntervals(list, lo, hi) {
    const out = [];
    for (const [a, b] of list) {
      const x = Math.max(a, lo);
      const y = Math.min(b, hi);
      if (y > x + 1e-6) out.push([x, y]);
    }
    return out;
  }
  /** Intervals minus [lo, hi]. */
  function cutIntervals(list, lo, hi) {
    if (hi <= lo) return list;
    const out = [];
    for (const [a, b] of list) {
      if (b <= lo || a >= hi) out.push([a, b]);
      else {
        if (a < lo) out.push([a, lo]);
        if (b > hi) out.push([hi, b]);
      }
    }
    return out;
  }

  /**
   * Style intervals of a line for this frame: the resolved ones, cut to what the intro has inked so far, with the
   * finale's lit front laid over them. `only` (a Set of track indices) restricts them to a subset (focus).
   */
  function frameIntervals(line, only) {
    let sets = lineStyles[line.index];
    if (only) {
      sets = [[], [], [], []];
      for (const ti of line.chain) {
        if (!only.has(ti)) continue;
        const t = model.tracks[ti];
        sets[trackStyle[ti]].push([t.s0, t.s1]);
      }
    }
    const rootDist = model.nodes[line.root].dist;
    if (light !== null) {
      const reach = lightFront(light) - rootDist;
      if (reach > 0) {
        const litEnd = Math.min(line.length, reach);
        sets = sets.map((list, s) => (s === 3 ? list : cutIntervals(list, 0, litEnd)));
        const lit = [[0, litEnd]];
        if (only) {
          // Lit only on the subset's tracks.
          const sub = [];
          for (const ti of line.chain) if (only.has(ti)) sub.push(...clipIntervals(lit, model.tracks[ti].s0, model.tracks[ti].s1));
          sets[3] = mergeIntervals([...sets[3], ...sub]);
        } else sets[3] = mergeIntervals([...sets[3], ...lit]);
      }
    }
    if (intro.t !== null && !reduced) {
      const F = model.maxDist * introEase(clamp01((intro.t - INTRO.lines[0]) / (INTRO.lines[1] - INTRO.lines[0])));
      const drawn = F - rootDist;
      if (drawn <= 0) return null;
      if (drawn < line.length) sets = sets.map((list) => clipIntervals(list, 0, drawn));
    }
    return sets;
  }
  function mergeIntervals(list) {
    if (list.length < 2) return list;
    list.sort((a, b) => a[0] - b[0]);
    const out = [list[0].slice()];
    for (let k = 1; k < list.length; k++) {
      const last = out[out.length - 1];
      if (list[k][0] <= last[1] + 1e-6) last[1] = Math.max(last[1], list[k][1]);
      else out.push(list[k].slice());
    }
    return out;
  }

  function strokeTracks(view, only, now) {
    const { zoom, inv, vl, vt, vr, vb } = view;
    const m = midWeight(zoom);
    const widths = [tierValue(W_UNLIT, zoom) * inv, tierValue(W_UNLIT, zoom) * inv, tierValue(W_BUILD, zoom) * inv, tierValue(W_LIT, zoom) * inv];
    const margin = 8 * inv;
    const frames = [];
    for (const line of model.lines) {
      if (!lineVisible(line, vl, vt, vr, vb, margin)) continue;
      const sets = frameIntervals(line, only);
      if (sets) frames.push([line, sets]);
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    for (let style = 0; style < 4; style++) {
      ctx.lineWidth = widths[style];
      for (const [line, sets] of frames) {
        const list = sets[style];
        if (!list.length) continue;
        ctx.strokeStyle = style === 3 ? line.lit : style === 1 ? line.reachable : line.unlit;
        setDashIntervals(list, line.length);
        ctx.stroke(line.path);
      }
      if (style === 2) {
        // Marching dashes toward the node being learned (DESIGN §3.3: 8/6, 3/2.5 at overview, 24 pt/s).
        const on = (DASH_OV[0] + (DASH_UP[0] - DASH_OV[0]) * m) * inv;
        const off = (DASH_OV[1] + (DASH_UP[1] - DASH_OV[1]) * m) * inv;
        const period = on + off;
        const phase = reduced ? 0 : period - ((now * MARCH_PT_PER_MS * inv) % period);
        const pad = tierValue(W_BUILD, zoom) / 2 + 2;
        for (const [line, sets] of frames) {
          if (!sets[2].length) continue;
          ctx.strokeStyle = line.lit;
          for (const ti of line.chain) {
            if (trackStyle[ti] !== 2 || (only && !only.has(ti))) continue;
            const track = model.tracks[ti];
            // Only the part the intro has inked.
            const shown = clipIntervals(sets[2], track.s0, track.s1);
            if (!shown.length) continue;
            if (shown[0][1] < track.s1 - 0.5) continue;
            ctx.setLineDash([on, off]);
            ctx.lineDashOffset = phase;
            ctx.stroke(trackPath(track));
            ctx.lineDashOffset = 0;
            if (!reduced) {
              view.idle = Math.max(view.idle, 2);
              const b = track.bounds;
              view.rest?.push([b[0] * zoom + view.tx - pad, b[1] * zoom + view.ty - pad, b[2] * zoom + view.tx + pad, b[3] * zoom + view.ty + pad]);
            }
          }
        }
      }
    }
    ctx.setLineDash([]);

    // Paper heads at the inking front of each growing line, and at the finale's lit front.
    const front =
      intro.t !== null && !reduced
        ? model.maxDist * introEase(clamp01((intro.t - INTRO.lines[0]) / (INTRO.lines[1] - INTRO.lines[0])))
        : light !== null && light < 1 && !reduced
          ? lightFront(light)
          : null;
    if (front !== null && !only) {
      const F = front;
      const h = 7 * inv;
      ctx.strokeStyle = COLORS.paper;
      for (const [line] of frames) {
        const drawn = F - model.nodes[line.root].dist;
        if (drawn <= 0 || drawn >= line.length) continue;
        const lit = light !== null || lineStyles[line.index][3].some(([a, b]) => drawn > a && drawn <= b + 0.5);
        ctx.lineWidth = (lit ? widths[3] : widths[0]) + 0.5 * inv;
        ctx.setLineDash([0, Math.max(0, drawn - h), Math.min(h, drawn), line.length + 100]);
        ctx.stroke(line.path);
      }
      ctx.setLineDash([]);
    }
  }

  function strokeAnims(view, now) {
    const { inv, zoom } = view;
    const reach = tierValue(W_UNLIT, zoom) * inv;
    for (const a of anims) {
      if (a.kind === 'ripple') {
        const t = now - a.t0 - a.delay;
        if (t >= a.dur) continue;
        const d = t <= 0 ? 0 : (t / a.dur) * a.len;
        const h = HEAD_PT * inv;
        if (a.line) {
          const { line, s0 } = a;
          const s1 = s0 + a.len;
          // The track stays dark ahead of the head…
          ctx.strokeStyle = line.unlit;
          ctx.lineWidth = reach + 0.6 * inv;
          ctx.setLineDash([0, s0 + d, Math.max(0, s1 - s0 - d), line.length + 100]);
          ctx.stroke(line.path);
          // …and the paper head runs along it.
          if (t > 0) {
            ctx.strokeStyle = COLORS.paper;
            ctx.lineWidth = reach + 1 * inv;
            const from = Math.max(s0, s0 + d - h);
            ctx.setLineDash([0, from, s0 + d - from, line.length + 100]);
            ctx.stroke(line.path);
          }
        } else if (a.link) {
          ctx.strokeStyle = COLORS.neutralReachable;
          ctx.lineCap = 'round';
          ctx.lineWidth = 1.75 * inv;
          ctx.setLineDash([0.01 * inv, 5 * inv]);
          ctx.stroke(linkPath(a.link));
          ctx.lineCap = 'butt';
          if (t > 0) {
            ctx.strokeStyle = COLORS.paper;
            ctx.lineWidth = 4 * inv;
            const from = Math.max(0, d - h);
            ctx.setLineDash([0, from, d - from, a.len + 100]);
            ctx.stroke(linkPath(a.link));
          }
        }
        ctx.setLineDash([]);
      } else if (a.kind === 'head') {
        const t = (now - a.t0) / a.dur;
        if (t < 0 || t > 1) continue;
        const { line } = a;
        const d = EASE.inOutSine(t) * line.length;
        const h = HEAD_PT * 1.6 * inv;
        ctx.strokeStyle = COLORS.paper;
        ctx.lineWidth = tierValue(W_LIT, zoom) * inv + 1 * inv;
        const from = Math.max(0, d - h);
        ctx.setLineDash([0, from, d - from, line.length + 100]);
        ctx.stroke(line.path);
        ctx.setLineDash([]);
      }
    }
  }

  function strokeLinks(view, links, alpha) {
    if (!links.length || alpha <= 0) return;
    const { inv } = view;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = COLORS.neutralReachable;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.75 * inv;
    ctx.setLineDash([0.01 * inv, 5 * inv]);
    for (const link of links) ctx.stroke(linkPath(link));
    ctx.restore();
  }

  // Light pools live on their own canvas under the map, at half the CSS resolution: they are soft radial glows,
  // the compositor scales them up for free, and their opacity (tier fade, the ±4% breathing) is a CSS opacity —
  // no pixels are touched for it. The canvas is redrawn only when the camera or the pools change.
  let poolKey = '';
  let breathAt = 0;
  // setPoolGain(): the pools' light × gain (drawn in passes: a pass can't exceed the sprite's own alpha) and their
  // radius × radius. 1, 1 is the app's light.
  const poolBoost = { gain: 1, radius: 1 };
  /** Draws pool sprite `img` at (sx, sy), radius r, with the boost's gain over `alpha` (screen compositing). */
  function poolPasses(c, img, sx, sy, r, alpha) {
    let left = alpha * poolBoost.gain;
    while (left > 1e-3) {
      c.globalAlpha = Math.min(1, left);
      c.drawImage(img, sx - r, sy - r, 2 * r, 2 * r);
      left -= 1;
    }
  }
  function drawPools(view) {
    const { zoom, tx, ty, m } = view;
    if (view.clip) {
      // A partial frame: the pools are as the last whole frame left them; only their breath moves, at the slow idle
      // rate (each new opacity is a style change: 30 a second cost a third of the frame).
      if (view.now - breathAt < IDLE_SLOW_MS) return;
      breathAt = view.now;
      const breath = reduced ? 1 : 1 - BREATH_AMP + BREATH_AMP * Math.sin((view.now / BREATH_MS) * 2 * Math.PI);
      const opacity = poolsLit ? ((1 + (POOL_OPACITY_UP - 1) * m) * breath).toFixed(3) : '0';
      if (poolCanvas.style.opacity !== opacity) poolCanvas.style.opacity = opacity;
      return;
    }
    const overviewR = Math.max(POOL_MIN_R / zoom, POOL_R * POOL_OVERVIEW_SCALE);
    const R = (overviewR + (POOL_R - overviewR) * m) * poolBoost.radius;
    let key = `${tx.toFixed(2)}|${ty.toFixed(2)}|${zoom.toFixed(5)}|${R.toFixed(2)}|${poolBoost.gain.toFixed(3)}|${pctx.canvas.width}|`;
    let any = false;
    for (let i = 0; i < N; i++) {
      if (bloom[i] > 0) {
        any = true;
        key += bloom[i] === 1 ? `${i},` : `${i}:${Math.round(bloom[i] * 60)},`;
      }
    }
    const breath = reduced ? 1 : 1 - BREATH_AMP + BREATH_AMP * Math.sin((view.now / BREATH_MS) * 2 * Math.PI);
    const opacity = any ? ((1 + (POOL_OPACITY_UP - 1) * m) * breath).toFixed(3) : '0';
    if (poolCanvas.style.opacity !== opacity) poolCanvas.style.opacity = opacity;
    poolsLit = any;
    if (any && !reduced) view.idle = Math.max(view.idle, 1);
    if (key === poolKey) return;
    poolKey = key;
    const c = pctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    if (!any) return;
    c.setTransform(POOL_RES, 0, 0, POOL_RES, 0, 0);
    c.globalCompositeOperation = 'screen';
    for (let i = 0; i < N; i++) {
      const b = bloom[i];
      if (b <= 0) continue;
      const node = model.nodes[i];
      const r = R * (0.45 + 0.55 * b) * zoom;
      const sx = node.x * zoom + tx;
      const sy = node.y * zoom + ty;
      if (sx + r < 0 || sx - r > W || sy + r < 0 || sy - r > H) continue;
      poolPasses(c, glow.pool, sx, sy, r, b);
    }
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
  }

  function drawFocusPools(view) {
    const { zoom, tx, ty, m } = view;
    const overviewR = Math.max(POOL_MIN_R / zoom, POOL_R * POOL_OVERVIEW_SCALE);
    const R = (overviewR + (POOL_R - overviewR) * m) * poolBoost.radius;
    const layer = 1 + (POOL_OPACITY_UP - 1) * m;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    for (const i of focus.set) {
      const b = bloom[i];
      if (b <= 0) continue;
      const node = model.nodes[i];
      const r = R * (0.45 + 0.55 * b) * zoom;
      const sx = node.x * zoom + tx;
      const sy = node.y * zoom + ty;
      if (sx + r < 0 || sx - r > W || sy + r < 0 || sy - r > H) continue;
      poolPasses(ctx, glow.pool, sx, sy, r, b * layer * Math.min(1, focus.dim / 0.62));
    }
    ctx.restore();
  }

  const kindOf = (node) => (node.interchange ? 'interchange' : 'ordinary');
  function codeAt(i) {
    return look[i] >= 0 ? look[i] : eff.codes[i];
  }
  function spriteFor(tier, i) {
    return glyphOf(atlas, tier, i, codeAt(i), look[i] >= 0 ? 0 : eff.stances[i]);
  }
  /** Node i's glyph at `tier` for display code `code` and landed-stance bits `stances` (the ring, full tier only). */
  function glyphOf(a, tier, i, code, stances) {
    const node = model.nodes[i];
    const state = STATES[code];
    const slots = tier === 'full' ? ringSlots(node.stanceMask, state, stances) : null;
    return nodeSprite(a, tier, kindOf(node), state, model.lines[node.line], node.line, slots);
  }

  const snap = (v) => Math.round(v * dpr) / dpr;

  function drawNodes(view, only, now) {
    const { zoom, tx, ty, vl, vt, vr, vb, inv, m, full } = view;
    // Screen position of a node; the trembling one (tremble()) jitters with its label and tag.
    const sh = reduced ? -1 : shake.i;
    const X = (node) => node.x * zoom + tx + (node.index === sh ? shake.dx : 0);
    const Y = (node) => node.y * zoom + ty + (node.index === sh ? shake.dy : 0);
    const nm = 40 * inv;
    const lm = 160 * inv;
    const inView = (node, margin) => node.x >= vl - margin && node.x <= vr + margin && node.y >= vt - margin && node.y <= vb + margin;
    const R = nodeRadiusAt(zoom);
    const L = labelScale(zoom);
    const pull = 1 - full;
    const pulseT = reduced ? 0 : (now % PULSE.periodMs) / PULSE.periodMs;
    const pulseEase = 1 - Math.pow(1 - pulseT, 3);
    const list = only ? [...only] : null;
    const each = (fn) => {
      if (list) for (const i of list) fn(i);
      else for (let i = 0; i < N; i++) fn(i);
    };

    // Overview: the red rings around learning dots, then the dots.
    if (m < 1) {
      const ringAlpha = 1 - m;
      ctx.strokeStyle = COLORS.red;
      each((i) => {
        if (codeAt(i) !== LEARNING || scale[i] <= 0) return;
        const node = model.nodes[i];
        if (!inView(node, nm)) return;
        const sx = X(node);
        const sy = Y(node);
        const a = ringAlpha * Math.min(1, scale[i]);
        ctx.globalAlpha = a;
        ctx.lineWidth = PULSE.overview.w1;
        ctx.beginPath();
        ctx.arc(sx, sy, PULSE.overview.r1, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = PULSE.overview.w2;
        ctx.beginPath();
        if (reduced) {
          ctx.globalAlpha = PULSE.overview.a2 * a;
          ctx.arc(sx, sy, PULSE.overview.r2, 0, Math.PI * 2);
        } else {
          ctx.globalAlpha = 0.9 * (1 - pulseEase) * a;
          ctx.arc(sx, sy, PULSE.overview.r1 + (PULSE.overview.r2 + 3 - PULSE.overview.r1) * pulseEase, 0, Math.PI * 2);
          view.idle = Math.max(view.idle, 2);
          const R = PULSE.overview.r2 + 3 + PULSE.overview.w2 + 2;
          view.rest?.push([sx - R, sy - R, sx + R, sy + R]);
        }
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
      each((i) => {
        const k = scale[i];
        if (k <= 0.01) return;
        const node = model.nodes[i];
        if (!inView(node, nm)) return;
        const e = spriteFor('overview', i);
        const sx = X(node);
        const sy = Y(node);
        blit(ctx, e, k === 1 ? snap(sx) : sx, k === 1 ? snap(sy) : sy, k);
      });
    }

    // The red glow under learning nodes, from mid up; it grows with the glyph.
    if (m > 0) {
      const kk = (R / 10) * (m < 1 ? MID_IN_SCALE + (1 - MID_IN_SCALE) * m : 1);
      each((i) => {
        if (codeAt(i) !== LEARNING || scale[i] <= 0) return;
        const node = model.nodes[i];
        if (!inView(node, nm)) return;
        const sx = X(node);
        const sy = Y(node);
        const extra = node.interchange ? 2 * kk : 0;
        const a = m * Math.min(1, scale[i]);
        if (!reduced) {
          const r0 = (PULSE.full.rFrom + 7) * kk + extra;
          ctx.globalAlpha = 0.75 * a;
          ctx.drawImage(glow.pulse, sx - r0, sy - r0, 2 * r0, 2 * r0);
          const r = (PULSE.full.rFrom + (PULSE.full.rTo - PULSE.full.rFrom) * pulseEase) * kk + extra;
          ctx.globalAlpha = PULSE.opacityFrom * (1 - pulseEase) * a;
          ctx.drawImage(glow.pulse, sx - r, sy - r, 2 * r, 2 * r);
          view.idle = Math.max(view.idle, 2);
          const R = Math.max(r0, PULSE.full.rTo * kk + extra) + 2;
          view.rest?.push([sx - R, sy - R, sx + R, sy + R]);
        } else {
          ctx.globalAlpha = a;
          ctx.strokeStyle = COLORS.red;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sx, sy, PULSE.full.rFrom * kk + extra, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    }

    // Mid: small glyphs and the labels that survive the declutter.
    if (m > 0 && full < 1) {
      const layered = m < 1;
      const kn = layered ? MID_IN_SCALE + (1 - MID_IN_SCALE) * m : R / 7;
      ctx.globalAlpha = layered ? m : 1;
      each((i) => {
        const k = scale[i];
        if (k <= 0.01) return;
        const node = model.nodes[i];
        if (!inView(node, nm)) return;
        blit(ctx, spriteFor('mid', i), X(node), Y(node), kn * k);
      });
      if (fontsOk) {
        const keep = midKeep(zoom);
        each((i) => {
          // The focused chain is always named; elsewhere only the labels the declutter kept.
          if (!only && !keep[i]) return;
          if (scale[i] <= 0.01) return;
          const node = model.nodes[i];
          if (!inView(node, lm)) return;
          const [px, py] = declutter.pulls[i];
          const e = labelSprite(atlas, node, codeAt(i) === LOCKED);
          const a = (layered ? m : 1) * labelAlpha[i];
          if (a <= 0) return;
          ctx.globalAlpha = a;
          blit(ctx, e, snap(X(node) + px * pull), snap(Y(node) + py * pull), L);
        });
      }
      ctx.globalAlpha = 1;
    }

    // Full: nodes with stance rings, every label, bait, tags, line bullets.
    if (full > 0) {
      const layered = full < 1;
      const nodeK = R / 10;
      const keep = layered && fontsOk ? midKeep(zoom) : null;
      each((i) => {
        const k = scale[i];
        if (k <= 0.01) return;
        const node = model.nodes[i];
        if (!inView(node, lm)) return;
        const sx = X(node);
        const sy = Y(node);
        ctx.globalAlpha = layered ? full : 1;
        const kk = nodeK * k;
        const crisp = Math.abs(kk - 1) < 0.002;
        blit(ctx, spriteFor('full', i), crisp ? snap(sx) : sx, crisp ? snap(sy) : sy, kk);
        if (!fontsOk) return;
        const la = (layered ? full : 1) * labelAlpha[i];
        if (la <= 0) return;
        // Labels the mid tier already shows are not drawn twice inside the band.
        if (!(layered && keep && keep[i])) {
          const [px, py] = declutter.pulls[i];
          ctx.globalAlpha = la;
          blit(ctx, labelSprite(atlas, node, codeAt(i) === LOCKED), snap(sx + px * pull), snap(sy + py * pull), L);
        }
        if (look[i] >= 0) return;
        const code = eff.codes[i];
        ctx.globalAlpha = la;
        if (code === LEARNING && node.tag) {
          const n = base.attempts.get(i);
          blit(ctx, tagSprite(atlas, node, n ? `learning·${n}` : 'learning'), snap(sx), snap(sy), L);
        } else if (code === AVAILABLE && node.bait) {
          blit(ctx, baitSprite(atlas, node), snap(sx), snap(sy), L);
        }
      });
      // Line bullets at the first node of each line.
      if (fontsOk && !only) {
        for (const line of model.lines) {
          if (!line.bullet) continue;
          const i = line.stations[0];
          const node = model.nodes[i];
          if (!inView(node, lm) || scale[i] <= 0.01) continue;
          const started = line.stations.some((j) => eff.codes[j] !== LOCKED);
          ctx.globalAlpha = (layered ? full : 1) * labelAlpha[i];
          blit(ctx, bulletSprite(atlas, line, started), snap(X(node)), snap(Y(node)), L);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  // The intro's slap-on of the tapes (its t), and the same for setTapes(p, { slap: true }) (p 0 → 1).
  const SLAP_SPAN = INTRO.tapes[1] * 9 + INTRO.tapes[2];
  function slapOf(p, s) {
    const [, step, dur] = INTRO.tapes;
    return clamp01((p - step * s) / dur);
  }
  function drawTapes(view, alpha) {
    const { zoom, tx, ty, full } = view;
    if (full >= 1 || !fontsOk || tapes.alpha <= 0) return;
    const base = (1 - full) * alpha * tapes.alpha;
    for (let s = 0; s < model.segments.length; s++) {
      let a = base;
      let k = 1;
      const slaps = [];
      if (intro.t !== null && !reduced) slaps.push(slapOf(intro.t - INTRO.tapes[0], s));
      if (tapes.slap !== null) slaps.push(slapOf(tapes.slap * SLAP_SPAN, s));
      for (const p of slaps) {
        if (p <= 0) {
          a = 0;
          break;
        }
        if (reduced) {
          a *= p;
          continue;
        }
        a *= Math.min(1, p * 2.5);
        k *= 1.35 - 0.35 * EASE.outCubic(p);
      }
      if (a <= 0) continue;
      const off = tapeOffset(model.tapes, s, zoom);
      if (!off) continue;
      const segment = model.segments[s];
      const percent = segmentPercent(s);
      const e = tapeBody(atlas, segment, s, percent);
      const t = segment.title;
      const x = t.x * zoom + tx + off[0];
      const y = t.y * zoom + ty + off[1];
      if (x + e.left + e.w < -20 || x + e.left > W + 20 || y + e.top > H + 20 || y + e.top + e.h < -20) continue;
      ctx.globalAlpha = a;
      // The strip scales around its own centre.
      const strip = tapeStrip(segment, percent);
      const cx = x + strip.x + strip.w / 2;
      const cy = y + 10;
      const px = k === 1 ? snap(x) : cx + (x - cx) * k;
      const py = k === 1 ? snap(y) : cy + (y - cy) * k;
      const c = view.clip;
      if (c && (px + (e.left + e.w) * k < c[0] || px + e.left * k > c[2] || py + e.top * k > c[3] || py + (e.top + e.h) * k < c[1])) continue;
      blit(ctx, e, px, py, k);
      // The percentage, stamped glyph by glyph (on whole device pixels at rest, like the strip).
      for (const [ch, dx, dy] of tapeGlyphs(segment, s, percent)) {
        const g = tapeGlyph(atlas, s, ch);
        if (k === 1) blit(ctx, g, snap(px + dx), snap(py + dy));
        else blit(ctx, g, px + dx * k, py + dy * k, k);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawFlashes(view, now) {
    const { zoom, tx, ty } = view;
    for (const a of anims) {
      if (a.kind === 'white') {
        // The hit-stop's paper-white frame: the node's whole glyph (stance ring included) goes paper.
        if (now > a.end) continue;
        const node = model.nodes[a.i];
        const jx = a.i === shake.i && !reduced ? shake.dx : 0;
        const jy = a.i === shake.i && !reduced ? shake.dy : 0;
        ctx.globalAlpha = 1;
        ctx.fillStyle = COLORS.paper;
        ctx.beginPath();
        ctx.arc(node.x * zoom + tx + jx, node.y * zoom + ty + jy, tierValue([5, 11, 21], zoom), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      if (a.kind !== 'flash') continue;
      const t = (now - a.t0) / a.dur;
      if (t < 0 || t > 1) continue;
      const node = model.nodes[a.i];
      const e = 1 - Math.pow(1 - t, 3);
      const base = tierValue([4, 9, 14.5], zoom);
      ctx.globalAlpha = 1 - e;
      ctx.strokeStyle = COLORS.paper;
      ctx.lineWidth = 3 - 2 * e;
      ctx.beginPath();
      ctx.arc(node.x * zoom + tx, node.y * zoom + ty, base + base * 1.6 * e, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Draws one frame. Returns the idle life on screen: 0 none, 1 slow (pools breathe), 2 fast (pulse, dashes).
   * With `boxes` ([l, t, r, b] screen pt) it is a partial frame, for when only the clock moved since the last whole
   * one: the same picture, cleared and redrawn only inside each box (merged where they overlap; one device-pixel
   * aligned rectangle clip per box, the scene culled to it). One plain rectangle per pass keeps the strokes as a whole
   * frame rasterizes them (a union-of-rects clip changes their anti-aliasing).
   */
  function draw(now = performance.now(), boxes = null) {
    if (!W || !H || released) return 0;
    const t0 = performance.now();
    resolveStates(now);
    prepare(now);
    stats.prepMs = performance.now() - t0;
    const zoom = cam.zoom;
    const inv = 1 / zoom;
    const tx = snap(W / 2 - cam.x * zoom);
    const ty = snap(H / 2 - cam.y * zoom);
    const view = {
      now,
      zoom,
      inv,
      tx,
      ty,
      m: midWeight(zoom),
      full: fullWeight(zoom),
      vl: -tx * inv,
      vt: -ty * inv,
      vr: (W - tx) * inv,
      vb: (H - ty) * inv,
      idle: 0,
      // A whole frame collects the boxes of its rest life (pulse, marching dashes) for the partial frames after it.
      rest: boxes ? null : [],
      clip: null,
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (boxes) {
      const rects = deviceRects(boxes);
      for (const [x0, y0, x1, y1] of rects) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0, y0, x1 - x0, y1 - y0);
        ctx.clip();
        ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
        view.clip = [x0 / dpr, y0 / dpr, x1 / dpr, y1 / dpr];
        view.vl = (view.clip[0] - tx) * inv;
        view.vt = (view.clip[1] - ty) * inv;
        view.vr = (view.clip[2] - tx) * inv;
        view.vb = (view.clip[3] - ty) * inv;
        paint(view, now, null);
        ctx.restore();
      }
      stats.drawMs = performance.now() - t0;
      stats.partials++;
      return lastIdle;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Profiling (api.profile(true)): each phase is flushed to pixels and timed.
    const phases = profiling ? {} : null;
    let mark = performance.now();
    const phase = (name) => {
      if (!phases) return;
      ctx.getImageData(0, 0, 1, 1);
      const t = performance.now();
      phases[name] = t - mark;
      mark = t;
    };
    phase('clear');
    paint(view, now, phase);
    if (phases) stats.phases = phases;
    lastDraw = performance.now();
    stats.drawMs = lastDraw - t0;
    stats.frames++;
    wholePending = false;
    lastIdle = view.idle;
    restBoxes = view.rest;
    // Where this frame drew the idle heads: the next partial frame erases them there.
    headBoxes = anims.length ? headBoxesAt(now) : [];
    return view.idle;
  }

  /** Boxes (screen pt) → device-pixel rectangles on the canvas, snapped outward, overlapping ones merged. */
  function deviceRects(boxes) {
    let rects = [];
    for (const box of boxes) {
      const x0 = Math.max(0, Math.floor(box[0] * dpr));
      const y0 = Math.max(0, Math.floor(box[1] * dpr));
      const x1 = Math.min(canvas.width, Math.ceil(box[2] * dpr));
      const y1 = Math.min(canvas.height, Math.ceil(box[3] * dpr));
      if (x1 > x0 && y1 > y0) rects.push([x0, y0, x1, y1]);
    }
    for (let merged = true; merged && rects.length > 1; ) {
      merged = false;
      const out = [];
      for (const r of rects) {
        const o = out.find((q) => r[0] <= q[2] && r[2] >= q[0] && r[1] <= q[3] && r[3] >= q[1]);
        if (o) {
          o[0] = Math.min(o[0], r[0]);
          o[1] = Math.min(o[1], r[1]);
          o[2] = Math.max(o[2], r[2]);
          o[3] = Math.max(o[3], r[3]);
          merged = true;
        } else out.push(r.slice());
      }
      rects = out;
    }
    return rects;
  }

  /** The layers of a frame, bottom to top, into whatever clip is set (culled to view.vl…vb). */
  function paint(view, now, phase) {
    const { zoom, tx, ty } = view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPools(view);
    phase?.('pools');

    ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty);
    strokeTracks(view, null, now);
    strokeAnims(view, now);
    if (focus.set && focus.dim < 0.01) strokeLinks(view, focus.links, 1);
    phase?.('tracks');

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawNodes(view, null, now);
    phase?.('nodes');
    const focusing = focus.set && focus.dim > 0.004;
    if (!focusing) drawTapes(view, 1);
    phase?.('tapes');

    // Focus: everything but the chain goes dark; the chain is drawn once more above the dim.
    if (focusing) {
      ctx.globalAlpha = Math.min(1, focus.dim);
      ctx.fillStyle = COLORS.grip;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      // The chain keeps its light: its pools glow above the dim.
      drawFocusPools(view);
      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * tx, dpr * ty);
      strokeLinks(view, focus.links, Math.min(1, focus.dim / 0.3));
      strokeTracks(view, focus.tracks, now);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawNodes(view, focus.set, now);
      // Segment tapes stay on top, receded.
      drawTapes(view, 1 - 0.5 * Math.min(1, focus.dim));
    }
    drawFlashes(view, now);
    phase?.('focus');
  }

  // ---------- size, and the pixels given back far from the screen

  /** The backing stores at the current size and ratio. */
  function allocate() {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    poolCanvas.width = Math.max(1, Math.round(W * POOL_RES));
    poolCanvas.height = Math.max(1, Math.round(H * POOL_RES));
    poolKey = '';
    wholePending = true;
  }
  function resize() {
    const rect = container.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const d = Math.min(2, window.devicePixelRatio || 1);
    if (w === W && h === H && d === dpr && atlas) return;
    const scaleChanged = d !== dpr || !atlas;
    W = w;
    H = h;
    dpr = d;
    if (scaleChanged) atlas = atlasOf(shared, dpr);
    // Released, only the size is noted: the canvases get it when they come back.
    if (!released) allocate();
    options.onResize?.({ width: W, height: H });
    if (scaleChanged) {
      prewarm();
      if (usesLight) prewarmLight();
    }
    if (released) return;
    draw(performance.now());
    requestRender();
  }

  /** Gives the canvases' pixels back (≥ 2 viewports from the screen). */
  function release() {
    if (released || destroyed) return;
    released = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (restoreRaf) cancelAnimationFrame(restoreRaf);
    restoreRaf = 0;
    clearTimeout(idleTimer);
    canvas.width = canvas.height = 0;
    poolCanvas.width = poolCanvas.height = 0;
    poolKey = '';
  }
  /**
   * Takes the pixels again on the way in, and draws the picture in the next animation frame — long before the canvas
   * shows, active or not. `caller`: the caller draws at once instead (a jump, or a still asked for).
   */
  function restore(caller = false) {
    if (!released || destroyed) return;
    released = false;
    allocate();
    if (caller) return;
    if (active) requestRender();
    else
      restoreRaf = requestAnimationFrame((t) => {
        restoreRaf = 0;
        if (!released && !destroyed && !raf) draw(t);
      });
  }
  /** Released but asked to draw now (a jump: goto; a still): back at once when the container is near the screen. */
  function reclaim() {
    if (!released) return true;
    if (destroyed) return false;
    const r = container.getBoundingClientRect();
    const vh = window.innerHeight || 844;
    if (r.bottom < -NEAR * vh || r.top > (1 + NEAR) * vh || !r.width || !r.height) return false;
    restore(true);
    return true;
  }
  const near =
    typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(
          (entries) => {
            if (entries[entries.length - 1].isIntersecting) restore();
            else release();
          },
          { rootMargin: `${NEAR * 100}% 0px` },
        )
      : null;

  setPreset(preset);
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  resize();
  near?.observe(container);

  // ---------- prewarm: every bitmap and declutter pass the current states need, built in small slices in the
  // background (nearest the camera first), so a flight never stalls on its first visit to the mid or full tier.
  // Once per (ratio, states) for the whole page: a second map on the same states finds it all made.

  function nearestFirst() {
    const d = model.nodes.map((node) => (node.x - cam.x) ** 2 + (node.y - cam.y) ** 2);
    return model.nodes.map((node) => node.index).sort((a, b) => d[a] - d[b]);
  }
  function prewarm() {
    if (!fontsOk || destroyed || !atlas) return;
    const codes = resolveAvailability(model, base.codes.slice());
    const stances = base.stances.slice();
    const attempts = new Map(base.attempts);
    const sig = sigOf(codes);
    let tagSig = '';
    for (let i = 0; i < N; i++) if (codes[i] === LEARNING) tagSig += `${i}:${attempts.get(i) ?? ''},`;
    const key = `${dpr}|${sig}|${sigOf(stances)}|${tagSig}`;
    if (shared.warmed.has(key)) return;
    shared.warmed.add(key);
    const a = atlas;
    const shown = tapes.alpha > 0;
    const jobs = [];
    for (let b = 0; b < BUCKET.count; b++) jobs.push(() => keepFor(b, shown, codes, sig));
    for (const i of nearestFirst()) {
      jobs.push(() => {
        const node = model.nodes[i];
        glyphOf(a, 'overview', i, codes[i], stances[i]);
        glyphOf(a, 'mid', i, codes[i], stances[i]);
        glyphOf(a, 'full', i, codes[i], stances[i]);
        labelSprite(a, node, codes[i] === LOCKED);
        if (codes[i] === AVAILABLE && node.bait) baitSprite(a, node);
        if (codes[i] === LEARNING && node.tag) {
          const n = attempts.get(i);
          tagSprite(a, node, n ? `learning·${n}` : 'learning');
        }
      });
    }
    for (const line of model.lines) {
      if (line.bullet) jobs.push(() => bulletSprite(a, line, line.stations.some((j) => codes[j] !== LOCKED)));
    }
    for (let s = 0; s < model.segments.length; s++) jobs.push(() => tapeBody(a, model.segments[s], s, segmentPercent(s, codes)));
    jobs.push(() => {
      for (let s = 0; s < 4; s++) for (const ch of TAPE_CHARS) tapeGlyph(a, s, ch);
    });
    // The other tapes setting's declutter last (the hero shows its map with and without them).
    for (let b = 0; b < BUCKET.count; b++) jobs.push(() => keepFor(b, !shown, codes, sig));
    enqueueWarm(jobs);
  }
  /**
   * The finale's states (lightAll): every dot landed or on lock, the open dots its front passes, and the strips at
   * 100 % — only for a map that calls lightAll, once.
   */
  function prewarmLight() {
    if (!fontsOk || destroyed || !atlas) return;
    const codes = resolveAvailability(model, base.codes.slice());
    const key = `L|${dpr}|${sigOf(codes)}`;
    if (shared.warmed.has(key)) return;
    shared.warmed.add(key);
    const a = atlas;
    const jobs = [];
    for (const i of nearestFirst()) {
      jobs.push(() => {
        // The finale plays at the overview: its dots only (the other tiers are made on demand).
        glyphOf(a, 'overview', i, isDone(codes[i]) ? ON_LOCK : LANDED, 0);
        glyphOf(a, 'overview', i, AVAILABLE, 0);
      });
    }
    for (let s = 0; s < model.segments.length; s++) jobs.push(() => tapeBody(a, model.segments[s], s, 100));
    enqueueWarm(jobs);
  }
  /** After setState calls settle: the new states' bitmaps (mostly made already, so mostly look-ups). */
  function prewarmSoon() {
    clearTimeout(stateWarmTimer);
    stateWarmTimer = setTimeout(() => {
      prewarm();
      if (usesLight) prewarmLight();
    }, 400);
  }

  loadFonts()
    .then(() => {
      fontsOk = true;
      requestRender();
      prewarm();
      if (usesLight) prewarmLight();
    })
    .catch(() => {});

  // ---------- interaction

  function toWorld(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const tx = W / 2 - cam.x * cam.zoom;
    const ty = H / 2 - cam.y * cam.zoom;
    return { x: (sx - tx) / cam.zoom, y: (sy - ty) / cam.zoom, sx, sy };
  }

  function nodeAt(clientX, clientY, radius = HIT_R) {
    const p = toWorld(clientX, clientY);
    const r = radius / cam.zoom;
    let best = -1;
    let bestD = r * r;
    for (const node of model.nodes) {
      const dx = node.x - p.x;
      const dy = node.y - p.y;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = node.index;
      }
    }
    return best >= 0 ? model.nodes[best].id : null;
  }

  let panOpts = null;
  let pointer = null;
  let hoverId = null;

  function clampCam(c) {
    return {
      x: Math.min(model.world.width, Math.max(0, c.x)),
      y: Math.min(model.world.height, Math.max(0, c.y)),
      zoom: Math.min(1.6, Math.max(0.02, c.zoom)),
    };
  }

  function onPointerDown(e) {
    if (!panOpts) return;
    if (e.pointerType === 'touch' && !panOpts.touch) return;
    if (e.button !== undefined && e.button !== 0) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0 };
    dragging = true;
    flinging = false;
    flingStep = null;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
    canvas.style.cursor = 'grabbing';
  }
  function onPointerMove(e) {
    if (dragging && pointer && e.pointerId === pointer.id) {
      const now = performance.now();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      const dt = Math.max(1, now - pointer.t);
      pointer.moved += Math.hypot(dx, dy);
      pointer.vx = pointer.vx * 0.6 + ((dx / dt) * 1000) * 0.4;
      pointer.vy = pointer.vy * 0.6 + ((dy / dt) * 1000) * 0.4;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      pointer.t = now;
      cam = clampCam({ x: cam.x - dx / cam.zoom, y: cam.y - dy / cam.zoom, zoom: cam.zoom });
      panOpts?.onMove?.({ vx: pointer.vx, vy: pointer.vy, speed: Math.hypot(pointer.vx, pointer.vy) });
      requestRender();
      return;
    }
    if (e.pointerType === 'touch' || !hoverCbs.length) return;
    const id = nodeAt(e.clientX, e.clientY);
    if (id !== hoverId) {
      hoverId = id;
      canvas.style.cursor = id ? 'pointer' : panOpts ? 'grab' : '';
      for (const cb of hoverCbs) cb(id, e);
    }
  }
  function onPointerUp(e) {
    const wasTap = pointer && pointer.moved < 6;
    if (dragging && pointer && e.pointerId === pointer.id) {
      dragging = false;
      canvas.style.cursor = panOpts ? 'grab' : '';
      let vx = Math.max(-3200, Math.min(3200, pointer.vx));
      let vy = Math.max(-3200, Math.min(3200, pointer.vy));
      if (performance.now() - pointer.t > 80 || reduced) {
        vx = 0;
        vy = 0;
      }
      pointer = null;
      if (Math.hypot(vx, vy) > 40) {
        flinging = true;
        flingStep = (dt) => {
          const decay = Math.exp(-dt / 1000 / 0.35);
          const nvx = vx * decay;
          const nvy = vy * decay;
          const mx = ((vx + nvx) / 2) * (dt / 1000);
          const my = ((vy + nvy) / 2) * (dt / 1000);
          vx = nvx;
          vy = nvy;
          cam = clampCam({ x: cam.x - mx / cam.zoom, y: cam.y - my / cam.zoom, zoom: cam.zoom });
          panOpts?.onMove?.({ vx, vy, speed: Math.hypot(vx, vy) });
          if (Math.hypot(vx, vy) < 6) {
            flinging = false;
            flingStep = null;
            panOpts?.onEnd?.();
          }
        };
        requestRender();
      } else panOpts?.onEnd?.();
    }
    if (wasTap && tapCbs.length) {
      const id = nodeAt(e.clientX, e.clientY);
      for (const cb of tapCbs) cb(id, e);
    }
  }
  function onPointerLeave() {
    if (hoverId !== null && !dragging) {
      hoverId = null;
      canvas.style.cursor = panOpts ? 'grab' : '';
      for (const cb of hoverCbs) cb(null);
    }
  }
  // Taps without panning (touch included) and hover.
  function onTapDown(e) {
    if (panOpts && !(e.pointerType === 'touch' && !panOpts.touch)) return;
    pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0 };
  }
  function onTapMove(e) {
    if (pointer && !dragging && e.pointerId === pointer.id) pointer.moved += Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y);
  }
  canvas.addEventListener('pointerdown', (e) => {
    onTapDown(e);
    onPointerDown(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    onTapMove(e);
    onPointerMove(e);
  });
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', (e) => {
    pointer = null;
    if (dragging) {
      dragging = false;
      panOpts?.onEnd?.();
    }
    void e;
  });
  canvas.addEventListener('pointerleave', onPointerLeave);

  // ---------- animations API

  function introPlay({ duration = 3200 } = {}) {
    intro.resolve?.();
    if (reduced) {
      intro.t = null;
      intro.playing = false;
      requestRender();
      return Promise.resolve();
    }
    intro.duration = duration;
    intro.start = performance.now();
    intro.t = 0;
    intro.playing = true;
    requestRender();
    return new Promise((resolve) => {
      intro.resolve = resolve;
    });
  }
  /** Scrub the intro: t ∈ [0, 1]; null shows the finished map. */
  introPlay.seek = (t) => {
    intro.playing = false;
    intro.resolve?.();
    intro.resolve = null;
    intro.t = t === null || t === undefined || reduced ? null : clamp01(t);
    if (intro.t === 1) intro.t = null;
    requestRender();
  };
  introPlay.stop = () => introPlay.seek(null);

  /**
   * Lands `trickId` (unless `land: false`) and runs the unlock ripple: a paper head along each edge to every newly
   * opened trick, UNLOCK_STAGGER_MS apart, each UNLOCK_HEAD_MS long; the node pops as its head arrives.
   * `onArrive(k, trickId)` fires as head k reaches its node (k in the order of map.opens(); for the rising ticks);
   * under reduced motion there are no heads and every onArrive fires at once. Resolves with the opened ids.
   */
  function ripple(trickId, { land = true, onArrive } = {}) {
    const i = model.indexOf.get(trickId);
    if (i === undefined) return Promise.resolve([]);
    const opened = land ? openedBy(model, base.codes, i) : [];
    if (land && !isDone(base.codes[i])) {
      base.codes[i] = LANDED;
      base.stances[i] |= 1;
      base.attempts.delete(i);
    }
    resolveAvailability(model, base.codes);
    baseVersion++;
    const ids = opened.map((j) => model.nodes[j].id);
    const now = performance.now();
    if (reduced) {
      requestRender();
      if (onArrive) queueMicrotask(() => ids.forEach((id, k) => !destroyed && onArrive(k, id)));
      return Promise.resolve(ids);
    }
    anims.push({ kind: 'flash', i, t0: now, dur: FLASH_MS, end: now + FLASH_MS });
    anims.push({ kind: 'pop', i, t0: now, from: 0.5, end: now + POP_MS });
    let end = now + FLASH_MS;
    // Nothing opened: one pulse outward along the home line instead (DESIGN §8.2).
    const pulseOnly = opened.length === 0;
    const heads = pulseOnly ? model.tracks.filter((t) => t.from === i && !t.feeder).map((t) => t.to).slice(0, 1) : opened;
    heads.forEach((j, k) => {
      const track = model.tracks.find((t) => t.from === i && t.to === j);
      const link = track ? null : model.links.find((l) => l.from === i && l.to === j);
      if (!track && !link) return;
      const a = { kind: 'ripple', from: i, to: j, pulseOnly, t0: now, delay: k * UNLOCK_STAGGER_MS, dur: UNLOCK_HEAD_MS };
      if (track) Object.assign(a, { line: model.lines[track.line], s0: track.s0, len: track.s1 - track.s0 });
      else Object.assign(a, { link, len: link.length });
      a.end = now + a.delay + a.dur + POP_MS;
      end = Math.max(end, a.end);
      anims.push(a);
    });
    if (onArrive) {
      ids.forEach((id, k) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          if (!destroyed) onArrive(k, id);
        }, UNLOCK_HEAD_MS + k * UNLOCK_STAGGER_MS);
        timers.add(timer);
      });
    }
    requestRender();
    return new Promise((resolve) => setTimeout(() => resolve(ids), end - now));
  }

  /** What landing `trickId` would open from the current state (ids, in the ripple's order); nothing is changed. */
  function opens(trickId) {
    const i = model.indexOf.get(trickId);
    if (i === undefined) return [];
    return openedBy(model, base.codes, i).map((j) => model.nodes[j].id);
  }

  /** Every trick `trickId` builds on (its transitive prerequisites), roots first; with `self`, the trick last. */
  function prereqsOf(trickId, { self = false } = {}) {
    const i = model.indexOf.get(trickId);
    if (i === undefined) return [];
    const ids = upstream(model, i).map((j) => model.nodes[j].id);
    if (self) ids.push(trickId);
    return ids;
  }

  /**
   * The hit-stop (DESIGN §8.1): one paper-white frame on the node — its glyph, ring and stance ring go paper for `ms`
   * (default 80). Resolves when it is over.
   */
  function flash(trickId, { ms = WHITE_MS } = {}) {
    const i = model.indexOf.get(trickId);
    if (i === undefined) return Promise.resolve();
    const now = performance.now();
    anims.push({ kind: 'white', i, t0: now, dur: ms, end: now + ms });
    // Drawn now, not on the next frame: the hit-stop is the frame the finger lifts.
    if (active && W && H && reclaim()) draw(now);
    requestRender();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * The hold-to-confirm tremble (DESIGN §8.1: the node trembles ±1 pt): the node, its label and its tag jitter by up
   * to `amp` pt every frame while amp > 0; tremble(id, 0) (or tremble(null)) stops it. Off under reduced motion.
   */
  function tremble(trickId, amp = 1) {
    const i = trickId ? model.indexOf.get(trickId) : undefined;
    const a = Math.max(0, Number(amp) || 0);
    shake.i = i === undefined || a <= 0 ? -1 : i;
    shake.amp = a;
    if (shake.i < 0) shake.dx = shake.dy = 0;
    requestRender();
  }

  function idleHead() {
    if (reduced) return Promise.resolve(null);
    const z = cam.zoom;
    const vl = cam.x - W / 2 / z;
    const vr = cam.x + W / 2 / z;
    const vt = cam.y - H / 2 / z;
    const vb = cam.y + H / 2 / z;
    const candidates = model.lines.filter((line) => {
      if (!line.chain.length) return false;
      if (!line.chain.every((ti) => trackStyle[ti] === 3)) return false;
      const b = line.bounds;
      return b[2] >= vl && b[0] <= vr && b[3] >= vt && b[1] <= vb;
    });
    if (!candidates.length) return Promise.resolve(null);
    candidates.sort((a, b) => b.length - a.length);
    const line = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
    const now = performance.now();
    const speed = 340 / z; // world units per second: about 340 pt/s on screen
    const dur = Math.max(900, Math.min(4200, (line.length / speed) * 1000));
    const a = { kind: 'head', line, t0: now, dur, end: now + dur };
    anims.push(a);
    // Only the clock moves: the frames redraw just the tracks under the head.
    schedule();
    return new Promise((resolve) => {
      a.done = () => resolve(line.id);
    });
  }

  /** The finale: t ∈ [0, 1] lights every node outward from Stance; null switches it off. lightAll.full is the t at
   *  which the last node is lit (every tape at 100 % from there on). */
  function lightAll(t) {
    light = t === null || t === undefined ? null : clamp01(t);
    if (!usesLight) {
      // The first call (even lightAll(null) on init) marks the map that plays the finale: its lit states are made in
      // the background now, not while the visitor scrolls through it.
      usesLight = true;
      prewarmLight();
    }
    requestRender();
  }
  lightAll.full = LIGHT.to;

  function setFocus(indices, links, { light: doLight = false, stagger = 90, node = -1, dim = 0.62, keep = null } = {}) {
    const set = new Set(indices);
    focus.set = set;
    focus.node = node;
    focus.links = links;
    focus.tracks = new Set(model.tracks.filter((t) => set.has(t.from) && set.has(t.to)).map((t) => t.index));
    focus.target = Math.max(0, Math.min(1, dim));
    focus.clearing = false;
    focus.lit = null;
    focus.keep = keep && keep.size ? keep : null;
    focus.v++;
    if (doLight) {
      const now = performance.now();
      const order = [...indices].sort((a, b) => model.nodes[a].depth - model.nodes[b].depth || model.nodes[a].dist - model.nodes[b].dist);
      let k = 0;
      focus.lit = [];
      for (const i of order) {
        if (isDone(base.codes[i]) || focus.keep?.has(i)) continue;
        focus.lit.push({ i, at: now + (reduced ? 0 : 180 + k * stagger) });
        k++;
      }
    }
    requestRender();
  }

  function focusTrick(trickId, opts = {}) {
    const i = model.indexOf.get(trickId);
    if (i === undefined) return;
    setFocus([i], (model.linksOf.get(i) ?? []).map((li) => model.links[li]), { ...opts, light: false, node: i });
  }
  /** The trick and everything it builds on, lit above a dim. opts: { light, stagger, dim, keep } — `keep`: trick ids
   *  (the target among them, say) that `light` leaves in their own state: the rest of the chain lights around them. */
  function focusPrereqs(trickId, opts = {}) {
    const i = model.indexOf.get(trickId);
    if (i === undefined) return [];
    const up = upstream(model, i);
    const set = new Set([...up, i]);
    const links = model.links.filter((l) => set.has(l.from) && set.has(l.to) && l.kind === 'prereq');
    const keep = opts.keep ? new Set(opts.keep.map((id) => model.indexOf.get(id)).filter((j) => j !== undefined && set.has(j))) : null;
    setFocus([...up, i], links, { ...opts, keep, node: i });
    return [...up, i].map((j) => model.nodes[j].id);
  }
  function clearFocus() {
    if (!focus.set) return;
    focus.target = 0;
    focus.clearing = true;
    requestRender();
  }

  // ---------- camera API

  function viewport(vp) {
    return { width: W || 390, height: H || 844, ...(vp ?? {}) };
  }
  /**
   * A camera for `target`: 'overview' (the whole city), a segment id, a trick id, { ids: [...] } (fits those
   * tricks), or a camera (returned as is). `vp` = { width, height, top, right, bottom, left } (defaults: the canvas).
   */
  function frame(target, vp, opts = {}) {
    const v = viewport(vp);
    if (target && typeof target === 'object' && Array.isArray(target.ids)) return frameIds(target.ids, v, opts);
    if (target && typeof target === 'object') return { x: target.x, y: target.y, zoom: target.zoom };
    if (target === 'overview' || target === undefined || target === null) {
      return fitRect({ x: 0, y: 0, w: model.world.width, h: model.world.height }, v, opts.pad ?? 12);
    }
    const seg = model.segments.find((s) => s.id === target);
    if (seg) return fitRect(seg.bounds, v, opts.pad ?? 16, opts.maxZoom ?? 1);
    const i = model.indexOf.get(target);
    if (i !== undefined) {
      const node = model.nodes[i];
      return cameraAt(node.x + (opts.dx ?? 0), node.y + (opts.dy ?? 0), opts.zoom ?? 1, v);
    }
    throw new Error(`map.frame: unknown target ${target}`);
  }
  /**
   * Fits a set of tricks: their nodes' centres with `pad` screen pt around them (default 48: room for the rings and
   * the labels), up to `maxZoom` (default 1, the app's full tier) and no lower than `minZoom` (default 0.02).
   */
  function frameIds(ids, v, { pad = 48, maxZoom = 1, minZoom = 0.02 } = {}) {
    let l = Infinity;
    let t = Infinity;
    let r = -Infinity;
    let b = -Infinity;
    for (const id of ids) {
      const i = model.indexOf.get(id);
      if (i === undefined) continue;
      const node = model.nodes[i];
      l = Math.min(l, node.x);
      r = Math.max(r, node.x);
      t = Math.min(t, node.y);
      b = Math.max(b, node.y);
    }
    if (l === Infinity) return frame('overview', v);
    if (r - l < 1e-6 && b - t < 1e-6) return cameraAt(l, t, Math.max(minZoom, maxZoom), v);
    return fitRect({ x: l, y: t, w: Math.max(1e-3, r - l), h: Math.max(1e-3, b - t) }, v, pad, maxZoom, minZoom);
  }
  /** A camera from a target for flight() and route(): cameras pass through, the rest goes through frame(). */
  const cameraOf = (target) => (target && typeof target === 'object' && !Array.isArray(target.ids) ? target : frame(target));

  const api = {
    canvas,
    model,
    lang,
    get reduced() {
      return reduced;
    },
    /** Info about a trick for overlays and captions. */
    trick(trickId) {
      const i = model.indexOf.get(trickId);
      if (i === undefined) return null;
      const node = model.nodes[i];
      const line = model.lines[node.line];
      return {
        id: node.id,
        name: node.name,
        x: node.x,
        y: node.y,
        state: STATES[eff.codes[i]],
        xp: node.xp,
        difficulty: node.difficulty,
        line: { id: line.id, code: line.code, lit: line.lit, reachable: line.reachable, unlit: line.unlit },
        segment: model.segments[node.seg].id,
        attempts: base.attempts.get(i) ?? 0,
      };
    },
    /** Lit share of the whole map and per segment for the current (effective) states. */
    progress() {
      let lit = 0;
      for (let i = 0; i < N; i++) if (isDone(eff.codes[i])) lit++;
      return { lit, total: N, percent: Math.round((lit / N) * 100), segments: model.segments.map((s, k) => ({ id: s.id, percent: segmentPercent(k) })) };
    },
    setPreset,
    /**
     * Sets one trick's stored state ('learning' | 'landed' | 'onLock' | 'none') and re-derives open / locked
     * around it. `stances`: landed stance names for the ring (e.g. ['normal', 'fakie']); `attempts` for the tag.
     */
    setState(trickId, state, { stances, attempts } = {}) {
      const i = model.indexOf.get(trickId);
      if (i === undefined) return;
      const code = { learning: LEARNING, landed: LANDED, onLock: ON_LOCK }[state];
      base.codes[i] = code ?? LOCKED;
      if (stances) base.stances[i] = ['normal', 'fakie', 'nollie', 'switch'].reduce((mask, st, bit) => (stances.includes(st) ? mask | (1 << bit) : mask), 0);
      else if (code >= LANDED) base.stances[i] |= 1;
      if (attempts !== undefined) base.attempts.set(i, attempts);
      resolveAvailability(model, base.codes);
      baseVersion++;
      requestRender();
      prewarmSoon();
    },
    setReduced(value) {
      reduced = !!value;
      requestRender();
    },
    /** The light pools brighter (gain × their light) and wider (radius × their size); (1, 1) is the app's light. The
     *  hero's phone poster: the band between the words shows the city lit. */
    setPoolGain(gain = 1, radius = 1) {
      const g = Math.max(0, Number(gain) || 0);
      const r = Math.max(0.1, Number(radius) || 1);
      if (g === poolBoost.gain && r === poolBoost.radius) return;
      poolBoost.gain = g;
      poolBoost.radius = r;
      requestRender();
    },
    setCamera(c) {
      cam = { x: c.x, y: c.y, zoom: c.zoom };
      requestRender();
    },
    getCamera: () => ({ ...cam }),
    frame,
    flight: (a, b, opts = {}) => flightPath(cameraOf(a), cameraOf(b), { size: Math.min(W || 390, H || 844), ...opts }),
    route: (targets, opts = {}) => routePath(targets.map(cameraOf), { size: Math.min(W || 390, H || 844), ...opts }),
    /** World point → canvas px (CSS), e.g. to pin an HTML caption to a node. */
    toScreen(x, y) {
      return { x: (x - cam.x) * cam.zoom + W / 2, y: (y - cam.y) * cam.zoom + H / 2 };
    },
    trickPoint(trickId) {
      const i = model.indexOf.get(trickId);
      if (i === undefined) return null;
      return api.toScreen(model.nodes[i].x, model.nodes[i].y);
    },
    toWorld,
    tierOf: () => tierOf(cam.zoom),
    intro: introPlay,
    ripple,
    opens,
    prereqsOf,
    flash,
    tremble,
    idleHead,
    lightAll,
    /**
     * Segment tapes: setTapes(alpha 0…1 | true | false) fades them as a whole (also under reduced motion, where the
     * intro is skipped); setTapes(p, { slap: true }) plays the intro's slap-on instead, p 0 → 1 (scrubbable; under
     * reduced motion a plain fade). createMap({ tapes: false }) starts with them off.
     */
    setTapes(value, { slap = false } = {}) {
      const v = value === true ? 1 : !value ? 0 : clamp01(Number(value) || 0);
      tapes.slap = slap ? v : null;
      tapes.alpha = slap ? (v > 0 ? 1 : 0) : v;
      requestRender();
    },
    get tapes() {
      return tapes.slap !== null ? tapes.slap : tapes.alpha;
    },
    /**
     * Where the segment tapes stand for the current camera: [{ id, x, y, w, h }] in canvas CSS px (the paper strip,
     * without its ±1° tilt and shadow), only the ones drawn at this zoom. For keeping HTML clear of them, and for QA.
     */
    tapeRects() {
      if (!fontsOk || tapes.alpha <= 0 || fullWeight(cam.zoom) >= 1) return [];
      const out = [];
      for (let s = 0; s < model.segments.length; s++) {
        const box = tapeBox(s, cam.zoom);
        if (!box) continue;
        const x = box[0] + W / 2 - cam.x * cam.zoom;
        const y = box[1] + H / 2 - cam.y * cam.zoom;
        out.push({ id: model.segments[s].id, x, y, w: box[2] - box[0], h: box[3] - box[1] });
      }
      return out;
    },
    focus: focusTrick,
    focusPrereqs,
    clearFocus,
    nodeAt: (x, y) => nodeAt(x, y),
    enablePan(opts = {}) {
      panOpts = { touch: false, ...opts };
      canvas.style.touchAction = panOpts.touch ? 'none' : 'pan-y pinch-zoom';
      canvas.style.cursor = 'grab';
      return () => {
        panOpts = null;
        dragging = false;
        canvas.style.touchAction = 'pan-y pinch-zoom';
        canvas.style.cursor = '';
      };
    },
    onHover(cb) {
      hoverCbs.push(cb);
      return () => hoverCbs.splice(hoverCbs.indexOf(cb), 1);
    },
    onTap(cb) {
      tapCbs.push(cb);
      return () => tapCbs.splice(tapCbs.indexOf(cb), 1);
    },
    setActive(value) {
      active = !!value;
      if (!active && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      clearTimeout(idleTimer);
      if (active) requestRender();
    },
    /** Draws now (synchronously), e.g. right before a screenshot: every strip and sprite is made, nothing waits. */
    render() {
      // Released (far from the screen) a still is not drawn: there is nothing to see; near, the pixels come back.
      if (!reclaim()) return 0;
      return draw(performance.now());
    },
    stats,
    /** Pages of the atlas this map draws from (shared by every map of the page at its pixel ratio). */
    get atlasPages() {
      return atlas ? atlas.pages.length : 0;
    },
    /** Whether the canvases have given their pixels back (the map is ≥ 2 viewports from the screen). */
    get released() {
      return released;
    },
    /** Flush and time each drawing phase into stats.phases (slow; for profiling only). */
    profile(on = true) {
      profiling = !!on;
    },
    get ready() {
      return loadFonts().then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    },
    /** Removes the map. The shared atlas, declutter and prewarm stay for the page's other maps. */
    destroy() {
      destroyed = true;
      if (raf) cancelAnimationFrame(raf);
      if (restoreRaf) cancelAnimationFrame(restoreRaf);
      clearTimeout(idleTimer);
      clearTimeout(stateWarmTimer);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      ro.disconnect();
      near?.disconnect();
      canvas.remove();
      poolCanvas.remove();
      canvas.width = canvas.height = 0;
      poolCanvas.width = poolCanvas.height = 0;
    },
  };
  return api;
}
