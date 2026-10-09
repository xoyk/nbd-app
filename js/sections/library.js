// library — "Every try on tape." The app's clips as a library of your own tricks (docs/site/library-facts.md).
//
// One pinned stage (data-pin 2.8). The scroll is the thumb on the clip player's scrubber:
//   battle   the player at poster scale, three cuts of one Kickflip battle, a story in three stills — 14.09 attempt
//            (it under-flips: the bail on the ground, wheels up), 27.09 almost (all the way round, onto its edge and
//            going over), today, the make (the flick in the air, the NBD. graphic to the camera and the only ghosts:
//            "there's the flick"), then its touchdown. The scroll drives the board continuously — drawn at the exact
//            clip time every frame, between the clip's frames too, a short critically damped follow behind the thumb —
//            and is spent on what the board does: the clip time eases down into each telling frame and through it (a
//            slow zone, never a freeze), and a thumb that rests near one brings the footage onto it exactly. A fast
//            thumb plays the battle as a quick run of poses; the hand-off waits for the touchdown and its proof (a
//            jump, reduced motion and leaving the section do not wait). The battle's clock — the day, outlined, in the
//            empty top of the footage — ticks at every cut, and Kickflip's group under the player files the clips of
//            the days between (21.09, 24.09) as it does. At the make's touchdown, not before, the clip is the proof:
//            today's tile pops in, the chip says landed, "Clip's in · +30 XP" (the landed section had the landing
//            itself; nothing here lands it again). A missed board is let go by the filmer and leaves the shot.
//   reel     after the proof has had the screen to itself, the app's add-clip sheet, paper, slides up over the player —
//            the scroll is the thumb pulling it, frame by frame and both ways; the player dims, drifts up a little and
//            recedes under it, the desktop column re-inks as the paper passes behind it, beat 01 folding as 02 opens:
//            "Which trick?" — every name on a reel, already turning as the sheet rises, slowing down past KICKFLIP
//            while the segment chips light; then the scroll types "flip", a letter as it asks for one, and the typing
//            finds it: 216 → 133 → 44 → 43, the results running up into the box from below as the spin did (its
//            own search), Kickflip first. The field is live.
//   shelf    the sheet carries on up and off the top of the stage, and the Clips tab on grip, filed — 10 clips · 4
//            tricks — rises right behind its foot, heading first. Scrolling forward, everything travels up: it comes in
//            from below and leaves at the top (scrolling back reverses it exactly). Kickflip's tiles replay the battle
//            once, oldest first, each settling on its still with the play badge; the tab arrives at the thumb's pace
//            and scrolls on up under the words with it, one px per px, and on with the page past the pin.
// Everything in the player works by hand too: drag the scrubber or use its arrow keys, step a frame (hold to repeat
// at 8 a second), play at 1× / 0.5× / 0.25×, tap the footage. Tab from the speed switch goes on to the reel's live
// search (the page goes to the typing, the field takes the focus), Shift+Tab from there comes back to the player.
// Under reduced motion every beat is its still frame. No rider, no real footage: js/lib/board.js draws every frame.
//
// QA: NBD.goto('library', p); NBD.sections.library.handlers.qa → { state(), frame(n), settle(), keys(), timeline() }
// — settle() puts the stage and the footage straight where the scroll wants them, as a jump does, at rest (a goto is a
// jump and lands there anyway; a small one may still be catching up). keys(): the p of the slow zones' frames
// (battleKnots) — phones (the head slides off 0–0.083) bail ≈ 0.108, so close ≈ 0.295, flick ≈ 0.395, touchdown
// ≈ 0.515; desktops ≈ 0.097, 0.278, 0.374, 0.491 — and a goto within half a frame of one (the touchdown: a frame and
// a half), then settle(), shows that frame exactly. timeline(): TL for the layout on screen (where the sheet goes up and down, the typing, the tab).

import { createBoardView, filmerBack, groundHeight, measureBoardFrame } from '../lib/board.js';
import {
  BATTLE_ORDER,
  CLIPS,
  CUTS,
  FPS,
  drawStill,
  drawStrip,
  drawTileFrame,
  fmtTime,
  outsideShift,
  playRange,
  tileFrame,
  timeOf,
  todayStrings,
  wallY,
} from './library-clips.js';
import { createReel } from './library-reel.js';

// Where each beat sits in p (0…1 over the pin, data-pin 2.8: 1.8 screens of scroll). Phones have a head that slides
// off first; the battle's first cut starts under it (the board is already rolling into the pop as the player comes
// up). reel: where the battle's footage ends — the battle keeps the pixels it had on the 2.5 pin (0.65 / 0.62 of 1.5
// screens; head 0.1 of them), so its footage per pixel of scroll is what it was. The pin grew for what follows:
//   the proof: the make's touchdown (keys().land) gets 0.05 of the pin (≈ 75 px on a 390 × 844 phone) to itself —
//            the board settling, today's tile, the chip, "Clip's in · +30 XP" — before anything covers it;
//   up:      the "Which trick?" sheet slides up over the player — the app's own gesture, the scroll the thumb pulling
//            it — its drum already turning as it comes into view (spin, slowing past KICKFLIP once the sheet is up);
//   type:    the scroll types "flip", a letter as it asks for one; it ends 0.04 of the pin before the sheet goes
//            off, so on a steady scroll "flip" has found Kickflip with room to spare and nothing waits for it;
//   off:     the sheet carries on up and off the top, the Clips tab, filed, rising right behind it;
//   scroll:  the tab scrolls up under the words, one pixel per pixel of scroll, on from the pace it arrived at, and on
//            past the pin's end with the page (phones; desktops only where the tab is taller than the stage).
// Where the tab has less to scroll than `scroll` leaves it (a desktop where it fits the stage: nothing), L() spreads
// up … off over the rest of the pin instead, so the tab lands at the page's pace as the page takes the stage on.
const TL = {
  phone: { head: 0.0833, reel: 0.5417, up: [0.565, 0.6375], spin: [0.575, 0.675], type: [0.685, 0.765], off: [0.805, 0.87], scroll: [0.87, 1] },
  desk: { head: 0, reel: 0.5167, up: [0.54, 0.615], spin: [0.55, 0.655], type: [0.665, 0.755], off: [0.795, 0.87], scroll: [0.87, 1] },
};
// The hand-offs. S.hand is where the stage is: 0 the battle, 1 the sheet all the way up, 2 the tab; between, the sheet
// on its way — in (0…1) rising from below over the player, out (1…2) carrying on up and off the top. Past 2 it goes
// on as the tab's own scroll, in trips of the way out (handOf), so the tab's arrival and its scroll are one motion.
// Scrolling forward everything on the stage travels up — it comes in from below and leaves at the top — and
// scrolling back reverses it exactly. The scroll moves the sheet frame by frame, both ways, exactly with it up to a
// whole trip per SHEET_MS (the tab's own scroll, past 2, always exactly); what a frame's scroll asks for beyond that
// (a flick), and the jump a hold lets go of, the stage catches up with a critically damped follow (SHEET_FOLLOW_S), so
// it slides into step with the thumb instead of starting a trip of its own — the tab included: it never stands still
// while the thumb moves — and never crosses a trip faster than SHEET_MIN_MS. On the way in, what the sheet covers dims
// under the scrim (DIM of --scrim) and drifts up PARALLAX of the stage's height (the player, its toast, a phone's beat
// panel, the scrim with them) as the player recedes by RECEDE about its top edge. On the way out the tab rises behind the sheet's foot: its heading starts
// TAB_GAP px under it, so "CLIPS · 10 clips · 4 tricks" is the first thing the paper uncovers, and it arrives at the
// thumb's own pace where it goes on scrolling (leaveOf). The desktop column's beats fold and open over MORPH of each
// trip. While the battle has not told its story (a flick past the touchdown) the sheet still moves with the scroll,
// up to BATTLE_PEEK of its trip: low enough to leave the proof's toast in view. A proof is late — it gets its PROOF_MS
// — only when the scroll was more than PROOF_LATE_PX past the touchdown when it was filed: a flick, never a steady
// scroll. The tab's own scroll comes to an easy stop over TAB_STOP px at its end.
const SHEET_MS = 160; // a trip is ≈ 100–120 px of scroll: exact up to ≈ 650 px/s on a phone, ≈ 760 on a desktop (≈ 145–170
// px and ≈ 900–1050 px/s on a desktop where the tab fits the stage: L() spreads the trips there)
const SHEET_FOLLOW_S = 0.08;
const SHEET_MIN_MS = 70; // a catch-up crosses a trip in no less than this (≈ 4 frames at 60 Hz)
const BATTLE_PEEK = 0.15;
const PROOF_LATE_PX = 120;
const TAB_STOP = 24;
const TAB_GAP = 12;
const SHEET_SHADOW = 5; // px: the hard shadow on each of the sheet's edges, kept off the stage with it
const DIM = 0.75;
const RECEDE = 0.05;
const PARALLAX = 0.08;
const MORPH = [0.12, 0.88];
const LOWER_PX = 1.5; // a desktop beat the new layout puts lower than this leaves and comes back up (placeBeats)
const EDGE_FADE = 0.8; // lines: the soft edge the coming text rises through (placeBeats)
const ease = (x) => x * x * (3 - 2 * x);
/** The way out (v 0…1): from rest, like the way in, but arriving at slope m (m = 0: the smoothstep), so a tab that
 *  scrolls on afterwards meets the thumb's pace instead of stopping for it. Monotonic for m ≤ 3. */
const leaveOf = (v, m) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v) + m * v * v * (v - 1));
const mix = (a, b, t) => a + (b - a) * t;
// The battle, planned on the scroll: cut a from four frames before its pop (f0) to its end (f1), then b, then c, one
// line from p 0 to TL.reel. The plan is shares of that span, so it follows wherever the timeline puts the reel, and
// the cuts fall where the board's story puts them (TL.cuts is not read). The scroll is spent on what the board does,
// not on clip time: each stretch of a clip gets scroll in proportion to how much the board visibly changes there — its
// turn in degrees, an inch of rise, fall or travel across the shot counted as KAPPA degrees — over a floor
// (PLAN_BASE) that keeps a rolling board rolling. Around each telling frame — the bail on its grip (a), so close on
// its edge and going over (b), the flick in the air (c) — and the make's touchdown (frame 66, the proof) the clip time
// eases down (SLOW: a Gaussian share of the scroll, SLOW_W frames wide, centred SLOW_AT frames from it) and passes
// exactly through the frame: a slow zone, never a plateau — the board moves whenever the scroll does. The telling
// frames' zones are tight (key); the touchdown's (land) is wide, from the catch through the drop to the first roll, so
// the landing reads and the board settles while the proof pops in. A thumb resting within MAGNET frames of one of
// them brings the footage onto it exactly, so the story still reads as three stills and a landing; between MAGNET and
// MAGNET × MAGNET_EDGE frames the pull fades out (a rest there goes part of the way, never a step at the zone's edge).
// The pull is a rest's only (CALM_PX: a thumb that has stopped, or creeps on from a stop slower than ≈ 90 px a
// second, is held on the frame until it leaves the pull); a moving thumb always moves the board. The reach is short
// (half a frame, ≤ 25° of turn at the flick), so what the board does after the thumb stops is a small settle, not a
// move of its own. On phones the bail's zone is on a clear screen (after the head, HEAD_CLEAR on).
const SUB = 8; // plan samples per clip frame
const KAPPA = 2.5;
const PLAN_BASE = 0.1;
const SLOW = { key: 0.05, land: 0.1 };
const SLOW_W = { key: 0.55, land: 3 };
const SLOW_AT = { key: 0, land: -1 };
const MAGNET = { key: 0.5, land: 1.5 }; // the touchdown's: the board rolling on after it barely changes
const MAGNET_EDGE = 1.5;
const HEAD_CLEAR = 0.025;
const PLANS = new Map();
const NEEDS = new Map();
const ROT = [new Float64Array(9), new Float64Array(9)];
/** The board's orientation (board.js: yaw, then pitch, then roll) as a 3 × 3 matrix. */
function orient(p, R) {
  const [cy, sy, cp, sp, cr, sr] = [Math.cos(p.yaw), Math.sin(p.yaw), Math.cos(p.pitch), Math.sin(p.pitch), Math.cos(p.roll), Math.sin(p.roll)];
  R[0] = cy * cp;
  R[1] = -cy * sp * cr + sy * sr;
  R[2] = cy * sp * sr + sy * cr;
  R[3] = sp;
  R[4] = cp * cr;
  R[5] = -cp * sr;
  R[6] = -sy * cp;
  R[7] = sy * sp * cr + cy * sr;
  R[8] = -sy * sp * sr + cy * cr;
  return R;
}
/** How much the board visibly changes over each 1/SUB of a cut's frames (degrees, KAPPA per inch), f0 → f1. */
function needOf(c) {
  let need = NEEDS.get(c.key);
  if (need) return need;
  const n = (c.f1 - c.f0) * SUB;
  need = new Float64Array(n);
  const P = { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, air: 0 };
  const xLet = c.follow ? (c.m.pose(c.follow.followUntil, P), P.x) : 0; // where the filmer let the board go
  let y0 = 0;
  let x0 = 0;
  for (let k = 0; k <= n; k++) {
    const sec = Math.max(0, Math.min(c.m.duration, timeOf(c.f0 + k / SUB) - c.off));
    c.m.pose(sec, P);
    const R = orient(P, ROT[k & 1]);
    const y = Math.max(P.air, groundHeight(P.yaw, P.pitch, P.roll));
    const x = c.follow && sec > c.follow.followUntil ? P.x - xLet + filmerBack(sec - c.follow.followUntil, c.follow.panBack) : 0;
    if (k) {
      const Q = ROT[(k - 1) & 1];
      let tr = 0;
      for (let j = 0; j < 9; j++) tr += Q[j] * R[j];
      const turn = (Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180) / Math.PI;
      need[k - 1] = turn + KAPPA * (Math.abs(y - y0) + Math.abs(x - x0));
    }
    y0 = y;
    x0 = x;
  }
  NEEDS.set(c.key, need);
  return need;
}
/**
 * The battle's plan for a layout: `ps` the p of every plan sample (cut i's samples start at `at[i]`, sample
 * at[i] + j is frame f0 + j / SUB), `keys` the p of each telling frame and of the touchdown, `zones` the same with
 * the p a resting thumb is brought in from (lo…hi: MAGNET frames either side; lo2…hi2: MAGNET × MAGNET_EDGE, where the
 * pull fades out).
 */
function battleKnots(mode) {
  const t = TL[mode];
  const id = `${mode}:${t.reel}:${t.head}`;
  let plan = PLANS.get(id);
  if (plan) return plan;
  const end = t.reel;
  const needs = CUTS.map(needOf);
  const at = [];
  const n = needs.reduce((s, need) => (at.push(s), s + need.length), 0);
  const needTot = needs.reduce((s, need) => s + need.reduce((u, v) => u + v, 0), 0);
  const marks = CUTS.flatMap((c, i) => [[i, c.keyFrame, 'key'], ...(c.landFrame ? [[i, c.landFrame, 'land']] : [])]);
  const slowTot = marks.reduce((s, m) => s + SLOW[m[2]], 0);
  const d = new Float64Array(n);
  CUTS.forEach((c, i) => {
    for (let j = 0; j < needs[i].length; j++) {
      const a = c.f0 + (j + 0.5) / SUB;
      let z = 0;
      for (const [mi, f, kind] of marks) {
        const u = (a - f - SLOW_AT[kind]) / SLOW_W[kind];
        if (mi === i) z += (SLOW[kind] * Math.exp(-0.5 * u * u)) / (SLOW_W[kind] * Math.sqrt(2 * Math.PI) * SUB);
      }
      d[at[i] + j] = PLAN_BASE / n + ((1 - PLAN_BASE - slowTot) * needs[i][j]) / needTot + z;
    }
  });
  const ps = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) ps[k + 1] = ps[k] + d[k];
  for (let k = 0; k <= n; k++) ps[k] *= end / ps[n];
  const sampleOf = (i, f) => at[i] + (f - CUTS[i].f0) * SUB;
  // phones: the bail's slow zone after the head has slid off (the time before it stretched, the time after squeezed)
  const aKey = sampleOf(0, CUTS[0].keyFrame);
  const want = t.head ? t.head + HEAD_CLEAR : 0;
  if (ps[aKey] < want) {
    const k0 = ps[aKey];
    for (let k = 0; k <= n; k++) ps[k] = k <= aKey ? (ps[k] * want) / k0 : want + ((ps[k] - k0) * (end - want)) / (end - k0);
  }
  plan = { mode, end, at, ps, n };
  plan.pOf = (i, f) => {
    const c = CUTS[i];
    const x = sampleOf(i, Math.max(c.f0, Math.min(c.f1, f)));
    const k = Math.min(n - 1, Math.floor(x));
    return ps[k] + (ps[k + 1] - ps[k]) * (x - k);
  };
  plan.keys = { a: plan.pOf(0, CUTS[0].keyFrame), b: plan.pOf(1, CUTS[1].keyFrame), c: plan.pOf(2, CUTS[2].keyFrame), land: plan.pOf(2, CUTS[2].landFrame) };
  plan.zones = marks.map(([i, f, kind]) => {
    const [m, e] = [MAGNET[kind], MAGNET[kind] * MAGNET_EDGE];
    return { i, frame: f, p: plan.pOf(i, f), lo: plan.pOf(i, f - m), hi: plan.pOf(i, f + m), lo2: plan.pOf(i, f - e), hi2: plan.pOf(i, f + e) };
  });
  PLANS.set(id, plan);
  return plan;
}
/** How hard a slow zone pulls a resting thumb at p onto its frame: 1 within MAGNET frames, fading to 0 at the edge
 *  (all the way in from 0.9 of it: a board a hair short of its frame would read as the frame before it). */
function pullOf(z, p) {
  if (p >= z.lo && p <= z.hi) return 1;
  const u = p < z.lo ? (p - z.lo2) / (z.lo - z.lo2) : (z.hi2 - p) / (z.hi2 - z.hi);
  return u >= 0.9 ? 1 : u > 0 ? ease(u) : 0;
}
// The footage follows the thumb: the drawn position on that line (S.pf) chases the scroll's p with a critically
// damped follow (FOLLOW_S: on a steady scroll the board trails the scroll by a little less than that, and has done
// 90 % of the rest of the way some 2.5 × that after it stops), drawing the board at the exact clip time every frame —
// between two frames of the clip too. A thumb (a coarse pointer) gets the short follow: touch scrolling is smooth by
// itself, and what the board does after the thumb stops is the board moving on its own. A mouse or a trackpad gets
// a touch longer one, which smooths a wheel's notches; not much longer, because browsers already animate wheel steps
// and a Mac's trackpad scrolls smoothly, and the owner felt 65 ms of trailing as a sluggish board on their Mac.
// The scroll is at rest once it has moved less than CALM_PX[0]
// a frame (60 Hz) for CALM_MS: then a slow zone's frame becomes the goal at once (MAGNET, pullOf), so a stop near a
// telling frame is one settle onto it, not a stop and then a second move. It stays at rest until the scroll moves
// faster than CALM_PX[1] a frame again: a thumb that creeps on from a stop keeps the zone's pull (the board stays on
// the frame until the thumb leaves the pull), never a pull that comes and goes with every pixel. Nothing is held on
// the way: a flick plays the battle as a quick run of poses. The hand-off to the sheet waits for the footage
// (battleTold: S.pf at the touchdown, and PROOF_MS for a proof the flick filed late: the tile's pop, the chip, the
// toast). A jump, reduced motion and the page leaving the section go straight to where the scroll is; HOLD_MAX_MS is
// the safety net.
const FOLLOW_S = { fine: 0.042, coarse: 0.035 };
const CALM_PX = [0.6, 1.5]; // px a 60 Hz frame: ≈ 36 px a second to come to rest, ≈ 90 to leave it
const CALM_MS = 32; // two frames at 60 Hz
const PROOF_MS = 380;
const HOLD_MAX_MS = 4000;
const HAND_FRAMES = [0.75, 1.6]; // "there's the flick": in full / gone, frames from the telling one (placeHand)
// the footage's framing: where the ground and the top of the flight sit in the visible video (fractions). The make
// flies highest: its flight is framed a touch lower (make), so at the flick the board overlaps the day's date like a
// masthead instead of eclipsing it (the date also shrinks from its top when it still would: measure()).
const FRAME_FIT = { phone: { ground: 0.9, top: 0.31, make: 0.36 }, desk: { ground: 0.88, top: 0.25, make: 0.29 } };
const CUT_ELEV = { a: 14, b: 19, c: 17 };
const STRIP_DATES = { b: ['21.09', '24.09', '27.09'] };
export default async function init(root, ctx) {
  const { $, $$, clamp, smoothstep } = ctx.dom;
  const today = todayStrings();
  const stage = $('[data-stage]', root);
  const head = $('[data-head]', root);
  const honest = $('[data-honest]', root);
  const beats = $('[data-beats]', root);
  const beatEls = $$('[data-beat]', root);
  const rail = $('[data-rail]', root);
  const player = $('[data-player]', root);
  const video = $('[data-video]', root);
  const floor = $('[data-floor]', root);
  const dateBox = $('[data-date]', root);
  const dateEl = $('[data-date-t]', root);
  const nameEl = $('.lib-top__name', root);
  const cv = $('[data-cv]', root);
  const meta = $('[data-meta]', root);
  const hand = $('[data-hand]', root);
  const arrow = $('[data-hand-arrow]', root);
  const handNote = $('.t-hand', hand);
  const speedTape = $('[data-speedtape]', root);
  const scrub = $('[data-scrub]', root);
  const stripCv = $('[data-strip]', root);
  const headMark = $('[data-head-mark]', root);
  const curEl = $('[data-cur]', root);
  const frameEl = $('[data-frame]', root);
  const lenEl = $('[data-len]', root);
  const tagEls = $$('[data-tags] > span', root);
  const playBtn = $('[data-play]', root);
  const group = $('[data-strip-group]', root);
  const groupChip = $('[data-chip]', group);
  const groupN = $('[data-n]', group);
  const groupHead = $('.lib-group__h', group);
  const stripTiles = new Map($$('[data-tiles] > [data-clip]', group).map((el) => [el.dataset.clip, el]));
  const toast = $('[data-toast]', root);
  const reelEl = $('[data-reel]', root);
  const shelf = $('[data-shelf]', root);
  const shelfIn = $('[data-shelf-in]', root);
  const shelfTiles = new Map($$('[data-clip]', shelf).map((el) => [el.dataset.clip, el]));
  const live = $('[data-live]', root);
  const deskMQ = matchMedia('(min-width: 900px), (min-width: 600px) and (max-height: 520px) and (orientation: landscape)');
  const coarseMQ = matchMedia('(pointer: coarse)'); // a thumb: the footage's short follow (FOLLOW_S)
  // The words on the sheet: a copy of the column inside it, aria-hidden and inert (a phone shows its beat panel, beat
  // 02, at the sheet's foot; a desktop the whole column in ink, held where the column is while the sheet moves). No
  // ids and no data hooks (the section's own queries above found the originals); the title is not a second heading.
  const inkCol = $('.lib-col', root).cloneNode(true);
  for (const el of [inkCol, ...inkCol.querySelectorAll('*')]) {
    for (const a of [...el.attributes]) if (a.name === 'id' || (a.name.startsWith('data-') && a.name !== 'data-beat')) el.removeAttribute(a.name);
  }
  for (const h of inkCol.querySelectorAll('h2')) {
    const d = document.createElement('div');
    d.className = h.className;
    d.innerHTML = h.innerHTML;
    h.replaceWith(d);
  }
  inkCol.classList.add('lib-ink');
  inkCol.setAttribute('aria-hidden', 'true');
  inkCol.inert = true;
  reelEl.prepend(inkCol);
  const inkBeats = $$('.lib-beat', inkCol);
  const inkHonest = $('.lib-honest', inkCol);
  // what the sheet covers dims under it as it travels
  const scrim = document.createElement('i');
  scrim.className = 'lib-scrim';
  scrim.setAttribute('aria-hidden', 'true');
  reelEl.before(scrim);
  // Shift+Tab from the next section: the tab has no controls and the reel and the player are inert there, so the
  // browser would skip the whole section. This stop, the stage's last, is focusable only while the tab shows, and
  // hands the focus straight on to the reel's live search (see the keyboard path below).
  const kbBack = document.createElement('span');
  kbBack.className = 'sr-only';
  kbBack.tabIndex = -1;
  stage.append(kbBack);

  for (const el of $$('[data-today-dm]', root)) el.textContent = today.dm;
  for (const el of $$('[data-today-dmy]', root)) el.textContent = today.dmy;
  // the Clips tab's text equivalent (outside the tab, always reachable): with the script, today's tile is today
  const shelfLabel = $('[data-shelf-label]', root);
  if (shelfLabel) shelfLabel.textContent = ctx.t('shelf');
  const say = (text) => {
    live.textContent = '';
    requestAnimationFrame(() => (live.textContent = text));
  };

  // ------------------------------------------------------------ state
  const S = {
    mode: deskMQ.matches ? 'desk' : 'phone',
    p: -1,
    phase: '',
    cut: null,
    frame: 52,
    manual: false,
    manualP: 0,
    playing: false,
    speed: 0.25,
    k: 1, // the head's slide (phones)
    filed: false, // the shelf has replayed the battle
    geo: null, // the framing of the cut on screen (geos: every cut's)
    geos: null,
    knots: null,
    pf: null, // where the footage is on the battle's line, in p (battleKnots), and its speed (p a second)
    vf: 0,
    pT: -1, // the scroll's p the footage last heard of, when it last moved, when it last moved faster than CALM_PX a
    movedAt: 0, // frame, and whether a jump put it there (the magnet waits for rest)
    stirAt: 0,
    landed: false,
    drawnT: 0, // the clip time on screen (s)
    dir: 1, // which way the story last moved
    lastAt: 0,
    leftAt: 0, // when the scroll left the battle while the stage still held it (a flick)
    proof: false, // the make is down: the clip is filed as the proof
    proofAt: 0,
    saidProof: false,
    trailDrop: 0, // the make's ghosts left out as it lands (showAt), and the flick note's fade (placeHand)
    handO: null,
    sizeKey: '', // the strip's and the tiles' sizes and the pixel ratio the pictures were drawn for (onResize)
    resting: false, // leave() is resting the stage off screen
    shelfTf: null, // the tab's scroll as last written (update)
    hand: -1, // where the stage is between the beats (0 battle · 1 the sheet up · 2 the tab), and when it last moved
    handAt: 0,
    goal: -1, // where the sheet was headed last frame, and how far it is behind that (catching up) and how fast
    lag: 0,
    lagV: 0,
    proofSeen: 0, // the proof's filing the sheet has looked at, and whether the scroll was well past it by then
    proofLate: false,
    tabFrom: -1, // the p the sheet came down at: the tab's own scroll starts there
    beatKey: 'a', // the beat open in the column (desktops: both copies) and how the beats lie in each state (measureBeats)
    beatGeo: null,
    railTf: null,
  };
  // The timeline for the layout on screen: TL[mode], except where what the tab has left to scroll after the way out
  // would end before the pin does (a desktop where the tab fits the stage has none at all: the last 0.13 of the pin,
  // ≈ 210 px at 1440 × 900, was scroll that moved nothing). There the moving beats after the proof's moment — up, spin,
  // type, off, in proportion — are spread over the rest of the pin, so the way out ends where the tab's own scroll then
  // meets the pin's end: the tab lands at the page's pace just as the page takes the stage on. The battle and its proof
  // keep their pixels, and so does the payoff between the typing and the way out (its rest is not stretched).
  let tlKey = '';
  let tlNow = null;
  const L = () => {
    const base = TL[S.mode];
    const px = pinPx();
    const key = `${S.mode}:${S.shelfMax}:${px}`;
    if (key === tlKey) return tlNow;
    tlKey = key;
    const end = px > 0 && S.shelfMax !== undefined ? Math.min(1, 1 - S.shelfMax / px) : 0; // measured (measure)
    if (!(end > base.off[1] + 1e-3)) return (tlNow = base);
    const a = base.up[0];
    const gap = base.off[0] - base.type[1]; // the payoff
    const k = (end - a - gap) / (base.off[1] - a - gap);
    const at = (x) => +(x <= base.type[1] ? a + (x - a) * k : end - (base.off[1] - x) * k).toFixed(4);
    const span = ([x, y]) => [at(x), at(y)];
    return (tlNow = { ...base, up: span(base.up), spin: span(base.spin), type: span(base.type), off: span(base.off), scroll: [at(base.off[1]), 1] });
  };
  // A step of the build per frame: a frame is drawn between two steps (back-to-back yields can run ahead of a
  // pending frame until the browser's starvation cut-off: long animation frames while the visitor is scrolling the
  // section above). The timeout keeps a hidden page building.
  const nextFrame = () =>
    new Promise((resolve) => {
      let done = false;
      const go = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      requestAnimationFrame(() => setTimeout(go, 0));
      setTimeout(go, 120);
    });
  // the work nobody sees yet (the other cuts' strips, the tiles, the replays' framing) waits for an idle moment
  const idle = () => (typeof requestIdleCallback === 'function' ? new Promise((resolve) => requestIdleCallback(() => resolve(), { timeout: 1200 })) : nextFrame());

  // ------------------------------------------------------------ the footage: one board view, driven by hand
  // (created a frame in: the dates written above are laid out by the browser's own frame, not forced by the view's
  // first measure)
  await nextFrame();
  const view = createBoardView(cv, { trick: CUTS[2].motion, look: 'night', bg: false, autoplay: false, loop: false, trail: 3, trailGap: 0.06, elev: 17, reduced: false });
  await nextFrame();
  battleKnots(deskMQ.matches ? 'desk' : 'phone'); // the battle's plan, a step of its own (≈ 16 ms cold at CPU ×4)
  await nextFrame();

  /** Fit the footage: the ground near the bottom of the visible video, the flight's top under the meta line. */
  function measure() {
    S.mode = deskMQ.matches ? 'desk' : 'phone';
    S.knots = battleKnots(S.mode);
    const top = cv.offsetTop;
    const w = video.clientWidth;
    const hv = video.clientHeight - top;
    if (!w || hv < 40) return false;
    const fit = FRAME_FIT[S.mode];
    const frame = (topAt) => {
      let Sc = ((fit.ground - topAt) * hv) / 20.9; // the flight spans ~20.9 board-inches from the ground to its top
      Sc = Math.min(Sc, (w * 0.8) / 32); // the deck never wider than 80 % of the frame
      return { Sc, oy: fit.ground * hv - 10 * Sc };
    };
    const std = frame(fit.top);
    const hc = Math.max(hv, std.oy / 0.52);
    cv.style.height = `${hc.toFixed(1)}px`;
    const unit = Math.min(w / (w < hc ? 40 : 48), hc / 36);
    // every cut's framing in the one canvas: its scale (zoom) and its view height (a frame offset from the canvas's)
    const geoOf = (f) => ({ w, hv, hc, top, S: f.Sc, zoom: f.Sc / unit, oy: f.oy, off: f.oy - 0.52 * hc });
    S.geos = { a: geoOf(std), b: geoOf(std), c: geoOf(frame(fit.make)) };
    // the day's date in the empty top of the footage: at the make's flick the board may cover the lower 40 % of its
    // digits at most (a masthead, not an eclipse). The make's flight is framed lower until the date keeps at least
    // 62 % of its size (a short desktop window needs it most), then the date shrinks from its top to fit; where it
    // would have to go under 55 %, it steps out
    dateBox.style.setProperty('--date-k', '1');
    delete stage.dataset.nodate;
    const db = dateEl.getBoundingClientRect();
    if (db.height) {
      const fs = parseFloat(getComputedStyle(dateEl).fontSize) || db.height / 0.76;
      const digitsTop = db.top - video.getBoundingClientRect().top + 0.06 * fs; // Sofia's digits: 0.06–0.76 em of the box
      const fitOf = (g) => {
        const flick = measureBoardFrame(w, hc, { trick: CUTS[2].motion, sec: CUTS[2].sec, zoom: g.zoom, elev: CUT_ELEV.c, frameOffset: [0, g.off] });
        return { boardTop: top + flick.y0, k: Math.min(1, (top + flick.y0 - digitsTop) / (0.6 * 0.7 * fs)) };
      };
      let f = fitOf(S.geos.c);
      for (let at = fit.make + 0.01; f.k < 0.62 && at <= fit.make + 0.12; at += 0.01) {
        S.geos.c = geoOf(frame(at));
        f = fitOf(S.geos.c);
      }
      if (f.k < 0.55) stage.dataset.nodate = '';
      else dateBox.style.setProperty('--date-k', f.k.toFixed(3));
      S.dateFit = { digitsTop: Math.round(digitsTop), digitsH: Math.round(0.7 * fs * f.k), boardTop: Math.round(f.boardTop), k: +f.k.toFixed(3), make: +(S.geos.c.S / S.geos.a.S).toFixed(3) };
    }
    S.geo = S.geos[S.cut?.key ?? 'a'];
    if (S.cut) frameCut(S.cut);
    view.resize();
    // the toast (phones): on the group header's right, standing in for "N clips" while the proof is filed; on the
    // smallest phones, where it would cover the header's state chip, on the player's title row instead (right of
    // the trick's name, over nothing: the app's share and trash are left out of the recreation)
    if (S.mode === 'phone') {
      const railTop = rail.getBoundingClientRect().top;
      const row = (w < 360 ? nameEl : groupHead).getBoundingClientRect();
      stage.dataset.toastAt = w < 360 ? 'title' : 'group';
      toast.style.setProperty('--toast-y', `${(row.top - railTop + (row.height - toast.offsetHeight) / 2).toFixed(1)}px`);
    } else delete stage.dataset.toastAt;
    // the head (phones): where the player starts, under the honesty line
    const headBottom = honest.offsetTop + honest.offsetHeight + 18;
    S.headBottom = headBottom;
    S.railStart = Math.max(0, headBottom - top);
    // every beat's height (phones: one at a time at the bottom, over the reel and the tab), read once here, not
    // at a cut: the reel ends above its beat, the tab scrolls up to it
    beats.classList.add('is-measuring');
    S.beatH = Object.fromEntries(beatEls.map((b) => [b.dataset.beat, b.offsetHeight]));
    const pad = beats.offsetHeight - beatEls.reduce((n, b) => n + b.offsetHeight, 0);
    beats.classList.remove('is-measuring');
    for (const k of Object.keys(S.beatH)) S.beatH[k] += pad;
    reelEl.style.setProperty('--beats-h', `${S.beatH.b + 8}px`);
    S.stageH = stage.clientHeight;
    const note = hand.querySelector('.t-hand');
    S.note = [note.offsetWidth, note.offsetHeight];
    // the tab's scroll: phones up to the beat panel; desktops only where the tab is taller than the stage (a phone on
    // its side), up to 16 px from the bottom
    const over = S.mode === 'phone' ? shelfIn.offsetHeight - (S.stageH - S.beatH.c - 10) : shelfIn.offsetHeight + 16 - S.stageH;
    S.shelfMax = over > 4 ? Math.ceil(over) : 0;
    // the way out: the tab rises from S.tabD px below its place, its heading (at S.headTop in the tab, at rest)
    // starting TAB_GAP px under the sheet's foot
    let headTop = 0;
    for (let el = $('.lib-shelf__title', shelf); el && el !== shelf; el = el.offsetParent) headTop += el.offsetTop;
    S.headTop = headTop;
    S.tabD = Math.max(0, S.stageH + TAB_GAP - headTop);
    // the toast is the player's: where its middle is from the player's origin (the top of the rail, its middle), so it
    // drifts and recedes with it under the sheet (placeRail). offset* are untransformed
    S.toastRel = [toast.offsetLeft + toast.offsetWidth / 2 - (rail.offsetLeft + rail.offsetWidth / 2), toast.offsetTop + toast.offsetHeight / 2 - rail.offsetTop];
    measureBeats();
    return true;
  }
  /** How the column's beats lie with each one open (desktops; read here, never during a hand-off): for each beat its
   *  top, whether it shows at all (a phone on its side shows one), and the height of the text under its lead. A
   *  phone's sheet always carries beat 02. */
  function measureBeats() {
    S.beatGeo = null;
    S.honestGeo = null;
    const keep = beatEls.find((li) => li.classList.contains('is-on'))?.dataset.beat ?? 'a';
    S.beatKey = null; // placeBeats writes the classes again
    if (S.mode === 'desk') {
      const geo = {};
      for (const X of ['a', 'b', 'c']) {
        beatEls.forEach((li) => li.classList.toggle('is-on', li.dataset.beat === X));
        geo[X] = beatEls.map((li) => {
          const long = $('.lib-beat__long', li);
          const short = $('.lib-beat__short', li);
          const body = long.offsetHeight > 2 ? long : short.offsetHeight > 2 ? short : null;
          const lh = body ? parseFloat(getComputedStyle(body).lineHeight) || 21 : 21;
          return { top: li.offsetTop, vis: li.offsetHeight > 2, body: body ? body.offsetHeight : 0, lh, form: body === long ? 'long' : body ? 'short' : '' };
        });
        // the honesty line, at the column's foot: lower where a state's beats overflow it (a short desktop)
        (S.honestGeo ??= {})[X] = honest.offsetTop;
      }
      S.beatGeo = geo;
    } else inkBeats.forEach((li) => li.classList.toggle('is-on', li.dataset.beat === 'b'));
    beatEls.forEach((li) => li.classList.toggle('is-on', li.dataset.beat === keep));
  }

  // ------------------------------------------------------------ the scrubber's 12 frames, drawn once per cut and size
  const stripCache = new Map();
  /** The cut's 12 frames as an image (cached): built ahead, one cut per task, so a cut only copies it. The strip's
   *  size is read once per layout (S.stripBox, cleared on resize): a cut mid-scroll must not force a layout. */
  function stripImage(c) {
    if (!S.stripBox?.[0]) S.stripBox = [Math.round(stripCv.clientWidth), Math.round(stripCv.clientHeight)];
    const [w, h] = S.stripBox;
    if (!w || !h) return null;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const key = `${c.key}:${w}x${h}@${dpr}`;
    let img = stripCache.get(key);
    if (!img) {
      img = document.createElement('canvas');
      img.width = Math.round(w * dpr);
      img.height = Math.round(h * dpr);
      const g = img.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cw = drawStrip(g, w, h, c, { zoom: 1.04, elev: CUT_ELEV[c.key], dpr, gap: 2 });
      g.strokeStyle = '#3A3A35';
      g.lineWidth = 1;
      for (let i = 0; i < 12; i++) g.strokeRect(i * (cw + 2) + 0.5, 0.5, cw - 1, h - 1);
      stripCache.set(key, img);
    }
    S.stripW = w;
    return img;
  }
  function paintStrip() {
    const img = S.cut && stripImage(S.cut);
    if (!img) return;
    if (stripCv.width !== img.width || stripCv.height !== img.height) {
      stripCv.width = img.width;
      stripCv.height = img.height;
    }
    const g = stripCv.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, img.width, img.height);
    g.drawImage(img, 0, 0);
  }

  // ------------------------------------------------------------ a cut: the clip on screen
  let tickTimers = [];
  const clearTicks = () => {
    tickTimers.forEach(clearTimeout);
    tickTimers = [];
  };
  // Kickflip's group on the day on screen. Today's clip is not in it until the make is down (setProof).
  const PRESENT = { a: ['k-1409'], b: ['k-2709', 'k-2409', 'k-2109', 'k-1409'], c: ['k-2709', 'k-2409', 'k-2109', 'k-1409'] };
  function fileStrip(key, forward) {
    const now = new Set(PRESENT[key]);
    const was = new Set(S.cut ? PRESENT[S.cut.key] : []);
    for (const [id, el] of stripTiles) {
      el.hidden = !now.has(id);
      el.classList.remove('is-new');
    }
    groupChip.className = 'chip chip--learning';
    groupChip.textContent = 'learning';
    groupN.textContent = `${now.size} clip${now.size === 1 ? '' : 's'}`;
    if (!forward || ctx.reduced) return;
    // the clips of the days between file themselves in the order they were added, the date ticking with them
    const added = [...PRESENT[key]].reverse().filter((id) => !was.has(id));
    added.forEach((id, i) => {
      const el = stripTiles.get(id);
      el.hidden = true;
      tickTimers.push(
        setTimeout(() => {
          el.hidden = false;
          el.classList.add('is-new');
        }, 90 + i * 130),
      );
    });
  }
  function setDate(key, forward) {
    const final = key === 'c' ? today.dm : CUTS.find((c) => c.key === key).date;
    if (!forward || ctx.reduced) {
      dateEl.textContent = final;
      return;
    }
    const steps = key === 'b' ? STRIP_DATES.b : [final];
    steps.forEach((d, i) => tickTimers.push(setTimeout(() => (dateEl.textContent = d), i * 130)));
  }
  /** The cut's camera in the one board view: its framing (the make's is lower), the ghosts only behind the make (the
   *  misses are single boards on the ground), a filmer who lets a missed board go; the floor under its wall line.
   *  Nothing is drawn here: the frame that follows (showFrame, or the view's resize) draws. */
  function frameCut(c) {
    const g = S.geos?.[c.key];
    S.geo = g ?? S.geo;
    S.trailDrop = 0;
    view.set(
      {
        trick: c.motion,
        elev: CUT_ELEV[c.key],
        trail: c.key === 'c' ? 3 : 0,
        trailDrop: 0,
        followUntil: c.follow?.followUntil ?? null,
        panBack: c.follow?.panBack ?? 0,
        ...(g ? { zoom: g.zoom, frameOffset: [0, g.off] } : null),
      },
      false,
    );
    if (g) floor.style.transform = `translateY(${(g.top + wallY(g.hc, g.S, CUT_ELEV[c.key], g.oy)).toFixed(1)}px)`;
    S.drawn = '';
  }
  /** The player's meta line: "clip i of n" follows the strip under it, so today's clip is "1 of 5" only once the
   *  touchdown has filed it (before that the group has 4 clips and no today tile). */
  function setMeta(c) {
    const day = c.key === 'c' ? today.dmy : `${c.date}.26`;
    const of = c.key === 'c' && !S.proof ? 1 : c.of;
    meta.textContent = `Normal · ${day}${of > 1 ? ` · clip 1 of ${of}` : ''}`;
  }
  function setCut(c, forward) {
    if (S.cut === c) return;
    stopPlay();
    clearTicks();
    setProof(false);
    if (c.key !== 'c') S.saidProof = false;
    fileStrip(c.key, forward && S.cut !== null && CUTS.indexOf(c) === CUTS.indexOf(S.cut) + 1);
    setDate(c.key, forward && S.cut !== null);
    S.cut = c;
    stage.dataset.clip = c.key;
    frameCut(c);
    setMeta(c);
    lenEl.textContent = fmtTime(c.len);
    tagEls.forEach((t) => t.classList.toggle('is-on', t.dataset.k === c.tag));
    scrub.setAttribute('aria-valuemax', String(c.frames));
    player.setAttribute('aria-label', ctx.t(`player.${c.key}`));
    paintStrip();
  }
  /**
   * The proof, filed at the make's touchdown (all four wheels down), not at the cut: today's tile pops into
   * Kickflip's group, its chip says landed, 5 clips, the toast "Clip's in · +30 XP" (on phones standing in for the
   * group's count), and the live region says it once. Nothing lands Kickflip a second time. It stays filed under
   * the sheet (the footage there is the make's end); only footage before the touchdown takes it back. The pop and the
   * words are for the footage getting there, with the player in view (the sheet down, or only peeking).
   */
  function setProof(on) {
    if (on === S.proof) return;
    S.proof = on;
    if (on) S.proofAt = performance.now();
    const seen = S.dir > 0 && S.hand <= BATTLE_PEEK;
    const tile = stripTiles.get('k-today');
    tile.hidden = !on;
    tile.classList.toggle('is-new', on && seen && !ctx.reduced);
    groupChip.className = `chip chip--${on ? 'landed' : 'learning'}`;
    groupChip.textContent = on ? 'landed' : 'learning';
    if (S.cut?.key === 'c') {
      groupN.textContent = `${on ? 5 : 4} clips`;
      setMeta(S.cut);
    }
    toast.classList.toggle('is-on', on);
    if (on) stage.dataset.proof = '';
    else delete stage.dataset.proof;
    if (on && seen && !S.saidProof) {
      S.saidProof = true;
      say(ctx.t('proof'));
    }
  }

  /** Draw frame a (1-based) of the cut on screen, exactly (a step, the scrubber, the keys); every readout follows. */
  function showFrame(a) {
    showAt(timeOf(clamp(Math.round(a), 1, S.cut.frames)));
  }
  /**
   * Draw the cut on screen at clip time ct (s): any time, between two of the clip's frames too, so the board turns
   * smoothly under the scroll. The readouts — frame n / N, the timecode, the scrubber's head — show the frame the
   * time falls in (the app's rule: floor(t × 30) + 1), except while it plays (live: the time itself, as the app's
   * player counts). Nothing is written that has not changed.
   */
  function showAt(ct, live = false) {
    const c = S.cut;
    ct = clamp(ct, 0, timeOf(c.frames));
    const a = clamp(Math.floor(ct * FPS + 1e-6) + 1, 1, c.frames);
    S.drawnT = ct;
    setProof(c.key === 'c' && a >= c.landFrame); // filed through the hand-off too: the sheet covers it, never clears it
    // the make's sequence catches up into the board as it lands: 3, 2, 1 ghosts on the three frames before the
    // touchdown, the touchdown itself one board on its shadow (the flick keeps all three). Between two frames the
    // leaving ghost fades by the time between them, as the board moves (board.js: a fractional trailDrop)
    const drop = c.key === 'c' ? Math.round((3 - clamp(c.landFrame - (ct * FPS + 1), 0, 3)) * 1000) / 1000 : 0;
    if (drop !== S.trailDrop) {
      S.trailDrop = drop;
      view.set({ trailDrop: drop }, false);
    }
    const drawn = `${c.key}:${ct}:${S.geo?.S}:${drop}`;
    if (drawn !== S.drawn) {
      S.drawn = drawn;
      const sec = ct - c.off;
      view.seek(clamp(sec / c.m.duration, 0, 1));
      // the clip's head and tail: the board rolls into and out of the shot (the filmer is not following yet / any more)
      const shift = S.geo ? outsideShift(c.m, sec, c.follow) * S.geo.S : 0;
      const tf = shift ? `translate3d(${shift.toFixed(1)}px, 0, 0)` : '';
      if (tf !== S.cvTf) cv.style.transform = S.cvTf = tf;
    }
    if (a !== S.frame || c !== S.frameCut || live || S.liveT) {
      S.frame = a;
      S.frameCut = c;
      S.liveT = live;
      curEl.textContent = fmtTime(live ? ct : timeOf(a));
      frameEl.textContent = `frame ${a} / ${c.frames}`;
      scrub.setAttribute('aria-valuenow', String(a));
      scrub.setAttribute('aria-valuetext', `frame ${a} / ${c.frames}`);
    }
    const hx = `translate3d(${(((live ? ct : timeOf(a)) / c.len) * (S.stripW || scrub.clientWidth)).toFixed(1)}px, 0, 0)`;
    if (hx !== S.headTf) headMark.style.transform = S.headTf = hx;
    placeHand(c, ct);
  }
  /** "there's the flick": at the make's telling frame, the note under the board and an arrow up at its edge (never
   *  across the graphic), wherever the footage's framing puts the board. Only while the graphic faces the camera: in
   *  full within HAND_FRAMES[0] frames of the telling frame, faded out by HAND_FRAMES[1] (the board on its edge, or
   *  turned on to its grip). Stepping by whole frames, that is 51–53. */
  function placeHand(c, ct) {
    const d = c.key === 'c' && S.phase === 'battle' ? Math.abs(ct * FPS + 1 - c.keyFrame) : Infinity;
    const o = 1 - ease(clamp((d - HAND_FRAMES[0]) / (HAND_FRAMES[1] - HAND_FRAMES[0])));
    const on = o > 0.01;
    const op = on && o < 0.995 ? o.toFixed(2) : '';
    if (op !== S.handO) handNote.style.opacity = arrow.style.opacity = S.handO = op; // the container is the on/off
    if (on && S.geo && !S.handOn) {
      const g = S.geo;
      const cx = g.w / 2;
      const yc = g.top + g.oy - g.S * (0.956 * 15.2 - 10); // the board's centre at the flick (15.2 in up)
      const tip = [cx + 2.6 * g.S, yc + 4.5 * g.S + 7]; // just under the board's bottom edge
      const text = handNote;
      const [tw, th] = S.note ?? [text.offsetWidth, text.offsetHeight]; // measured with the layout, not mid-scroll
      const bottom = g.top + g.hv - 8;
      const x = clamp(cx + 5.5 * g.S, 16, g.w - tw - 12);
      const y = clamp(tip[1] + 22, tip[1] - th * 0.3, bottom - th);
      text.style.translate = `${x.toFixed(0)}px ${y.toFixed(0)}px`; // the translate property: not turned by the note's tilt
      // the arrow: from the note's left side (or its top, when the note starts left of the tip), curving up to the tip
      const from = x > tip[0] + 18 ? [x - 6, y + th * 0.42] : [x + tw * 0.2, y - 2];
      const ctl = [tip[0] + (from[0] - tip[0]) * 0.15, from[1]];
      const ang = Math.atan2(tip[1] - ctl[1], tip[0] - ctl[0]);
      const head = (t) => [tip[0] - 11 * Math.cos(ang + t), tip[1] - 11 * Math.sin(ang + t)];
      const [h1, h2] = [head(0.5), head(-0.5)];
      const f = (pt) => `${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`;
      arrow.firstChild.setAttribute('d', `M${f(from)}Q${f(ctl)} ${f(tip)}M${f(h1)}L${f(tip)}L${f(h2)}`);
    }
    S.handOn = on;
    hand.classList.toggle('is-on', on);
  }

  // ------------------------------------------------------------ the page's scroll → the beat on screen: the hand-offs
  // Between the beats the app's add-clip sheet does the moving: "Which trick?" slides up over the player (the scroll is
  // the thumb pulling it up), and carries on up off the top as the Clips tab rises behind it. S.hand is where the
  // stage is: 0 the battle, 1 the sheet all the way up, 2 the tab; between, the sheet on its way; past 2, the tab's own
  // scroll. The scroll sets it frame by frame, both ways (handOf), exactly up to a whole trip per SHEET_MS and catching
  // up with a damped follow beyond that, so a flick still sees it slide. The beat on the stage — inert layers, the live
  // region, the battle's footage, the reel's typing — changes at the midpoints (phaseAt).
  /** The pin's length in px (the scroll engine's cached geometry). */
  function pinPx() {
    const r = ctx.scroll.rangeOf('library');
    return r ? r.end - r.start : 0;
  }
  /** Most of the stage on screen: the pin, or the page no more than a quarter of a screen past its end. */
  function stageInView() {
    const r = ctx.scroll.rangeOf('library');
    return !r || (window.scrollY >= r.start - 0.25 * S.stageH && window.scrollY <= r.end + 0.25 * S.stageH);
  }
  /** Where the drum starts on the sheet (layout, read with the resize): below the stage's edge it is not drawn. */
  function measureDrum() {
    const drum = $('[data-drum]', reelEl);
    S.drumTop = drum ? drum.offsetTop + (drum.offsetParent === reelEl ? 0 : drum.offsetParent?.offsetTop ?? 0) : 0;
  }
  /** Where the scroll puts the stage between the beats (0…2), from the timeline alone; past 2, the tab's own scroll in
   *  trips of the way out (one px of scroll, one px of the tab). */
  function handOf(p) {
    const t = L();
    if (p <= t.up[0]) return 0;
    if (p < t.up[1]) return (p - t.up[0]) / (t.up[1] - t.up[0]);
    if (p <= t.off[0]) return 1;
    return 1 + (p - t.off[0]) / (t.off[1] - t.off[0]);
  }
  /** The way out's length in px of scroll (a trip in handOf's units, past 2). */
  const tripPx = () => (L().off[1] - L().off[0]) * pinPx();
  /** From a to b in one frame: the stretch inside the sheet's trips (0…2) is kept in step up to `step`; past 2, the
   *  tab's own scroll, it is free. Where the trips ask for more, the stage stops `step` into them (the rest is lag). */
  function stepTrip(a, b, step) {
    const inTrips = Math.max(0, Math.min(Math.max(a, b), 2) - Math.max(Math.min(a, b), 0));
    if (inTrips <= step) return b;
    return b > a ? Math.max(a, 0) + step : Math.min(a, 2) - step;
  }
  const phaseAt = (h) => (h < 0.5 ? 'battle' : h < 1.5 ? 'reel' : 'shelf');
  /** The beat the scroll wants, nothing holding it (release() asks): the visitor typing keeps the reel. */
  function phaseOf(p) {
    return reel?.focused ? 'reel' : phaseAt(handOf(p));
  }
  /** The battle has told its story: its footage has reached the make's touchdown and, when a flick got the scroll well
   *  past it before the footage filed the proof (proofLate), the proof has had its moment (PROOF_MS). The visitor
   *  scrubbing or playing has the footage, not the story; HOLD_MAX_MS is the safety net. */
  function battleTold(now) {
    if (S.pf === null || S.manual || S.playing) return true;
    if (S.leftAt && now - S.leftAt > HOLD_MAX_MS) return true;
    if (S.pf < K().keys.land - 1e-4) return false;
    return !(S.proof && S.proofLate && now - S.proofAt < PROOF_MS);
  }
  /** Where the sheet goes now. A beat that has not paid off holds it against a flick — forward only, inside the pin
   *  only (a page past the pin's end has no story left to wait for: the sheet goes where the scroll says), never on a
   *  jump or under reduced motion (there the stage cuts at the midpoints, no sliding). The battle, until its story is
   *  told (battleTold), lets the sheet come up only BATTLE_PEEK of the way, with the scroll, never frozen. The reel
   *  keeps it up until the scroll's "flip" has found Kickflip (reel.busy(); onSettled lets go) — but once the scroll is a
   *  quarter into the way out the rest is typed at once (finish) and the sheet goes with the thumb. A visitor in the
   *  field keeps it up. Under reduced motion the stage cuts at the midpoints; the tab's own scroll is the page's. */
  function handGoal(now, jumped) {
    const h = reel?.focused ? 1 : handOf(S.p);
    if (ctx.reduced) return h < 0.5 ? 0 : h < 1.5 ? 1 : Math.max(2, h);
    if (jumped || S.hand < 0 || h <= S.hand) {
      S.leftAt = 0;
      return h;
    }
    const t = L();
    const pinned = S.p < 1;
    if (S.hand < 0.5 && pinned && !battleTold(now)) {
      S.leftAt ||= now;
      return Math.max(S.hand, Math.min(h, BATTLE_PEEK)); // never pulled back down: a proof filed late stops it there
    }
    S.leftAt = 0;
    if (S.hand <= 1 && h > 1 && reel?.busy()) {
      if (pinned && S.p < t.off[0] + 0.25 * (t.off[1] - t.off[0])) return Math.max(S.hand, 1);
      reel.finish();
    }
    return h;
  }
  let handOff = null;
  const stopHand = () => {
    handOff?.();
    handOff = null;
  };
  /**
   * The stage a frame toward its goal; the beat on the stage follows it. The goal's own motion is followed exactly up
   * to a whole trip per SHEET_MS inside the trips (a steady scroll: the sheet is where the thumb puts it, both ways),
   * and always exactly past them (the tab's own scroll); what goes beyond that — a flick's frame, a hold letting go —
   * becomes a lag the stage makes up with a critically damped follow (SHEET_FOLLOW_S, Unity's SmoothDamp toward no
   * lag), so it slides into step with the thumb, and the tab, which arrives on the same axis, keeps moving through the
   * catch-up and on with the thumb (no stretch of scroll where nothing moves). The ticker runs while the stage is short
   * of where the scroll wants it, held or catching up: a hold lets go in time, thumb moving or not.
   */
  function moveHand(jumped, force = false, now = performance.now()) {
    const t = L();
    if (S.proof && S.proofAt !== S.proofSeen) {
      S.proofSeen = S.proofAt;
      // late: the scroll was well past the touchdown when the footage got there (a flick); a steady scroll's footage
      // trails it by a few frames' worth of pixels
      S.proofLate = (S.p - K().keys.land) * pinPx() > PROOF_LATE_PX;
    }
    const goal = handGoal(now, jumped);
    let h = goal;
    if (jumped || ctx.reduced || S.hand < 0 || S.goal < 0) {
      S.lag = S.lagV = 0;
    } else {
      const dt = Math.min(50, Math.max(0, now - S.handAt)) / 1000;
      // the goal's move from where the stage is (the lag kept), stepped through the trips
      let lag = stepTrip(S.hand, S.hand + (goal - S.goal), (dt * 1000) / SHEET_MS) - goal;
      if (lag && dt) {
        const w = 2 / SHEET_FOLLOW_S;
        const x = w * dt;
        const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const tmp = (S.lagV + w * lag) * dt;
        const next = (lag + tmp) * e;
        S.lagV = (S.lagV - w * tmp) * e;
        if (Math.abs(next) < 1e-3 || Math.sign(next) !== Math.sign(lag)) {
          lag = 0;
          S.lagV = 0;
        } else lag = next;
      }
      // a catch-up still slides: inside the trips the stage covers a trip in no less than SHEET_MIN_MS (a long lag —
      // a hold letting go after a flick, a flick into the tab's own scroll — would otherwise cross one in a frame)
      const capped = stepTrip(S.hand, goal + lag, (dt * 1000) / SHEET_MIN_MS);
      if (capped !== goal + lag) lag = capped - goal;
      S.lag = lag;
      h = Math.max(0, goal + lag);
    }
    S.goal = goal;
    S.handAt = now;
    const moved = h !== S.hand;
    S.hand = h;
    // where the tab was in place, the sheet gone (QA; a jump: where the timeline has it)
    if (h < 2) S.tabFrom = -1;
    else if (S.tabFrom < 0) S.tabFrom = jumped ? t.scroll[0] : Math.max(t.scroll[0], S.p);
    setPhase(phaseAt(h));
    if (moved || force) placeSheet();
    const want = ctx.reduced ? goal : reel?.focused ? 1 : handOf(S.p);
    if (Math.abs(want - h) > 1e-6 || S.lag) handOff ??= ctx.ticker.subscribe(handTick);
    else stopHand();
  }
  /** A frame of the sheet's own travel (the scroll still): it moves, the beat follows, the reel turns under it. */
  function handTick() {
    const was = S.phase;
    moveHand(false);
    if (S.phase === 'battle' && was !== 'battle' && !S.manual && !S.playing) battleTo(S.p, true);
    underSheet();
    sheetWork(was);
  }
  /** What lies under a sheet on its way up is the make's end, filed (frame 80, the proof): a page that lands there (a
   *  goto, a restore, a jump) shows that, not wherever the footage was. */
  function underSheet() {
    if (S.phase !== 'reel' || S.hand >= 1 || S.manual || S.playing) return;
    const end = K().end;
    if (S.pf === null || Math.abs(S.pf - end) > 1e-6 || S.cut !== CUTS[CUTS.length - 1]) battleTo(S.p, true);
  }
  /** The tab's own scroll, d px of it: one px of the tab per px, on from the pace the tab arrived at, and an easy stop
   *  over TAB_STOP px where the tab ends (max). */
  function tabOwn(d, max) {
    const E = Math.min(TAB_STOP, max);
    const y = Math.max(0, d);
    return y <= max - E ? y : y >= max + E ? max : max - (max + E - y) ** 2 / (4 * E);
  }
  /** While the sheet is on screen its drum turns with the scroll (drawn only once it is up past the stage's edge), and
   *  once it is the stage's beat its field types with it, a letter as the scroll asks for one (on the way in, letters
   *  left from an earlier pass go at once: nobody watches them deleted). Before that, inert, it is only ever cleared for
   *  the spin — a sheet a flick brings up types "flip" in view, never off it; a sheet coming back down over the tab
   *  brings what the scroll has typed by then, already in place. (The tab's own scroll is the stage's: placeSheet.) */
  function sheetWork(was) {
    const t = L();
    const p = S.p;
    if (reel && S.hand > 0 && S.hand < 2) {
      const u = (p - t.type[0]) / (t.type[1] - t.type[0]);
      if (S.sheetY + (S.drumTop ?? 0) < S.stageH) reel.spin((p - t.spin[0]) / (t.spin[1] - t.spin[0]));
      if (S.phase === 'reel') reel.type(u, was !== 'reel');
      else if (u <= 0 || S.hand > 1) reel.type(clamp(u), true);
    }
  }
  const bodies = new Map();
  const bodiesOf = (li) => bodies.get(li) ?? bodies.set(li, [...li.querySelectorAll('.lib-beat__long, .lib-beat__short')]).get(li);
  const put = (el, prop, v) => {
    if (el[`lib$${prop}`] !== v) el.style[prop] = el[`lib$${prop}`] = v;
  };
  /** Where the stage is on the way in (0…1: the sheet rising over the player) and on the way out (0…1: the sheet going
   *  on up off the top, the tab rising behind it), and the tab's own scroll past that (px). */
  function legs(h = S.hand) {
    const tp = tripPx();
    // the tab arrives at the thumb's pace, where it goes on with it: its own scroll (C1 into tabOwn), or — where it
    // fits the stage, the way out ending at the pin's end (L) — the page carrying the whole stage on
    const m = S.tabD && tp && (S.shelfMax || L().off[1] >= 0.9999) ? Math.min(3, tp / S.tabD) : 0;
    return { in: ease(clamp(h)), out: leaveOf(h - 1, m), own: h > 2 && S.shelfMax ? tabOwn((h - 2) * tp, S.shelfMax) : 0 };
  }
  /** The hand-off on screen. Everything travels up as the scroll goes forward and comes back down as it goes back:
   *  - in: the sheet rises from below over the player; what it covers (the player, its toast, a phone's beat panel and
   *    the scrim over them) dims and drifts up PARALLAX of the stage, the player receding about its top edge;
   *  - out: the sheet carries on up off the top (a hard shadow on its foot as on its top edge); a phone's beat 03 panel
   *    rides up under its foot into place, and the tab rises behind it, its heading TAB_GAP px under the foot at first,
   *    so the heading is what the paper uncovers first; past the way out, the tab scrolls on with the thumb;
   *  - a desktop's column stays where it is: the copy on the sheet is held still (counter-moved), so the sheet's top
   *    edge inks it line by line on the way in and its foot gives it back to grip line by line on the way out, both
   *    sweeping up; the beats fold and open in between (placeBeats).
   *  Transform, opacity, clip-path and (the column's coming text) a mask only. */
  function placeSheet() {
    const h = S.hand;
    const hs = clamp(h, 0, 2);
    const moving = hs > 0 && hs < 2 && hs !== 1;
    const hd = hs > 0 && hs < 1 ? 'in' : hs > 1 && hs < 2 ? 'out' : '';
    if (hd !== (stage.dataset.hand ?? '')) {
      if (hd) stage.dataset.hand = hd;
      else delete stage.dataset.hand;
    }
    const g = legs(h);
    const T = S.stageH + SHEET_SHADOW;
    const y = hs <= 1 ? T * (1 - g.in) : -T * g.out;
    S.sheetY = y; // the sheet's top edge below the stage's top (the drum turns only once it is in view: sheetWork)
    put(reelEl, 'transform', moving ? `translate3d(0, ${y.toFixed(1)}px, 0)` : '');
    put(inkCol, 'transform', moving && S.mode === 'desk' ? `translate3d(0, ${(-y).toFixed(1)}px, 0)` : '');
    const comingIn = hs > 0 && hs < 1;
    const drift = comingIn ? PARALLAX * S.stageH * g.in : 0;
    put(scrim, 'opacity', comingIn ? (DIM * g.in).toFixed(3) : '0');
    // the scrim goes up with what it dims; the band it leaves at the stage's foot is under the sheet by then
    put(scrim, 'transform', drift > 0.05 ? `translate3d(0, ${(-drift).toFixed(1)}px, 0)` : '');
    const rise = hs > 1 && hs < 2 ? S.tabD * (1 - g.out) : 0;
    put(shelf, 'transform', rise > 0.05 ? `translate3d(0, ${rise.toFixed(1)}px, 0)` : '');
    const tf = g.own > 0.05 ? `translate3d(0, ${(-g.own).toFixed(1)}px, 0)` : '';
    if (tf !== S.shelfTf) shelfIn.style.transform = S.shelfTf = tf; // none where the tab fits the stage
    // a phone's grip panel (its beat changes under the sheet: placeBeats): beat 01 drifts up with the player as the
    // paper covers it; beat 03 comes up under the paper's foot
    let by = 0;
    if (S.mode === 'phone' && S.beatH) {
      if (comingIn) by = -drift;
      else if (hs > 1 && hs < 2) by = Math.max(0, S.beatH.c - T * g.out);
    }
    put(beats, 'transform', Math.abs(by) > 0.05 ? `translate3d(0, ${by.toFixed(1)}px, 0)` : '');
    placeRail();
    placeBeats();
  }
  /** The player: under the head while it slides off (phones); under the sheet coming in, drifting up and receding
   *  about its top edge (so no part of it moves down), its toast going with it. */
  function placeRail() {
    const ty = S.mode === 'phone' ? S.railStart * (1 - S.k) : 0;
    const k = S.hand > 0 && S.hand < 1 ? ease(S.hand) : 0;
    const s = 1 - RECEDE * k;
    const y = ty - PARALLAX * S.stageH * k;
    put(rail, 'transform', y || s !== 1 ? `translate3d(0, ${y.toFixed(1)}px, 0)${s !== 1 ? ` scale(${s.toFixed(4)})` : ''}` : '');
    // the toast as a point of the player: its middle where the player's transform takes it, the toast scaled with it
    const [dx, dy] = S.toastRel ?? [0, 0];
    put(toast, 'transform', k ? `translate3d(${(-dx * RECEDE * k).toFixed(1)}px, ${(-PARALLAX * S.stageH * k - dy * RECEDE * k).toFixed(1)}px, 0) scale(${s.toFixed(4)})` : '');
  }
  /**
   * The words follow the hand-off. Phones: one beat at a time; the grip panel's beat changes under the sheet — 01 → 02
   * at the midpoint of the way in (the paper covers the panel early), 02 → 03 as soon as the sheet starts out (its foot
   * uncovers the panel first) — and the sheet brings beat 02 up at its foot and takes it on up and away. Desktops: the
   * column's beats fold and open as the sheet passes them (MORPH of the trip) — 01 folds to its short line as 02 opens,
   * then 02 as 03 does — the same on the grip column and on its copy on the sheet, so the edge only re-inks them. One
   * layout, at the midpoint (the classes); the motion is transforms (the beats' places), clip-path (the text's room),
   * a mask (the coming text's soft edge) and opacity (the long text going, the new one coming): the leaving text is
   * gone before the swap, the new one comes after it. Nothing in the column moves down as the scroll goes forward: a
   * beat the new layout puts lower (by more than LOWER_PX) leaves rising and comes back up into its place, the leaving
   * text loses whole lines from the bottom, and the coming one rises into view with its lead, through a soft edge
   * fixed at its own new bottom (no line is ever cut through its letters).
   */
  function placeBeats() {
    const h = S.hand;
    const [from, to, u] = h <= 1 ? ['a', 'b', clamp(h)] : ['b', 'c', clamp(h - 1)];
    const G = S.mode === 'desk' && !ctx.reduced ? S.beatGeo : null;
    const m = G ? clamp((u - MORPH[0]) / (MORPH[1] - MORPH[0])) : h > 1 && S.mode === 'phone' ? 1 : u < 0.5 ? 0 : 1;
    const key = m < 0.5 ? from : to;
    if (key !== S.beatKey) {
      S.beatKey = key;
      const lit = { a: 1, b: 2, c: 3 }[key];
      for (const els of S.mode === 'desk' ? [beatEls, inkBeats] : [beatEls]) {
        els.forEach((li, j) => {
          li.classList.toggle('is-on', li.dataset.beat === key);
          li.classList.toggle('is-lit', j < lit);
        });
      }
    }
    const sm = (x) => ease(clamp(x));
    const e = sm((m - 0.2) / 0.8); // the beats' places and the text's room: they start moving once the fade is under way
    const live = Boolean(G) && m > 0 && m < 1;
    for (let i = 0; i < beatEls.length; i++) {
      let ty = 0;
      let op = '';
      let bop = '';
      let clip = '';
      let mask = '';
      let form = '';
      if (live) {
        const A = G[from][i];
        const B = G[to][i];
        const D = G[key][i];
        form = D.form;
        if (A.vis && B.vis) {
          const leaving = key === from;
          if (B.top - A.top > LOWER_PX) {
            // the new layout puts this beat lower (03 as a longer 02 opens above it): it never slides down — it leaves
            // rising and fading, and comes back up into its new place (as a phone on its side changes beats)
            op = (leaving ? 1 - sm(m / 0.5) : sm((m - 0.5) / 0.5)).toFixed(3);
            ty = leaving ? -10 * sm(m / 0.5) : 10 * (1 - sm((m - 0.5) / 0.5));
          } else ty = mix(A.top, B.top, e) - D.top;
          if (A.form !== B.form) {
            bop = (leaving ? 1 - sm((m - 0.05) / 0.45) : sm((m - 0.5) / 0.3)).toFixed(3);
            if (leaving) {
              // the room under the lead shrinks to the other text's height: the leaving text keeps the whole lines
              // that fit in it (a line shows, or it does not), so it loses its last lines from the bottom, the edge
              // only rising, fading out up to the swap
              const room = mix(A.body, B.body, e);
              const shown = Math.min(D.body, Math.floor(Math.min(room, D.body) / D.lh + 0.1) * D.lh);
              if (D.body - shown > 0.5) clip = `inset(0 0 ${(D.body - shown).toFixed(1)}px 0)`;
            } else {
              // the coming text rides up with its lead, fading in from the swap, under an edge that stays put at its
              // own bottom in the new layout: its lines come up into view from below, the edge never moving down. The
              // edge is soft (EDGE_FADE of a line above it fades to nothing), so a line coming up through it is never
              // cut through its letters, at any p: a scroll that stops mid-morph leaves it half risen out of the
              // grip, not sliced; and the text stays fainter while most of a line is still under the edge
              const over = Math.max(0, mix(A.top, B.top, e) - B.top);
              if (over > 0.5) {
                const o = Math.min(D.body, over);
                clip = `inset(0 0 ${o.toFixed(1)}px 0)`;
                mask = `linear-gradient(#000 calc(100% - ${(o + EDGE_FADE * D.lh).toFixed(1)}px), transparent calc(100% - ${o.toFixed(1)}px))`;
              }
              bop = (+bop * clamp(1.5 - over / D.lh)).toFixed(3);
            }
          }
        } else if (A.vis || B.vis) {
          // one beat at a time (a phone on its side): the open one slides up and out, the next slides up into place
          const leaving = A.vis;
          op = (leaving ? 1 - sm(m / 0.5) : sm((m - 0.5) / 0.5)).toFixed(3);
          ty = leaving ? -10 * sm(m / 0.5) : 10 * (1 - sm((m - 0.5) / 0.5));
        }
      }
      const tf = Math.abs(ty) > 0.05 ? `translate3d(0, ${ty.toFixed(1)}px, 0)` : '';
      // the grip column and its copy on the sheet move as one (a phone's copy is the sheet's own panel: left alone)
      for (const li of [beatEls[i], inkBeats[i]]) {
        const on = li === beatEls[i] || S.mode === 'desk';
        put(li, 'transform', on ? tf : '');
        put(li, 'opacity', on ? op : '');
        for (const b of bodiesOf(li)) {
          const mine = on && b.classList.contains(form === 'long' ? 'lib-beat__long' : 'lib-beat__short');
          put(b, 'opacity', mine ? bop : '');
          put(b, 'clipPath', mine ? clip : '');
          put(b, 'maskImage', mine ? mask : '');
          put(b, 'webkitMaskImage', mine ? mask : '');
        }
      }
    }
    // the honesty line (desktops): the column's foot, pushed lower where the new state's beats overflow it (1440 × 700:
    // 19 px as 03 opens) — like a beat, it never slides down: it leaves rising and comes back up into its place
    if (S.mode === 'desk') {
      const HG = live ? S.honestGeo : null;
      let hy = 0;
      let hop = '';
      if (HG) {
        const [A, B, D] = [HG[from], HG[to], HG[key]];
        if (B - A > LOWER_PX) {
          const leaving = key === from;
          hop = (leaving ? 1 - sm(m / 0.5) : sm((m - 0.5) / 0.5)).toFixed(3);
          hy = leaving ? -10 * sm(m / 0.5) : 10 * (1 - sm((m - 0.5) / 0.5));
        } else hy = mix(A, B, e) - D;
      }
      const tf = Math.abs(hy) > 0.05 ? `translate3d(0, ${hy.toFixed(1)}px, 0)` : '';
      for (const el of [honest, inkHonest]) {
        if (el.style.transform !== tf) el.style.transform = tf;
        if (el.style.opacity !== hop) el.style.opacity = hop;
      }
    }
  }
  function setPhase(phase) {
    if (phase === S.phase) return;
    const prev = S.phase;
    S.phase = phase;
    stage.dataset.phase = phase;
    if (phase !== 'battle') {
      stopPlay();
      stopChase();
      S.leftAt = 0;
    }
    // a keyboard visitor in the player when the stage moves on (a page key, a wheel): focus goes to the stage, not to
    // <body> — the next Tab is the new beat's first control
    const refocus = phase !== 'battle' && rail.contains(document.activeElement);
    rail.inert = phase !== 'battle';
    reelEl.inert = phase !== 'reel';
    shelf.inert = phase !== 'shelf';
    kbBack.tabIndex = phase === 'shelf' ? 0 : -1; // the way back in from the next section (the tab has no controls)
    if (refocus) {
      stage.tabIndex = -1;
      stage.focus({ preventScroll: true });
    }
    if (phase === 'shelf') {
      if (prev === 'reel' && !S.filed && !ctx.reduced && !S.resting) replayBattle(); // never off screen (leave)
    } else stopReplay();
    hand.classList.remove('is-on');
    S.handOn = false;
  }

  // ------------------------------------------------------------ the battle: the scroll's frame, and the one on screen
  const K = () => S.knots ?? (S.knots = battleKnots(S.mode));
  /** The plan's sample under p, fractional: 0 is cut a's f0, K().n the make's f1 (cut i's run from K().at[i]). */
  function lineAt(p) {
    const { ps, n } = K();
    if (!(p > 0)) return 0;
    if (p >= ps[n]) return n;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ps[mid] <= p) lo = mid;
      else hi = mid;
    }
    return lo + (p - ps[lo]) / (ps[lo + 1] - ps[lo] || 1);
  }
  /** Where p puts the battle: the cut and its frame, fractional (clip time (a − 1) / 30). Reduced motion: the telling
   *  frames only — each cut's, and the make's touchdown in the second half of its stretch. */
  function battleTarget(p) {
    const { at, keys } = K();
    const x = lineAt(p);
    let i = at.length - 1;
    while (i > 0 && x < at[i]) i--;
    const c = CUTS[i];
    if (ctx.reduced) return [i, c.key === 'c' && p >= (keys.c + keys.land) / 2 ? c.landFrame : c.keyFrame];
    return [i, Math.min(c.f1, c.f0 + (x - at[i]) / SUB)];
  }
  /** The footage at S.pf: its cut, the board at that exact clip time. */
  function renderBattle() {
    const [i, a] = battleTarget(S.pf);
    setCut(CUTS[i], S.dir > 0);
    showAt(timeOf(a));
  }
  /** The scroll is at rest: calm for CALM_MS, or just landed by a jump. A forced redraw mid-scroll (a phone's toolbar
   *  resizing the window) is not a rest. */
  const resting = (now) => S.landed || now - S.stirAt >= CALM_MS;
  /** Where the footage is heading: the scroll's p (the battle's end once the scroll is past it); with the scroll at
   *  rest within MAGNET frames of a telling frame or the touchdown, that frame exactly (and part of the way to it
   *  near the zone's edge: pullOf). */
  function goalOf(now) {
    const { end, zones } = K();
    const p = Math.min(S.p, end);
    if (S.p < end && resting(now)) {
      for (const z of zones) {
        const k = pullOf(z, p);
        if (k > 0) return p + (z.p - p) * k;
      }
    }
    return p;
  }
  const inZone = (p) => p < K().end && K().zones.some((z) => pullOf(z, p) > 0);
  let chaseOff = null;
  function startChase() {
    chaseOff ??= ctx.ticker.subscribe(chase);
  }
  function stopChase() {
    chaseOff?.();
    chaseOff = null;
  }
  /** The footage has caught up: if the scroll has gone on meanwhile, the stage follows it now, thumb moving or not
   *  (and a reel with nothing left to type — typed on an earlier pass — hands on to where the scroll is). */
  function release() {
    if (S.phase !== 'battle' || phaseOf(S.p) === 'battle') return;
    update(S.p, true);
    if (S.phase === 'reel' && phaseOf(S.p) !== 'reel') update(S.p, true);
  }
  /** Every frame while the footage is not where the scroll wants it: a critically damped follow (Unity's SmoothDamp,
   *  exact for any frame time, never past its goal), the board drawn at the exact clip time. Once there it stops —
   *  after the magnet has had its say (the thumb at rest in a slow zone) — and, with the scroll past the battle, gives
   *  the stage to where the scroll is (release; the hand-off's own hold, battleTold, reads S.pf and the proof). */
  function chase(dt, now) {
    if (S.phase !== 'battle' || S.manual || S.playing) return stopChase();
    const goal = goalOf(now);
    const h = Math.min(0.05, dt / 1000);
    const w = 2 / (coarseMQ.matches ? FOLLOW_S.coarse : FOLLOW_S.fine);
    const x = w * h;
    const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const off = S.pf - goal;
    const tmp = (S.vf + w * off) * h;
    S.vf = (S.vf - w * tmp) * e;
    let next = goal + (off + tmp) * e;
    if ((off < 0 && next > goal) || (off > 0 && next < goal) || Math.abs(next - goal) < 1.5e-4) {
      next = goal;
      S.vf = 0;
    }
    if (next !== S.pf) {
      S.dir = next > S.pf ? 1 : -1;
      S.pf = next;
      renderBattle();
    }
    if (next !== goal) return;
    if (!resting(now) && inZone(S.p)) return; // the magnet has not had its say yet
    stopChase();
    release();
  }
  /** The scroll's p for the battle: the footage jumps there (a jump, a goto, reduced motion, coming back from the
   *  reel, the top of the pin — a slow zone's frame when the page has landed in one) or follows it (chase). A forced
   *  update while the footage is on its way (a phone's toolbar resizing the window mid-scroll) does not cut it short. */
  function battleTo(p, snap) {
    const now = performance.now();
    if (p !== S.pT) {
      const gap = now - S.movedAt;
      S.landed = Math.abs(p - S.pT) > 0.05 && (snap || gap > 160); // a jump (a flick is no rest)
      // the scroll's speed in px a 60 Hz frame (the first move after a pause counts as a fast one): at rest, it takes
      // more to stir it than to keep it stirring (CALM_PX)
      const r = ctx.scroll.rangeOf(ctx.id);
      const px = Math.abs(p - S.pT) * (r ? r.end - r.start : 1500);
      if ((px * 16.7) / Math.min(50, Math.max(8, gap)) >= CALM_PX[now - S.stirAt >= CALM_MS ? 1 : 0]) S.stirAt = now;
      S.pT = p;
      S.movedAt = now;
    }
    if (snap && chaseOff && !S.landed && !ctx.reduced && p > 0) snap = false;
    if (snap || S.pf === null) {
      const goal = goalOf(now);
      S.dir = S.pf === null || goal >= S.pf ? 1 : -1;
      S.pf = goal;
      S.vf = 0;
      stopChase();
      renderBattle();
      // a thumb that stops right here, in a slow zone, still gets the magnet
      if (!ctx.reduced && !resting(now) && inZone(p)) startChase();
    } else startChase(); // it stops by itself once there (past the battle: after the proof's moment, then release)
  }

  /** rest: the page has left the section (leave) or QA settles it — the stage goes straight to where the scroll is,
   *  like a jump. */
  function update(p, force = false, rest = false) {
    p = clamp(p);
    const t = L();
    const moved = Math.abs(p - S.p);
    const now = performance.now();
    // a jump (goto, a link, a restore) moves p a long way in one frame after a pause; a scroll never does
    const jumped = rest || (moved > 0.05 && now - S.lastAt > 160);
    S.lastAt = now;
    S.p = p;
    if ((S.manual || S.playing) && Math.abs(p - S.manualP) > 0.015) {
      // the scroll takes over again from the frame the visitor left the footage on
      stopPlay();
      S.manual = false;
      if (S.cut) {
        S.pf = K().pOf(CUTS.indexOf(S.cut), S.frame);
        S.vf = 0;
      }
    }
    const was = S.phase;
    // the sheet, and with it the beat on the stage (the beats light as the stage gets to them: a held reel keeps 03 dark)
    moveHand(jumped, force, now);

    // the head slides off as the player comes up (phones)
    const k = t.head ? (ctx.reduced ? (p < t.head * 0.5 ? 0 : 1) : smoothstep(0, t.head, p)) : 1;
    if (force || k !== S.k) {
      S.k = k;
      if (S.mode === 'phone') {
        const hy = (-S.headBottom * k).toFixed(1);
        head.style.transform = `translate3d(0, ${hy}px, 0)`;
        honest.style.transform = `translate3d(0, ${hy}px, 0)`;
        // the beat panel waits under the player until the head is off: out of sight and out of the way, but still
        // read by a screen reader (never visibility: hidden)
        beats.style.opacity = k < 0.999 ? '0' : '';
        beats.style.pointerEvents = k < 0.999 ? 'none' : '';
      } else {
        head.style.transform = ''; // the honesty line's is placeBeats' on a desktop (it ran just before)
        beats.style.opacity = beats.style.pointerEvents = '';
      }
      placeRail();
    }

    // the top of the pin is a resting place too (a swipe up out of the section): the story is back at its start there,
    // never played backwards on the way down again
    if (S.phase === 'battle' && !S.manual && !S.playing) battleTo(p, force || jumped || ctx.reduced || was !== 'battle' || p === 0);
    underSheet();

    // the spin is scrubbed; the typing asks for letters of "flip" and the reel types them as it asks
    sheetWork(was);
    if (moved > 0 && S.phase !== 'battle') {
      hand.classList.remove('is-on');
      S.handOn = false;
    }
  }

  // ------------------------------------------------------------ by hand: play, step, speed, drag, keys
  let raf = 0;
  let last = 0;
  let playT = 0;
  function playRangeFrames() {
    const c = S.cut;
    const fa = Math.max(1, Math.floor((c.off + c.m.tPop - 0.4) * FPS) + 1);
    const fb = Math.min(c.frames, Math.floor((c.off + Math.min(c.m.duration, c.m.tLand + 0.7)) * FPS) + 1);
    return [fa, fb];
  }
  function tick(now) {
    raf = 0;
    if (!S.playing) return;
    const dt = last ? Math.min(100, now - last) : 16.7;
    last = now;
    const [fa, fb] = playRangeFrames();
    playT += (dt / 1000) * S.speed;
    if (playT > timeOf(fb)) playT = timeOf(fa);
    showAt(playT, true);
    raf = requestAnimationFrame(tick);
  }
  function startPlay() {
    if (S.playing || S.phase !== 'battle') return;
    S.playing = true;
    S.manualP = S.p;
    const [fa, fb] = playRangeFrames();
    playT = S.frame >= fb ? timeOf(fa) : timeOf(Math.max(fa, S.frame));
    playBtn.setAttribute('aria-pressed', 'true'); // a toggle: the label stays "Play", pressed says it is playing
    last = 0;
    raf = requestAnimationFrame(tick);
  }
  function stopPlay() {
    if (!S.playing) return;
    S.playing = false;
    S.manual = true;
    cancelAnimationFrame(raf);
    raf = 0;
    playBtn.setAttribute('aria-pressed', 'false');
    if (S.cut) showFrame(S.frame);
  }
  const togglePlay = () => (S.playing ? stopPlay() : startPlay());
  playBtn.addEventListener('click', togglePlay);
  // the tap on the footage is the pointer's way to play; the keyboard's is the play button (one tab stop, not two)
  const tapEl = $('[data-tap]', root);
  tapEl.tabIndex = -1;
  tapEl.addEventListener('click', togglePlay);

  const toManual = () => {
    stopPlay();
    S.manual = true;
    S.manualP = S.p;
  };
  const step = (d) => {
    toManual();
    showFrame(S.frame + d);
    ctx.sound.play('tick', { volume: 0.35 });
  };
  let repeat = 0;
  const stopRepeat = () => {
    clearTimeout(repeat);
    clearInterval(repeat);
  };
  for (const b of $$('[data-step]', root)) {
    const d = Number(b.dataset.step);
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      step(d);
      stopRepeat();
      repeat = setTimeout(() => (repeat = setInterval(() => step(d), 125)), 350); // the app: 8 frames a second
    });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, stopRepeat);
    b.addEventListener('click', (e) => e.detail === 0 && step(d)); // keyboard
  }
  // the speed switch is a radio group: one tab stop (the checked one), the arrows move the check and the focus and
  // wrap at the ends. Without the script its buttons are disabled (they would do nothing): enabled here
  const speeds = $$('[data-speed]', root);
  function setSpeed(b, focus = false) {
    S.speed = Number(b.dataset.speed);
    for (const o of speeds) {
      o.setAttribute('aria-checked', String(o === b));
      o.tabIndex = o === b ? 0 : -1;
    }
    speedTape.textContent = `${b.dataset.speed}×`;
    speedTape.hidden = S.speed === 1;
    if (focus) b.focus();
  }
  for (const b of speeds) {
    b.disabled = false;
    b.tabIndex = b.getAttribute('aria-checked') === 'true' ? 0 : -1;
    b.addEventListener('click', () => setSpeed(b));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      setSpeed(speeds[(speeds.indexOf(b) + d + speeds.length) % speeds.length], true);
    });
  }
  let lastTick = 0;
  function scrubTo(clientX) {
    const r = scrub.getBoundingClientRect();
    toManual();
    const before = S.frame;
    showFrame(clamp((clientX - r.left) / r.width) * S.cut.frames + 1);
    const now = performance.now();
    if (S.frame !== before && now - lastTick > 33) {
      lastTick = now; // the app's haptic tick per frame, at most 30 a second
      ctx.sound.play('tick', { volume: 0.25 });
    }
  }
  scrub.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    scrub.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
    const move = (ev) => scrubTo(ev.clientX);
    const up = () => {
      scrub.removeEventListener('pointermove', move);
      scrub.removeEventListener('pointerup', up);
      scrub.removeEventListener('pointercancel', up);
    };
    scrub.addEventListener('pointermove', move);
    scrub.addEventListener('pointerup', up);
    scrub.addEventListener('pointercancel', up);
  });
  // the slider's keys: a frame per arrow, ten per page key, the ends on Home / End; Space and Enter play, as the app's
  // tap does. None of them scrolls the page (a page key would carry the stage off the player and drop the focus)
  scrub.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!e.repeat) togglePlay();
      return;
    }
    const d = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
    if (!d && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    if (d) step(d);
    else {
      toManual();
      showFrame(e.key === 'Home' ? 1 : S.cut.frames);
    }
  });
  // A keyboard visitor tabbing into the player before the head has slid off (phones, the top of the pin): the
  // browser would scroll the control into view and carry the page to the second cut. The page goes to the bail
  // instead (its slow zone, after the head is off): the whole player on screen at the first cut, on its telling frame.
  rail.addEventListener('focusin', (e) => {
    if (S.mode !== 'phone' || S.k >= 0.999 || !e.target.matches?.(':focus-visible')) return;
    const r = ctx.scroll.rangeOf('library');
    if (!r || !(r.end > r.start)) return;
    const y = Math.ceil(r.start + Math.max(L().head, K().keys.a) * (r.end - r.start));
    const go = () => window.scrollTo(0, y);
    go();
    requestAnimationFrame(go); // after the browser's own scroll into view, wherever it lands in the frame
  });
  // The reel and the tab are inert until the stage gets to them, so the browser's Tab from the player's last control
  // (the speed switch) would skip the live search and land in the next section. Tab there goes to the reel's field
  // instead: the page jumps to where the typing starts (the spin at rest, nothing typed yet) — a jump, so the sheet is
  // up at once, no slide — and the field takes the focus, which stops the scroll's own typing (library-reel.js, focus): what the visitor
  // types stays theirs. Shift+Tab from the field goes back to the speed switch where the visitor left the player; Tab
  // from the field goes on to the next section, as before (the tab has no controls).
  const field = $('[data-q]', reelEl);
  let kbFrom = null; // the battle's p the visitor tabbed out of
  const kbPlain = (e) => e.key === 'Tab' && !e.altKey && !e.ctrlKey && !e.metaKey;
  /** The page to p of the pin and the stage with it at once (a jump: no chase, no hold). */
  function jumpTo(p) {
    const r = ctx.scroll.rangeOf('library');
    if (!r || !(r.end > r.start)) return false;
    const y = Math.round(r.start + clamp(p) * (r.end - r.start));
    window.scrollTo(0, y);
    update((y - r.start) / (r.end - r.start), false, true);
    return true;
  }
  $('.lib-speed', root).addEventListener('keydown', (e) => {
    if (!kbPlain(e) || e.shiftKey || !reel || S.phase !== 'battle') return;
    const t = L();
    const from = S.p;
    if (!jumpTo((t.spin[1] + t.type[0]) / 2) || S.phase !== 'reel') return; // between the spin's rest and "f"
    e.preventDefault();
    kbFrom = from;
    field.focus({ preventScroll: true });
  });
  field.addEventListener('keydown', (e) => {
    if (!kbPlain(e) || !e.shiftKey) return;
    // where the visitor left the player; else the make's touchdown, the battle's last slow zone
    const back = kbFrom !== null && kbFrom < L().reel ? kbFrom : K().keys.land;
    e.preventDefault();
    field.blur(); // first: the reel holds the stage while the field has the focus (left empty, it goes back to the scroll)
    if (!jumpTo(back) || S.phase !== 'battle') return;
    speeds.find((b) => b.tabIndex === 0)?.focus({ preventScroll: true });
  });
  // Shift+Tab into the section from the next one lands on kbBack (the tab showing): the page goes to the typing, as
  // the forward Tab does, and the field takes the focus; from there Shift+Tab goes on back to the player
  kbBack.addEventListener('focus', () => {
    if (!reel || S.phase !== 'shelf') return;
    const t = L();
    const at = (t.spin[1] + t.type[0]) / 2;
    if (!jumpTo(at) || S.phase !== 'reel') return;
    field.focus({ preventScroll: true });
    requestAnimationFrame(() => document.activeElement === field && jumpTo(at)); // after the browser's own scroll into view
  });

  // ------------------------------------------------------------ tiles: one still each, drawn once per size
  const stillCache = new Map();
  const dprNow = () => Math.min(2, window.devicePixelRatio || 1);
  /** A tile's canvas size (its box minus the 1.5 px border): the strip and the tab may differ (desktop). */
  function tileSize(el) {
    const cs = getComputedStyle(el);
    const w = parseFloat(cs.getPropertyValue('--tw')) || 83; // registered (@property): px; else the app's 83 × 110
    const h = parseFloat(cs.getPropertyValue('--th')) || (w * 110) / 83;
    return [Math.max(1, Math.round(w - 3)), Math.max(1, Math.round(h - 3))];
  }
  function still(id, w, h, dpr) {
    const key = `${id}:${w}x${h}@${dpr}`;
    let img = stillCache.get(key);
    if (!img) {
      img = document.createElement('canvas');
      img.width = Math.round(w * dpr);
      img.height = Math.round(h * dpr);
      const g = img.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawStill(g, w, h, CLIPS[id], dpr);
      stillCache.set(key, img);
    }
    return img;
  }
  function blit(canvas, img) {
    if (canvas.width !== img.width || canvas.height !== img.height) {
      canvas.width = img.width;
      canvas.height = img.height;
    }
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(img, 0, 0);
  }
  /** The pictures nobody sees yet, one per idle moment (never a chain of tasks while the visitor scrolls the section
   *  above): the first cut's tile, the other cuts' scrubber strips, every other tile's still (Kickflip's strip first),
   *  then the framing of the five Kickflip tiles' replays, measured ahead so a replay only draws. A newer paint (a
   *  resize that changed the sizes) takes over from an older one. */
  let paintGen = 0;
  async function paintTiles() {
    const gen = ++paintGen;
    const dpr = dprNow();
    const sizes = [stripTiles, shelfTiles].map((map) => tileSize(map.values().next().value));
    S.tileSizes = { strip: sizes[0], shelf: sizes[1] };
    const ids = Object.keys(CLIPS);
    const jobs = [[0, 'k-1409'], ...CUTS.map((c) => ['strip', c]), ...ids.filter((id) => stripTiles.has(id)).map((id) => [0, id]), ...ids.map((id) => [1, id])];
    for (const [i, id] of jobs) {
      await idle();
      if (gen !== paintGen) return;
      if (i === 'strip') {
        stripImage(id);
        continue;
      }
      const el = (i ? shelfTiles : stripTiles).get(id);
      if (!el || (i && replay.id === id) || el.dataset.painted === `${sizes[i]}@${dpr}`) continue;
      blit($('canvas', el), still(id, ...sizes[i], dpr));
      el.dataset.painted = `${sizes[i]}@${dpr}`;
    }
    for (const id of BATTLE_ORDER) {
      await idle();
      if (gen !== paintGen) return;
      tileFrame(CLIPS[id], ...sizes[1], true);
    }
  }
  /** What the strips and the tiles are drawn for: their widths, heights and the pixel ratio (not the window's height). */
  const sizesKey = () => {
    const tiles = [stripTiles, shelfTiles].map((map) => tileSize(map.values().next().value).join('x'));
    return `${Math.round(stripCv.clientWidth)}x${Math.round(stripCv.clientHeight)}|${tiles.join('|')}@${dprNow()}`;
  };

  // ------------------------------------------------------------ the filed tab replays the battle once
  const replay = { id: null, i: 0, t: 0, off: null };
  function replayBattle() {
    S.filed = true;
    replay.i = 0;
    startTile();
  }
  function startTile() {
    const id = BATTLE_ORDER[replay.i];
    if (!id) return stopReplay();
    replay.id = id;
    const [a] = playRange(CLIPS[id]);
    replay.t = a;
    shelfTiles.get(id).classList.add('is-playing');
    replay.off ??= ctx.ticker.subscribe(frameTile);
  }
  function frameTile(dt) {
    const id = replay.id;
    if (!id) return;
    const clip = CLIPS[id];
    const [, b] = playRange(clip);
    replay.t += dt / 1000;
    const el = shelfTiles.get(id);
    const canvas = $('canvas', el);
    const [w, h] = S.tileSizes?.shelf ?? tileSize(el); // measured with the layout, never read mid-frame
    const dpr = dprNow();
    if (replay.t >= b) {
      el.classList.remove('is-playing');
      blit(canvas, still(id, w, h, dpr));
      replay.i++;
      replay.id = null;
      if (replay.i < BATTLE_ORDER.length) setTimeout(() => S.phase === 'shelf' && replay.off && startTile(), 140);
      else stopReplay();
      return;
    }
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTileFrame(g, w, h, clip, replay.t, dpr);
  }
  function stopReplay() {
    replay.off?.();
    replay.off = null;
    if (replay.id) {
      const el = shelfTiles.get(replay.id);
      el.classList.remove('is-playing');
      const [w, h] = S.tileSizes?.shelf ?? tileSize(el);
      blit($('canvas', el), still(replay.id, w, h, dprNow()));
      replay.id = null;
    }
  }

  // ------------------------------------------------------------ build: what the first frame needs, a step per frame
  // (measure, the first cut and its strip); the rest — the reel, the other strips, the tiles — after init has
  // returned, at idle, a picture at a time (paintTiles)
  measure();
  await nextFrame();
  stripImage(CUTS[0]); // the first cut's 12 frames, then the cut itself (it only copies them)
  await nextFrame();
  setCut(CUTS[0], false);
  S.sizeKey = sizesKey();
  await nextFrame();
  let reel = null;
  const reelReady = ctx
    .data('library')
    .then(async (data) => {
      await nextFrame();
      // onSettled: the scroll's "flip" has paid off; if the scroll has gone on to the tab meanwhile, the sheet goes now.
      // onLive: the reel speaks only while the stage is on screen and the scroll is still on the reel (not for a reel a
      // page key or a fling only passed through on the way to the tab); what the visitor typed is always said
      const reelSays = (text) => stageInView() && (reel.userQuery !== null || handOf(S.p) < 1.5) && say(text);
      reel = createReel(reelEl, { data, ctx, onLive: reelSays, onSettled: () => update(S.p, true) });
      await nextFrame();
      reel.resize(); // laid out (hidden, below the stage) from the start: the sheet only brings it up
      measureDrum();
      if (S.hand > 0 && S.hand < 2) update(S.p, true);
    })
    .catch((error) => console.error('[library] the reel has no data', error));
  paintTiles();
  void reelReady;
  // the note is set in Caveat: place it with the real font's width
  document.fonts?.load(`700 28px ${getComputedStyle(hand.querySelector('.t-hand')).fontFamily}`).then(
    () => {
      const note = hand.querySelector('.t-hand');
      S.note = [note.offsetWidth, note.offsetHeight];
      S.handOn = false;
    },
    () => {},
  );
  // the beats' places in each state, with the real fonts (the column's beats fold and open by them)
  document.fonts?.ready.then(() => {
    if (S.mode !== 'desk') return;
    measureBeats();
    if (S.hand >= 0) placeSheet();
  });

  // ------------------------------------------------------------ resize, reduced motion
  let rsz = 0;
  const onResize = () => {
    cancelAnimationFrame(rsz);
    rsz = requestAnimationFrame(() => {
      if (!measure()) return;
      S.handOn = false;
      S.drawn = '';
      S.stripBox = null; // the strip's size, read again (stripImage)
      // the strips and the tiles depend on their own sizes and the pixel ratio only: a height-only resize (a phone's
      // toolbar coming and going, every change of scroll direction in Safari) keeps every picture
      const key = sizesKey();
      if (key !== S.sizeKey) {
        S.sizeKey = key;
        stripCache.clear();
        stillCache.clear();
        paintStrip();
        paintTiles();
      }
      reel?.resize();
      measureDrum();
      update(S.p, true);
    });
  };
  window.addEventListener('resize', onResize, { passive: true });
  ctx.onReducedChange(() => update(S.p, true));

  return {
    progress(p) {
      update(p, S.p < 0);
    },
    enter() {},
    leave() {
      stopPlay();
      stopChase();
      // the page has left the section: the stage rests where the scroll is (0 or 1) — the beat its p says, the
      // footage on its frame, nothing left half-told (a flick out of the top would otherwise come back to a story
      // that plays backwards). Nothing keeps running off screen, the tab's replay included
      if (S.p >= 0) {
        S.resting = true;
        update(S.p, false, true);
        S.resting = false;
      }
      stopReplay();
      stopChase();
      stopHand();
      clearTicks();
    },
    qa: {
      state: () => ({
        p: S.p,
        phase: S.phase,
        hand: +Math.min(2, S.hand).toFixed(4), // 0 the battle · 1 the sheet all the way up · 2 the tab; between, the sheet on its way
        run: +S.hand.toFixed(4), // the same, going on past 2 as the tab's own scroll (trips of the way out)
        cut: S.cut?.key,
        frame: S.frame,
        mode: S.mode,
        geo: S.geo,
        filed: S.filed,
        proof: S.proof,
        chasing: !!chaseOff,
        behind: S.pf === null ? 0 : +((lineAt(goalOf(performance.now())) - lineAt(S.pf)) / SUB).toFixed(2), // frames the footage trails the scroll
        date: S.dateFit ?? null,
        t: +S.drawnT.toFixed(5), // the clip time on screen (s): between two frames while it moves
        pf: S.pf, // where the footage is on the battle's line (p)
        drawMs: +(view.drawMs ?? 0).toFixed(2), // the footage's last draw
        want: +Math.min(2, handOf(S.p)).toFixed(4), // where the scroll alone puts the sheet (hand is where it is: a hold, a catch-up)
        wantRun: +handOf(S.p).toFixed(4), // the same past 2 (run's goal)
        tab: S.shelfTf ? +S.shelfTf.match(/-?[\d.]+(?=px, 0\))/)[0] : 0, // the tab's own scroll (px, ≤ 0)
        tabRise: S.hand > 1 && S.hand < 2 ? +(S.tabD * (1 - legs().out)).toFixed(1) : 0, // the tab on its way up into place (px below it)
        tabFrom: S.tabFrom, // the p where the tab was in place, the sheet gone
        busy: reel?.busy() ?? false, // the reel's typing has not paid off yet
        reel: reel?.qa() ?? null, // the reel: { query, n, top, settled, anchor, pos (the drum, in rows: < 0 results still running up), busy }
      }),
      /** the battle's plan: p of each telling frame (a, b, c) and of the make's touchdown (land), and the battle's end */
      keys: () => ({ ...K().keys, end: K().end }),
      /** the timeline in p (TL for this layout): up, spin, type, off, scroll, reel, head; `down` repeats `off` for
       *  older scripts (the sheet's second trip used to slide down) */
      timeline: () => ({ ...JSON.parse(JSON.stringify(L())), down: [...L().off] }),
      /** the cut on screen at frame n (1-based), as the visitor would step to it */
      frame(n) {
        toManual();
        showFrame(n);
        return { frame: frameEl.textContent, time: curEl.textContent };
      },
      /** the footage straight to where the scroll wants it (no chase, no hold; at rest, so a slow zone's frame exactly):
       *  what a picture after a goto needs */
      settle() {
        S.landed = true;
        if (S.p >= 0) update(S.p, false, true); // as a jump: no chase, no hold, the beat the scroll is on
        return { cut: S.cut?.key, frame: S.frame, proof: S.proof };
      },
    },
  };
}
