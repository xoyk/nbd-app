// A drawn skateboard doing real tricks: a 3D board (popsicle deck with kicked nose and tail, griptape, a paper bottom
// with the NBD. wordmark, trucks, wheels) rendered on a 2D canvas, painter's algorithm, mild perspective. The site's
// stand-in for clip footage: no people, no real video, the board alone tells the trick — a trick-tip sequence in
// ink, paper and grip, brought to life. No dependencies.
//
//   import { createBoardView, drawBoardFrame, drawBoardStrip, listTricks, getMotion, measureBoardFrame } from './js/lib/board.js';
//
//   const view = createBoardView(canvas, { trick: 'kickflip', look: 'night', trail: 4, speed: 0.5 });
//   view.play(); view.pause(); view.toggle(); view.seek(0.4); view.frame(3, 12); view.setTrick('360-flip');
//   view.set({ look: 'paper', trail: 0 }); view.resize(); view.render(); view.destroy();
//   view.t (0…1) · view.playing · view.visible · view.reduced · view.motion · view.duration (s) · view.drawMs
//
//   drawBoardFrame(ctx, 83, 110, { trick: 'heelflip', t: 0.5, look: 'paper', dpr: 2 });   // one still, anywhere
//   drawBoardFrame(ctx, 83, 110, { trick: 'bs-50-50', badgeSafe: true, dpr: 2 });          // a Clips-tab thumbnail
//   drawBoardStrip(ctx, 390, 40, { trick: 'kickflip', n: 12, look: 'night', dpr: 2 });    // a 12-frame scrubber row
//   measureBoardFrame(390, 220, { trick: 'kickflip', t: 0.4 }) → { x0, y0, x1, y1, cx, cy, wallY, floorY, … }
//
//   listTricks() → [{ id, trick, name, outcome, stance, kind, duration, best, marks: { pop, takeoff, land, … } }]
//                  (trick = the dataset id, name its English name; best and marks are 0…1 fractions of the clip;
//                  kind 'pop' | 'manual' | 'grind'; a grind's marks add lock (the trucks meet the edge) and out (the
//                  pop off the end) or slip (the back truck slides off))
//   getMotion(id) → the motion itself: pose(sec, out), duration, best, marks, tPop, tTO, tLand (seconds), and for a
//                  grind ledge { x0, x1, h, z, d } (the prop, world inches) and sparks(sec, out)
//
// Tricks (motion ids): ollie, nollie (an Ollie in nollie stance), fakie-ollie (rolling tail first), kickflip,
// heelflip, pop-shuvit, fs-pop-shuvit, varial-kickflip, varial-heelflip, 360-flip, hardflip, inward-heelflip,
// laser-flip, double-kickflip, bs-180, fs-180, manual, nose-manual, bs-50-50 (ollie up onto the ledge, both trucks
// locked on its edge, grind, pop off the end) — all 'landed' — and the takes that did not make it: kickflip-bail and
// heelflip-bail ('attempt': under-flipped, lands on its grip, slides away upside down), ollie-bail and
// fakie-ollie-bail ('attempt': the board tips out from under the feet, lands on its side, flops over wheels up),
// kickflip-primo ('almost': over-flipped, lands on its edge, bounces, leans and wobbles, goes back over onto its
// wheels), bs-50-50-almost ('almost': locks in, then the back truck slips off the edge, the board falls off and
// shoots out). An outcome suffix works on
// any id: 'kickflip.bail' / 'kickflip:attempt' / 'ollie.attempt' / 'fakie-ollie.attempt' / 'kickflip.almost' /
// 'bs-50-50.almost' / 'bs-50-50:primo' ('.landed' is the trick itself; a trick with no miss of the asked kind gets
// its other one: 'bs-50-50.attempt' is the slip, 'ollie.almost' the bail; an unknown id plays the kickflip).
//
// A grind brings its own ledge (the 'ledge' prop's cross-section — concrete, joints, an angle iron along the edge —
// cut to the grind's length; the `ledge` option is ignored for it), tilts the follow camera up with the board (a
// still camera frames itself higher), drops the board's shadow on the ledge top while it is up there, and throws a
// few spark streaks where the trucks meet the iron (short bars, paper on grip and ink on paper; never red, which the
// design keeps for the brand dot, the capture action and learning; no glow).
//
// createBoardView(canvas, options) sizes the canvas to its CSS box (DPR ≤ 2, ResizeObserver), loops the clip only
// while the canvas is on screen (one shared IntersectionObserver and one shared requestAnimationFrame for every
// view), stops while the page is hidden, and under prefers-reduced-motion draws the trick's one telling still
// (`best`) instead of playing — seek()/frame() still draw what they are asked to. Nothing allocates per frame.
//
// Options (createBoardView and drawBoardFrame; all optional):
//   trick     motion id (above; default 'kickflip')
//   look      'night' (grip footage, paper/ink board; default) | 'paper' (ink on paper)
//   trail     0…6 ghost poses behind the board (the sequence-photo look), only around the trick itself, never
//             behind a rolling (or grinding) board; trailGap seconds between them (0.07); trailDrop 0…6 leaves out
//             that many of the oldest, the rest keeping their tones (the sequence catching up into the board as
//             it lands: 3, 2, 1, 0 ghosts on the frames before the touchdown, no tone jumping); a fraction fades
//             the next one out by as much (2.25: two left out, the third at 75 %)
//   camera    'follow' (a filmer rolling alongside: the board stays centred, the floor slides; default) |
//             'fixed' (a still camera: the board crosses the frame — use with a trail for a sequence)
//   ground    'floor' (floor and wall with joints; default) | 'line' (one line, diagram style) | 'none'
//   ledge     false | true / 'ledge' (a waxed ledge behind the lane, its end in the shot) | 'curb' (a low one);
//             a grind always has its own ledge
//   bg        true: paint the frame's own background (grip or paper, static grain); false: transparent (a view
//             decides this once, when it is created)
//   zoom      1 = the board fills ~2/3 of a landscape frame, ~4/5 of a portrait tile (follow); multiply to taste
//   elev, yaw camera elevation and yaw in degrees (17, 0); mirror: true travels right to left
//   speed     playback rate (1 = real time: a kickflip is in the air for half a second; 0.5 reads every turn)  [view]
//   loop      true (default) | false: stop at the end                                          [view]
//   autoplay  true (default): play whenever visible                                           [view]
//   t         where a view starts (0…1; default 0, or `best` under reduced motion)               [view]
//   fps       60 (default) | 30: thumbnails can draw every other frame (time still runs smooth) [view]
//   reduced   true / false to override prefers-reduced-motion                                [view]
//   onFrame   (t, view) => {} after every draw (a scrubber's playhead, a time readout)        [view]
//   t | sec   drawBoardFrame: the moment, as 0…1 of the clip or seconds (default `best`); dpr: the context's
//             pixel ratio (for crisp grain; the caller owns the context's transform)
//   n, gap, from, to   drawBoardStrip: n cells gap px apart, spanning from…to (default: the trick, pop to landing)
//   badgeSafe true | 'above' | px: frame the board clear of a round play badge in the middle of the frame. true =
//             the app's clip tile (a 26 pt badge on 83 × 110, scaled to the frame's width) and its corner chips
//             (duration top right, tag bottom left: kept clear where the board fits); 'above' = the same, with the
//             board over the badge, never under it (where it does not fit there: clear of it, wherever); a number =
//             just a badge that many px across. The whole scene moves up or down, the shortest move that clears
//             it, the board kept in the frame. A still is framed on its own moment; a view once, on frameT, and
//             keeps that framing while it plays (no camera jumps)
//   frameY    0…1: put the board's centre at this fraction of the frame's height instead (the whole scene moves:
//             floor, wall, ledge and all), on the same moment as badgeSafe
//   frameT    0…1: the moment frameY / badgeSafe frame on (badgeT works too). Default: a still's own moment, a
//             view's `best` (the still a tile settles on). A strip or a run of stills that share one frameT
//             share one framing
//   frameOffset  px | [dx, dy] px: move the scene by hand (+ = right / down), after frameY / badgeSafe
//   followUntil  seconds of the motion: the follow camera stops following there (a filmer who lets a missed
//             board go); panBack inches: and then turns back toward the rider by that much, eased over 2.4 s, so
//             the board goes on alone and leaves the shot. filmerBack(tau, inches) is that turn, for a caller that
//             carries the clip on past the motion's end
//
// Units inside: inches and seconds. A 32" × 8.25" deck, 14.25" wheelbase, 54 mm wheels; gravity 386 in/s².

import { buildMotion, ROLL, SPECS } from './board-tricks.js';

export { SPECS as TRICK_SPECS };

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

// ------------------------------------------------------------------ the board (inches). Local axes: x nose, y grip, z toe side
const HALF = 16; // 32" long
const HW = 4.125; // 8.25" wide
const TH = 0.45; // seven plies
const K0 = 9.6; // the kick starts just outside the truck bolts
const KB = 1.8; // over this length it bends up to its angle
const A_NOSE = 19 * DEG;
const A_TAIL = 21 * DEG; // the tail a touch steeper, as on most decks
const ROUND = 4.4; // the popsicle end: a little longer than a half circle
const AXLE_X = 8.2; // 14.25" wheelbase
const TRUCK_H = 2.0; // deck bottom to axle
const WHEEL_R = 1.06; // 54 mm
const WHEEL_W = 1.22;
const WHEEL_Z = 3.62;
const HOUSING_Z = 2.95;
const BASE_L = 2.5;
const BASE_W = 2.6;
const BASE_T = 0.34;
const CUTS = [-HALF, -11.4, -10.5, -K0, K0, 10.5, 11.4, HALF]; // 7 planar panels: tail tip, 2 bends, flat, 2 bends, nose tip

const kickAngle = (x) => {
  const d = Math.abs(x) - K0;
  if (d <= 0) return 0;
  const a = x > 0 ? A_NOSE : A_TAIL;
  return d < KB ? (a * d) / KB : a;
};
const kickRise = (x) => {
  const d = Math.abs(x) - K0;
  if (d <= 0) return 0;
  const a = x > 0 ? A_NOSE : A_TAIL;
  if (d < KB) return -(KB / a) * Math.log(Math.cos((a * d) / KB));
  return -(KB / a) * Math.log(Math.cos(a)) + (d - KB) * Math.tan(a);
};
const halfWidth = (x) => {
  const ax = Math.abs(x);
  const xr = HALF - ROUND;
  if (ax <= xr) return HW;
  const u = Math.min(1, (ax - xr) / ROUND);
  return HW * Math.sqrt(Math.max(0, 1 - u * u));
};

function buildPanels() {
  const panels = [];
  const xr = HALF - ROUND;
  for (let k = 0; k < CUTS.length - 1; k++) {
    const x0 = CUTS[k];
    const x1 = CUTS[k + 1];
    const xs = [x0, x1];
    const N = 12;
    for (let i = 0; i <= N; i++) {
      const ax = xr + ROUND * Math.sin(((i / N) * Math.PI) / 2);
      for (const sx of [ax, -ax]) if (sx > x0 + 1e-6 && sx < x1 - 1e-6) xs.push(sx);
    }
    xs.sort((a, b) => a - b);
    const pts = [];
    for (const x of xs) pts.push([x, halfWidth(x)]);
    for (let i = xs.length - 1; i >= 0; i--) {
      const w = halfWidth(xs[i]);
      if (w < 1e-4) continue; // the tip point is on the +z side already
      pts.push([xs[i], -w]);
    }
    const nv = pts.length;
    const top = new Float32Array(nv * 3);
    const bot = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
      const [x, z] = pts[i];
      const a = kickAngle(x);
      const s = Math.sign(x);
      const ty = TH / 2 + kickRise(x);
      const nx = -Math.sin(a) * s;
      const ny = Math.cos(a);
      top[i * 3] = x;
      top[i * 3 + 1] = ty;
      top[i * 3 + 2] = z;
      bot[i * 3] = x - TH * nx;
      bot[i * 3 + 1] = ty - TH * ny;
      bot[i * 3 + 2] = z;
    }
    // face normal and frame at the panel's middle
    const xc = (x0 + x1) / 2;
    const ac = (kickAngle(x0) + kickAngle(x1)) / 2;
    const sc = Math.sign(xc);
    const face = [-Math.sin(ac) * sc, Math.cos(ac), 0];
    const tan = [Math.cos(ac), Math.sin(ac) * sc, 0];
    const ctr = [xc, TH / 2 + (kickRise(x0) + kickRise(x1)) / 2, 0];
    // edges: i → i+1; a cut edge crosses the deck at x0 or x1 (where it meets the next panel)
    const cut = new Uint8Array(nv);
    const en = new Float32Array(nv * 3);
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < nv; i++) {
      cx += top[i * 3];
      cy += top[i * 3 + 1];
    }
    cx /= nv;
    cy /= nv;
    for (let i = 0; i < nv; i++) {
      const j = (i + 1) % nv;
      const [xa, za] = pts[i];
      const [xb, zb] = pts[j];
      cut[i] = Math.abs(xa - xb) < 1e-6 && (Math.abs(xa - x0) < 1e-6 || Math.abs(xa - x1) < 1e-6) && za * zb < 0 ? 1 : 0;
      // outward normal of the side wall: tangent × face normal, pointed away from the panel's middle
      const tx = top[j * 3] - top[i * 3];
      const ty = top[j * 3 + 1] - top[i * 3 + 1];
      const tz = top[j * 3 + 2] - top[i * 3 + 2];
      let nx = ty * face[2] - tz * face[1];
      let ny = tz * face[0] - tx * face[2];
      let nz = tx * face[1] - ty * face[0];
      const mx = (top[i * 3] + top[j * 3]) / 2 - cx;
      const mz = (top[i * 3 + 2] + top[j * 3 + 2]) / 2;
      if (nx * mx + nz * mz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      const l = Math.hypot(nx, ny, nz) || 1;
      en[i * 3] = nx / l;
      en[i * 3 + 1] = ny / l;
      en[i * 3 + 2] = nz / l;
    }
    panels.push({
      k,
      mid: k === 3,
      nv,
      top,
      bot,
      cut,
      en,
      face,
      tan,
      ctr,
      centroid: [cx, cy - TH / 2, 0],
      // per-frame scratch
      st: new Float32Array(nv * 2),
      sb: new Float32Array(nv * 2),
      ev: new Uint8Array(nv),
      depth: 0,
      vis: false,
    });
  }
  return panels;
}

// points that can touch the ground: the deck's outline, top and bottom (the wheels are handled as cylinders)
function buildKeys(panels) {
  const keys = [];
  for (const p of panels) {
    for (let i = 0; i < p.nv; i += 2) {
      keys.push(p.top[i * 3], p.top[i * 3 + 1], p.top[i * 3 + 2]);
      keys.push(p.bot[i * 3], p.bot[i * 3 + 1], p.bot[i * 3 + 2]);
    }
  }
  return new Float32Array(keys);
}

// convex meshes (quads only): vertices, faces, local face normals
function convexMesh(verts, faces) {
  const v = new Float32Array(verts.flat());
  const f = new Int16Array(faces.flat());
  const n = new Float32Array(faces.length * 3);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of verts) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= verts.length;
  cy /= verts.length;
  cz /= verts.length;
  faces.forEach((q, i) => {
    const [a, b, c] = q.map((k) => verts[k]);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const wx = c[0] - a[0];
    const wy = c[1] - a[1];
    const wz = c[2] - a[2];
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const mx = q.reduce((s, k) => s + verts[k][0], 0) / 4 - cx;
    const my = q.reduce((s, k) => s + verts[k][1], 0) / 4 - cy;
    const mz = q.reduce((s, k) => s + verts[k][2], 0) / 4 - cz;
    if (nx * mx + ny * my + nz * mz < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    n[i * 3] = nx / l;
    n[i * 3 + 1] = ny / l;
    n[i * 3 + 2] = nz / l;
  });
  return { v, f, n, nf: faces.length, nvert: verts.length, s: new Float32Array(verts.length * 2), c: [cx, cy, cz] };
}

// a box or a frustum: 4 bottom corners then 4 top corners, each ring in the same order
const HEX_FACES = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [0, 1, 5, 4],
  [1, 2, 6, 5],
  [2, 3, 7, 6],
  [3, 0, 4, 7],
];
const ring = (x, y, z, hx, hz) => [
  [x - hx, y, z - hz],
  [x + hx, y, z - hz],
  [x + hx, y, z + hz],
  [x - hx, y, z + hz],
];

function buildTrucks() {
  const yb = -TH / 2; // deck bottom
  const ybp = yb - BASE_T;
  const ya = yb - TRUCK_H; // axle
  return [-1, 1].map((side) => {
    const xa = side * AXLE_X;
    const inward = -side; // kingpins face the middle of the board
    const xp = xa - inward * 0.32; // the pivot leans out
    return {
      xa,
      ya,
      base: convexMesh([...ring(xa, ybp, 0, BASE_L / 2, BASE_W / 2), ...ring(xa, yb, 0, BASE_L / 2, BASE_W / 2)], HEX_FACES),
      hanger: convexMesh([...ring(xa, ya - 0.08, 0, 0.72, 1.7), ...ring(xp, ya + 1.32, 0, 0.42, 0.55)], HEX_FACES),
      // kingpin with its bushing, from the baseplate down into the hanger
      kp: [xa + inward * 0.78, ybp, 0, xa + inward * 0.38, ya + 0.35, 0],
      bush: [xa + inward * 0.7, ybp - 0.32, 0, xa + inward * 0.55, ya + 0.95, 0],
      housing: [xa, ya, -HOUSING_Z, xa, ya, HOUSING_Z],
      wheels: [
        [xa, ya, -WHEEL_Z],
        [xa, ya, WHEEL_Z],
      ],
      depth: 0,
    };
  });
}

const PANELS = buildPanels();
const KEYS = buildKeys(PANELS);
const TRUCKS = buildTrucks();
const ORDER = new Uint8Array(PANELS.length);
const BOLTS = [];
for (const t of TRUCKS) for (const dx of [-1.06, 1.06]) for (const dz of [-0.81, 0.81]) BOLTS.push(t.xa + dx, dz);

// the NBD. wordmark (Sofia Sans Extra Condensed 900 outlines, units per em 1000, baseline y 0, cap height 655) and
// its red square dot: 0.2 em, 0.07 em after the D, as on the site's wordmark
const WORDMARK =
  'M161 0L46 0Q34 0 34-13L34-642Q34-655 45-655L196-655Q205-655 208-646L280-375Q286-351 293.5-321Q301-291 307.5-261Q314-231 318-209L320-209Q318-229 316-258.5Q314-288 312-320Q310-352 309.5-382Q309-412 309-432L309-642Q309-655 321-655L435-655Q447-655 447-642L447-13Q447 0 436 0L286 0Q277 0 274-9L199-278Q188-318 179-361.5Q170-405 163-441L161-441Q164-412 166.5-369.5Q169-327 170.5-285Q172-243 172-214L172-13Q172 0 161 0M692 0L528 0Q515 0 515-13L515-642Q515-655 527-655L690-655Q786-655 833.5-613.5Q881-572 881-489Q881-438 861-403.5Q841-369 797-348L797-344Q849-329 875-290Q901-251 901-191Q901-93 851-46.5Q801 0 692 0M663-279L663-120L694-120Q724-120 740-141Q756-162 756-201Q756-239 739.5-259Q723-279 692-279L663-279M663-535L663-387L686-387Q710-387 723.5-407Q737-427 737-465Q737-501 724-518Q711-535 684-535M1135 0L968 0Q955 0 955-13L955-642Q955-655 968-655L1131-655Q1247-655 1307-585Q1367-515 1367-372L1367-295Q1367-146 1307.5-73Q1248 0 1135 0M1103-524L1103-131L1132-131Q1178-131 1198.5-172Q1219-213 1219-295L1219-372Q1219-448 1197.5-486Q1176-524 1129-524';
const WM = { w: 1660, h: 655, dot: [1460, -200, 200, 200], scale: 11.6 / 1660 }; // 11.6" long on the bottom
let wordPath = null;
let dotPath = null;
function wordmarkPaths() {
  if (!wordPath && typeof Path2D !== 'undefined') {
    wordPath = new Path2D(WORDMARK);
    dotPath = new Path2D();
    const [x, y, w, h] = WM.dot;
    if (dotPath.roundRect) dotPath.roundRect(x, y, w, h, 35);
    else dotPath.rect(x, y, w, h);
  }
  return wordPath;
}

// ------------------------------------------------------------------ the looks
//
// Tones run dark → light and are picked by the light falling on a face (posterised: four steps, as in print).

const LOOKS = {
  night: {
    bg: '#0F0F0E',
    floor: '#171715',
    joint: '#22221F',
    wallJoint: '#161614',
    wallLine: '#2E2E2A',
    groundLine: '#3A3A35',
    speck: [236, 230, 214, 0.055],
    shadow: '#000000',
    line: '#0B0B0A',
    rim: '#D2CBB8',
    gripBase: '#2B2B27',
    gripSpeck: [236, 230, 214, 0.2],
    gripShade: ['rgba(0,0,0,0.5)', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.08)', 'rgba(236,230,214,0.06)'],
    ply: ['#9E9783', '#B9B29E', '#CFC8B4', '#DDD6C4'],
    bottom: ['#B3AC98', '#CBC4B0', '#DED7C5', '#ECE6D6'],
    metal: ['#4F4C44', '#66625A', '#817D71', '#9F9A8B'],
    wheel: ['#ABA490', '#C4BDA9', '#D9D2BF', '#ECE6D6'],
    bush: '#2E2E2A',
    bearing: '#11110F',
    bolt: '#8A8678',
    ink: '#11110F',
    red: '#FF4524',
    ledge: ['#1A1A18', '#20201D', '#272724', '#2E2E2A'],
    ledgeLine: '#3A3A35',
    ledgeEdge: '#8A8678',
    ghostFill: ['#1C1C1A', '#222220', '#282825', '#2E2E2A', '#34342F', '#3A3A35'],
    ghostLine: ['#3A3A35', '#45443E', '#504E47', '#5B5950', '#666359', '#716E62'],
    spark: '#ECE6D6', // grind sparks: paper bars on grip (ink on paper)
  },
  paper: {
    bg: '#ECE6D6',
    floor: '#E3DCCA',
    joint: '#CDC6B2',
    wallJoint: '#E2DBC9',
    wallLine: '#BDB6A2',
    groundLine: '#11110F',
    speck: [17, 17, 15, 0.07],
    shadow: '#11110F',
    line: '#11110F',
    rim: '#11110F',
    gripBase: '#161614',
    gripSpeck: [236, 230, 214, 0.16],
    gripShade: ['rgba(0,0,0,0.35)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0)', 'rgba(236,230,214,0.07)'],
    ply: ['#BDB6A2', '#CFC8B4', '#DDD6C4', '#E8E2D2'],
    bottom: ['#CFC8B4', '#DDD6C4', '#E9E3D3', '#F5F1E6'],
    metal: ['#6B675C', '#8A8678', '#A8A392', '#C2BDAC'],
    wheel: ['#CFC8B4', '#DDD6C4', '#ECE6D6', '#F7F3EA'],
    bush: '#4A4840',
    bearing: '#11110F',
    bolt: '#6B675C',
    ink: '#11110F',
    red: '#FF4524',
    ledge: ['#C4BCA6', '#CFC8B4', '#D9D2BF', '#E3DCCB'],
    ledgeLine: '#11110F',
    ledgeEdge: '#6B675C',
    ghostFill: ['#E6E0D0', '#E1DACA', '#DCD5C4', '#D7D0BE', '#D2CBB8', '#CDC6B2'],
    ghostLine: ['#C9C2AE', '#C0B9A5', '#B7B09C', '#AEA793', '#A59E8A', '#9C9581'],
    spark: '#11110F',
  },
};
export const LOOK_NAMES = Object.keys(LOOKS);

// the light: from the upper left, in front (world)
const LIGHT = (() => {
  const l = [-0.42, 0.8, 0.48];
  const n = Math.hypot(...l);
  return l.map((v) => v / n);
})();
const tone = (d) => {
  // half-Lambert, posterised into 4 steps
  const h = d * 0.5 + 0.5;
  return h < 0.42 ? 0 : h < 0.62 ? 1 : h < 0.8 ? 2 : 3;
};

// ------------------------------------------------------------------ textures (static grain), per context
const TEX = new Map();
function speckTile(rgba, density, seed, size = 96) {
  const key = rgba.join() + density + seed + size;
  if (TEX.has(key)) return TEX.get(key);
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = 0; i < size * size; i++) {
    if (rnd() < density) {
      img.data[i * 4] = rgba[0];
      img.data[i * 4 + 1] = rgba[1];
      img.data[i * 4 + 2] = rgba[2];
      img.data[i * 4 + 3] = Math.round(255 * rgba[3] * (0.45 + rnd() * 0.9));
    }
  }
  g.putImageData(img, 0, 0);
  TEX.set(key, c);
  return c;
}
function gripTile(look) {
  const key = 'grip:' + look.gripBase;
  if (TEX.has(key)) return TEX.get(key);
  if (typeof document === 'undefined') return null;
  const size = 96;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = look.gripBase;
  g.fillRect(0, 0, size, size);
  g.drawImage(speckTile(look.gripSpeck, 0.34, 7, size), 0, 0);
  g.drawImage(speckTile([0, 0, 0, 0.5], 0.22, 11, size), 0, 0);
  TEX.set(key, c);
  return c;
}
const PATTERNS = new WeakMap();
function patternsFor(ctx, lookName, look) {
  let byLook = PATTERNS.get(ctx);
  if (!byLook) PATTERNS.set(ctx, (byLook = {}));
  let p = byLook[lookName];
  if (!p) {
    const grip = gripTile(look);
    const bg = speckTile(look.speck, 0.5, 3, 128);
    p = byLook[lookName] = {
      grip: grip ? ctx.createPattern(grip, 'repeat') : null,
      bg: bg ? ctx.createPattern(bg, 'repeat') : null,
      bgDpr: 0,
    };
  }
  return p;
}
const PM = typeof DOMMatrix !== 'undefined' ? new DOMMatrix() : null;
const GRIP_PPI = 24; // grip tile pixels per inch of deck

// ------------------------------------------------------------------ motions
const MOTIONS = new Map();
const SPEC_BY_ID = new Map(SPECS.map((s) => [s.id, s]));

// scratch for the contact solver
const RS = new Float64Array(9);
function rotation(yaw, pitch, roll, R) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  // R = Ry(yaw) · Rz(pitch) · Rx(roll)
  // Rz·Rx = [[cp, -sp*cr, sp*sr], [sp, cp*cr, -cp*sr], [0, sr, cr]]
  const a00 = cp;
  const a01 = -sp * cr;
  const a02 = sp * sr;
  const a10 = sp;
  const a11 = cp * cr;
  const a12 = -cp * sr;
  const a20 = 0;
  const a21 = sr;
  const a22 = cr;
  // Ry = [[cy,0,sy],[0,1,0],[-sy,0,cy]]
  R[0] = cy * a00 + sy * a20;
  R[1] = cy * a01 + sy * a21;
  R[2] = cy * a02 + sy * a22;
  R[3] = a10;
  R[4] = a11;
  R[5] = a12;
  R[6] = -sy * a00 + cy * a20;
  R[7] = -sy * a01 + cy * a21;
  R[8] = -sy * a02 + cy * a22;
  return R;
}

/** Height of the board's centre that puts its lowest point (deck outline, grip, wheels) on the ground. */
export function groundHeight(yaw, pitch, roll) {
  const R = rotation(yaw, pitch, roll, RS);
  let min = Infinity;
  for (let i = 0; i < KEYS.length; i += 3) {
    const y = R[3] * KEYS[i] + R[4] * KEYS[i + 1] + R[5] * KEYS[i + 2];
    if (y < min) min = y;
  }
  const ay = R[5]; // the wheels' axis (local z), its vertical part
  const reach = WHEEL_R * Math.sqrt(Math.max(0, 1 - ay * ay)) + (WHEEL_W / 2) * Math.abs(ay);
  for (const t of TRUCKS) {
    for (const w of t.wheels) {
      const y = R[3] * w[0] + R[4] * w[1] + R[5] * w[2] - reach;
      if (y < min) min = y;
    }
  }
  return -min;
}
export const REST_HEIGHT = groundHeight(0, 0, 0);

// an outcome suffix on any id: '.bail' / ':attempt' / '-attempt', '.primo' / ':almost' / '-almost', '.landed'. A
// trick without that kind of miss gets its other one (a take that did not make it never lands clean)
const ATTEMPT_IDS = ['-bail', '-attempt', '-primo', '-almost'];
const ALMOST_IDS = ['-primo', '-almost', '-bail', '-attempt'];
const MISS_IDS = { bail: ATTEMPT_IDS, attempt: ATTEMPT_IDS, primo: ALMOST_IDS, almost: ALMOST_IDS };
function parseTrick(id) {
  if (SPEC_BY_ID.has(id)) return id;
  if (typeof id === 'string') {
    const k = id.trim().toLowerCase();
    if (SPEC_BY_ID.has(k)) return k;
    const hit = /^(.+?)[.:-](bail|attempt|primo|almost|landed)$/.exec(k);
    if (hit) {
      if (hit[2] === 'landed' && SPEC_BY_ID.has(hit[1])) return hit[1];
      for (const suffix of MISS_IDS[hit[2]] || []) if (SPEC_BY_ID.has(hit[1] + suffix)) return hit[1] + suffix;
    }
  }
  return 'kickflip';
}

// the board's measures a grind needs (what grinds on the edge, what rests on the ledge top)
const GEO = { axleX: AXLE_X, axleY: -TH / 2 - TRUCK_H, wheelZ: WHEEL_Z, wheelR: WHEEL_R, wheelW: WHEEL_W, housingR: 0.36 };

/** The motion for a trick id (built once). */
export function getMotion(id) {
  const key = parseTrick(id);
  let m = MOTIONS.get(key);
  if (!m) {
    m = buildMotion(SPEC_BY_ID.get(key), groundHeight, GEO);
    MOTIONS.set(key, m);
  }
  return m;
}

/** Every trick the engine can play, with its clip length and the useful moments as 0…1 fractions. */
export function listTricks() {
  return SPECS.map((s) => {
    const m = getMotion(s.id);
    return {
      id: m.id,
      trick: m.trick,
      name: m.name,
      outcome: m.outcome,
      stance: m.stance,
      kind: m.kind,
      duration: m.duration,
      best: m.best,
      marks: m.marks,
    };
  });
}

// the follow camera: the board's x, smoothed over ±0.3 s (precomputed, so any t is a pure lookup)
const CAM_N = 256;
function camTable(m) {
  if (m.cam) return m.cam;
  const pose = newPose();
  const raw = new Float64Array(CAM_N + 1);
  for (let i = 0; i <= CAM_N; i++) {
    m.pose((i / CAM_N) * m.duration, pose);
    raw[i] = pose.x;
  }
  const w = Math.max(1, Math.round((0.3 / m.duration) * CAM_N));
  const vEnd = (raw[CAM_N] - raw[CAM_N - 1]) / (m.duration / CAM_N);
  const at = (i) => (i < 0 ? raw[0] + ROLL * (i / CAM_N) * m.duration : i > CAM_N ? raw[CAM_N] + vEnd * ((i - CAM_N) / CAM_N) * m.duration : raw[i]);
  const pass = (src) => {
    const out = new Float64Array(CAM_N + 1);
    for (let i = 0; i <= CAM_N; i++) {
      let s = 0;
      for (let k = -w; k <= w; k++) s += src(i + k);
      out[i] = s / (2 * w + 1);
    }
    return out;
  };
  const one = pass(at);
  const two = pass((i) => (i < 0 ? one[0] + (at(i) - at(0)) : i > CAM_N ? one[CAM_N] + (at(i) - at(CAM_N)) : one[i]));
  m.cam = two;
  return two;
}
function camAt(m, sec) {
  const tab = camTable(m);
  const f = Math.max(0, Math.min(1, sec / m.duration)) * CAM_N;
  const i = Math.min(CAM_N - 1, Math.floor(f));
  return tab[i] + (tab[i + 1] - tab[i]) * (f - i);
}
// a grind's filmer also tilts up with the board (the action climbs onto the ledge): the board's height, smoothed
// over ±0.35 s, and the view height that follows part of it
const TILT = 0.65;
function tiltTable(m) {
  if (m.camH) return m.camH;
  const pose = newPose();
  const raw = new Float64Array(CAM_N + 1);
  for (let i = 0; i <= CAM_N; i++) {
    m.pose((i / CAM_N) * m.duration, pose);
    const g = groundHeight(pose.yaw, pose.pitch, pose.roll);
    raw[i] = pose.air > g ? pose.air : g;
  }
  const w = Math.max(1, Math.round((0.35 / m.duration) * CAM_N));
  const pass = (src) => {
    const out = new Float64Array(CAM_N + 1);
    for (let i = 0; i <= CAM_N; i++) {
      let s = 0;
      for (let k = -w; k <= w; k++) s += src[Math.max(0, Math.min(CAM_N, i + k))];
      out[i] = s / (2 * w + 1);
    }
    return out;
  };
  m.camH = pass(pass(raw));
  return m.camH;
}
function viewHeightAt(m, sec) {
  const tab = tiltTable(m);
  const f = Math.max(0, Math.min(1, sec / m.duration)) * CAM_N;
  const i = Math.min(CAM_N - 1, Math.floor(f));
  return YC + TILT * (tab[i] + (tab[i + 1] - tab[i]) * (f - i) - REST_HEIGHT);
}

const newPose = () => ({ x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, air: 0, y: 0 });

// ------------------------------------------------------------------ the scene: framing and projection
const F_PERSP = 360; // focal distance, inches: a mild perspective (the far wheels a touch smaller)
const YC = 10; // view height the perspective is centred on
const WALL_Z = 34;

function newScene() {
  return {
    w: 0,
    h: 0,
    S: 1,
    ox: 0,
    oy: 0,
    mir: 1,
    camX: 0,
    V: new Float64Array(9),
    lw: 1,
    dpr: 1,
    lod: 2,
    look: LOOKS.night,
    lookName: 'night',
    pat: null,
    ground: 'floor',
    ledge: null,
    yc: YC,
    joint: 30,
    bg: true,
    followUntil: null,
    panBack: 0,
  };
}

function frameScene(sc, w, h, o, m) {
  sc.w = w;
  sc.h = h;
  sc.lookName = LOOKS[o.look] ? o.look : 'night';
  sc.look = LOOKS[sc.lookName];
  sc.mir = o.mirror ? -1 : 1;
  sc.dpr = o.dpr || 1;
  sc.bg = o.bg !== false;
  sc.ground = o.ground || 'floor';
  const zoom = o.zoom || 1;
  const fixed = o.camera === 'fixed';
  // follow: ~48" across a landscape frame (the board ⅔ of the width), 40" across a portrait tile
  const spanX = fixed ? (m.xSpan ?? ROLL * Math.max(0.5, m.tLand - m.tTO)) + 30 + 44 : w < h ? 40 : 48;
  const S = (sc.S = zoom * Math.min(w / spanX, h / 36));
  sc.lw = Math.max(0.75, Math.min(2.2, S * 0.13));
  sc.lod = S < 2.6 ? 0 : S < 5 ? 1 : 2;
  sc.ox = w / 2;
  sc.oy = h * 0.52; // the view height sits a little below the middle: the ground line ends up near 3/4
  sc.yc = m.yc ?? YC; // a grind's still camera frames itself higher (its action is up on the ledge); a follow tilts
  const e = (o.elev ?? 17) * DEG;
  const g = (o.yaw ?? 0) * DEG;
  // V = Rx(e) · Ry(g)
  const ce = Math.cos(e);
  const se = Math.sin(e);
  const cg = Math.cos(g);
  const sg = Math.sin(g);
  const V = sc.V;
  V[0] = cg;
  V[1] = 0;
  V[2] = sg;
  V[3] = se * sg;
  V[4] = ce;
  V[5] = -se * cg;
  V[6] = -ce * sg;
  V[7] = se;
  V[8] = ce * cg;
  // ledge: a grind's own, or the one asked for
  const lg = o.ledge === true ? 'ledge' : o.ledge || null;
  sc.ledge = m.ledge ? propMesh(m) : lg === 'ledge' ? LEDGE : lg === 'curb' ? CURB : null;
  // joints: a spacing that makes a looping follow clip seamless
  const d = camAt(m, m.duration) - camAt(m, 0);
  sc.joint = d > 1 ? d / Math.max(1, Math.round(d / 30)) : 30;
  sc.fixed = fixed;
  // the filmer stops following at followUntil (s of the motion) and turns back by panBack inches
  sc.followUntil = o.followUntil != null && isFinite(o.followUntil) ? +o.followUntil : null;
  sc.panBack = +o.panBack || 0;
  return sc;
}

// props behind the lane, starting a little before the pop so their end is in the shot; the top front edge is the
// waxed angle iron
const LEDGE = convexMesh([...ring(150, 0, -24, 175, 6), ...ring(150, 12, -24, 175, 6)], HEX_FACES);
LEDGE.edge = [-25, 12, -18, 325, 12, -18];
LEDGE.depth = 12;
LEDGE.iron = 1.4; // the angle iron's legs, inches
const CURB = convexMesh([...ring(150, 0, -15, 175, 3), ...ring(150, 5, -15, 175, 3)], HEX_FACES);
CURB.edge = [-25, 5, -12, 325, 5, -12];
CURB.depth = 6;
CURB.iron = 0;
const LEDGE_JOINT = 40; // concrete joints along a ledge
// a grind's ledge, from its numbers (m.ledge: start, end, height, front edge z, depth), built once per motion
function propMesh(m) {
  if (m.prop) return m.prop;
  const { x0, x1, h, z, d } = m.ledge;
  const xc = (x0 + x1) / 2;
  const mesh = convexMesh([...ring(xc, 0, z - d / 2, (x1 - x0) / 2, d / 2), ...ring(xc, h, z - d / 2, (x1 - x0) / 2, d / 2)], HEX_FACES);
  mesh.edge = [x0, h, z, x1, h, z];
  mesh.depth = d;
  mesh.iron = LEDGE.iron;
  mesh.box = m.ledge;
  m.prop = mesh;
  return mesh;
}

// projection scratch: M = V·R (view from board), T = view translation
const M = new Float64Array(9);
const TV = new Float64Array(3);
const R = new Float64Array(9);
const LB = new Float64Array(3); // the light in board coordinates

function setBoardTransform(sc, pose) {
  rotation(pose.yaw, pose.pitch, pose.roll, R);
  const V = sc.V;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) M[r * 3 + c] = V[r * 3] * R[c] + V[r * 3 + 1] * R[3 + c] + V[r * 3 + 2] * R[6 + c];
  }
  const tx = pose.x - sc.camX;
  const ty = pose.y;
  const tz = pose.z;
  TV[0] = V[0] * tx + V[1] * ty + V[2] * tz;
  TV[1] = V[3] * tx + V[4] * ty + V[5] * tz;
  TV[2] = V[6] * tx + V[7] * ty + V[8] * tz;
  // Rᵀ · light
  LB[0] = R[0] * LIGHT[0] + R[3] * LIGHT[1] + R[6] * LIGHT[2];
  LB[1] = R[1] * LIGHT[0] + R[4] * LIGHT[1] + R[7] * LIGHT[2];
  LB[2] = R[2] * LIGHT[0] + R[5] * LIGHT[1] + R[8] * LIGHT[2];
}
function setWorldTransform(sc) {
  M.set(sc.V);
  const tx = -sc.camX;
  TV[0] = sc.V[0] * tx;
  TV[1] = sc.V[3] * tx;
  TV[2] = sc.V[6] * tx;
  LB[0] = LIGHT[0];
  LB[1] = LIGHT[1];
  LB[2] = LIGHT[2];
}

// project local (x, y, z) with M/TV into out[o], out[o+1]; returns the perspective factor
let PZ = 0; // view z of the last projected point
function proj(sc, x, y, z, out, o) {
  const vx = M[0] * x + M[1] * y + M[2] * z + TV[0];
  const vy = M[3] * x + M[4] * y + M[5] * z + TV[1];
  const vz = M[6] * x + M[7] * y + M[8] * z + TV[2];
  const k = F_PERSP / (F_PERSP - vz);
  out[o] = sc.ox + sc.mir * sc.S * k * vx;
  out[o + 1] = sc.oy - sc.S * k * (vy - sc.yc);
  PZ = vz;
  return k;
}
const P2 = new Float32Array(16); // small scratch for a few points

// ------------------------------------------------------------------ drawing

function drawBackground(ctx, sc) {
  const L = sc.look;
  const { w, h } = sc;
  if (sc.bg) {
    ctx.fillStyle = L.bg;
    ctx.fillRect(0, 0, w, h);
  }
  setWorldTransform(sc);
  if (sc.ground === 'floor') {
    // the wall meets the floor at Z = −WALL_Z: a horizontal line (no camera yaw) or nearly
    proj(sc, sc.camX - 1000, 0, -WALL_Z, P2, 0);
    proj(sc, sc.camX + 1000, 0, -WALL_Z, P2, 2);
    const wy = Math.min(P2[1], P2[3]);
    if (sc.bg) {
      ctx.fillStyle = L.floor;
      ctx.beginPath();
      ctx.moveTo(P2[0], P2[1]);
      ctx.lineTo(P2[2], P2[3]);
      ctx.lineTo(P2[2], h + 10);
      ctx.lineTo(P2[0], h + 10);
      ctx.closePath();
      ctx.fill();
    }
    // joints on the floor (and fainter ones up the wall), scrolling with the camera
    const J = sc.joint;
    const span = (w / sc.S) * 0.75 + 60;
    const first = Math.floor((sc.camX - span) / J);
    const last = Math.ceil((sc.camX + span) / J);
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
      const x = i * J;
      proj(sc, x, 0, -WALL_Z, P2, 0);
      proj(sc, x, 0, 60, P2, 2);
      ctx.moveTo(P2[0], P2[1]);
      ctx.lineTo(P2[2], P2[3]);
    }
    ctx.strokeStyle = L.joint;
    ctx.lineWidth = Math.max(1, sc.lw * 0.8);
    ctx.stroke();
    if (sc.lod > 0) {
      ctx.beginPath();
      const W = J * 2;
      const f2 = Math.floor((sc.camX - span) / W);
      const l2 = Math.ceil((sc.camX + span) / W);
      for (let i = f2; i <= l2; i++) {
        proj(sc, i * W + J * 0.5, 0, -WALL_Z, P2, 0);
        ctx.moveTo(P2[0], P2[1]);
        ctx.lineTo(P2[0], -10);
      }
      ctx.strokeStyle = L.wallJoint;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-10, wy);
    ctx.lineTo(w + 10, wy);
    ctx.strokeStyle = L.wallLine;
    ctx.lineWidth = Math.max(1, sc.lw);
    ctx.stroke();
  } else if (sc.ground === 'line') {
    proj(sc, sc.camX, 0, -HW - 1.5, P2, 0);
    ctx.beginPath();
    ctx.moveTo(-10, P2[1]);
    ctx.lineTo(w + 10, P2[1]);
    ctx.strokeStyle = L.groundLine;
    ctx.lineWidth = Math.max(1, sc.lw * 1.2);
    ctx.stroke();
  }
  if (sc.bg && sc.pat && sc.pat.bg) {
    // static grain, one tile pixel per device pixel
    if (PM && sc.pat.bgDpr !== sc.dpr) {
      PM.a = 1 / sc.dpr;
      PM.b = 0;
      PM.c = 0;
      PM.d = 1 / sc.dpr;
      PM.e = 0;
      PM.f = 0;
      sc.pat.bg.setTransform(PM);
      sc.pat.bgDpr = sc.dpr;
    }
    ctx.fillStyle = sc.pat.bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (sc.ledge) drawLedge(ctx, sc, sc.ledge);
}

// a ledge (or curb): the block, its concrete joints scrolling past, the angle iron along its front edge (a band down
// the face and along the top), and the waxed edge itself
function drawLedge(ctx, sc, mesh) {
  const L = sc.look;
  drawConvex(ctx, sc, mesh, L.ledge, L.ledgeLine, sc.lw, null);
  const e = mesh.edge;
  const x0 = e[0];
  const x1 = e[3];
  const h = e[1];
  const z = e[2];
  const t = mesh.iron;
  const span = (sc.w / sc.S) * 0.75 + 60;
  const a = Math.max(x0, sc.camX - span);
  const b = Math.min(x1, sc.camX + span);
  if (b > a && sc.lod > 0) {
    ctx.beginPath();
    for (let x = x0 + Math.max(1, Math.ceil((a - x0) / LEDGE_JOINT)) * LEDGE_JOINT; x < Math.min(b, x1 - 2); x += LEDGE_JOINT) {
      proj(sc, x, 0, z, P2, 0);
      proj(sc, x, h - t, z, P2, 2);
      ctx.moveTo(P2[0], P2[1]);
      ctx.lineTo(P2[2], P2[3]);
      proj(sc, x, h, z - t, P2, 0);
      proj(sc, x, h, z - mesh.depth, P2, 2);
      ctx.moveTo(P2[0], P2[1]);
      ctx.lineTo(P2[2], P2[3]);
    }
    ctx.strokeStyle = L.ledge[0];
    ctx.lineWidth = Math.max(1, sc.lw * 0.9);
    ctx.stroke();
  }
  if (b > a && t) {
    ctx.lineWidth = Math.max(0.75, sc.lw * 0.7);
    ctx.strokeStyle = L.ledgeLine;
    ctx.lineJoin = 'round';
    // down the face
    proj(sc, a, h - t, z, P2, 0);
    proj(sc, b, h - t, z, P2, 2);
    proj(sc, b, h, z, P2, 4);
    proj(sc, a, h, z, P2, 6);
    ctx.beginPath();
    ctx.moveTo(P2[0], P2[1]);
    ctx.lineTo(P2[2], P2[3]);
    ctx.lineTo(P2[4], P2[5]);
    ctx.lineTo(P2[6], P2[7]);
    ctx.closePath();
    ctx.fillStyle = L.metal[1];
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(P2[0], P2[1]);
    ctx.lineTo(P2[2], P2[3]);
    ctx.stroke();
    // along the top
    proj(sc, a, h, z - t, P2, 0);
    proj(sc, b, h, z - t, P2, 2);
    ctx.beginPath();
    ctx.moveTo(P2[6], P2[7]);
    ctx.lineTo(P2[4], P2[5]);
    ctx.lineTo(P2[2], P2[3]);
    ctx.lineTo(P2[0], P2[1]);
    ctx.closePath();
    ctx.fillStyle = L.metal[2];
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(P2[0], P2[1]);
    ctx.lineTo(P2[2], P2[3]);
    ctx.stroke();
  }
  proj(sc, a, h, z, P2, 0);
  proj(sc, b, h, z, P2, 2);
  ctx.beginPath();
  ctx.moveTo(P2[0], P2[1]);
  ctx.lineTo(P2[2], P2[3]);
  ctx.strokeStyle = L.ledgeEdge;
  ctx.lineWidth = sc.lw * 1.5;
  ctx.stroke();
}

function drawConvex(ctx, sc, mesh, tones, line, lw, flat) {
  const { v, f, n, nf, nvert, s } = mesh;
  for (let i = 0; i < nvert; i++) proj(sc, v[i * 3], v[i * 3 + 1], v[i * 3 + 2], s, i * 2);
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = line;
  for (let q = 0; q < nf; q++) {
    const nx = n[q * 3];
    const ny = n[q * 3 + 1];
    const nz = n[q * 3 + 2];
    if (M[6] * nx + M[7] * ny + M[8] * nz <= 0.002) continue;
    const a = f[q * 4] * 2;
    const b = f[q * 4 + 1] * 2;
    const c = f[q * 4 + 2] * 2;
    const d = f[q * 4 + 3] * 2;
    ctx.beginPath();
    ctx.moveTo(s[a], s[a + 1]);
    ctx.lineTo(s[b], s[b + 1]);
    ctx.lineTo(s[c], s[c + 1]);
    ctx.lineTo(s[d], s[d + 1]);
    ctx.closePath();
    ctx.fillStyle = flat || tones[tone(nx * LB[0] + ny * LB[1] + nz * LB[2])];
    ctx.fill();
    ctx.stroke();
  }
}

function capsule(ctx, sc, seg, r, fill, line, lw) {
  proj(sc, seg[0], seg[1], seg[2], P2, 0);
  const k = proj(sc, seg[3], seg[4], seg[5], P2, 2);
  const wpx = 2 * r * sc.S * k;
  ctx.beginPath();
  ctx.moveTo(P2[0], P2[1]);
  ctx.lineTo(P2[2] + 0.01, P2[3]);
  ctx.lineCap = 'round';
  if (line) {
    ctx.strokeStyle = line;
    ctx.lineWidth = wpx + 2 * lw;
    ctx.stroke();
  }
  ctx.strokeStyle = fill;
  ctx.lineWidth = wpx;
  ctx.stroke();
  ctx.lineCap = 'butt';
}

// a wheel: a short cylinder along the board's lateral axis
function wheel(ctx, sc, c, L, lw, ghost) {
  const k = proj(sc, c[0], c[1], c[2], P2, 0);
  const cz = PZ;
  // the axis in view space (M's third column) and on screen
  const ax = M[2];
  const ay = M[5];
  const az = M[8];
  const r = WHEEL_R * sc.S * k;
  const sx = sc.mir * ax;
  const sy = -ay;
  const sl = Math.hypot(sx, sy);
  const rot = sl > 1e-4 ? Math.atan2(sy, sx) : 0;
  const minor = Math.max(0.01, r * Math.abs(az));
  // face centres: ± half the width along the axis
  const hw = (WHEEL_W / 2) * sc.S * k;
  const dx = sx * hw;
  const dy = sy * hw;
  const near = az >= 0 ? 1 : -1; // +axis face is the nearer one when the axis points at the camera
  const nx = P2[0] + near * dx;
  const ny = P2[1] + near * dy;
  const fx = P2[0] - near * dx;
  const fy = P2[1] - near * dy;
  const ux = sl > 1e-4 ? -sy / sl : 0;
  const uy = sl > 1e-4 ? sx / sl : 1;
  const faceTone = ghost ? null : L.wheel[tone(near * LB[2])];
  const sideTone = ghost ? null : L.wheel[Math.max(0, tone(near * LB[2]) - 1)];
  const fill = ghost ? ghost[0] : sideTone;
  const stroke = ghost ? ghost[1] : L.line;
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  // far face
  ctx.beginPath();
  ctx.ellipse(fx, fy, minor, r, rot, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.stroke();
  // the tread between the faces
  if (sl > 1e-3 && hw * sl > 0.3) {
    ctx.beginPath();
    ctx.moveTo(fx + ux * r, fy + uy * r);
    ctx.lineTo(nx + ux * r, ny + uy * r);
    ctx.lineTo(nx - ux * r, ny - uy * r);
    ctx.lineTo(fx - ux * r, fy - uy * r);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(fx + ux * r, fy + uy * r);
    ctx.lineTo(nx + ux * r, ny + uy * r);
    ctx.moveTo(nx - ux * r, ny - uy * r);
    ctx.lineTo(fx - ux * r, fy - uy * r);
    ctx.stroke();
  }
  // near face with its bearing
  ctx.beginPath();
  ctx.ellipse(nx, ny, minor, r, rot, 0, TAU);
  ctx.fillStyle = ghost ? ghost[0] : faceTone;
  ctx.fill();
  ctx.stroke();
  if (!ghost && sc.lod > 0 && Math.abs(az) > 0.12) {
    ctx.beginPath();
    ctx.ellipse(nx, ny, minor * 0.44, r * 0.44, rot, 0, TAU);
    ctx.fillStyle = L.bearing;
    ctx.fill();
    if (sc.lod > 1 && r > 7) {
      ctx.beginPath();
      ctx.ellipse(nx, ny, minor * 0.14, r * 0.14, rot, 0, TAU);
      ctx.fillStyle = L.metal[2];
      ctx.fill();
    }
  }
  return cz;
}

function drawTruck(ctx, sc, t, L, lw, topVis, ghost) {
  // which wheel is nearer the camera
  const wz0 = M[6] * t.wheels[0][0] + M[7] * t.wheels[0][1] + M[8] * t.wheels[0][2];
  const wz1 = M[6] * t.wheels[1][0] + M[7] * t.wheels[1][1] + M[8] * t.wheels[1][2];
  const far = wz0 < wz1 ? t.wheels[0] : t.wheels[1];
  const nearW = wz0 < wz1 ? t.wheels[1] : t.wheels[0];
  const tlw = lw * 0.85;
  wheel(ctx, sc, far, L, tlw, ghost);
  const metal = ghost ? ghost[0] : L.metal[2];
  const line = ghost ? ghost[1] : L.line;
  if (ghost || sc.lod === 0) {
    capsule(ctx, sc, t.housing, 0.36, metal, line, tlw);
  } else {
    // from the deck outwards when we see the deck's bottom, the other way round when the trucks are behind it
    const parts = topVis ? 0 : 1;
    if (parts === 1) {
      drawConvex(ctx, sc, t.base, L.metal, L.line, tlw, null);
      if (sc.lod > 1) {
        capsule(ctx, sc, t.bush, 0.42, L.bush, L.line, tlw);
        capsule(ctx, sc, t.kp, 0.16, L.metal[3], L.line, tlw);
      }
      drawConvex(ctx, sc, t.hanger, L.metal, L.line, tlw, null);
      capsule(ctx, sc, t.housing, 0.36, metal, L.line, tlw);
    } else {
      capsule(ctx, sc, t.housing, 0.36, metal, L.line, tlw);
      drawConvex(ctx, sc, t.hanger, L.metal, L.line, tlw, null);
      if (sc.lod > 1) {
        capsule(ctx, sc, t.kp, 0.16, L.metal[3], L.line, tlw);
        capsule(ctx, sc, t.bush, 0.42, L.bush, L.line, tlw);
      }
      drawConvex(ctx, sc, t.base, L.metal, L.line, tlw, null);
    }
  }
  wheel(ctx, sc, nearW, L, tlw, ghost);
}

function traceFace(ctx, arr, nv) {
  ctx.beginPath();
  ctx.moveTo(arr[0], arr[1]);
  for (let i = 1; i < nv; i++) ctx.lineTo(arr[i * 2], arr[i * 2 + 1]);
  ctx.closePath();
}

let gripFill = '';
function drawDeck(ctx, sc, L, lw, ghost) {
  // project, cull and sort the panels
  for (let k = 0; k < PANELS.length; k++) {
    const p = PANELS[k];
    for (let i = 0; i < p.nv; i++) {
      proj(sc, p.top[i * 3], p.top[i * 3 + 1], p.top[i * 3 + 2], p.st, i * 2);
      proj(sc, p.bot[i * 3], p.bot[i * 3 + 1], p.bot[i * 3 + 2], p.sb, i * 2);
    }
    p.vis = M[6] * p.face[0] + M[7] * p.face[1] + M[8] * p.face[2] > 0;
    for (let i = 0; i < p.nv; i++) {
      p.ev[i] = !p.cut[i] && M[6] * p.en[i * 3] + M[7] * p.en[i * 3 + 1] + M[8] * p.en[i * 3 + 2] > 0 ? 1 : 0;
    }
    p.depth = M[6] * p.centroid[0] + M[7] * p.centroid[1] + M[8] * p.centroid[2];
    ORDER[k] = k;
  }
  for (let i = 1; i < ORDER.length; i++) {
    const v = ORDER[i];
    let j = i - 1;
    while (j >= 0 && PANELS[ORDER[j]].depth > PANELS[v].depth) {
      ORDER[j + 1] = ORDER[j];
      j--;
    }
    ORDER[j + 1] = v;
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let o = 0; o < ORDER.length; o++) {
    const p = PANELS[ORDER[o]];
    const nv = p.nv;
    const near = p.vis ? p.st : p.sb;
    const far = p.vis ? p.sb : p.st;
    // the edge band: every side wall facing us, one path (no seams between them)
    let any = false;
    let lit = 0;
    let cnt = 0;
    ctx.beginPath();
    for (let i = 0; i < nv; i++) {
      if (!p.ev[i]) continue;
      const j = (i + 1) % nv;
      ctx.moveTo(near[i * 2], near[i * 2 + 1]);
      ctx.lineTo(near[j * 2], near[j * 2 + 1]);
      ctx.lineTo(far[j * 2], far[j * 2 + 1]);
      ctx.lineTo(far[i * 2], far[i * 2 + 1]);
      ctx.closePath();
      any = true;
      lit += p.en[i * 3] * LB[0] + p.en[i * 3 + 1] * LB[1] + p.en[i * 3 + 2] * LB[2];
      cnt++;
    }
    if (any) {
      ctx.fillStyle = ghost ? ghost[0] : L.ply[tone(lit / cnt)];
      ctx.fill();
      if (!ghost) {
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
    // the face we see: grip on top, the paper bottom underneath
    const fl = p.face[0] * LB[0] + p.face[1] * LB[1] + p.face[2] * LB[2];
    traceFace(ctx, near, nv);
    if (ghost) {
      ctx.fillStyle = ghost[0];
      ctx.fill();
    } else if (p.vis) {
      if (sc.pat && sc.pat.grip && sc.lod > 1 && PM) {
        panelAffine(sc, p, true);
        PM.a = AF[0] / GRIP_PPI;
        PM.b = AF[1] / GRIP_PPI;
        PM.c = AF[2] / GRIP_PPI;
        PM.d = AF[3] / GRIP_PPI;
        PM.e = AF[4];
        PM.f = AF[5];
        sc.pat.grip.setTransform(PM);
        ctx.fillStyle = sc.pat.grip;
      } else ctx.fillStyle = L.gripBase;
      ctx.fill();
      gripFill = ctx.fillStyle;
      ctx.fillStyle = L.gripShade[tone(fl)];
      ctx.fill();
    } else {
      ctx.fillStyle = L.bottom[tone(-fl)];
      ctx.fill();
    }
    // close the hairline seam to the next panel with the face's own colour
    if (!ghost) {
      ctx.beginPath();
      for (let i = 0; i < nv; i++) {
        if (!p.cut[i]) continue;
        const j = (i + 1) % nv;
        ctx.moveTo(near[i * 2], near[i * 2 + 1]);
        ctx.lineTo(near[j * 2], near[j * 2 + 1]);
      }
      ctx.lineWidth = 1;
      ctx.lineCap = 'butt';
      if (p.vis) {
        ctx.strokeStyle = gripFill;
        ctx.stroke();
        ctx.strokeStyle = L.gripShade[tone(fl)];
      } else ctx.strokeStyle = L.bottom[tone(-fl)];
      ctx.stroke();
      ctx.lineCap = 'round';
      if (p.mid) {
        if (!p.vis) drawGraphic(ctx, sc, L);
        else if (sc.lod > 1) drawBolts(ctx, sc, L);
      }
    }
    // ink: the band's outer edge and its ends
    ctx.beginPath();
    for (let i = 0; i < nv; i++) {
      if (!p.ev[i]) continue;
      const j = (i + 1) % nv;
      ctx.moveTo(far[i * 2], far[i * 2 + 1]);
      ctx.lineTo(far[j * 2], far[j * 2 + 1]);
      const pi = (i - 1 + nv) % nv;
      if (!p.ev[pi] && !p.cut[pi]) {
        ctx.moveTo(near[i * 2], near[i * 2 + 1]);
        ctx.lineTo(far[i * 2], far[i * 2 + 1]);
      }
      if (!p.ev[j] && !p.cut[j]) {
        ctx.moveTo(near[j * 2], near[j * 2 + 1]);
        ctx.lineTo(far[j * 2], far[j * 2 + 1]);
      }
    }
    ctx.strokeStyle = ghost ? ghost[1] : L.line;
    ctx.lineWidth = lw;
    ctx.stroke();
    // the face's outline (the grip's filed edge shows light at night)
    ctx.beginPath();
    for (let i = 0; i < nv; i++) {
      if (p.cut[i]) continue;
      const j = (i + 1) % nv;
      ctx.moveTo(near[i * 2], near[i * 2 + 1]);
      ctx.lineTo(near[j * 2], near[j * 2 + 1]);
    }
    ctx.strokeStyle = ghost ? ghost[1] : p.vis ? L.rim : L.line;
    ctx.lineWidth = p.vis && !ghost ? lw * 0.85 : lw;
    ctx.stroke();
  }
}

// affine of a panel face: local plan (along the panel, across the board) inches → screen
const AF = new Float64Array(6);
function panelAffine(sc, p, top) {
  const c = p.ctr;
  const y = top ? c[1] : c[1] - TH;
  proj(sc, c[0], y, 0, P2, 0);
  proj(sc, c[0] + p.tan[0], y + p.tan[1], 0, P2, 2);
  proj(sc, c[0], y, 1, P2, 4);
  AF[0] = P2[2] - P2[0];
  AF[1] = P2[3] - P2[1];
  AF[2] = P2[4] - P2[0];
  AF[3] = P2[5] - P2[1];
  AF[4] = P2[0];
  AF[5] = P2[1];
}

function drawGraphic(ctx, sc, L) {
  const path = wordmarkPaths();
  if (!path) return;
  panelAffine(sc, PANELS[3], false);
  const k = WM.scale;
  // the wordmark reads along the board from the tail; its letters stand across it (the cap height toward −z: read
  // from below, it is not mirrored)
  const cx = WM.w / 2;
  const cy = -WM.h / 2;
  ctx.save();
  ctx.transform(AF[0] * k, AF[1] * k, -AF[2] * k, -AF[3] * k, AF[4] - (AF[0] * cx - AF[2] * cy) * k, AF[5] - (AF[1] * cx - AF[3] * cy) * k);
  ctx.fillStyle = L.ink;
  ctx.fill(path);
  ctx.fillStyle = L.red;
  ctx.fill(dotPath);
  ctx.restore();
}

function drawBolts(ctx, sc, L) {
  panelAffine(sc, PANELS[3], true);
  ctx.save();
  ctx.transform(AF[0], AF[1], AF[2], AF[3], AF[4], AF[5]);
  ctx.beginPath();
  for (let i = 0; i < BOLTS.length; i += 2) {
    ctx.moveTo(BOLTS[i] + 0.19, BOLTS[i + 1]);
    ctx.arc(BOLTS[i], BOLTS[i + 1], 0.19, 0, TAU);
  }
  ctx.restore();
  ctx.fillStyle = L.bolt;
  ctx.fill();
}

function drawShadow(ctx, sc, pose) {
  const L = sc.look;
  setWorldTransform(sc);
  // a grind's ledge carries the board: while it is over the ledge, the shadow lies on the ledge top (cut at the
  // edge); otherwise on the floor, never over the ledge's faces
  const box = sc.ledge && sc.ledge.box;
  const onTop = !!box && pose.x >= box.x0 && pose.x <= box.x1 && pose.z <= box.z + 1 && pose.z >= box.z - box.d;
  const base = onTop ? box.h : 0;
  const k = proj(sc, pose.x, base, pose.z, P2, 0);
  // the board's long and lateral axes, flattened onto the ground
  rotation(pose.yaw, pose.pitch, pose.roll, R);
  const h = Math.max(0, pose.y - base - REST_HEIGHT);
  const f = 1 - 0.38 * Math.min(1, h / 26);
  const lx = R[0] * 15.6 * f;
  const lz = R[6] * 15.6 * f;
  // + the trucks and wheels sticking out sideways when the board stands on its edge
  const wx = R[2] * 4.7 * f + R[1] * 2.6;
  const wz = R[8] * 4.7 * f + R[7] * 2.6;
  const V = sc.V;
  const S = sc.S * k;
  const a = sc.mir * S * (V[0] * lx + V[2] * lz);
  const b = -S * (V[3] * lx + V[5] * lz);
  const c = sc.mir * S * (V[0] * wx + V[2] * wz);
  const d = -S * (V[3] * wx + V[5] * wz);
  const cx = P2[0];
  const cy = P2[1];
  if (box) {
    ctx.save();
    clipLedge(ctx, sc, sc.ledge, onTop);
  }
  ctx.save();
  ctx.transform(a, b, c, d, cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TAU);
  ctx.restore();
  ctx.fillStyle = L.shadow;
  ctx.fill();
  if (box) ctx.restore();
}

// clip to the ledge's top face, or to everything but the ledge (its faces as drawn by drawBackground this frame:
// the world transform and the mesh's projected corners are still the ones it used)
function clipLedge(ctx, sc, mesh, top) {
  const { s, f, n, nf } = mesh;
  ctx.beginPath();
  if (!top) ctx.rect(-10, -10, sc.w + 20, sc.h + 20);
  for (let q = 0; q < nf; q++) {
    if (top ? q !== 1 : M[6] * n[q * 3] + M[7] * n[q * 3 + 1] + M[8] * n[q * 3 + 2] <= 0.002) continue;
    const a = f[q * 4] * 2;
    ctx.moveTo(s[a], s[a + 1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(s[f[q * 4 + i] * 2], s[f[q * 4 + i] * 2 + 1]);
    ctx.closePath();
  }
  ctx.clip('evenodd');
}

// grind sparks: short straight bars thrown back and out from where each truck meets the edge, a fresh handful
// every 45 ms of the clip (seeded by the moment, so a still and a scrubbed frame show the same ones)
const SPK = { back: 0, front: 0, burst: 0 };
const SPARK_DT = 0.045;
const hash01 = (a) => {
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  a = Math.imul(a ^ (a >>> 16), 0x45d9f3b);
  return ((a ^ (a >>> 16)) >>> 0) / 4294967296;
};
function drawSparks(ctx, sc, m, sec, pose) {
  m.sparks(sec, SPK);
  if (!SPK.back && !SPK.front) return;
  const L = sc.look;
  const box = m.ledge;
  setWorldTransform(sc);
  rotation(pose.yaw, pose.pitch, pose.roll, R);
  const bucket = Math.floor(sec / SPARK_DT);
  const age = sec / SPARK_DT - bucket;
  ctx.lineCap = 'butt';
  for (let side = 0; side < 2; side++) {
    const on = side ? SPK.front : SPK.back;
    if (!on) continue;
    const lx = (side ? 1 : -1) * AXLE_X;
    const x0 = pose.x + R[0] * lx;
    const count = 3 + Math.round(4 * SPK.burst);
    for (let i = 0; i < count; i++) {
      const seed = (bucket * 31 + side * 7 + i) * 2654435761;
      const u1 = hash01(seed);
      const u2 = hash01(seed + 1);
      const u3 = hash01(seed + 2);
      if (hash01(seed + 3) > on * 1.2) continue; // the flicker
      const up = (-34 + 44 * u1) * DEG; // back along the edge, spraying low (under the deck, down the face)
      const dx = -Math.cos(up);
      const dy = Math.sin(up);
      const dz = 0.2 + 0.7 * u2; // and out toward the lane
      const len = (3 + 6 * u3) * (0.75 + 0.6 * SPK.burst);
      const o = 0.6 + age * 7;
      const k0 = proj(sc, x0 + dx * o, box.h + dy * o, box.z + dz * o, P2, 0);
      proj(sc, x0 + dx * (o + len), box.h + dy * (o + len), box.z + dz * (o + len), P2, 2);
      ctx.beginPath();
      ctx.moveTo(P2[0], P2[1]);
      ctx.lineTo(P2[2], P2[3]);
      ctx.strokeStyle = L.spark;
      ctx.lineWidth = Math.max(1, (0.24 + 0.2 * u2) * sc.S * k0);
      ctx.stroke();
    }
  }
}

function drawBoard(ctx, sc, pose, ghost) {
  const L = sc.look;
  setBoardTransform(sc, pose);
  const lw = ghost ? Math.max(0.75, sc.lw * 0.8) : sc.lw;
  const topVis = M[7] > 0; // the flat part's grip faces the camera
  // trucks in depth order; behind the deck when we look at the grip, in front of it when we look at the bottom
  const t0 = TRUCKS[0];
  const t1 = TRUCKS[1];
  const d0 = M[6] * t0.xa + M[7] * t0.ya;
  const d1 = M[6] * t1.xa + M[7] * t1.ya;
  const a = d0 < d1 ? t0 : t1;
  const b = d0 < d1 ? t1 : t0;
  if (topVis) {
    drawTruck(ctx, sc, a, L, lw, topVis, ghost);
    drawTruck(ctx, sc, b, L, lw, topVis, ghost);
    drawDeck(ctx, sc, L, lw, ghost);
  } else {
    drawDeck(ctx, sc, L, lw, ghost);
    drawTruck(ctx, sc, a, L, lw, topVis, ghost);
    drawTruck(ctx, sc, b, L, lw, topVis, ghost);
  }
}

// ------------------------------------------------------------------ one frame
const POSE = newPose();
const GHOST = newPose();
const GHOST_STYLE = ['', ''];

function poseAt(m, sec, out) {
  m.pose(sec, out);
  const g = groundHeight(out.yaw, out.pitch, out.roll);
  out.y = out.air > g ? out.air : g;
  return out;
}

function placeCamera(sc, m, sec, pose) {
  if (sc.fixed) sc.camX = m.xMid;
  else if (sc.followUntil !== null && sec > sc.followUntil) {
    // the filmer has stopped following (followUntil) and turns back toward the rider (panBack): the board goes on
    // alone and leaves the shot
    followCamera(sc, m, sc.followUntil, poseAt(m, sc.followUntil, STOPPED));
    sc.camX -= filmerBack(sec - sc.followUntil, sc.panBack);
  } else followCamera(sc, m, sec, pose);
}
function followCamera(sc, m, sec, pose) {
  if (m.ledge) sc.yc = viewHeightAt(m, sec);
  // the filmer's smoothed follow, never letting the board out of the shot (a board that stops dead — a bail —
  // would otherwise drift to the edge while the smoothing catches up)
  const off = Math.max(0, (sc.w / sc.S) / 2 - 18);
  const c = camAt(m, sec);
  sc.camX = c < pose.x - off ? pose.x - off : c > pose.x + off ? pose.x + off : c;
}
const STOPPED = newPose();
const PAN_BACK_S = 2.4; // how long the filmer takes to turn back (s)
/**
 * How far (inches) a filmer who stopped following `tau` seconds ago has turned back toward the rider: `back` inches
 * in all, eased over 2.4 s. The camera moves back, so the scene — and the board going on alone — slides ahead.
 */
export function filmerBack(tau, back) {
  if (!(back > 0) || !(tau > 0)) return 0;
  const u = Math.min(1, tau / PAN_BACK_S);
  return back * u * u * (3 - 2 * u);
}

// ------------------------------------------------------------------ framing clear of a play badge
//
// Where the board lands on screen at one moment (its outline, top and bottom, walked every few px, and its wheels),
// then the shortest vertical move of the whole scene that keeps every one of those points off the badge's disc —
// and, for the app's tile (badgeSafe: true), off its corner chips as far as it can, and inside the frame.
const SAFE = newPose();
const SPTS = new Float32Array(4096); // x, y pairs
function badgePoints(sc) {
  let n = 0;
  const add = (x, y) => {
    if (n < SPTS.length - 1) {
      SPTS[n++] = x;
      SPTS[n++] = y;
    }
  };
  for (let k = 0; k < PANELS.length; k++) {
    const p = PANELS[k];
    for (let f = 0; f < 2; f++) {
      const arr = f ? p.bot : p.top;
      let px = 0;
      let py = 0;
      for (let i = 0; i <= p.nv; i++) {
        const j = (i % p.nv) * 3;
        proj(sc, arr[j], arr[j + 1], arr[j + 2], P2, 0);
        if (i) {
          const steps = Math.min(40, Math.ceil(Math.hypot(P2[0] - px, P2[1] - py) / 2.5));
          for (let q = 1; q <= steps; q++) add(px + ((P2[0] - px) * q) / steps, py + ((P2[1] - py) * q) / steps);
        } else add(P2[0], P2[1]);
        px = P2[0];
        py = P2[1];
      }
    }
  }
  for (const t of TRUCKS) {
    for (const w of t.wheels) {
      const k = proj(sc, w[0], w[1], w[2], P2, 0);
      const wr = WHEEL_R * sc.S * k + sc.lw * 0.5;
      for (let a = 0; a < 8; a++) add(P2[0] + wr * Math.cos((a * TAU) / 8), P2[1] + wr * Math.sin((a * TAU) / 8));
      add(P2[0], P2[1]);
    }
  }
  return n;
}
function badgeShift(sc, m, sec, o, above = o.badgeSafe === 'above') {
  const tile = o.badgeSafe === true || o.badgeSafe === 'above';
  const kx = sc.w / 83; // the app's tile: 83 × 110 pt
  const d = tile ? 26 * kx : +o.badgeSafe || 0;
  if (!(d > 0)) return 0;
  const r = d / 2 + Math.max(3, sc.w * 0.045); // the badge and a breath around it
  const r2 = r * r;
  const cx = sc.w / 2;
  const cy = sc.h / 2;
  poseAt(m, sec, SAFE);
  placeCamera(sc, m, sec, SAFE);
  setBoardTransform(sc, SAFE);
  const n = badgePoints(sc);
  // the chips (tile only): duration top right (inset 8, ~30 × 14), tag bottom left (from the edge, 8 up, ~52 × 19)
  const dr0 = sc.w - 38 * kx;
  const dr1 = sc.w - 8 * kx + 1;
  const dt0 = 8 * kx - 1;
  const dt1 = 22 * kx + 1;
  const tl1 = 52 * kx;
  const tt0 = sc.h - 27 * kx - 1;
  const tt1 = sc.h - 8 * kx + 1;
  let best = 0;
  let bestCost = Infinity;
  const lim = Math.ceil(sc.h * 0.8);
  for (let s = 0; s <= 2 * lim; s++) {
    const dy = s & 1 ? -((s + 1) >> 1) : s >> 1; // 0, −1, 1, −2, 2, … (ties go to the smaller move)
    let hit = 0;
    let chips = 0;
    let out = 0;
    for (let i = 0; i < n; i += 2) {
      const x = SPTS[i];
      const y = SPTS[i + 1] + dy;
      const ex = x - cx;
      const ey = y - cy;
      if (ex * ex + ey * ey < r2 || (above && ey > -r && ex * ex < r2)) hit++; // 'above': nothing under its top
      if (y < 1 || y > sc.h - 1) out++;
      if (tile && ((x >= dr0 && x <= dr1 && y >= dt0 && y <= dt1) || (x <= tl1 && y >= tt0 && y <= tt1))) chips++;
    }
    const cost = hit * 1e6 + out * 1e3 + chips * 3 + Math.abs(dy);
    if (cost < bestCost) {
      bestCost = cost;
      best = dy;
    }
    if (bestCost <= Math.abs(dy)) break; // nothing further can beat a clean fit this close
  }
  // 'above' and the board does not fit over the badge: clear of it, wherever that is
  return above && bestCost >= 1e6 ? badgeShift(sc, m, sec, o, false) : best;
}
// the vertical move a frame gets before frameOffset: the board's centre put at frameY of the height, or badgeSafe
function sceneShift(sc, m, sec, o) {
  if (o.frameY != null && isFinite(o.frameY)) {
    poseAt(m, sec, SAFE);
    placeCamera(sc, m, sec, SAFE);
    setWorldTransform(sc);
    proj(sc, SAFE.x, SAFE.y, SAFE.z, P2, 0);
    return o.frameY * sc.h - P2[1];
  }
  return o.badgeSafe ? badgeShift(sc, m, sec, o) : 0;
}
// the moment a frame is framed on: frameT (or badgeT) when given, else the frame's own (a still) / best (a view)
function frameSec(m, o, own) {
  const t = o.frameT ?? o.badgeT;
  return t != null && isFinite(t) ? Math.max(0, Math.min(1, t)) * m.duration : own;
}
function offsetScene(sc, o, shift) {
  sc.oy += shift;
  const f = o.frameOffset;
  if (typeof f === 'number') sc.oy += f;
  else if (f && f.length === 2) {
    sc.ox += +f[0] || 0;
    sc.oy += +f[1] || 0;
  }
}

function renderScene(ctx, sc, m, sec, o) {
  poseAt(m, sec, POSE);
  placeCamera(sc, m, sec, POSE);
  drawBackground(ctx, sc);
  drawShadow(ctx, sc, POSE);
  const trail = Math.max(0, Math.min(6, o.trail | 0));
  if (trail) {
    // the sequence of the trick itself: from just before the pop to just after the landing (a rolling board
    // leaves no trail, nor does a grinding one: m.trail lists the windows where ghosts belong)
    const gap = o.trailGap || 0.07;
    const win = m.trail;
    const L = sc.look;
    // trailDrop: the oldest ghosts left out, the others keeping the tone they have in the full trail; a fraction
    // fades the next one out by as much (a caller between two of its steps)
    const drop = Math.max(0, Math.min(trail, +o.trailDrop || 0));
    const gone = Math.floor(drop + 1e-6);
    const fade = drop - gone > 1e-3 ? drop - gone : 0;
    for (let i = trail - gone; i >= 1; i--) {
      const s = sec - i * gap;
      let inside = false;
      for (let w = 0; w < win.length; w++) if (s >= win[w][0] && s <= win[w][1]) inside = true;
      if (!inside) continue;
      poseAt(m, s, GHOST);
      const k = Math.min(L.ghostFill.length - 1, Math.round(((trail - i) / Math.max(1, trail - 1)) * (L.ghostFill.length - 1)));
      GHOST_STYLE[0] = L.ghostFill[k];
      GHOST_STYLE[1] = L.ghostLine[k];
      if (fade && i === trail - gone) ctx.globalAlpha = 1 - fade;
      drawBoard(ctx, sc, GHOST, GHOST_STYLE);
      ctx.globalAlpha = 1;
    }
  }
  drawBoard(ctx, sc, POSE, null);
  if (m.sparks) drawSparks(ctx, sc, m, sec, POSE);
}

const SCENE = newScene();

/**
 * Draws one frame into ctx at (0, 0, w, h) in the context's current units (the caller owns its transform: for a
 * canvas at devicePixelRatio 2 that is usually ctx.setTransform(2, 0, 0, 2, 0, 0) and opts.dpr = 2).
 * opts: { trick, t (0…1) | sec, look, trail, trailGap, camera, ground, ledge, bg, zoom, elev, yaw, mirror, dpr }.
 */
export function drawBoardFrame(ctx, w, h, opts = {}) {
  const m = getMotion(opts.trick);
  frameScene(SCENE, w, h, opts, m);
  SCENE.pat = patternsFor(ctx, SCENE.lookName, SCENE.look);
  const sec = Math.max(0, Math.min(m.duration, opts.sec ?? (opts.t ?? m.best) * m.duration));
  offsetScene(SCENE, opts, sceneShift(SCENE, m, frameSec(m, opts, sec), opts));
  renderScene(ctx, SCENE, m, sec, opts);
}

/**
 * Where things land in a frame drawn with these options (the same framing as drawBoardFrame, nothing drawn), in the
 * frame's px: the board's box { x0, y0, x1, y1 } and centre { cx, cy }, the wall line (wallY), the floor under the
 * lane (floorY), a grind's ledge edge under the board (ledgeY, or null), the scale (px per inch) and the vertical
 * move the framing made (shift). For overlays that have to sit in the empty air, clear of the board.
 */
export function measureBoardFrame(w, h, opts = {}) {
  const m = getMotion(opts.trick);
  const sc = MEASURE;
  frameScene(sc, w, h, opts, m);
  const sec = Math.max(0, Math.min(m.duration, opts.sec ?? (opts.t ?? m.best) * m.duration));
  const shift = sceneShift(sc, m, frameSec(m, opts, sec), opts);
  offsetScene(sc, opts, shift);
  poseAt(m, sec, SAFE);
  placeCamera(sc, m, sec, SAFE);
  setBoardTransform(sc, SAFE);
  const n = badgePoints(sc);
  const out = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, cx: 0, cy: 0, wallY: 0, floorY: 0, ledgeY: null, scale: sc.S, shift };
  for (let i = 0; i < n; i += 2) {
    if (SPTS[i] < out.x0) out.x0 = SPTS[i];
    if (SPTS[i] > out.x1) out.x1 = SPTS[i];
    if (SPTS[i + 1] < out.y0) out.y0 = SPTS[i + 1];
    if (SPTS[i + 1] > out.y1) out.y1 = SPTS[i + 1];
  }
  setWorldTransform(sc);
  proj(sc, SAFE.x, SAFE.y, SAFE.z, P2, 0);
  out.cx = P2[0];
  out.cy = P2[1];
  proj(sc, sc.camX, 0, -WALL_Z, P2, 0);
  out.wallY = P2[1];
  proj(sc, SAFE.x, 0, 0, P2, 0);
  out.floorY = P2[1];
  if (m.ledge) {
    proj(sc, SAFE.x, m.ledge.h, m.ledge.z, P2, 0);
    out.ledgeY = P2[1];
  }
  return out;
}
const MEASURE = newScene();

/**
 * A row of n frames side by side in (0, 0, w, h) — the clip player's frame scrubber, or a sequence. Frames span
 * [from, to] (0…1 of the clip; default from just before the pop to just after the landing), `gap` px apart
 * (default 2), each clipped to its cell. Other opts as drawBoardFrame (trail is ignored). Returns the cell width.
 */
export function drawBoardStrip(ctx, w, h, opts = {}) {
  const m = getMotion(opts.trick);
  const n = Math.max(1, opts.n || 12);
  const gap = opts.gap ?? 2;
  const from = opts.from ?? Math.max(0, m.marks.pop - 0.05);
  const to = opts.to ?? Math.min(1, m.marks.land + 0.1);
  const cw = (w - gap * (n - 1)) / n;
  const o = { ...opts, trail: 0, sec: undefined, t: 0 };
  for (let i = 0; i < n; i++) {
    const x = i * (cw + gap);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, 0, cw, h);
    ctx.clip();
    ctx.translate(x, 0);
    o.t = n > 1 ? from + ((to - from) * i) / (n - 1) : from;
    drawBoardFrame(ctx, cw, h, o);
    ctx.restore();
  }
  return cw;
}

// ------------------------------------------------------------------ views: a canvas that plays a clip

const RUN = {
  views: new Set(),
  raf: 0,
  last: 0,
  frame: 0,
  io: null,
  ro: null,
  byEl: new WeakMap(),
  hidden: typeof document !== 'undefined' ? document.hidden : false,
  mq: null,
  listening: false,
  stats: { frames: 0, drawMs: 0, lastMs: 0 },
};

function systemReduced() {
  if (typeof matchMedia === 'undefined') return false;
  if (!RUN.mq) {
    RUN.mq = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => RUN.views.forEach((v) => v._reducedChanged());
    if (RUN.mq.addEventListener) RUN.mq.addEventListener('change', on);
    else if (RUN.mq.addListener) RUN.mq.addListener(on);
  }
  return RUN.mq.matches;
}

function listen() {
  if (RUN.listening || typeof document === 'undefined') return;
  RUN.listening = true;
  document.addEventListener('visibilitychange', () => {
    RUN.hidden = document.hidden;
    if (!RUN.hidden) kick();
  });
  if (typeof IntersectionObserver !== 'undefined') {
    RUN.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const v = RUN.byEl.get(e.target);
          if (!v) continue;
          v.visible = e.isIntersecting;
          if (v.visible) v._draw();
        }
        kick();
      },
      { rootMargin: '80px 0px' },
    );
  }
  if (typeof ResizeObserver !== 'undefined') {
    RUN.ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const v = RUN.byEl.get(e.target);
        if (v) v.resize();
      }
    });
  }
}

function wants(v) {
  return v.playing && v.visible && !RUN.hidden && !v.reduced;
}

function kick() {
  if (RUN.raf || RUN.hidden) return;
  for (const v of RUN.views) {
    if (wants(v)) {
      RUN.last = 0;
      RUN.raf = requestAnimationFrame(tick);
      return;
    }
  }
}

function tick(now) {
  RUN.raf = 0;
  const dt = RUN.last ? Math.min(100, now - RUN.last) : 16.7;
  RUN.last = now;
  RUN.frame++;
  let any = false;
  const t0 = performance.now();
  for (const v of RUN.views) {
    if (!wants(v)) continue;
    any = true;
    v._advance(dt);
    if (v.every <= 1 || (RUN.frame + v.phase) % v.every === 0) v._draw();
  }
  if (any) {
    const ms = performance.now() - t0;
    RUN.stats.frames++;
    RUN.stats.drawMs += ms;
    RUN.stats.lastMs = ms;
    RUN.raf = requestAnimationFrame(tick);
  }
}

let PHASE = 0;

/** A canvas that plays a trick clip. See the header for the options. */
export function createBoardView(canvas, options = {}) {
  listen();
  const o = { trick: 'kickflip', look: 'night', trail: 0, speed: 1, loop: true, autoplay: true, ...options };
  const ctx = canvas.getContext('2d', { alpha: o.bg === false });
  const sc = newScene();
  let m = getMotion(o.trick);
  let framed = false; // the badge-safe shift is worked out for this size, trick and options
  let shift = 0;
  const v = {
    canvas,
    playing: false,
    visible: typeof IntersectionObserver === 'undefined',
    reduced: false,
    every: o.fps && o.fps <= 30 ? 2 : 1,
    phase: PHASE++ & 1,
    t: 0,
    w: 0,
    h: 0,
    dpr: 1,
    get motion() {
      return m;
    },
    get duration() {
      return m.duration;
    },
    get options() {
      return o;
    },
    play() {
      if (v.reduced) {
        v.t = m.best;
        v._draw();
        return v;
      }
      if (v.t >= 1 && !o.loop) v.t = 0;
      v.playing = true;
      kick();
      return v;
    },
    pause() {
      v.playing = false;
      return v;
    },
    toggle() {
      return v.playing ? v.pause() : v.play();
    },
    seek(t) {
      v.t = Math.max(0, Math.min(1, +t || 0));
      v._draw();
      return v;
    },
    frame(i, n) {
      return v.seek(n > 1 ? i / (n - 1) : 0);
    },
    setTrick(id) {
      m = getMotion(id);
      o.trick = m.id;
      v.t = v.reduced ? m.best : 0;
      framed = false;
      v._draw();
      return v;
    },
    // set(options, draw = true): draw false only takes the options, for a caller that seeks (and so draws) next
    set(next = {}, draw = true) {
      Object.assign(o, next);
      framed = false;
      if (next.trick) m = getMotion(next.trick);
      if (next.fps) v.every = next.fps <= 30 ? 2 : 1;
      if ('reduced' in next) v._reducedChanged();
      else if (draw) v._draw();
      return v;
    },
    resize() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 300));
      const h = Math.max(1, Math.round(rect.height || canvas.clientHeight || 150));
      const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
      if (w !== v.w || h !== v.h || dpr !== v.dpr) {
        v.w = w;
        v.h = h;
        v.dpr = dpr;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        o.dpr = dpr;
        framed = false;
      }
      v._draw();
      return v;
    },
    render() {
      v._draw();
      return v;
    },
    destroy() {
      v.playing = false;
      RUN.views.delete(v);
      if (RUN.io) RUN.io.unobserve(canvas);
      if (RUN.ro) RUN.ro.unobserve(canvas);
      RUN.byEl.delete(canvas);
    },
    _advance(dt) {
      v.t += (dt / 1000) * (o.speed || 1) / m.duration;
      if (v.t >= 1) {
        if (o.loop) v.t %= 1;
        else {
          v.t = 1;
          v.playing = false;
        }
      }
    },
    _draw() {
      if (!v.w) return;
      const t0 = performance.now();
      ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
      if (o.bg === false) ctx.clearRect(0, 0, v.w, v.h);
      frameScene(sc, v.w, v.h, o, m);
      sc.pat = patternsFor(ctx, sc.lookName, sc.look);
      if (!framed) {
        // frameY / badgeSafe: framed once (on the still a tile settles on, or frameT), kept while it plays
        shift = sceneShift(sc, m, frameSec(m, o, m.best * m.duration), o);
        framed = true;
      }
      offsetScene(sc, o, shift);
      renderScene(ctx, sc, m, v.t * m.duration, o);
      v.drawMs = performance.now() - t0;
      if (o.onFrame) o.onFrame(v.t, v);
    },
    _reducedChanged() {
      v.reduced = o.reduced ?? systemReduced();
      if (v.reduced) {
        v.playing = false;
        v.t = m.best;
      } else if (o.autoplay) v.play();
      v._draw();
    },
    drawMs: 0,
  };
  RUN.views.add(v);
  RUN.byEl.set(canvas, v);
  if (RUN.io) RUN.io.observe(canvas);
  if (RUN.ro) RUN.ro.observe(canvas);
  v.reduced = o.reduced ?? systemReduced();
  v.t = v.reduced ? m.best : (o.t ?? 0);
  v.resize();
  if (o.autoplay && !v.reduced) v.play();
  return v;
}

/** Frame-loop statistics of every view together: { frames, drawMs } (drawMs summed). */
export const boardStats = RUN.stats;
