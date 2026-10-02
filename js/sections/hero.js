// Hero: NEVER BEEN DONE. over the live night map, then the flight down to Kickflip (pinned 4.2 screens).
//
// Load: the words slam in (CSS, before this runs) · the map inks itself in from Stance and its lights come on
// (map.intro, timed to end ~2.6 s after navigation) · 300 ms after DONE. lands, Kickflip's learning beacon comes on
// and "…yet" writes on, its arrow's tip on the beacon's ring.
// Scroll (p 0 → 1): the poster rips (torn halves, transform only, hard cut at the end) and the segment tapes slap
// onto the city while the camera pulls back to it (beat 1), dives through Flips at the mid tier (beat 2) and lands on
// Kickflip at the full tier (beat 3, the app's NEXT UP card). Target lock: every camera is solved from where Kickflip
// has to sit on screen, so its pulse is one continuous beacon from the first frame to the last.
// Desktop: drag pans the map (roll sound; the scroll always takes the camera back), hover names a node, a click
// lights everything it builds on (the trick itself keeps its state, and Kickflip stays the trick being learned: its
// landing is the climax, further down). Touch: a tap does the same; the page keeps scrolling.
// Phone poster: the open band holds the city's lit quarter, its light pools boosted until the camera pulls back.
// The COMING SOON sticker: pressed, it peels up at a corner; let go, it slaps back down (the sticker sound).
// Reduced motion: still frames that cut at the beats.

import { createMap } from '../map/index.js';

const KF = 'kickflip';
// Scroll timeline (hero progress).
const TL = {
  tearEnd: 0.17, // the poster is gone (hard cut)
  tapes: [0.03, 0.13], // the segment tapes slap on as the poster rips: start, length
  keys: [0, 0.035, 0.2, 0.36, 0.56, 0.68, 0.88, 1], // camera: hold, pull back, hold, dive, hold, dive, hold
  beats: [
    // Wide screens hold the first caption into the dive: it is what fills the left half while the city sits right.
    { from: 0.15, to: 0.375, toWide: 0.48 },
    { from: 0.5, to: 0.695 },
    { from: 0.83, to: 2 },
  ],
};
// Reduced motion: the flight as still frames that cut at the beat thresholds.
const cut = (p) => (p < 0.12 ? 0 : p < 0.45 ? 0.28 : p < 0.78 ? 0.62 : 1);
const IDLE_HEAD_MS = 8000;
const PAN_RELEASE = 0.06; // a dragged camera eases back onto the flight over this much scroll
// "…yet" and the beacon: 300 ms after DONE. has landed (the dot's drop ends at 1.37 s, hero.css).
const YET_AT = 1670;
// The arrow's tip in its viewBox (64 × 48: the path ends at 8.5, 37.5) and its tilt (hero.css: rotate ±4deg).
const TIP = [8.5 / 64, 37.5 / 48];
const TIP_TILT = 4;
// Where the tip touches Kickflip: the overview learning dot's outer red ring (r 11) and a hair.
const RING = 12;

export default async function init(root, ctx) {
  const { dom, motion, sound } = ctx;
  const { clamp, lerp } = dom;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];

  const stage = $('.hero');
  const poster = $('.hero__poster');
  const h1 = $('.hero__h1');
  const rip = $('.hero__rip');
  const lines = $$('.hero__h1 .hero__ln');
  const tape = $('.hero__tape');
  const band = $('.hero__band');
  const hand = $('.hero__hand');
  const handWipe = $('.hero__hand-wipe');
  const handIn = $('.hero__hand-in');
  const arrow = $('.hero__arrow');
  const sub = $('.hero__sub');
  const foot = $('.hero__foot');
  const cta = $('.hero__cta');
  const drop = $('.hero__drop');
  const beacon = $('.hero__beacon');
  const probe = $('.hero__probe');
  const probeName = $('.hero__probe-name');
  const probeTag = $('.hero__probe-tag');
  const probeMore = $('.hero__probe-more');
  const beats = $$('.hero__beat');
  const mapEl = $('.hero__map');

  const t0 = performance.now();
  const startP = ctx.scroll.progressOf('hero');
  // Arrived mid-page (a reload, an anchor) or late: no load choreography, the poster is simply there.
  const settled = startP > 0.002 || t0 > 6000;
  if (settled) root.classList.add('is-settled');

  // The toner tile on the words: fetched and decoded first (a mask that is still loading would hide them), switched
  // on after the slam so the slam layers stay plain.
  const toner = new Image();
  toner.src = ctx.asset('assets/img/hero/toner.png');
  Promise.all([toner.decode(), motion.sleep(settled ? 0 : 1300)])
    .then(() => root.classList.add('is-toner'))
    .catch(() => {});

  let reduced = ctx.reduced;
  const desktopQuery = matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 600px)');
  const fineQuery = matchMedia('(hover: hover) and (pointer: fine)');

  // ---------------------------------------------------------------- the map

  const data = await ctx.data('map');
  const [worldW, worldH] = data.world;
  let ready = false;
  // The tapes start off: on the poster they would peek out between the letters. They slap on as it rips.
  const map = createMap(mapEl, {
    data,
    preset: 'intermediate',
    reduced,
    lang: ctx.lang,
    tapes: false,
    hover: (id) => onHover(id),
    tap: (id) => onTap(id),
    onResize: () => {
      if (ready) relayout();
    },
  });
  const kf = map.trick(KF);

  // ---------------------------------------------------------------- geometry and the camera keys

  let W = 1;
  let H = 1;
  let extra = 0; // how much taller the stage is than the small viewport (the iOS toolbar gone)
  let footTop = Infinity; // phones: where the promise starts (the probe stays above it on the poster)
  let desk = false;
  let keys = [];
  let tears = [];

  /** Camera that shows Kickflip at screen point (ax, ay) at zoom z. */
  const lockOn = (ax, ay, z) => ({ x: kf.x - (ax - W / 2) / z, y: kf.y - (ay - H / 2) / z, zoom: z });
  const anchorOf = (cam) => ({ ax: (kf.x - cam.x) * cam.zoom + W / 2, ay: (kf.y - cam.y) * cam.zoom + H / 2, z: cam.zoom });
  const box = (el) => {
    const r = el.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
  };
  /** Layout box of a line, ignoring the transforms of the rip. */
  const lineBox = (el) => ({ x: h1.offsetLeft + el.offsetLeft, y: h1.offsetTop + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });

  function relayout() {
    W = stage.clientWidth || innerWidth;
    H = stage.clientHeight || innerHeight;
    desk = desktopQuery.matches;
    // The stage is dvh: in iOS Safari it grows by the bottom toolbar (~80 pt) once the visitor scrolls. The keys are
    // composed in the small viewport (svh), so the city never hops when it does: the extra height only shows more
    // city at the bottom. (lockOn and anchorOf stay on the real H, the canvas centre.)
    const Hs = Math.min(H, ctx.scroll.vh || H);
    extra = H - Hs;
    const chrome = parseFloat(getComputedStyle(root).getPropertyValue('--hero-top')) || 98;
    measureHand();

    // Key 0: the first screen. Phone: Kickflip low in the open band between the tape and the promise, as far right
    // as the dare beside it allows, the city pulled back so the lit Shuvits and Ollies — west and north of it — fill
    // the band's left with their light, and the dare goes up to the right. Desktop: in the dark to the right of BEEN,
    // with room for the dare on its right.
    let k0;
    if (desk) {
      const b = lineBox(lines[1]);
      const right = b.x + b.w;
      const room = W - 24 - (handM.w - handM.tip[0][0]) - RING;
      k0 = { ax: Math.max(right + 60, Math.min(right + (W - right) * 0.4, room)), ay: b.y + b.h * 0.4, z: clamp(W / 3200, 0.38, 0.47) };
    } else {
      const b = box(band);
      const bh = b.h - extra;
      // The dare's room on the right of the ring decides how far right Kickflip can go (the longer «…пока что» moves
      // it left: the lights stay west of it, the dare east, full size).
      const room = W - 10 - (handM.w - handM.tip[0][0]) - RING;
      k0 = { ax: clamp(room, W * 0.36, W * 0.62), ay: b.y + bh - clamp(bh * 0.12, 12, 22), z: clamp(Math.min(W / 1640, bh / 640), 0.19, 0.26) };
    }
    // Key 1: the whole city, fitted into what the caption leaves free, with no segment tape under the caption.
    const beatH = beats[0].offsetHeight;
    // (A phone on its side has no height to spare: the top bar is up while the page scrolls down, so the city goes
    // up to the HUD.)
    const vp = desk
      ? H < 500
        ? { width: W, height: H, top: 50, bottom: 16, left: W * 0.46, right: 16 }
        : { width: W, height: H, top: chrome + 8, bottom: 26, left: Math.min(W * 0.42, 620), right: 24 }
      : { width: W, height: H, top: chrome - 16, bottom: extra + (Hs < 740 ? beatH * 0.62 : beatH + 34), left: 0, right: 0 };
    const k1 = anchorOf(overview(vp, desk ? 16 : 6));
    // Key 2: Flips at the mid tier, Kickflip high so its lines run down the screen, easy to hard.
    const k2 = desk ? { ax: W * 0.66, ay: chrome + (H - chrome) * 0.22, z: 0.66 } : { ax: W * 0.56, ay: chrome + 40, z: 0.6 };
    // Key 3: Kickflip at the full tier, exactly as the app draws it (zoom 1).
    const k3 = desk ? { ax: W * 0.66, ay: chrome + (H - chrome) * 0.3, z: 1 } : { ax: W * 0.47, ay: chrome + 92, z: 1 };
    keys = [k0, k0, k1, k1, k2, k2, k3, k3];
    // The note never climbs onto the tape (short phones have a thin band).
    handTop = desk ? -Infinity : tape.offsetTop + tape.offsetHeight + 2;
    footTop = desk ? Infinity : foot.offsetTop;
    buildTears();
    place(lastP);
  }

  /** The overview camera for `vp`, pulled back until no segment tape sits under beat 1's caption (map.tapeRects()
   *  measures the tapes at a camera; they are switched on for the measure only, inside this task). */
  function overview(vp, pad) {
    const s = stage.getBoundingClientRect();
    const cap = { x: Infinity, y: Infinity, r: -Infinity, b: -Infinity };
    // Phones: the caption is anchored to the stage's bottom; measured where it sits in the small viewport.
    const dy = desk ? 0 : extra;
    for (const el of beats[0].querySelectorAll('.hero__kicker > span, .hero__strip, .hero__note')) {
      const r = el.getBoundingClientRect();
      cap.x = Math.min(cap.x, r.left - s.left - 8);
      cap.y = Math.min(cap.y, r.top - s.top - 6 - dy);
      cap.r = Math.max(cap.r, r.right - s.left + 8);
      cap.b = Math.max(cap.b, r.bottom - s.top + 4 - dy);
    }
    const keep = map.getCamera();
    map.setTapes(1);
    let cam = map.frame('overview', vp, { pad });
    // Beside the caption (wide screens) never at the price of the city: it narrows by at most a quarter, as the tapes
    // keep their size while it shrinks. Above it (phones) the city can always make room.
    const least = desk ? cam.zoom * 0.75 : 0;
    for (let i = 0; i < 6; i++) {
      map.setCamera(cam);
      const hits = map.tapeRects().filter((t) => t.x < cap.r && t.x + t.w > cap.x && t.y < cap.b && t.y + t.h > cap.y);
      if (!hits.length) break;
      if (desk) vp.left += Math.max(...hits.map((t) => cap.r - t.x)) + 2;
      else vp.bottom += Math.max(...hits.map((t) => t.y + t.h - cap.y)) + 2;
      const next = map.frame('overview', vp, { pad });
      if (next.zoom < least) break;
      cam = next;
    }
    map.setCamera(keep);
    map.setTapes(tapesV, { slap: true });
    return cam;
  }

  /** Camera for hero progress q: zoom interpolated in log space, Kickflip's screen anchor eased between keys. */
  function cameraAt(q) {
    const P = TL.keys;
    let i = 0;
    while (i < P.length - 2 && q > P[i + 1]) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const s = smootherstep(clamp((q - P[i]) / Math.max(1e-6, P[i + 1] - P[i])));
    const z = Math.exp(lerp(Math.log(a.z), Math.log(b.z), s));
    return lockOn(lerp(a.ax, b.ax, s), lerp(a.ay, b.ay, s), z);
  }

  // ---------------------------------------------------------------- the rip

  // One jagged tear per word, made once per layout: piece A (the real word, left of the tear) and piece B (a clone
  // in .hero__rip, right of it). Clip paths are set at rip start; after that only transforms move.
  const CUT = [0.47, 0.56, 0.5];
  const FLY = [
    // [ax, ay, ar, bx, by, br] in W/H fractions and degrees
    [-1.15, -0.1, -14, 1.1, -0.04, 9],
    [-1.1, 0.07, -8, 1.15, -0.12, 13],
    [-0.4, 1.15, -19, 0.28, 1.2, 15],
  ];
  const clones = lines.map((line) => {
    const c = line.cloneNode(true);
    c.removeAttribute('lang');
    rip.appendChild(c);
    return c;
  });
  let torn = false;

  function buildTears() {
    const rnd = dom.prng(1987);
    tears = lines.map((line, i) => {
      const w = line.offsetWidth;
      const h = line.offsetHeight;
      const em = parseFloat(getComputedStyle(line).fontSize) || 100;
      const pad = em * 0.4;
      const pts = [];
      let y = -pad;
      const x0 = w * CUT[i];
      const drift = (rnd() - 0.5) * em * 0.22;
      while (y < h + pad) {
        const k = (y + pad) / (h + 2 * pad);
        pts.push([x0 + drift * (k - 0.5) + (rnd() - 0.5) * em * 0.075, y]);
        y += em * (0.035 + rnd() * 0.055);
      }
      pts.push([x0 + drift * 0.5 + (rnd() - 0.5) * em * 0.075, h + pad]);
      const fmt = (p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`;
      const a = [[-pad * 2, -pad], ...pts, [-pad * 2, h + pad]];
      const b = [[w + pad * 2, -pad], ...pts, [w + pad * 2, h + pad]];
      return { a: `polygon(${a.map(fmt).join(',')})`, b: `polygon(${b.map(fmt).join(',')})` };
    });
    if (torn) applyClips(true);
  }
  function applyClips(on) {
    lines.forEach((line, i) => {
      line.style.clipPath = on ? tears[i].a : '';
      clones[i].style.clipPath = on ? tears[i].b : '';
    });
    rip.classList.toggle('is-on', on);
  }

  const easeIn = (k) => k * k * k;
  const smootherstep = (k) => k * k * k * (k * (k * 6 - 15) + 10);
  /** The rip's displacement for k ∈ [0, 1]: the tear cracks open at once, then the pieces are flung. */
  const flung = (k) => 0.05 * clamp(k / 0.18) + 0.95 * easeIn(clamp((k - 0.12) / 0.88));
  const tf = (x, y, r) => `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(2)}deg)`;

  let posterShown = true;
  function tearAt(q) {
    const on = q > 0.0005 && q < TL.tearEnd;
    if (on !== torn) {
      torn = on;
      applyClips(on);
      poster.classList.toggle('is-tearing', on);
    }
    // Hard cut once the pieces are off screen. Opacity, not visibility: the h1 stays in the accessibility tree.
    const gone = q >= TL.tearEnd;
    if (gone === posterShown) {
      posterShown = !gone;
      poster.style.opacity = gone ? '0' : '';
      poster.classList.toggle('is-gone', gone);
    }
    if (gone) return;
    for (let i = 0; i < 3; i++) {
      const s = i * 0.016;
      const k = flung(clamp((q - s) / 0.13));
      const [ax, ay, ar, bx, by, br] = FLY[i];
      const tA = k ? tf(ax * W * k, ay * H * k, ar * k) : '';
      const tB = k ? tf(bx * W * k, by * H * k, br * k) : '';
      if (lines[i].style.transform !== tA) lines[i].style.transform = tA;
      if (clones[i].style.transform !== tB) clones[i].style.transform = tB;
    }
    // The tape goes down with DONE, a beat later, as if it were still stuck to it.
    const kt = flung(clamp((q - 0.045) / 0.12));
    tape.style.transform = kt ? tf(W * 0.12 * kt, H * 1.1 * kt, 11 * kt) : '';
    // The promise slides away; the sticker is peeled off and falls; the cue goes first.
    const ks = clamp(q / 0.06);
    sub.style.transform = ks ? `translate3d(0, ${(ks * 40).toFixed(1)}px, 0)` : '';
    sub.style.opacity = ks ? (1 - ks).toFixed(3) : '';
    const kc = flung(clamp((q - 0.01) / 0.12));
    cta.style.transform = kc ? tf(-W * 0.08 * kc, H * 1.05 * kc, -16 * kc) : '';
    drop.style.opacity = q > 0 ? clamp(1 - q / 0.03).toFixed(3) : '';
  }

  // ---------------------------------------------------------------- the segment tapes

  // Off on the poster; slapped onto the city one after another as it rips (a plain fade under reduced motion, where
  // the flight cuts straight to the overview). The city has to be fully inked by then: a running intro is finished.
  let tapesV = 0;
  function tapesAt(q) {
    const v = clamp((q - TL.tapes[0]) / TL.tapes[1]);
    if (v === tapesV) return;
    tapesV = v;
    if (v > 0 && introRunning) map.intro.seek(null);
    map.setTapes(v, { slap: true });
  }

  // ---------------------------------------------------------------- the light on the phone's poster

  // On the phone the poster leaves the city one open band, and the city there is its lit quarter (Basics, Ollies,
  // Shuvits, west and north of Kickflip): its pools burn brighter and wider while the poster is up, back to the app's
  // light as the camera pulls back to the whole city (which shows the light by itself). Wide screens show the city
  // round the words and keep the app's light.
  const POOL_GAIN = [1.75, 1.3]; // light, radius
  let poolK = -1;
  function poolsAt(q) {
    const k = desk ? 1 : smootherstep(clamp((q - TL.keys[1]) / (TL.tearEnd - TL.keys[1])));
    if (k === poolK) return;
    poolK = k;
    map.setPoolGain(lerp(POOL_GAIN[0], 1, k), lerp(POOL_GAIN[1], 1, k));
  }

  // ---------------------------------------------------------------- overlays pinned to the map

  // The map's level-of-detail ramps (js/map/camera.js LOD: mid from 0.5, full from 0.85, 0.06 bands).
  const ramp = (zoom, at) => {
    const t = (zoom - (at - 0.03)) / 0.06;
    return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  };
  let lit = settled || reduced; // the city is inked and lit
  let yet = settled || reduced; // the beacon and "…yet" are on
  let handTop = -Infinity;
  let lastP = startP;
  let lastQ = reduced ? cut(startP) : startP;

  // "…yet": its box and where the arrow's tip is in it, as drawn (hero.css) and flipped (arrow on the right).
  const handM = {
    w: 0,
    h: 0,
    tip: [
      [0, 0],
      [0, 0],
    ],
  };
  function measureHand() {
    const was = hand.classList.contains('is-flip');
    const cs = getComputedStyle(handWipe);
    const ox = parseFloat(cs.paddingLeft) || 0;
    const oy = parseFloat(cs.paddingTop) || 0;
    handM.tip = [false, true].map((flip) => {
      hand.classList.toggle('is-flip', flip);
      // Relative to the inner row: the wipe only translates it, so these offsets are its layout.
      const a = arrow.getBoundingClientRect();
      const b = handIn.getBoundingClientRect();
      const aw = parseFloat(getComputedStyle(arrow).width) || 0;
      const ah = parseFloat(getComputedStyle(arrow).height) || 0;
      let vx = (TIP[0] - 0.5) * aw;
      const vy = (TIP[1] - 0.5) * ah;
      if (flip) vx = -vx;
      const r = ((flip ? -TIP_TILT : TIP_TILT) * Math.PI) / 180;
      return [
        ox + a.left + a.width / 2 - b.left + vx * Math.cos(r) - vy * Math.sin(r),
        oy + a.top + a.height / 2 - b.top + vx * Math.sin(r) + vy * Math.cos(r),
      ];
    });
    hand.classList.toggle('is-flip', was);
    handM.w = hand.offsetWidth;
    handM.h = hand.offsetHeight;
  }
  let handFlip = false;
  let handLook = '';
  let handBox = null; // where "…yet" is on screen while it shows (the probe keeps clear of it)

  function overlays(q) {
    const cam = map.getCamera();
    const pt = map.trickPoint(KF);
    const m = ramp(cam.zoom, 0.5);
    const f = ramp(cam.zoom, 0.85);
    // The beacon: full strength at the overview, where the canvas dot is tiny; across the mid band it shrinks onto the
    // canvas's own pulse, and across the full band it hands over to it — from there the app's pulse (r 14 → 26,
    // 1.6 s) is the beacon. One red, never out, never doubled at the end.
    const a = yet ? lerp(1, 0.92, m) * (1 - f) : 0;
    const size = lerp(1, 0.82, m) * (desk ? 1.15 : 1);
    beacon.style.opacity = a.toFixed(3);
    if (a > 0) beacon.style.transform = `translate3d(${pt.x.toFixed(1)}px, ${pt.y.toFixed(1)}px, 0) scale(${size.toFixed(3)})`;
    // "…yet": the arrow's tip on the ring, the note up and to the right of it — or to the left when it would run off
    // the screen (and a little smaller when it fits neither side). Gone as soon as the poster comes down.
    const ha = clamp(1 - q / 0.035);
    hand.style.opacity = ha.toFixed(3);
    handBox = null;
    if (ha > 0 && handM.w) {
      const d = RING * Math.SQRT1_2;
      const ty = pt.y - d;
      const fitR = (W - 8 - (pt.x + d)) / Math.max(1, handM.w - handM.tip[0][0]);
      const fitL = (pt.x - d - 8) / Math.max(1, handM.tip[1][0]);
      const flip = fitR < 1 && fitL > fitR;
      const s = Math.min(1, flip ? fitL : fitR);
      const tip = handM.tip[flip ? 1 : 0];
      const tx = flip ? pt.x - d : pt.x + d;
      const x = tx - tip[0] * s;
      const y = Math.max(ty - tip[1] * s, q < 0.002 ? handTop : -Infinity);
      if (flip !== handFlip) {
        handFlip = flip;
        hand.classList.toggle('is-flip', flip);
      }
      const look = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)${s < 1 ? ` scale(${s.toFixed(3)})` : ''}`;
      if (look !== handLook) hand.style.transform = handLook = look;
      if (yet) handBox = { x: x - 4, y: y - 4, r: x + handM.w * s + 4, b: y + handM.h * s + 4 };
    }
    if (probeId) placeProbe();
  }

  // ---------------------------------------------------------------- beats

  const pop = motion.solveSpring('pop');
  const beatParts = beats.map((b) => [...b.children].flatMap((c) => (c.classList.contains('hero__strips') ? [...c.children] : [c])));
  const beatOn = beats.map(() => false);
  const bscrim = $('.hero__bscrim');
  const bfade = $('.hero__bfade');
  let scrimA = -1;
  let fadeA = -1;
  function beatsAt(q) {
    // The scrim under the captions comes with the first beat and stays to the end; the bottom fade (wide screens)
    // comes with the last.
    const sa = reduced ? (q >= TL.beats[0].from ? 1 : 0) : clamp((q - TL.beats[0].from + 0.02) / 0.04);
    if (sa !== scrimA) {
      scrimA = sa;
      bscrim.style.opacity = sa.toFixed(3);
    }
    const fa = reduced ? (q >= TL.beats[2].from ? 1 : 0) : clamp((q - TL.beats[2].from + 0.04) / 0.08);
    if (fa !== fadeA) {
      fadeA = fa;
      bfade.style.opacity = fa.toFixed(3);
    }
    TL.beats.forEach(({ from, to, toWide }, i) => {
      const on = q >= from && q < (desk && toWide ? toWide : to);
      if (on !== beatOn[i]) {
        beatOn[i] = on;
        beats[i].classList.toggle('is-on', on);
      }
      if (!on) return;
      beatParts[i].forEach((el, j) => {
        if (reduced) {
          el.style.transform = '';
          el.style.opacity = '';
          return;
        }
        // Slapped on one strip after another: scale from 1.22 with the pop spring, a hard start.
        const k = clamp((q - from - j * 0.011) / 0.032);
        const v = pop.at(k);
        el.style.opacity = k >= 1 ? '' : clamp(k * 5).toFixed(3);
        el.style.transform = k >= 1 ? '' : `translate3d(0, ${((1 - v) * 10).toFixed(1)}px, 0) scale(${(1.22 - 0.22 * v).toFixed(4)})`;
      });
    });
  }

  // ---------------------------------------------------------------- desktop: drag the city

  // hero.js owns the drag (not map.enablePan), so the scroll can always take the camera back: the offset lives here,
  // in world units, and fades out over PAN_RELEASE of scroll from where the pointer last moved it. In world units it
  // also shrinks with the zoom as the camera pulls back, so it can never throw the overview off screen. A flick
  // glides on, and the glide stops the moment the page moves.
  let pan = null; // { x, y (world units), at (hero progress) }
  let drag = null; // { id, x, y, t, vx, vy, moved }
  let glide = null; // the glide's ticker subscription
  let pannable = false;

  function panWeight() {
    if (!pan) return 0;
    const w = 1 - smootherstep(clamp(Math.abs(lastP - pan.at) / PAN_RELEASE));
    if (w <= 0 && !drag && !glide) pan = null;
    return w;
  }
  /** The city moved (dx, dy) screen px under the pointer: the camera goes the other way, never off the world. */
  function panBy(dx, dy) {
    const base = cameraAt(lastQ);
    // What shows of an older offset is kept (its weight baked in) and anchored here.
    const w = pan ? panWeight() : 1;
    const x = (pan ? pan.x * w : 0) - dx / base.zoom;
    const y = (pan ? pan.y * w : 0) - dy / base.zoom;
    pan = { x: clamp(base.x + x, 0, worldW) - base.x, y: clamp(base.y + y, 0, worldH) - base.y, at: lastP };
  }
  function stopGlide() {
    if (!glide) return;
    glide();
    glide = null;
  }
  function startGlide(vx, vy) {
    stopGlide();
    const from = lastP;
    glide = ctx.ticker.subscribe((dt) => {
      if (lastP !== from || !pan) {
        stopGlide();
        return;
      }
      const decay = Math.exp(-dt / 350);
      const nx = vx * decay;
      const ny = vy * decay;
      panBy(((vx + nx) / 2) * (dt / 1000), ((vy + ny) / 2) * (dt / 1000));
      vx = nx;
      vy = ny;
      const speed = Math.hypot(vx, vy);
      sound.roll(clamp(speed / 2400));
      place(lastP);
      if (speed < 6) stopGlide();
    });
  }
  function endDrag() {
    drag = null;
    mapEl.classList.remove('is-grabbing');
  }
  function syncPan() {
    pannable = fineQuery.matches && !reduced;
    mapEl.classList.toggle('is-pannable', pannable);
    if (!pannable) {
      endDrag();
      stopGlide();
    }
  }
  mapEl.addEventListener('pointerdown', (e) => {
    if (!pannable || e.pointerType === 'touch' || e.button !== 0) return;
    stopGlide();
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0, moved: 0 };
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable */
    }
  });
  mapEl.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const dt = Math.max(1, now - drag.t);
    drag.moved += Math.hypot(dx, dy);
    drag.vx = drag.vx * 0.6 + (dx / dt) * 1000 * 0.4;
    drag.vy = drag.vy * 0.6 + (dy / dt) * 1000 * 0.4;
    drag.x = e.clientX;
    drag.y = e.clientY;
    drag.t = now;
    if (drag.moved >= 6 && !mapEl.classList.contains('is-grabbing')) {
      mapEl.classList.add('is-grabbing');
      if (focusAt === null) showProbe(null);
    }
    panBy(dx, dy);
    sound.roll(clamp(Math.hypot(drag.vx, drag.vy) / 2400));
    place(lastP);
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const fresh = performance.now() - drag.t < 80 && e.type === 'pointerup';
    const vx = fresh ? clamp(drag.vx, -3200, 3200) : 0;
    const vy = fresh ? clamp(drag.vy, -3200, 3200) : 0;
    endDrag();
    if (Math.hypot(vx, vy) > 40) startGlide(vx, vy);
  };
  mapEl.addEventListener('pointerup', release);
  mapEl.addEventListener('pointercancel', release);

  // ---------------------------------------------------------------- hover, tap

  let probeId = null;
  let probeW = 0;
  let probeH = 0;
  let focusAt = null;

  /** The probe beside its node: up and to the right on the city (below it once the map draws its own labels, which
   *  sit left of the node with the tag up and right), or the first other corner that stays on screen, clear of
   *  "…yet" and, on the phone's poster, above the promise (the poster is drawn over the probe). */
  function placeProbe() {
    const p = map.trickPoint(probeId);
    if (!p) return;
    const right = p.x + 16;
    const left = p.x - 16 - probeW;
    const up = p.y - 30;
    const above = p.y - 18 - probeH;
    const below = p.y + 20;
    const floor = !desk && lastQ < 0.05 ? footTop - 6 : H - 8;
    const labelled = map.getCamera().zoom >= 0.5;
    const spots = labelled
      ? [[right, below], [left, below], [right, above], [left, above], [right, up], [left, up]]
      : [[right, up], [left, up], [right, above], [left, above], [right, below], [left, below]];
    let at = null;
    for (const [x, y] of spots) {
      if (x < 8 || x + probeW > W - 8 || y < 8 || y + probeH > floor) continue;
      if (handBox && x < handBox.r && x + probeW > handBox.x && y < handBox.b && y + probeH > handBox.y) continue;
      at = [x, y];
      break;
    }
    const x = at ? at[0] : clamp(spots[0][0], 8, W - probeW - 8);
    const y = at ? at[1] : clamp(spots[0][1], 8, floor - probeH);
    probe.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
  }
  /** A node's name and its state as the app tags them (where the map does not draw them already); `more`: what a tap
   *  adds (what it builds on). */
  function showProbe(id, more) {
    probeId = id;
    if (!id) {
      probe.classList.remove('is-on');
      return;
    }
    const t = map.trick(id);
    const zoom = map.getCamera().zoom;
    const state = t.state;
    // Mid tier and up the map names every node in view (a focused chain always); the full tier also tags the learning
    // trick and baits the open ones with their XP.
    probeName.textContent = zoom >= 0.5 ? '' : t.name;
    probeTag.dataset.state = state;
    probeTag.textContent = '';
    if (zoom < 0.85 || (state !== 'learning' && state !== 'available')) {
      let tag = ctx.t(`state.${state}`);
      if (state === 'learning' && t.attempts) tag = `${tag} · ${t.attempts}`;
      probeTag.append(tag);
      if (state === 'available') {
        const xp = document.createElement('span');
        xp.className = 'xp';
        xp.textContent = `+${t.xp} XP`;
        probeTag.append(xp);
      }
    }
    probeMore.textContent = more || '';
    if (!probeName.textContent && !probeTag.textContent && !probeMore.textContent) {
      probeId = null;
      probe.classList.remove('is-on');
      return;
    }
    probe.classList.add('is-on');
    probeW = probe.offsetWidth;
    probeH = probe.offsetHeight;
    placeProbe();
  }
  function onHover(id) {
    if (focusAt !== null) return; // a lit chain keeps its caption
    if (drag && drag.moved >= 6) return; // the city is being dragged under the pointer
    showProbe(id);
  }
  function onTap(id) {
    if (!id) {
      clearFocus();
      return;
    }
    sound.play('select');
    // Everything it builds on lights up; the trick itself stays as it is, and Kickflip stays the trick being learned
    // wherever it is in the chain — landing it is the climax, further down the page.
    const chain = map.focusPrereqs(id, { light: true, keep: [id, KF] });
    focusAt = lastP;
    overlays(lastQ);
    const n = chain.length - 1;
    showProbe(id, n > 0 ? ctx.t('buildsOn', { n }) : ctx.t('root'));
  }
  function clearFocus() {
    if (focusAt === null) return;
    focusAt = null;
    map.clearFocus();
    showProbe(null);
    overlays(lastQ);
  }
  const onKey = (e) => {
    if (e.key === 'Escape') clearFocus();
  };

  // ---------------------------------------------------------------- the COMING SOON sticker

  // A statement, not a link: the call to action is at the end of the story. Pressing it peels it up at a corner; let
  // go, it slaps back down with the sticker sound. A scroll that starts on it just lets go.
  let peel = null;
  cta.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    peel = e.pointerId;
    cta.classList.add('is-peeled');
  });
  const unpeel = (e) => {
    if (peel === null || e.pointerId !== peel) return;
    peel = null;
    cta.classList.remove('is-peeled');
    if (e.type !== 'pointerup') return;
    sound.play('sticker');
    // The slap: a hard spring from a hair over size (Web Animations: the load choreography keeps its CSS animation).
    if (!reduced) motion.animate(cta, [{ scale: '1.07' }, { scale: '1' }], { spring: 'slam', fill: 'none' });
  };
  cta.addEventListener('pointerup', unpeel);
  cta.addEventListener('pointercancel', unpeel);
  cta.addEventListener('pointerleave', unpeel);

  // ---------------------------------------------------------------- per frame

  function place(p) {
    lastP = p;
    const q = reduced ? cut(p) : p;
    lastQ = q;
    const cam = cameraAt(q);
    const w = panWeight();
    if (w > 0) {
      cam.x = clamp(cam.x + pan.x * w, 0, worldW);
      cam.y = clamp(cam.y + pan.y * w, 0, worldH);
    }
    map.setCamera(cam);
    if (focusAt !== null && Math.abs(p - focusAt) > 0.025) clearFocus();
    tearAt(q);
    tapesAt(q);
    poolsAt(q);
    beatsAt(q);
    overlays(q);
  }

  // ---------------------------------------------------------------- the lights come on

  let introTimer = 0;
  let introRun = 0;
  let introRunning = false;
  let yetTimer = 0;
  function lightsOn() {
    lit = true;
    root.classList.add('is-lit');
  }
  function yetOn() {
    yet = true;
    root.classList.add('is-yet');
    overlays(lastQ);
  }
  /** Schedules the load against the time since navigation (`now`): the ink starts once DONE has slammed (~0.7 s),
   *  the beacon and "…yet" come 300 ms after the full stop lands, the last pools bloom by ~2.6 s. */
  function lightUp(now) {
    clearTimeout(introTimer);
    clearTimeout(yetTimer);
    const run = ++introRun;
    yetTimer = setTimeout(yetOn, Math.max(0, YET_AT - now));
    map.intro.seek(0);
    const start = Math.max(now, 700);
    const duration = clamp(2600 - start, 1500, 2100);
    introTimer = setTimeout(() => {
      if (run !== introRun) return;
      if (lastP > 0.002 || reduced) {
        map.intro.seek(null);
        lightsOn();
        return;
      }
      introRunning = true;
      map.intro({ duration }).then(() => {
        if (run === introRun) introRunning = false;
      });
      // The intro's last fifth is the tapes' slap-on, which the hero keeps for the rip.
      introTimer = setTimeout(() => {
        if (run === introRun) lightsOn();
      }, duration * 0.78);
    }, start - now);
  }
  ready = true;
  relayout();
  root.classList.add('is-placed');
  if (yet) root.classList.add('is-yet');
  if (lit) root.classList.add('is-lit');
  else lightUp(performance.now());
  syncPan();
  fineQuery.addEventListener?.('change', syncPan);
  desktopQuery.addEventListener?.('change', relayout);
  // The band, the note's width and the tapes depend on the faces: frame again once they are in.
  document.fonts?.ready.then(relayout);
  map.ready.then(relayout);

  const offReduced = ctx.onReducedChange((value) => {
    reduced = value;
    map.setReduced(value);
    if (value) {
      if (!lit) {
        clearTimeout(introTimer);
        map.intro.seek(null);
        lightsOn();
      }
      if (!yet) {
        clearTimeout(yetTimer);
        yetOn();
      }
    }
    syncPan();
    tapesV = -1;
    place(lastP);
  });
  void offReduced;

  // Idle life: one paper head along a lit line every ~8 s while the camera rests.
  let idleTimer = 0;
  function idle() {
    idleTimer = setTimeout(idle, IDLE_HEAD_MS);
    if (reduced || drag || glide || !lit || document.hidden) return;
    const resting = TL.keys.some((k, i) => i % 2 === 0 && lastQ >= k - 1e-4 && lastQ <= (TL.keys[i + 1] ?? 1) + 1e-4);
    if (resting) map.idleHead();
  }

  return {
    progress(p) {
      if (p !== lastP) stopGlide(); // the page moved: the scroll has the camera
      place(p);
    },
    enter() {
      root.classList.remove('is-paused');
      map.setActive(true);
      clearTimeout(idleTimer);
      idleTimer = setTimeout(idle, IDLE_HEAD_MS);
      addEventListener('keydown', onKey);
    },
    leave() {
      root.classList.add('is-paused');
      map.setActive(false);
      clearTimeout(idleTimer);
      removeEventListener('keydown', onKey);
      clearFocus();
      endDrag();
      stopGlide();
    },
    /** QA: plays the load choreography again from navigation time 0 (CSS slams, the lights, "…yet"). */
    replay() {
      lit = false;
      yet = false;
      root.classList.remove('is-lit', 'is-yet', 'is-settled');
      overlays(lastQ);
      // Restart the CSS choreography: switch it off for one style recalc.
      root.classList.add('is-settled');
      void root.offsetWidth;
      root.classList.remove('is-settled');
      lightUp(0);
    },
    /** QA: the map, the camera keys and the drag offset; relayout() frames again (e.g. after a text-size change). */
    map,
    relayout,
    get keys() {
      return keys;
    },
    get pan() {
      return pan && { ...pan, gliding: !!glide };
    },
  };
}
