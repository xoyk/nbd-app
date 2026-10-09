// library · the invented library and its drawn footage (docs/site/library-facts.md §2). No rider, ever: every frame
// is js/lib/board.js. This module knows the ten clips and the engine motion each one is (BS 50-50 on its own ledge,
// the Fakie attempt rolling tail first), the three the player scrubs and the moment each one is told by, and how a
// tile is framed: the board over the play badge, clear of it and of the corner chips (the engine's badgeSafe 'above'),
// and, while a tile replays, never out of the top of the tile or under its duration chip.

import { drawBoardFrame, filmerBack, getMotion, measureBoardFrame } from '../lib/board.js';
import { ROLL } from '../lib/board-tricks.js';

export const FPS = 30; // the app's DEFAULT_FPS (src/features/clips/logic.ts)
const DEG = Math.PI / 180;
const F_PERSP = 360; // board.js: the focal distance, the view height the perspective is centred on, the wall
const YC = 10;
const WALL_Z = 34;

// ---------------------------------------------------------------- today (the landed stamp's rule, facts §2.6)

/** The visitor's local date, never before 02.10.2026 (the stamp's markup and the real screenshot). */
export function todayStrings(now = new Date()) {
  const floor = new Date(2026, 9, 2);
  const d = now < floor ? floor : now;
  const p2 = (n) => String(n).padStart(2, '0');
  const dm = `${p2(d.getDate())}.${p2(d.getMonth() + 1)}`;
  return { dm, dmy: `${dm}.${p2(d.getFullYear() % 100)}` };
}

// ---------------------------------------------------------------- the clips (facts §2.2)
//
// motion: the engine's take of that clip. sec: the tile's still (seconds of the motion; default the motion's telling
// `best`), elev the camera's elevation, zoom its distance (default 1.1). A newly filed tile replays its clip once, from
// just before the pop up to its
// still, and stops there. Kickflip's five tiles are five different moments of the battle, so the strip reads as one.

export const CLIPS = {
  // the make: the catch at the top, level and grip up, high over its shadow
  'k-today': { tag: 'landed', len: 4, motion: 'kickflip', sec: 0.98, elev: 15 },
  // so close: on its edge, just after the clack, leaning over (the motion's best)
  'k-2709': { tag: 'almost', len: 3, motion: 'kickflip-primo', elev: 19 },
  // so close: going over, back onto its wheels
  'k-2409': { tag: 'almost', len: 5, motion: 'kickflip-primo', sec: 1.5, elev: 14 },
  // under-flipped: upside down in the air, wheels up, about to come down on its grip
  'k-2109': { tag: 'attempt', len: 6, motion: 'kickflip-bail', sec: 1.12, elev: 20 },
  // on its grip, sliding away wheels up (the motion's best)
  'k-1409': { tag: 'attempt', len: 4, motion: 'kickflip-bail', elev: 16 },
  // the Fakie attempt: rolling tail first, the board tips out and lands on its side (facts §2.7: never a clean landing)
  'o-2709': { tag: 'attempt', len: 5, motion: 'fakie-ollie-bail', elev: 18 },
  'o-0206': { tag: 'landed', len: 3, motion: 'ollie', elev: 16 },
  // locked on the angle iron, sparks at the trucks
  'g-1409': { tag: 'landed', len: 8, motion: 'bs-50-50', elev: 21 },
  // the back truck slipping off the edge: caught as it starts to go (the motion's best is later, the board rolled up on
  // its side, too tall for the room between the duration chip and the badge: its nose ran under the chip and out of
  // the tile's top), a touch wider and a touch lower (its wheels straddle the badge), clear of the chip and the top
  'g-1109': { tag: 'almost', len: 11, motion: 'bs-50-50-almost', sec: 1.55, zoom: 0.95, dy: 3, elev: 21 },
  's-2308': { tag: 'landed', len: 5, motion: 'pop-shuvit', elev: 26 },
};
for (const [id, clip] of Object.entries(CLIPS)) clip.id = id;

/** Kickflip's battle in the order it was filmed: the tiles replay it once when the tab is filed. */
export const BATTLE_ORDER = ['k-1409', 'k-2109', 'k-2409', 'k-2709', 'k-today'];

// The player's three cuts (facts §2.4: the three-clip arc), each told by one moment at frame 52 (0:01.70, §2.5):
//   a  the bail on the ground — upside down, sliding wheels up (the motion's best)
//   b  so close — on its edge and going over, back onto its wheels (1.47 s: not the face-on graphic of the make)
//   c  the flick in the air — the NBD. graphic to the camera (best), then the touchdown, all four wheels down: the
//      frame the proof is filed on (landFrame)
// f0 is four frames before the pop (the scroll spends the approach on the trick, not on a rolling board), f1 where
// the cut ends. A miss has the filmer stop following 0.3 s after it hits the ground and turn back toward the rider:
// the board goes on alone and leaves the shot. `of` is "clip 1 of n" that day (1 = left out).
export const CUTS = [
  { id: 'k-1409', key: 'a', motion: 'kickflip-bail', tag: 'attempt', date: '14.09', len: 4, of: 1, keyFrame: 52 },
  { id: 'k-2709', key: 'b', motion: 'kickflip-primo', tag: 'almost', date: '27.09', len: 3, of: 4, keyFrame: 52, sec: 1.47 },
  { id: 'k-today', key: 'c', motion: 'kickflip', tag: 'landed', date: null, len: 4, of: 5, keyFrame: 52 },
];
for (const c of CUTS) {
  const m = getMotion(c.motion);
  c.m = m;
  c.frames = c.len * FPS;
  c.sec ??= m.best * m.duration; // the telling moment, seconds of the motion
  c.off = (c.keyFrame - 1) / FPS - c.sec; // clip time of the motion's t = 0
  const frameAt = (s) => Math.floor((c.off + s) * FPS + 1e-6) + 1;
  c.popFrame = frameAt(m.tPop);
  c.f0 = Math.max(1, c.popFrame - 4);
  c.miss = m.outcome !== 'landed';
  c.landFrame = c.miss ? null : frameAt(m.tLand) + 2; // all four wheels down
  c.f1 = Math.min(c.frames, c.miss ? c.keyFrame + 12 : c.landFrame + 14);
  c.follow = c.miss ? { followUntil: m.tLand + 0.3, panBack: 36 } : null;
}

/** Clip time (s) of frame a (1-based): the app's timecode rule (facts §2.5). */
export const timeOf = (a) => (a - 1) / FPS;
/** 0:01.70 */
export const fmtTime = (s) => `0:${String(Math.floor(s + 1e-6)).padStart(2, '0')}.${String(Math.floor(s * 100 + 1e-6) % 100).padStart(2, '0')}`;

// ---------------------------------------------------------------- board.js's camera, for framing around it

const sinE = (e) => Math.sin(e * DEG);
const cosE = (e) => Math.cos(e * DEG);

/** The follow camera's scale (px per inch) for a w × h frame at `zoom` (board.js frameScene). */
export function followScale(w, h, zoom) {
  return zoom * Math.min(w / (w < h ? 40 : 48), h / 36);
}
/** Screen y of a world point (height y, depth z) under the camera, in a frame whose view centre is at oy. */
function screenY(oy, S, elev, y, z = 0) {
  const vy = cosE(elev) * y - sinE(elev) * z;
  const vz = sinE(elev) * y + cosE(elev) * z;
  return oy - S * (F_PERSP / (F_PERSP - vz)) * (vy - YC);
}
/** Where the wall meets the floor (board.js drawBackground) for a view centred at oy (default: board.js's own, 0.52 h). */
export function wallY(h, S, elev = 17, oy = h * 0.52) {
  return screenY(oy, S, elev, 0, -WALL_Z);
}
const POSE = { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, air: 0 };
/** Board x (inches) at motion time, extrapolated beyond the motion at its end speeds (the board rolls on). */
export function boardX(m, sec) {
  if (sec <= 0) {
    m.pose(0, POSE);
    return POSE.x + ROLL * sec;
  }
  if (sec >= m.duration) {
    m.pose(m.duration, POSE);
    const x1 = POSE.x;
    m.pose(m.duration - 0.05, POSE);
    const v = (x1 - POSE.x) / 0.05;
    return x1 + v * (sec - m.duration);
  }
  m.pose(sec, POSE);
  return POSE.x;
}
/**
 * The clip's head and tail, outside the motion: the filmer has not started following yet (the board rolls into the
 * shot) / has stopped (it rolls out; a filmer who let a missed board go keeps turning back, `follow`). The board's
 * horizontal offset in inches from the frame the engine draws there (the motion's first or last).
 */
export function outsideShift(m, sec, follow = null) {
  if (sec < 0) return boardX(m, sec) - boardX(m, 0);
  if (sec > m.duration) {
    const back = follow ? filmerBack(sec - follow.followUntil, follow.panBack) - filmerBack(m.duration - follow.followUntil, follow.panBack) : 0;
    return boardX(m, sec) - boardX(m, m.duration) + back;
  }
  return 0;
}

// ---------------------------------------------------------------- tiles

/** The chips of the app's tile at this width (badgeSafe's own numbers): the duration chip's box. */
const durationChip = (w) => ({ x0: w - 38 * (w / 83), y1: 22 * (w / 83) + 2 });

const FRAMES = new Map();
/**
 * How a tile of w × h frames its clip: the still's moment and the scene's vertical move that keeps the board clear
 * of the badge and the chips (badgeSafe, measured once). With `replay`, also the stretch the tile replays and the
 * filmer's tilt along it (lift, px down) wherever the board in the air would leave the tile's top or sit under the
 * duration chip — eased in and out, nothing at the still, so the replay settles on the still without a jump.
 */
export function tileFrame(clip, w, h, replay = false) {
  const key = `${clip.id}:${w}x${h}`;
  let f = FRAMES.get(key);
  if (!f) {
    const m = getMotion(clip.motion);
    const sec = clip.sec ?? m.best * m.duration;
    const base = { trick: clip.motion, zoom: clip.zoom ?? 1.1, elev: clip.elev ?? 17 };
    // the board over the badge; dy (px of an 83-wide tile) lets a still sit a touch lower in the room it leaves
    const shift = measureBoardFrame(w, h, { ...base, sec, badgeSafe: 'above' }).shift + ((clip.dy ?? 0) * w) / 83;
    f = { m, sec, base, shift, a: Math.max(0, Math.min(sec, m.tPop - 0.3)), b: sec, lift: null };
    FRAMES.set(key, f);
  }
  if (replay && !f.lift) {
    const n = 40;
    const chip = durationChip(w);
    const need = new Float64Array(n + 1);
    const o = { ...f.base, sec: 0, frameOffset: [0, f.shift] };
    const at = (s) => {
      o.sec = s;
      const r = measureBoardFrame(w, h, o);
      return Math.max(0, 3 - r.y0, r.x1 > chip.x0 ? chip.y1 - r.y0 : 0);
    };
    const still = at(f.b); // what the still itself accepted (badgeSafe keeps clear of the chips where it fits)
    for (let i = 0; i <= n; i++) need[i] = Math.max(0, at(f.a + ((f.b - f.a) * i) / n) - still);
    // the filmer sees it coming: spread each need over its neighbours, then smooth, then nothing at the still
    const spread = need.map((_, i) => Math.max(...need.slice(Math.max(0, i - 3), i + 4)));
    const blur = (arr) => arr.map((_, i) => (arr[Math.max(0, i - 1)] + 2 * arr[i] + arr[Math.min(n, i + 1)]) / 4);
    const lift = blur(blur(spread)).map((v, i) => {
      const u = Math.min(1, (n - i) / 4);
      return Math.max(v, need[i]) * u * u * (3 - 2 * u);
    });
    f.lift = { n, values: lift };
  }
  return f;
}
const liftAt = (f, s) => {
  if (!f.lift || f.b <= f.a) return 0;
  const { n, values } = f.lift;
  const x = Math.max(0, Math.min(1, (s - f.a) / (f.b - f.a))) * n;
  const i = Math.min(n - 1, Math.floor(x));
  return values[i] + (values[i + 1] - values[i]) * (x - i);
};

/** A tile's still at w × h (CSS px; the caller owns the dpr transform). */
export function drawStill(ctx, w, h, clip, dpr) {
  const f = tileFrame(clip, w, h);
  drawBoardFrame(ctx, w, h, { ...f.base, sec: f.sec, look: 'night', frameOffset: [0, f.shift], dpr });
}

/** One frame of a tile replaying its clip (seconds of the motion; the play badge is off while it plays). */
export function drawTileFrame(ctx, w, h, clip, sec, dpr) {
  const f = tileFrame(clip, w, h, true);
  drawBoardFrame(ctx, w, h, { ...f.base, sec, look: 'night', frameOffset: [0, f.shift + liftAt(f, sec)], dpr });
}
/** The stretch of motion a tile replays once: from just before the pop up to its still, where it stops. */
export function playRange(clip) {
  const f = tileFrame(clip, 83, 110);
  return [f.a, f.b];
}

// ---------------------------------------------------------------- the scrubber's strip

/** The scrubber's 12 frames over the WHOLE clip (cell i shows the moment in the middle of its twelfth). */
export function drawStrip(ctx, w, h, cut, opts) {
  const n = 12;
  const gap = opts.gap ?? 2;
  const cw = (w - gap * (n - 1)) / n;
  const elev = opts.elev ?? 17;
  const S = followScale(cw, h, opts.zoom);
  const wy = wallY(h, S, elev);
  for (let i = 0; i < n; i++) {
    const x = i * (cw + gap);
    const ct = ((i + 0.5) / n) * cut.len;
    const sec = ct - cut.off;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, cw, h);
    ctx.clip();
    ctx.translate(x, 0);
    ctx.fillStyle = '#0F0F0E';
    ctx.fillRect(0, 0, cw, h);
    ctx.fillStyle = '#171715';
    ctx.fillRect(0, wy, cw, h - wy);
    ctx.translate(outsideShift(cut.m, sec, cut.follow) * S, 0);
    drawBoardFrame(ctx, cw, h, {
      trick: cut.motion,
      sec: Math.max(0, Math.min(cut.m.duration, sec)),
      look: 'night',
      bg: false,
      zoom: opts.zoom,
      elev,
      dpr: opts.dpr,
      ...cut.follow,
    });
    ctx.restore();
  }
  return cw;
}
