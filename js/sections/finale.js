// Finale: the bookend of the hero's flight — the whole map lights up, then the call to action (pinned 2.5 screens).
//
// Scroll (p 0 → 1): it opens tight on Kickflip at zoom 1, exactly where the hero's flight landed (the thread of the
// page: Kickflip, landed now), under the title card "A few seasons later." Then the camera pulls back out — the hero's
// dive played in reverse, one map.flight on the same p — while map.lightAll scrubs every node on, outward from Stance,
// and the city's own light blooms under it. The segment tapes count up to 100 % and the page HUD is led to 100 % with
// them (ctx.hud.lead; the claps and one flare of the city's light, once, when the last light comes on). The card is
// gone by then, and the lit city holds still and alone, every tape at 100 %, for close to half a screen of scroll
// (phone: the whole city as wide as the screen, centred in the room; desktop: the whole city in the middle). Then the
// end slams in: the camera makes room for the words (phone: the city rises; desktop: it steps aside to the right), the
// scrim comes up under them (and the tapes step back wherever one would show between the words), with LIGHT UP /
// YOUR MAP. and the red dot, the Coming soon sticker, "Send it to the crew" (the one thing to do here: navigator.share,
// or copy the link) and the hand note. While the end holds, paper heads run the lit lines.
// Reduced motion: still frames — camera and lights cut between key frames, no slams, no shake, no heads.

import { createMap } from '../map/index.js';

const KF = 'kickflip';
// Scroll timeline (finale progress p). The last light comes on at light[0] + (light[1] − light[0]) · map.lightAll.full
// ≈ 0.50, with the camera at rest and the card gone: from there to endOn (0.30 of the range: ~380 px on a phone,
// ~400 on a desktop) the whole city is still, fully lit and alone.
const TL = {
  cam: [0.02, 0.5], // the camera pulls out from Kickflip to the whole city across this range (eased in and out)
  light: [0.03, 0.58], // lightAll t 0 → 1 across this range (the last node is lit at t = map.lightAll.full)
  glow: [0.3, 0.5], // the city's light blooms
  cardOut: [0.42, 0.5], // the title card peels away
  endOn: 0.8, // the end slams in at or past this…
  endOff: 0.76, // …and is cut away again below this (hysteresis)
};
const HEAD_MS = 2600; // a paper head runs a lit line this often while the end holds
const COPIED_MS = 2600; // "Link copied" stays on the button this long
const END_MS = 560; // the camera makes room for the words, the tapes step back, the scrim comes up: this long
// Desktop: the whole city, as large as the room under the chrome allows, up to this zoom — the closest that is still
// the overview tier (js/map: the mid tier fades in from 0.47 with labels on every node and the pools at 55 %; the
// lit city must read as a city at night, pools at full strength). Seen whole, its light gathers like the phone's.
const DESK_ZOOM_MAX = 0.46;
// Desktop, the end: the city steps aside into the room right of the words, pulled back at most to this share of its
// held size; where that room is too narrow it stands against the right edge at its held size and the words cover
// its left side.
const DESK_END_MIN = 0.55;
// Phone, the end: the city rises under the chrome and pulls back this much more, so the words cover less of it.
const PHONE_END_ZOOM = 0.9;
// The city's light: one still picture painted once per layout at 1/GLOW_RES of key B, moved and scaled with the
// camera. Every node's light with a near falloff and a far one (radii in world units), summed, and eased through a
// soft knee toward a peak alpha of --pool over grip: bright where the city is dense, falling to grip at its edges.
// The peak is lower on a phone, where the map's own pools already pile up on a hand's width of city; on a desktop
// it puts the middle of the held city at L ≈ 110–130 against grip's 19.
const GLOW_RES = 4;
const GLOW = { near: 120, far: 430, farMix: 0.42, knee: 2.2, peak: { phone: 0.36, desk: 0.55 } };
const GLOW_REST = 0.8; // its opacity at rest: the flare when the last light comes on takes it to 1
const POOL_RGB = [255, 201, 138]; // --pool
// Reduced motion: key frames by p — [camera u, lightAll t].
const still = (p) => (p < 0.16 ? [0, 0] : p < 0.32 ? [0.55, 0.42] : p < TL.cardOut[1] ? [1, 0.7] : [1, 1]);

/** Six box passes along x, then six along y (≈ a Gaussian of `sigma` cells), zeros outside. In place, via tmp. */
function blur(a, tmp, w, h, sigma) {
  const r = Math.round(sigma / Math.SQRT2);
  if (r < 1) return;
  const inv = 1 / (2 * r + 1);
  const pass = (src, dst, n, len, stride, step) => {
    for (let k = 0; k < n; k++) {
      const o = k * stride;
      let acc = 0;
      for (let x = 0; x < r && x < len; x++) acc += src[o + x * step];
      for (let x = 0; x < len; x++) {
        if (x + r < len) acc += src[o + (x + r) * step];
        if (x - r - 1 >= 0) acc -= src[o + (x - r - 1) * step];
        dst[o + x * step] = acc * inv;
      }
    }
  };
  for (let i = 0; i < 3; i++) {
    pass(a, tmp, h, w, w, 1);
    pass(tmp, a, h, w, w, 1);
  }
  for (let i = 0; i < 3; i++) {
    pass(a, tmp, w, h, 1, w);
    pass(tmp, a, w, h, 1, w);
  }
}

export default async function init(root, ctx) {
  const { dom, motion, sound } = ctx;
  const { clamp, lerp } = dom;
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => [...root.querySelectorAll(sel)];

  const stage = $('.finale');
  const shaker = $('.finale__stage');
  const glow = $('.finale__glow');
  const footScrim = $('.finale__scrim--foot');
  const card = $('.finale__card');
  const cardParts = $$('.finale__strip');
  const end = $('.finale__end');
  const poster = $('.finale__poster');
  const lines = $$('.finale__ln');
  const dot = $('.finale__dot');
  const soon = $('.finale__soon');
  const shareBtn = $('[data-fin-share]');
  const shareLabel = $('[data-fin-share-label]');
  const linkLine = $('[data-fin-link]');
  const live = $('[data-fin-live]');
  const hand = $('.finale__hand');
  const note = $('.finale__note');

  let reduced = ctx.reduced;
  const desktopQuery = matchMedia('(min-width: 900px), (orientation: landscape) and (min-width: 600px)');

  // ---------------------------------------------------------------- the map

  const data = await ctx.data('map');
  let ready = false;
  const map = createMap($('.finale__map'), {
    data,
    preset: 'intermediate',
    reduced,
    lang: ctx.lang,
    onResize: () => {
      if (ready) relayout();
    },
  });
  // The thread of the page: Kickflip was learning in the hero, landed in the climax and made to stick in the session.
  // Here it is landed (trick no. 69, its 14 tricks open), and the lights make it on lock with every other landed trick.
  map.setState(KF, 'landed', { stances: ['normal'] });
  const world = map.model.world;
  const kf = map.trick(KF);
  const FULL = map.lightAll.full; // lightAll t at which the last node is lit: the 100 % moment

  // ---------------------------------------------------------------- geometry

  let W = 1;
  let H = 1;
  let desk = false;
  let camA = null; // tight on Kickflip, where the hero left it
  let camB = null; // the hold: the whole city, centred in the room under the chrome
  let camC = null; // the end: the city makes room for the words (phone: risen; desktop: aside, right of them)
  let fly = null; // camA → camB, on the scroll
  let endFly = null; // camB → camC, on endK
  let span = 1; // scroll length of the pin (section height − stage height)
  let absTop = 0; // the section's top in the document (refreshed whenever the pin is under way)
  let footHandAt = Infinity; // the footer's hand note, px under the footer's top edge

  const px = (v) => `${v.toFixed(1)}px`;
  function relayout() {
    W = stage.clientWidth || innerWidth;
    H = stage.clientHeight || innerHeight;
    desk = desktopQuery.matches;
    span = Math.max(1, root.offsetHeight - H);
    absTop = root.getBoundingClientRect().top + scrollY;
    // Where the footer's own hand note sits under its top edge (read-only: the footer is chrome).
    const foot = document.querySelector('.foot');
    const footHand = foot?.querySelector('.foot__hand');
    footHandAt = foot && footHand ? footHand.getBoundingClientRect().top - foot.getBoundingClientRect().top : Infinity;
    fitPoster();
    const top = parseFloat(getComputedStyle(root).getPropertyValue('--fin-top')) || 98;
    // The scrim under the words. Phone: from a little above the end block down. Desktop: across the words' column and
    // no further (the city that steps aside into the room right of them keeps its full light).
    const endH = end.offsetHeight;
    footScrim.style.height = desk ? '' : px(Math.min(H, endH + parseFloat(getComputedStyle(end).bottom) + 120));
    footScrim.style.width = desk ? px(Math.min(W, wordsRight() + 64)) : '';

    // Key A: Kickflip at the full tier, at the very screen point where the hero's flight put it (hero.js key 3).
    const ax = desk ? W * 0.66 : W * 0.47;
    const ay = desk ? top + (H - top) * 0.3 : top + 92;
    camA = { x: kf.x - (ax - W / 2), y: kf.y - (ay - H / 2), zoom: 1 };
    if (desk) {
      // Desktop. Key B: the whole city in the middle of the room under the chrome. Key C: it steps aside into the
      // room right of the words (pulled back to fit), or, where that is too narrow, against the right edge.
      const padX = Math.max(24, W * 0.03);
      const roomT = top + 4;
      const roomB = H - 28;
      // A phone on its side has a third of the height: the whole city would be a stamp under its own tapes, so it is
      // shown larger, its top and bottom cropped.
      const tall = (roomB - roomT) / world.height;
      const zoom = Math.min((W - 2 * padX) / world.width, H < 520 ? tall * 1.8 : tall, DESK_ZOOM_MAX);
      // Centred in the room when it fits; taller than the room, it hangs from the top (Stance's trunk and the top row
      // of tapes in view, the dark tails cropped).
      const yAt = (z) => (world.height * z <= roomB - roomT + 1 ? world.height / 2 - ((roomT + roomB) / 2 - H / 2) / z : (H / 2 - roomT - 6) / z);
      camB = { x: world.width / 2, y: yAt(zoom), zoom };
      const left = wordsRight() + Math.max(24, W * 0.02);
      const zc = Math.min(zoom, (W - left - padX) / world.width);
      if (zc >= zoom * DESK_END_MIN) {
        const cx = left + (world.width * zc) / 2;
        camC = { x: world.width / 2 - (cx - W / 2) / zc, y: yAt(zc), zoom: zc };
      } else {
        camC = { x: world.width / 2 - (W - padX - (world.width * zoom) / 2 - W / 2) / zoom, y: camB.y, zoom };
      }
    } else {
      // Phone. Key B: the whole city as wide as the screen, centred in the room under the chrome. Key C: pulled back
      // a touch and risen to hang under the chrome; the words cover its lowest lines.
      const pad = 9;
      const wide = (W - 2 * pad) / world.width;
      const roomT = top - 10;
      const roomB = H - 10;
      const zoom = Math.min(wide, (roomB - roomT - 2 * pad) / world.height);
      camB = { x: world.width / 2, y: world.height / 2 - ((roomT + roomB) / 2 - H / 2) / zoom, zoom };
      const zc = zoom * PHONE_END_ZOOM;
      camC = { x: world.width / 2, y: (H / 2 - Math.min(top - 4, 70) - pad) / zc, zoom: zc };
    }
    // rho 0: the app's homing flight — zoom geometric, one point of the city standing still on screen.
    fly = map.flight(camA, camB, { rho: 0 });
    endFly = map.flight(camB, camC, { rho: 0, ease: (t) => t });
    tapesStay = !tapesUnderWords(camC);
    paintGlow();
    camKey = '';
    place(lastP, true);
  }

  /** The end's words, cut-outs and button as boxes in stage px (laid out even while they wait, transparent). */
  function wordBoxes() {
    const s = stage.getBoundingClientRect();
    const els = [...root.querySelectorAll('.finale__w, .finale__soon, .finale__share, .finale__hand-in, .finale__note')];
    return els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map((r) => ({ x: r.left - s.left - 6, y: r.top - s.top - 6, r: r.right - s.left + 6, b: r.bottom - s.top + 6 }));
  }
  function wordsRight() {
    return wordBoxes().reduce((m, b) => Math.max(m, b.r), 0);
  }
  /** Would a segment tape show between or behind the words at camera `c`? (The tapes are measured there, then put back.) */
  function tapesUnderWords(c) {
    const boxes = wordBoxes();
    const keepCam = map.getCamera();
    const keepTapes = map.tapes;
    map.setTapes(1);
    map.setCamera(c);
    const hit = map.tapeRects().some((t) => boxes.some((b) => t.x < b.r && t.x + t.w > b.x && t.y < b.b && t.y + t.h > b.y));
    map.setCamera(keepCam);
    map.setTapes(keepTapes);
    return hit;
  }

  // The city's light (GLOW): every node's pool, near and far falloffs summed and eased toward the peak, as --pool with
  // that alpha on a canvas 1/GLOW_RES of key B's size, its origin at world (−margin, −margin). Painted once per key B.
  let glowKey = '';
  let glowM = 0;
  function paintGlow() {
    const G = GLOW;
    const peak = desk ? G.peak.desk : G.peak.phone;
    const key = `${camB.zoom.toFixed(5)}|${peak}`;
    if (key === glowKey) return;
    glowKey = key;
    const z = camB.zoom / GLOW_RES; // cells per world unit
    glowM = G.far * 2.6;
    const w = Math.max(8, Math.ceil((world.width + 2 * glowM) * z));
    const h = Math.max(8, Math.ceil((world.height + 2 * glowM) * z));
    const near = new Float32Array(w * h);
    const tmp = new Float32Array(w * h);
    for (const node of map.model.nodes) {
      const x = Math.round((node.x + glowM) * z);
      const y = Math.round((node.y + glowM) * z);
      if (x >= 0 && x < w && y >= 0 && y < h) near[y * w + x] += 1;
    }
    const far = near.slice();
    blur(near, tmp, w, h, G.near * z);
    blur(far, tmp, w, h, G.far * z);
    let mn = 1e-6;
    let mf = 1e-6;
    for (let i = 0; i < near.length; i++) {
      if (near[i] > mn) mn = near[i];
      if (far[i] > mf) mf = far[i];
    }
    let md = 1e-6;
    for (let i = 0; i < near.length; i++) {
      const d = ((1 - G.farMix) * near[i]) / mn + (G.farMix * far[i]) / mf;
      tmp[i] = d;
      if (d > md) md = d;
    }
    const K = G.knee;
    const norm = peak / (1 - Math.exp(-K));
    glow.width = w;
    glow.height = h;
    const g = glow.getContext('2d');
    const img = g.createImageData(w, h);
    const px4 = img.data;
    for (let i = 0; i < tmp.length; i++) {
      const o = i * 4;
      px4[o] = POOL_RGB[0];
      px4[o + 1] = POOL_RGB[1];
      px4[o + 2] = POOL_RGB[2];
      px4[o + 3] = Math.round(255 * norm * (1 - Math.exp((-K * tmp[i]) / md)));
    }
    g.putImageData(img, 0, 0);
    glow.style.width = `${w}px`;
    glow.style.height = `${h}px`;
  }

  /**
   * Fits the poster's type (--P). A row is a line, or (desktop, EN) a pair of lines set side by side. The widest row
   * fills the end block's width (a phone may crop it a hair at the edge, like the hero's words), within a height
   * budget and under the page's title scale: about 28vw on a phone, 15vw on a desktop. Two passes: the indents are
   * partly em.
   */
  function fitPoster() {
    poster.style.removeProperty('--P');
    const rows = desk ? [...poster.children] : lines;
    const n = rows.length;
    const room = end.clientWidth + (desk ? -8 : 6);
    // A phone on its side has the desktop's layout in a third of its height: the words get less of it.
    const short = desk && H < 520;
    const maxH = short ? H * (n > 2 ? 0.42 : 0.4) : desk ? H * (n > 2 ? 0.56 : 0.46) : H * 0.36;
    const byH = maxH / (n * 0.8 - 0.035 * (n - 1));
    const cap = desk ? Math.max(96, W * 0.15) : W * 0.28;
    let size = parseFloat(getComputedStyle(poster).fontSize) || 100;
    const widthOf = (row) => {
      const parts = row.classList.contains('finale__ln') ? [row] : [...row.querySelectorAll('.finale__ln')];
      let w = 0;
      for (const ln of parts) {
        const cs = getComputedStyle(ln);
        w += ln.querySelector('.finale__w').offsetWidth + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.marginLeft || '0');
      }
      if (parts.length > 1) {
        const cs = getComputedStyle(row);
        w += (parseFloat(cs.columnGap) || 0) * (parts.length - 1) + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      }
      return w;
    };
    for (let pass = 0; pass < 2; pass++) {
      let widest = 1;
      for (const row of rows) widest = Math.max(widest, widthOf(row));
      size = Math.max(44, Math.min((size * room) / widest, byH, cap));
      poster.style.setProperty('--P', `${size.toFixed(1)}px`);
    }
  }

  // ---------------------------------------------------------------- camera, lights, the pool

  const camOf = (p) => (reduced ? still(p)[0] : clamp((p - TL.cam[0]) / (TL.cam[1] - TL.cam[0])));
  const lightOf = (p) => (reduced ? still(p)[1] : clamp((p - TL.light[0]) / (TL.light[1] - TL.light[0])));

  let camKey = '';
  let cam = null;
  let tapesA = -1;
  let tapesStay = false; // the tapes keep their place at the end (none of them would show between the words)
  let endK = 0; // 0 → 1 as the end comes in (time, not scroll): camera B → C, the tapes step back, the scrim rises
  function cameraAt(u) {
    const key = `${u.toFixed(5)}|${endK.toFixed(4)}`;
    if (key === camKey) return;
    camKey = key;
    cam = u >= 1 && endK > 0 ? endFly(endK) : fly(u);
    map.setCamera(cam);
    // The segment tapes come on as the city comes into view (none at the full tier; in between they would be cut
    // by the screen's edges as the camera passes), still counting up with the lights. When the words come in over the
    // city they step back (they would peek out between the poster's words): their count is done, the HUD reads 100 %.
    const a = Math.round(dom.smoothstep(0.6, 0.9, u) * (tapesStay ? 1 : 1 - endK) * 100) / 100;
    if (a !== tapesA) {
      tapesA = a;
      map.setTapes(a);
    }
    // The city's light follows the city: scaled with the zoom from its origin (transform only).
    const o = map.toScreen(-glowM, -glowM);
    glow.style.transform = `translate3d(${px(o.x)}, ${px(o.y)}, 0) scale(${((GLOW_RES * cam.zoom) / camB.zoom).toFixed(4)})`;
  }

  let glowA = -1;
  function poolAt(p) {
    const a = (reduced ? (lightT >= 1 ? 1 : 0) : motion.ease.out(clamp((p - TL.glow[0]) / (TL.glow[1] - TL.glow[0])))) * GLOW_REST;
    if (a !== glowA) {
      glowA = a;
      glow.style.opacity = a.toFixed(3);
    }
  }

  // The end's own clock: endK runs to 0 or 1 over END_MS (eased out: the city moves off as the first word lands).
  let endRaf = 0;
  function endTo(to, { now = false } = {}) {
    cancelAnimationFrame(endRaf);
    endRaf = 0;
    const from = endK;
    if (from === to) return;
    const apply = () => {
      if (fly) cameraAt(camOf(lastP));
      footScrim.style.opacity = endK.toFixed(3);
    };
    if (now || reduced || !entered) {
      endK = to;
      apply();
      return;
    }
    const t0 = performance.now();
    const dur = END_MS * Math.abs(to - from);
    const step = (t) => {
      const k = clamp((t - t0) / dur);
      endK = from + (to - from) * motion.ease.out(k);
      apply();
      endRaf = k < 1 ? requestAnimationFrame(step) : 0;
    };
    endRaf = requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- the title card

  const FLING = [
    // [x (W), y (H), rotate°] per strip
    [0.12, 0.7, 7],
    [-0.08, 0.8, -11],
  ];
  let cardShown = true;
  function cardAt(p) {
    const gone = p >= TL.cardOut[1];
    if (gone === cardShown) {
      cardShown = !gone;
      card.style.visibility = gone ? 'hidden' : '';
    }
    if (gone) return;
    cardParts.forEach((el, i) => {
      if (reduced) {
        el.style.transform = '';
        return;
      }
      const k = clamp((p - TL.cardOut[0] - i * 0.012) / (TL.cardOut[1] - TL.cardOut[0] - 0.024));
      const e = k * k * k;
      const [fx, fy, fr] = FLING[i] ?? FLING[FLING.length - 1];
      const t = e ? `translate3d(${px(fx * W * e)}, ${px(fy * H * e)}, 0) rotate(${(fr * e).toFixed(2)}deg)` : '';
      if (el.style.transform !== t) el.style.transform = t;
    });
  }

  // ---------------------------------------------------------------- the end

  let endOn = false;
  let endTimers = [];
  const later = (ms, fn) => endTimers.push(setTimeout(fn, ms));
  const endParts = [...lines, dot, soon, shareBtn, hand, note].filter(Boolean);
  function showEnd(on) {
    if (on === endOn) return;
    endOn = on;
    endTimers.forEach(clearTimeout);
    endTimers = [];
    for (const el of endParts) {
      el.getAnimations?.().forEach((a) => a.cancel());
      el.classList.remove('is-on');
    }
    shaker.getAnimations?.().forEach((a) => a.cancel());
    root.classList.toggle('is-end', on);
    syncHeads();
    // The camera makes room for the words and the scrim comes up under them, with the slam (not before it: while the
    // city is held, nothing darkens it). Cut back at once when the scroll has gone back into the flight.
    endTo(on ? 1 : 0, { now: !on && lastP < TL.cam[1] });
    if (!on) {
      linkLine.hidden = true;
      return;
    }
    if (reduced) {
      endParts.forEach((el) => el.classList.add('is-on'));
      return;
    }
    // The words slam in one after another (hard start, spring stop), the dot drops in as the full stop and the
    // stage takes the hit, the sticker is slapped on, the button comes up under it, the hand note writes itself.
    const step = lines.length > 2 ? 95 : 120;
    lines.forEach((ln, i) =>
      later(i * step, () => {
        ln.classList.add('is-on');
        motion.animate(ln, (v) => ({ transform: `translate3d(0, ${(-6 * (1 - v)).toFixed(2)}px, 0) scale(${(1.35 - 0.35 * v).toFixed(4)})` }), { spring: 'slam', fill: 'none' });
      }),
    );
    const tDot = (lines.length - 1) * step + 230;
    later(tDot, () => {
      dot.classList.add('is-on');
      motion.animate(dot, (v) => ({ transform: `translate3d(0, ${(-1.25 * (1 - v)).toFixed(3)}em, 0) scale(${(1.6 - 0.6 * v).toFixed(4)})` }), { spring: 'pop', fill: 'none' });
    });
    later(tDot + 120, () => motion.shake(shaker, 3));
    later(tDot + 300, () => {
      soon.classList.add('is-on');
      motion.animate(soon, (v) => ({ transform: `scale(${(1.25 - 0.25 * v).toFixed(4)}) rotate(${(-3 * (1 - v)).toFixed(2)}deg)` }), { spring: 'pop', fill: 'none' });
    });
    later(tDot + 470, () => {
      shareBtn.classList.add('is-on');
      motion.animate(shareBtn, (v) => ({ transform: `translate3d(0, ${(10 * (1 - v)).toFixed(2)}px, 0)` }), { spring: 'settle', fill: 'none' });
    });
    later(tDot + 640, () => hand.classList.add('is-on'));
    later(tDot + 760, () => note.classList.add('is-on'));
  }

  // ---------------------------------------------------------------- send it to the crew

  // The page's link (the canonical one: the language the visitor reads) through the phone's share sheet; where there
  // is none, onto the clipboard, and the button says so. If the clipboard is not ours either, the link is written out
  // under the button to copy by hand.
  const shareText = shareLabel?.textContent ?? '';
  let copiedTimer = 0;
  function say(text) {
    if (!live) return;
    live.textContent = '';
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  }
  function copiedState(on) {
    clearTimeout(copiedTimer);
    shareBtn.classList.toggle('is-copied', on);
    shareLabel.textContent = on ? ctx.t('copied') : shareText;
    if (on) copiedTimer = setTimeout(() => copiedState(false), COPIED_MS);
  }
  function copyFallback(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    Object.assign(area.style, { position: 'fixed', top: '0', left: '0', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    shareBtn.focus({ preventScroll: true });
    return ok;
  }
  async function share() {
    const url = (document.querySelector('link[rel="canonical"]')?.href || location.href).split('#')[0];
    if (navigator.share) {
      try {
        // The page's one share title (site.shareTitle: og:title and the social card say the same).
        const title = ctx.i18n?.has?.('site.shareTitle') ? ctx.i18n.t('site.shareTitle') : ctx.t('shareTitle');
        await navigator.share({ title, url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return; // the visitor closed the sheet
      }
    }
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      ok = copyFallback(url);
    }
    if (ok) {
      linkLine.hidden = true;
      copiedState(true);
      sound.play('tick', { rate: 1.5 });
      say(ctx.t('copiedLive'));
    } else {
      linkLine.textContent = `${ctx.t('copyByHand')} ${url}`;
      linkLine.hidden = false;
      say(linkLine.textContent);
    }
  }
  shareBtn?.addEventListener('click', share);
  // A keyboard visitor can reach the button before the end has come in (it waits, transparent and untouchable, in the
  // pinned stage): Tab to it scrolls the finale to its end, so the focus is never on something unseen. Keyboard focus
  // only: a pointer cannot reach it before the end (pointer-events: none until .is-on), and must never be thrown
  // past the light-up.
  shareBtn?.addEventListener('focus', () => {
    if (endOn || !shareBtn.matches(':focus-visible')) return;
    const r = ctx.scroll.rangeOf('finale');
    if (r) window.scrollTo({ top: Math.round(r.start + (r.end - r.start) * 0.86), behavior: 'instant' });
  });

  // ---------------------------------------------------------------- sound

  // A rising tick for every tenth of the run (the app's unlock wave: each one higher), then the claps when the last
  // light comes on. Forward only, once per pass; nothing at all while sound is off.
  let ticked = 0;
  let clapped = false;
  let lapped = false;
  function soundAt(t, forward) {
    const k = clamp(t / FULL);
    // The last light comes on: the city's light flares once with the claps (its rest is GLOW_REST of the peak) and a
    // lap of paper heads runs it (scrolling forward, once per pass).
    if (k < 0.6) lapped = false;
    else if (k >= 1 && forward && !lapped && !reduced) {
      lapped = true;
      const rest = glow.style.opacity || '0';
      glow.animate?.([{ opacity: rest }, { opacity: 1, offset: 0.14 }, { opacity: rest }], { duration: 900, easing: 'cubic-bezier(.2, 0, .3, 1)' });
      for (let i = 0; i < 3; i++) setTimeout(() => entered && map.idleHead(), i * 140);
    }
    const steps = Math.floor(k * 10 + 1e-6);
    if (!forward || t <= 0) {
      ticked = Math.min(ticked, steps);
      if (k < 0.6) clapped = false;
      return;
    }
    if (!sound.enabled || document.hidden) {
      ticked = steps;
      clapped = clapped || k >= 1;
      return;
    }
    if (k >= 1) {
      ticked = steps;
      if (!clapped) {
        clapped = true;
        sound.play('claps');
      }
    } else if (steps > ticked) {
      ticked = steps;
      sound.play('tick', { rate: 2 ** (steps / 12) });
    }
  }

  // ---------------------------------------------------------------- the page HUD, led to 100 % with the lights

  // main.js owns the HUD; the finale only leads it ahead of the scroll (the HUD shows the higher of the two), from
  // where the HUD stood when the finale began to 100 % at the moment the last light comes on. Handed back at p 0.
  let hudLead = -1;
  function hudAt(p, t) {
    if (p <= 0) {
      if (hudLead !== -1) {
        hudLead = -1;
        ctx.hud.release();
      }
      return;
    }
    const k = clamp(t / FULL);
    let f = 1;
    if (k < 1) {
      const r = ctx.hud.range();
      if (!r) return;
      // …and it reads 100 % only once the last light is on (the HUD rounds: 99.5 % would already say 100).
      f = Math.min(lerp(r.start, r.end, k), 0.994);
    }
    f = Math.round(f * 2000) / 2000;
    if (f === hudLead) return;
    hudLead = f;
    ctx.hud.lead(f);
  }

  // The hand-off: past the end of the pin the stage scrolls away and the footer comes up with its own hand note
  // ("never been done"); ours bows out just before that one shows, so a screen never carries two.
  let handA = 1;
  function handOff(y) {
    const over = y - (absTop + span);
    const from = Math.max(0, footHandAt - 140);
    const to = Math.max(from + 40, footHandAt - 10); // gone before the footer's note comes into view
    const a = over <= from ? 1 : 1 - clamp((over - from) / (to - from));
    if (a === handA) return;
    handA = a;
    hand.style.opacity = a >= 1 ? '' : a.toFixed(3);
  }
  ctx.scroll.onFrame(({ y }) => handOff(y));

  // ---------------------------------------------------------------- idle life at the end

  let headTimer = 0;
  let entered = false;
  function syncHeads() {
    const want = entered && endOn && !reduced;
    if (want && !headTimer) {
      const run = () => {
        headTimer = setTimeout(run, HEAD_MS);
        if (!document.hidden) map.idleHead();
      };
      headTimer = setTimeout(run, 900);
    } else if (!want && headTimer) {
      clearTimeout(headTimer);
      headTimer = 0;
    }
  }

  // ---------------------------------------------------------------- per frame

  let lastP = ctx.scroll.progressOf('finale');
  let lightT = -1;
  function place(p, force = false) {
    const forward = p >= lastP;
    lastP = p;
    if (p > 0 && p < 1) absTop = ctx.scroll.y - p * span;
    if (!fly) return;
    if (force) camKey = '';
    cameraAt(camOf(p));
    const t = lightOf(p);
    if (t !== lightT || force) {
      lightT = t;
      map.lightAll(t <= 0 ? null : t);
    }
    hudAt(p, t);
    poolAt(p);
    cardAt(p);
    if (p >= TL.endOn) showEnd(true);
    else if (p < TL.endOff) showEnd(false);
    soundAt(t, forward && !force);
  }

  ready = true;
  relayout();
  document.fonts?.ready?.then(() => ready && relayout());
  // …and once the map can measure its tapes (whether one would show between the words at the end).
  map.ready?.then?.(() => ready && relayout());
  desktopQuery.addEventListener?.('change', relayout);
  ctx.onReducedChange((value) => {
    reduced = value;
    map.setReduced(value);
    if (endOn) {
      showEnd(false);
      showEnd(lastP >= TL.endOn);
    }
    syncHeads();
    place(lastP, true);
  });

  // Drawn once; it only runs while the section is on screen (enter() follows at once when it already is).
  map.render();
  map.setActive(false);

  return {
    progress(p) {
      place(p);
    },
    enter() {
      entered = true;
      root.classList.add('is-in');
      map.setActive(true);
      syncHeads();
    },
    leave() {
      entered = false;
      root.classList.remove('is-in');
      map.setActive(false);
      syncHeads();
    },
    /** QA: the map, its cameras and the share action. */
    map,
    get camera() {
      return map.getCamera();
    },
    get cameras() {
      return { a: camA, b: camB, c: camC };
    },
    get endK() {
      return endK;
    },
    share,
  };
}
