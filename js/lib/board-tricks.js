// Trick motion as data, for the drawn skateboard of js/lib/board.js. No dependencies, no DOM.
//
// The scene: a regular-footed skater (never drawn) rolls to the right, +X, seen from the toe side — the camera is on
// +Z, in front of the rider's chest, as in a trick-tip sequence. World Y is up. The board's own axes: x long (nose
// +x, tail −x), y up out of the griptape, z lateral (toe side +z). A pose is
//
//   { x, z, yaw, pitch, roll, air }    inches and radians; the orientation is yaw (about world Y), then pitch (about
//                                       the board's lateral axis, + = nose up), then roll (about its long axis)
//
// and `air` is the height of the board's centre while it flies (−1e9 on the ground). board.js puts the board at
// max(air, the height at which its lowest point — a wheel, the tail, an edge, the grip — touches the ground), so a
// tail stays on the ground while it pops, an upside-down board lands on its grip, a board on its edge stands on it.
//
// Directions (the ones a skater checks first):
//   flip  + = kickflip: the toe-side edge goes up and over (to the heel side); − = heelflip
//   shuv  + = backside: the tail swings behind the rider (to −Z), the nose to the front; − = frontside
//   body  + = backside 180 of rider and board together (the board's yaw is the implied body rotation)
//
// A spec is a handful of numbers; buildMotion(spec, ground, geo) turns it into a motion { pose(sec, out), duration,
// … } with real timing: roll in, pop (≈ 55 ms with the tail on the ground), rise, rotation, catch, land, roll away.
// Times in a spec are seconds after the board leaves the ground (takeoff) unless they say otherwise.
//
// Grinds (kind 'grind') bring their own prop: a ledge behind the lane (the heel side: backside), 12" high, its waxed
// front edge 18" behind the lane. The board ollies up and sideways onto the edge and locks in — both hangers on the
// angle iron, the heel-side wheels on the ledge top, so the deck leans a little toward the lane — grinds, then pops
// off the end and lands on the floor. A motion that has a prop carries it as m.ledge { x0, x1, h, z, d } (world
// inches: start, end, height, front-edge z, depth), the edge contact per truck as m.sparks(sec, out), its own view
// height m.yc and m.trail, the windows (seconds) where a sequence's ghosts belong.

export const G = 386.09; // gravity, in/s²
export const ROLL = 110; // rolling speed, in/s (≈ 2.8 m/s, a push or two)
const DEG = Math.PI / 180;
const TURN = Math.PI * 2;
const OFF = -1e9; // `air` while the board is on the ground

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u) => ((u = clamp01(u)), u * u * (3 - 2 * u));
const smoother = (u) => ((u = clamp01(u)), u * u * u * (u * (u * 6 - 15) + 10));
const easeOut = (u, p = 2) => 1 - Math.pow(1 - clamp01(u), p);
const easeIn = (u, p = 2) => Math.pow(clamp01(u), p);

/** A spin that a flick starts and a catch stops: a short ramp in, constant speed, a short ramp out (slope continuous). */
function spin(u, a = 0.12, b = 0.1) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const v = 1 / (1 - a / 2 - b / 2);
  if (u < a) return (v * u * u) / (2 * a);
  if (u < 1 - b) return v * (a / 2 + u - a);
  const r = 1 - u;
  return 1 - (v * r * r) / (2 * b);
}

/** A damped rock after a contact: amp at τ = 0+, period and decay in seconds. */
const rock = (tau, amp, period, decay) => (tau <= 0 ? 0 : amp * Math.exp(-tau / decay) * Math.sin((TURN * tau) / period));

/** A single hump 0 → 1 → 0 over [0, 1]. */
const hump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u));

// ------------------------------------------------------------------ the tricks
//
// id is the motion's own id; trick is the dataset id (src/data/tricks.json) and name its English name, as the app
// shows it. outcome is the clip tag a take like this would carry: 'landed', 'almost' or 'attempt'.
//   pop     pitch at the pop, degrees (+ tail pop; − nollie, the nose pops)
//   v0      takeoff speed of the board's centre, in/s (the height of the trick)
//   flip    turns, + kickflip; flipAt [start, end] s after takeoff
//   shuv    turns, + backside; shuvAt [start, end] (start < 0 = the scoop starts on the pop)
//   body    turns of rider + board, + backside (bs 180): eased from the wind-up to just after the landing
//   level   s after takeoff until the front foot has levelled the board; dip = nose-down degrees at the top
//   miss    'bail' (under-flipped: lands on its grip, bounces, slides away upside down),
//           'primo' (lands on its edge, bounces, leans and wobbles there, goes over by `tip` turns: back onto its
//           wheels) or
//           'tilt' (an ollie the front foot loses: never levels, tips out sideways by `tilt` turns, comes down tail
//           first on its side, flops over onto its grip and slides away wheels up)
//   fakie   true: rolling tail first (the board turned round, its tail leading); the pop is still the tail's
//   best    s after takeoff of the one frame that tells the trick (the still under reduced motion, the thumbnail):
//           the moment the bottom graphic faces the camera for flips, a 3/4 turn for shuvs and 180s, the board at
//           the top for an ollie, mid-grind for a grind, and for a miss the board after it — upside down on the
//           ground, on its edge, or slipping off the ledge
// Grinds (kind 'grind'):
//   pop, v0 the ollie up onto the ledge; grind = s locked on the edge before the pop off the end; slip = s locked
//           on before the back truck slides off the edge (the 'almost': it falls to the floor and shoots out);
//           best = s after the lock-in (or after the slip) of the telling frame; lane = the z the board rolls in on
//           (default 13" in front of the edge; the almost's is where its riderless board ends up)

export const SPECS = [
  { id: 'ollie', trick: 'ollie', name: 'Ollie', pop: 31, v0: 96, level: 0.17, dip: 4, best: 0.2 },
  { id: 'kickflip', trick: 'kickflip', name: 'Kickflip', pop: 27, v0: 92, flip: 1, flipAt: [0.0, 0.3], best: 0.1 },
  { id: 'heelflip', trick: 'heelflip', name: 'Heelflip', pop: 27, v0: 92, flip: -1, flipAt: [0.0, 0.3], best: 0.205 },
  { id: 'pop-shuvit', trick: 'pop-shuvit', name: 'Pop Shuvit', pop: 22, v0: 80, shuv: 0.5, shuvAt: [-0.03, 0.27], best: 0.075 },
  { id: 'fs-pop-shuvit', trick: 'fs-pop-shuvit', name: 'FS Pop Shuvit', pop: 22, v0: 80, shuv: -0.5, shuvAt: [-0.03, 0.27], best: 0.075 },
  {
    id: 'varial-kickflip', trick: 'varial-kickflip', name: 'Varial Kickflip', pop: 25, v0: 90,
    flip: 1, flipAt: [0.0, 0.32], shuv: 0.5, shuvAt: [-0.03, 0.32], best: 0.23,
  },
  {
    id: 'varial-heelflip', trick: 'varial-heelflip', name: 'Varial Heelflip', pop: 25, v0: 90,
    flip: -1, flipAt: [0.0, 0.32], shuv: -0.5, shuvAt: [-0.03, 0.32], best: 0.1,
  },
  {
    id: '360-flip', trick: '360-flip', name: '360 Flip', pop: 26, v0: 98,
    flip: 1, flipAt: [0.0, 0.36], shuv: 1, shuvAt: [-0.03, 0.36], best: 0.21,
  },
  {
    id: 'hardflip', trick: 'hardflip', name: 'Hardflip', pop: 30, v0: 96,
    flip: 1, flipAt: [0.0, 0.32], shuv: -0.5, shuvAt: [-0.02, 0.32], best: 0.23,
  },
  {
    id: 'inward-heelflip', trick: 'inward-heelflip', name: 'Inward Heelflip', pop: 25, v0: 90,
    flip: -1, flipAt: [0.0, 0.32], shuv: 0.5, shuvAt: [-0.03, 0.32], best: 0.1,
  },
  {
    id: 'laser-flip', trick: 'laser-flip', name: 'Laser Flip', pop: 26, v0: 98,
    flip: -1, flipAt: [0.0, 0.36], shuv: -1, shuvAt: [-0.03, 0.36], best: 0.14,
  },
  { id: 'double-kickflip', trick: 'double-kickflip', name: 'Double Kickflip', pop: 28, v0: 100, flip: 2, flipAt: [0.0, 0.4], best: 0.08 },
  { id: 'bs-180', trick: 'bs-180', name: 'BS 180', pop: 30, v0: 94, level: 0.16, dip: 3, body: 0.5, best: 0.11 },
  { id: 'fs-180', trick: 'fs-180', name: 'FS 180', pop: 30, v0: 94, level: 0.16, dip: 3, body: -0.5, best: 0.11 },
  { id: 'nollie', trick: 'ollie', name: 'Ollie', stance: 'nollie', pop: -29, v0: 92, level: 0.17, dip: 3, best: 0.2 },
  { id: 'fakie-ollie', trick: 'ollie', name: 'Ollie', stance: 'fakie', fakie: true, pop: 30, v0: 92, level: 0.17, dip: 3, best: 0.2 },
  { id: 'manual', trick: 'manual', name: 'Manual', kind: 'manual', lean: 14, best: 1.0 },
  { id: 'nose-manual', trick: 'nose-manual', name: 'Nose Manual', kind: 'manual', lean: -11, best: 1.0 },
  { id: 'bs-50-50', trick: 'bs-50-50', name: 'BS 50-50', kind: 'grind', pop: 31, v0: 100, grind: 0.9, best: 0.4 },
  // takes that did not make it: the same Kickflip, tagged 'attempt' / 'almost' on the clip
  {
    id: 'kickflip-bail', trick: 'kickflip', name: 'Kickflip', outcome: 'attempt', pop: 26, v0: 88,
    flip: 0.5, miss: 'bail', best: 0.85,
  },
  {
    id: 'kickflip-primo', trick: 'kickflip', name: 'Kickflip', outcome: 'almost', pop: 27, v0: 92,
    flip: 1.25, tip: -0.25, miss: 'primo', best: 0.61,
  },
  {
    id: 'heelflip-bail', trick: 'heelflip', name: 'Heelflip', outcome: 'attempt', pop: 26, v0: 88,
    flip: -0.5, miss: 'bail', best: 0.85,
  },
  // an Ollie that did not make it, normal and fakie: the board tips out from under the feet and ends up wheels up
  {
    id: 'ollie-bail', trick: 'ollie', name: 'Ollie', outcome: 'attempt', pop: 30, v0: 86,
    miss: 'tilt', tilt: -0.27, best: 0.92,
  },
  {
    id: 'fakie-ollie-bail', trick: 'ollie', name: 'Ollie', stance: 'fakie', fakie: true, outcome: 'attempt', pop: 29, v0: 84,
    miss: 'tilt', tilt: 0.27, best: 0.92,
  },
  // a BS 50-50 that locks in and then slips off the edge: almost
  { id: 'bs-50-50-almost', trick: 'bs-50-50', name: 'BS 50-50', outcome: 'almost', kind: 'grind', pop: 31, v0: 100, grind: 0.9, slip: 0.36, best: 0.12 },
];

// ------------------------------------------------------------------ building a motion

/** The board's measures a grind needs (inches, the board's own axes), as board.js draws them; board.js passes its own. */
export const GEO = {
  axleX: 8.2, // half the wheelbase
  axleY: -2.225, // the axle under the board's centre (deck bottom − truck height)
  wheelZ: 3.62, // wheel centres either side
  wheelR: 1.06,
  wheelW: 1.22,
  housingR: 0.36, // the axle housing: what grinds
};

/**
 * Turns a spec into a motion. ground(yaw, pitch, roll) → the height of the board's centre that puts its lowest
 * point on the ground in that orientation (board.js owns the geometry and passes it in, with its measures as geo).
 */
export function buildMotion(spec, ground, geo) {
  if (spec.kind === 'manual') return buildManual(spec, ground);
  if (spec.kind === 'grind') return buildGrind(spec, ground, { ...GEO, ...geo });
  return buildPop(spec, ground);
}

/** world = Ry(yaw) · Rz(pitch) · Rx(roll) · (x, y, z), into out[0…2] (board.js's rotation, for a single point). */
function rotate(yaw, pitch, roll, x, y, z, out) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);
  const y1 = cr * y - sr * z;
  const z1 = sr * y + cr * z;
  const x2 = cp * x - sp * y1;
  out[0] = cy * x2 + sy * z1;
  out[1] = sp * x + cp * y1;
  out[2] = -sy * x2 + cy * z1;
  return out;
}

function base(spec) {
  return {
    id: spec.id,
    trick: spec.trick ?? spec.id,
    name: spec.name,
    outcome: spec.outcome ?? 'landed',
    stance: spec.stance ?? 'normal',
    kind: spec.kind ?? 'pop',
    spec,
  };
}

function buildPop(spec, ground) {
  const P = (spec.pop ?? 28) * DEG;
  const v0 = spec.v0 ?? 92;
  const tPop = spec.tPop ?? 0.62; // roll-in before the pop
  const popDur = 0.055; // tail strike: the board pivots on the tail
  const tTO = tPop + popDur; // takeoff
  const level = spec.level ?? 0.1;
  const dip = (spec.dip ?? 1.5) * DEG;
  const miss = spec.miss ?? null;
  const flip = spec.flip ?? 0;
  const shuv = spec.shuv ?? 0;
  const body = spec.body ?? 0;
  const yaw0 = spec.fakie ? Math.PI : 0; // fakie: the board turned round, rolling tail first
  const tilt = miss === 'tilt' ? (spec.tilt ?? -0.27) * TURN : 0;

  const y0 = ground(0, P, 0); // the centre at takeoff: pitched, tail on the ground
  const rest = ground(0, 0, 0);
  // a flat landing (all four wheels): the nominal end of the air time, which the rotations aim at
  const tAir = (v0 + Math.sqrt(v0 * v0 + 2 * G * (y0 - rest))) / G;
  const tLandNom = tTO + tAir;
  // a missed flick spins slower and is still turning when it hits the ground
  const flipAt = spec.flipAt ?? [0.0, miss === 'bail' ? tAir + 0.05 : miss ? tAir : 0.3];
  const shuvAt = spec.shuvAt ?? [-0.03, 0.3];
  const bodyAt = [tPop - 0.1, tLandNom + 0.06]; // absolute: the wind-up starts before the pop, the pivot ends after

  const m = base(spec);
  m.tPop = tPop;
  m.tTO = tTO;
  m.tLand = Infinity; // found below
  m.rest = rest;

  const flipTurns = (s) => {
    if (!flip) return 0;
    const u = (s - tTO - flipAt[0]) / (flipAt[1] - flipAt[0]);
    // a landed flip is caught (the ramp out); a missed one is not, the ground stops it
    return flip * (miss ? spin(u, 0.1, 0.2) : spin(u, 0.12, 0.12));
  };
  const shuvTurns = (s) => (shuv ? shuv * spin((s - tTO - shuvAt[0]) / (shuvAt[1] - shuvAt[0]), 0.16, 0.14) : 0);
  const bodyTurns = (s) => (body ? body * smoother((s - bodyAt[0]) / (bodyAt[1] - bodyAt[0])) : 0);
  // a tilt starts slow and gives way: the board tips out from under the feet over the whole flight
  const tiltAt = (s) => smooth((s - tTO - 0.03) / (tAir * 0.92));

  // Everything after the landing (wobble, bounce, slide, the primo fall) needs tLand; the air phase does not.
  let tLand = Infinity;
  let yLand = rest;
  let xLand = 0;
  const after = { yaw: 0, roll: 0, pitch: 0, x: 0, air: OFF };
  const atLand = { yaw: 0, pitch: 0, roll: 0 }; // the flying pose at the touchdown (a tilt carries on from it)

  function landed(s, out) {
    const tau = s - tLand;
    after.yaw = 0;
    after.roll = 0;
    after.pitch = 0;
    after.air = OFF;
    after.x = xLand + ROLL * tau;
    if (!miss) {
      after.pitch = rock(tau, 2.2 * DEG, 0.13, 0.07); // the front wheels touch a hair late
      after.x = xLand + ROLL * 0.97 * tau;
    } else if (miss === 'bail') {
      // grip down on the ground: a clack and a little hop, then it slides away upside down and stops
      const vb = 34;
      const hop = yLand + vb * tau - 0.5 * G * tau * tau;
      after.air = tau < (2 * vb) / G ? hop : OFF;
      const a = 165; // sliding on the grip
      const tStop = ROLL / a;
      const tt = Math.min(tau, tStop);
      after.x = xLand + ROLL * tt - 0.5 * a * tt * tt;
      after.yaw = 0.42 * easeOut(tau / 0.9, 2.2);
      after.roll = rock(tau, 7 * DEG, 0.17, 0.09);
      after.pitch = rock(tau, -3 * DEG, 0.12, 0.06);
    } else if (miss === 'primo') {
      // lands on its edge (over-flipped: the graphic faces the camera) and bounces off it, leans over and wobbles
      // there for a moment with nobody on it, then goes over: back onto its wheels, and rolls off slowly. It never
      // stands still on its edge: the lean is already the way it falls.
      const tip = spec.tip ?? -0.25;
      const sg = -Math.sign(tip) || 1; // + roll: the way it goes over (back toward grip up)
      const hold = 0.17; // on its edge, going over by ≈ 1.35 s
      const fall = 0.22;
      const a = 260; // sliding on its edge, then on its wheels
      const v1 = ROLL * 0.35;
      const tt = Math.min(tau, ROLL / a);
      after.x = xLand + ROLL * tt - 0.5 * a * tt * tt;
      after.air = tau < 0.06 ? yLand + 0.6 * hump(tau / 0.06) : OFF; // the clack: up off its edge for a moment
      const onEdge = (u) => 10 * DEG * easeOut(u / 0.1, 2) + rock(u, 4 * DEG, 0.15, 0.14); // the lean, wobbling
      if (tau < hold) after.roll = sg * onEdge(tau);
      else {
        const tf = tau - hold;
        const r0 = onEdge(hold);
        after.roll = sg * (r0 + (TURN * Math.abs(tip) - r0) * easeIn(tf / fall, 2.2)) + (tf > fall ? Math.sign(tip) * rock(tf - fall, 5 * DEG, 0.12, 0.06) : 0);
        if (tf > fall) after.x += v1 * (tf - fall) * Math.min(1, (tf - fall) / 0.25);
      }
      after.yaw = 0.12 * easeOut(tau / 0.5);
    } else if (miss === 'tilt') {
      // (absolute, not added) tail first on its side: the nose slaps down, the board flops over onto its grip and
      // slides off wheels up, turning a little
      const sg = Math.sign(tilt) || 1;
      const fallT = 0.27;
      after.pitch = atLand.pitch * (1 - easeIn(tau / 0.1, 2)) + (tau > 0.1 ? rock(tau - 0.1, -2.4 * DEG, 0.12, 0.06) : 0);
      after.roll =
        atLand.roll + (sg * Math.PI - atLand.roll) * easeIn(tau / fallT, 2.2) + (tau > fallT ? rock(tau - fallT, -sg * 7 * DEG, 0.16, 0.08) : 0);
      after.yaw = atLand.yaw + sg * 0.36 * easeOut(tau / 1.0, 2);
      const vb = 22; // the first clack bounces it a little
      after.air = tau < (2 * vb) / G ? yLand + vb * tau - 0.5 * G * tau * tau : OFF;
      const a = 150;
      const tt = Math.min(tau, ROLL / a);
      after.x = xLand + ROLL * tt - 0.5 * a * tt * tt;
    }
    out.x = after.x;
  }

  m.pose = function pose(s, out) {
    out.z = 0;
    let pitch = 0;
    if (s >= tPop && s < tTO) pitch = P * easeOut((s - tPop) / popDur, 2);
    else if (s >= tTO) {
      const tau = s - tTO;
      // a tilt: the front foot never gets the board level, the nose stays up
      if (tilt) pitch = P * (1 - 0.55 * smoother(tau / 0.22));
      else pitch = P * (1 - smoother(tau / level)) - dip * hump((tau - level * 0.5) / 0.3);
    }
    out.pitch = pitch;
    out.yaw = yaw0 - TURN * (shuvTurns(s) + bodyTurns(s));
    out.roll = -TURN * flipTurns(s);
    // a kickflip wanders a few degrees about the vertical: the flick is not perfectly sideways
    if (flip && !shuv) out.yaw += -Math.sign(flip) * 0.07 * hump((s - tTO) / 0.42);
    if (tilt) {
      const u = tiltAt(s);
      out.roll = tilt * u;
      out.yaw += Math.sign(tilt) * 0.1 * u; // and it kicks out a little
    }
    out.x = ROLL * (s - tPop);
    out.air = OFF;
    if (s >= tTO) {
      const tau = s - tTO;
      out.air = y0 + v0 * tau - 0.5 * G * tau * tau;
    }
    if (s >= tLand) {
      landed(s, out);
      if (tilt) {
        out.yaw = after.yaw;
        out.pitch = after.pitch;
        out.roll = after.roll;
        out.air = after.air;
        return out;
      }
      out.yaw += after.yaw;
      out.roll += after.roll;
      out.pitch += after.pitch;
      out.air = after.air;
    }
    return out;
  };

  // find the landing: the first moment after the top at which the flying centre is not above the contact height
  // (coarse steps, then bisection: a couple of hundred contact tests per trick)
  const tmp = { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, air: 0 };
  const down = (s) => {
    m.pose(s, tmp);
    return tmp.air <= ground(tmp.yaw, tmp.pitch, tmp.roll);
  };
  let lo = tTO + v0 / G;
  let hi = lo;
  while (hi < tTO + 3 && !down(hi)) {
    lo = hi;
    hi += 0.004;
  }
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    if (down(mid)) hi = mid;
    else lo = mid;
  }
  m.pose(hi, tmp); // the flying pose at the touchdown (tLand is still ∞ here)
  atLand.yaw = tmp.yaw;
  atLand.pitch = tmp.pitch;
  atLand.roll = tmp.roll;
  tLand = hi;
  yLand = ground(tmp.yaw, tmp.pitch, tmp.roll);
  xLand = ROLL * (hi - tPop);
  m.tLand = tLand;
  m.duration = spec.duration ?? tLand + (miss ? 1.05 : 0.72);
  m.best = clamp01((tTO + (spec.best ?? 0.15)) / m.duration);
  m.marks = { pop: tPop / m.duration, takeoff: tTO / m.duration, land: tLand / m.duration };
  m.xMid = ROLL * ((tTO + tLand) / 2 - tPop); // the middle of the air: where a still camera stands
  m.xSpan = ROLL * Math.max(0.5, tLand - tTO); // how far it travels in the air: what a still camera takes in
  m.trail = [[tPop - 0.12, tLand + 0.2]]; // the sequence of the trick itself: a rolling board leaves no ghosts
  return m;
}

function buildManual(spec) {
  const M = (spec.lean ?? 14) * DEG;
  const tLift = spec.tPop ?? 0.5;
  const rise = 0.2;
  const hold = 1.45;
  const tDrop = tLift + rise + hold;
  const drop = 0.11;
  const v = ROLL * 0.85;
  const m = base(spec);
  m.tPop = tLift;
  m.tTO = tLift;
  m.tLand = tDrop + drop;
  m.pose = function pose(s, out) {
    out.z = 0;
    out.yaw = 0;
    out.roll = 0;
    out.air = OFF;
    out.x = v * (s - tLift);
    let p = 0;
    if (s >= tLift && s < tLift + rise) p = M * easeOut((s - tLift) / rise, 2.4) * (1 + 0.12 * hump((s - tLift) / rise));
    else if (s >= tLift + rise && s < tDrop) {
      const tau = s - tLift - rise;
      // balancing: a slow sway, a quicker correction on top, settling a little toward the end
      p = M + (2.6 * Math.sin((TURN * tau) / 0.95) + 1.2 * Math.sin((TURN * tau) / 0.41 + 0.7)) * DEG * smooth(tau / 0.3);
    } else if (s >= tDrop && s < tDrop + drop) {
      const p0 = M + (2.6 * Math.sin((TURN * hold) / 0.95) + 1.2 * Math.sin((TURN * hold) / 0.41 + 0.7)) * DEG;
      p = p0 * (1 - easeIn((s - tDrop) / drop, 2));
    } else if (s >= tDrop + drop) p = -Math.sign(M) * rock(s - tDrop - drop, 1.6 * DEG, 0.12, 0.06);
    out.pitch = p;
    return out;
  };
  m.duration = spec.duration ?? tDrop + drop + 0.65;
  m.best = clamp01((tLift + (spec.best ?? 1.0)) / m.duration);
  m.marks = { pop: tLift / m.duration, takeoff: tLift / m.duration, land: (tDrop + drop) / m.duration };
  m.xMid = v * (rise + hold * 0.5);
  m.trail = [[tLift - 0.12, m.tLand + 0.2]];
  return m;
}

// ------------------------------------------------------------------ grinds
//
// BS 50-50 on the ledge behind the lane (the heel side). Phases, in seconds of the clip:
//   roll in along the ledge → pop → the ollie up and sideways (13" back, 12" up) → lock-in: both hangers clack onto
//   the angle iron at once → the grind (the board level, chattering, slowing a touch) →
//   landed: a small pop off the end of the ledge, out sideways over the lane, a 12" drop, all four wheels, roll away;
//   almost: the back truck slides off the edge toward the lane, the board pivots on the front truck, falls off,
//   hits the floor tail first, slaps down leaning and shoots out riderless, straightening out along the ledge.
// Either way the clip ends rolling straight in the lane it started in, so a loop has no seam.

const SLIP_A = 0.15; // the back truck going (s)

function buildGrind(spec, ground, g) {
  const L = { h: 12, z: -18, d: 12, x0: -30, ...(spec.ledge || {}) };
  const P = (spec.pop ?? 31) * DEG;
  const v0 = spec.v0 ?? 100;
  const tPop = spec.tPop ?? 0.62;
  const popDur = 0.055;
  const tTO = tPop + popDur;
  const almost = (spec.outcome ?? 'landed') === 'almost';
  // the lane: the board rolls in parallel to the ledge at zA and (landed) pops out back onto it past the end, so a
  // looping clip starts where it ends; the almost's lane is wherever its riderless board ends up (found below)
  let zA = spec.lane ?? L.z + 13;
  const m = base(spec);
  m.kind = 'grind';
  m.tPop = tPop;
  m.tTO = tTO;
  m.rest = ground(0, 0, 0);

  // the lock: the housings on the edge (housingR above it, the edge `e` toward the toe side of the board's middle)
  // and the heel-side wheels on the ledge top — which leans the deck toe side down by rL
  const e = spec.edgeAt ?? 0.6;
  const fr = (r) => Math.sin(r) * (g.wheelZ + e - g.wheelW / 2) - (g.wheelR * Math.cos(r) - g.housingR);
  let lo = 0;
  let hi = 0.7;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (fr(mid) > 0) hi = mid;
    else lo = mid;
  }
  const rL = (lo + hi) / 2;
  const yL = L.h + g.housingR - g.axleY * Math.cos(rL) + e * Math.sin(rL);
  const zL = L.z - g.axleY * Math.sin(rL) - e * Math.cos(rL);

  // the ollie up: from the popped tail to the lock height on the way down
  const y0 = ground(0, P, 0);
  const tLock = tTO + (v0 + Math.sqrt(Math.max(0, v0 * v0 - 2 * G * (yL - y0)))) / G;
  const fly = tLock - tTO;
  const xLock = ROLL * (tLock - tPop);
  // the grind: the clack costs a little speed, the wax keeps the rest
  const vG = ROLL * 0.95;
  const aG = 14;
  const Tg = spec.grind ?? 0.9;
  const tOut = tLock + Tg; // landed: the pop off the end
  const xOut = xLock + vG * Tg - 0.5 * aG * Tg * Tg;
  const vOut = vG - aG * Tg;
  L.x1 = xOut + g.axleX + 3; // the front truck is 3" from the end when it pops (the almost slips on the same ledge)
  const tSlip = almost ? tLock + (spec.slip ?? 0.36) : Infinity;

  // the pop off the end (landed): the nose comes up on the back truck, then a short hop and a 12" drop
  const Q = 16 * DEG;
  const pivot = 0.06;
  const tO2 = tOut + pivot;
  const v1 = spec.v1 ?? 46;
  const zOff = zA; // it pops out sideways, back over the lane

  const grindPose = (s, out) => {
    const tau = s - tLock;
    out.x = xLock + vG * tau - 0.5 * aG * tau * tau;
    out.z = zL;
    out.yaw = 0.004 * Math.sin((TURN * tau) / 0.53);
    // the clack: a quick squash, then the chatter of steel on steel and a slow nose bob
    out.air = yL + 0.1 - 0.16 * hump(tau / 0.085) + 0.03 * Math.sin(TURN * tau * 31);
    out.roll = rL + rock(tau, 1.5 * DEG, 0.11, 0.06) + 0.3 * DEG * Math.sin(TURN * tau * 27 + 1.3);
    out.pitch = rock(tau, -1.4 * DEG, 0.12, 0.07) + 0.6 * DEG * Math.sin((TURN * tau) / 0.62) * smooth(tau / 0.2);
    return out;
  };

  // after the slip (almost): phase A pivots on the front truck, phase B falls, phase C rolls out (a table)
  const SA = { yaw: 0.3, pitch: 0.17, roll: 0.3 }; // where phase A ends, relative to the lock
  const F = new Float64Array(3);
  const pf = new Float64Array(3); // the front truck's contact at the slip
  const slipA = (s, out) => {
    const u = clamp01((s - tSlip) / SLIP_A);
    // the tail swings out first, the deck leans off the edge with it, then the back truck drops
    out.yaw = SA.yaw * smooth(u);
    out.roll = rL + SA.roll * smooth(u);
    out.pitch = SA.pitch * easeIn(u, 2.4);
    rotate(out.yaw, out.pitch, out.roll, g.axleX, g.axleY, e, F);
    const slide = vG * 0.9 * (s - tSlip);
    out.x = pf[0] + slide - F[0];
    out.air = pf[1] - F[1];
    out.z = pf[2] - F[2];
    return out;
  };
  const B0 = { x: 0, z: 0, air: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, roll: 0 };
  const slipB = (s, out) => {
    const tau = s - tSlip - SLIP_A;
    out.x = B0.x + B0.vx * tau;
    out.z = B0.z + B0.vz * tau;
    out.air = B0.air + B0.vy * tau - 0.5 * G * tau * tau;
    out.yaw = B0.yaw - 0.14 * smooth(tau / 0.2); // the nose follows the tail out
    out.pitch = B0.pitch + 0.07 * smooth(tau / 0.2);
    out.roll = B0.roll + (8 * DEG - B0.roll) * smooth((tau - 0.09) / 0.18); // leaning off it until clear
    return out;
  };
  if (almost) {
    const c = grindPose(tSlip, {});
    rotate(c.yaw, c.pitch, c.roll, g.axleX, g.axleY, e, F);
    pf[0] = c.x + F[0];
    pf[1] = c.air + F[1];
    pf[2] = c.z + F[2];
    const a = slipA(tSlip + SLIP_A, {});
    const b = slipA(tSlip + SLIP_A - 0.004, {});
    Object.assign(B0, { x: a.x, z: a.z, air: a.air, yaw: a.yaw, pitch: a.pitch, roll: a.roll });
    B0.vx = (a.x - b.x) / 0.004;
    B0.vy = (a.air - b.air) / 0.004;
    B0.vz = (a.z - b.z) / 0.004 + 60; // and it squirts out toward the lane
  }

  let tLand = Infinity; // landed: back on the floor past the end; almost: the tail hits the floor
  const C0 = { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, vz: 0 };
  const CN = 360; // phase C table: 1.5 s at 240 Hz
  const CX = new Float64Array(CN + 1);
  const CZ = new Float64Array(CN + 1);
  const CDT = 1 / 240;
  const vC = vG * 1.04; // the rider's foot comes off: the board shoots out
  const yawC = (tau) => C0.yaw * (1 - smooth(tau / 0.55)); // and straightens out along the ledge

  const flyOff = (s, out) => {
    // landed, after the pivot: a short hop off the end
    const tau = s - tO2;
    out.x = xOut + vOut * (s - tOut) + g.axleX * (1 - Math.cos(Q));
    out.z = zL + (zOff - zL) * smooth(tau / 0.34);
    out.air = yL + g.axleX * Math.sin(Q) + v1 * tau - 0.5 * G * tau * tau;
    out.pitch = Q * (1 - smoother(tau / 0.15)) - 2.2 * DEG * hump((tau - 0.08) / 0.24);
    out.roll = rL * (1 - smooth(tau / 0.13));
    out.yaw = 0;
    return out;
  };

  m.pose = function pose(s, out) {
    if (s < tTO) {
      // rolling in along the ledge, then the pop on the tail
      out.x = ROLL * (s - tPop);
      out.z = zA;
      out.yaw = 0;
      out.pitch = s >= tPop ? P * easeOut((s - tPop) / popDur, 2) : 0;
      out.roll = 0;
      out.air = OFF;
      return out;
    }
    if (s < tLock) {
      // the ollie: up, over the edge, level, the lean of the lock set just before the trucks meet the iron
      const tau = s - tTO;
      out.x = ROLL * (s - tPop);
      // up and sideways onto the edge (a touch of yaw as the back foot steers it in)
      out.z = zA + (zL - zA) * smoother((tau + 0.02) / (fly - 0.05));
      out.yaw = 0.06 * hump(tau / (fly - 0.04));
      out.pitch = P * (1 - smoother(tau / 0.17)) - 3 * DEG * hump((tau - 0.085) / Math.max(0.1, fly - 0.1));
      out.roll = rL * smooth((tau - (fly - 0.15)) / 0.15);
      out.air = y0 + v0 * tau - 0.5 * G * tau * tau;
      return out;
    }
    if (almost) {
      if (s < tSlip) return grindPose(s, out);
      if (s < tSlip + SLIP_A) return slipA(s, out);
      if (s < tLand) return slipB(s, out);
      // phase C: the tail is down, the nose slaps, the board leans, wobbles and shoots out riderless
      const tau = s - tLand;
      const f = Math.min(CN, tau / CDT);
      const i = Math.min(CN - 1, Math.floor(f));
      const k = f - i;
      out.x = CX[i] + (CX[i + 1] - CX[i]) * k;
      out.z = CZ[i] + (CZ[i + 1] - CZ[i]) * k;
      out.yaw = yawC(tau);
      out.pitch = C0.pitch * (1 - easeIn(tau / 0.08, 2)) + (tau > 0.08 ? rock(tau - 0.08, -3 * DEG, 0.12, 0.07) : 0);
      out.roll = C0.roll * (1 - smooth(tau / 0.1)) + rock(tau, 6 * DEG, 0.22, 0.14);
      out.air = OFF;
      return out;
    }
    if (s < tOut) return grindPose(s, out);
    if (s < tO2) {
      // the nose comes up on the back truck (the board pivots on it, still sliding)
      const u = (s - tOut) / pivot;
      out.pitch = Q * easeOut(u, 2);
      out.roll = rL;
      out.yaw = 0;
      out.x = xOut + vOut * (s - tOut) + g.axleX * (1 - Math.cos(out.pitch));
      out.z = zL;
      out.air = yL + g.axleX * Math.sin(out.pitch);
      return out;
    }
    if (s < tLand) return flyOff(s, out);
    const tau = s - tLand;
    out.x = C0.x + vOut * 0.97 * tau;
    out.z = zOff;
    out.yaw = 0;
    out.pitch = rock(tau, 3 * DEG, 0.13, 0.08); // a 12" drop: the front wheels come down hard
    out.roll = rock(tau, -1.2 * DEG, 0.15, 0.08);
    out.air = OFF;
    return out;
  };

  // the touchdown on the floor: off the end (landed) or off the side, tail first (almost)
  const tmp = { x: 0, z: 0, yaw: 0, pitch: 0, roll: 0, air: 0 };
  const phase = almost ? slipB : flyOff;
  const down = (s) => {
    phase(s, tmp);
    return tmp.air <= ground(tmp.yaw, tmp.pitch, tmp.roll);
  };
  let a = almost ? tSlip + SLIP_A : tO2 + v1 / G;
  let b = a;
  while (b < a + 2 && !down(b)) {
    a = b;
    b += 0.004;
  }
  for (let i = 0; i < 12; i++) {
    const mid = (a + b) / 2;
    if (down(mid)) b = mid;
    else a = mid;
  }
  tLand = b;
  phase(tLand, tmp);
  Object.assign(C0, { x: tmp.x, z: tmp.z, yaw: tmp.yaw, pitch: tmp.pitch, roll: tmp.roll, vz: almost ? B0.vz : 0 });
  if (almost) {
    // roll out along the heading as it carves; the sideways squirt dies in the wheels
    CX[0] = C0.x;
    CZ[0] = C0.z;
    for (let i = 1; i <= CN; i++) {
      const tau = (i - 0.5) * CDT;
      const yw = yawC(tau);
      const v = Math.max(0, vC - 26 * tau);
      CX[i] = CX[i - 1] + v * Math.cos(yw) * CDT;
      CZ[i] = CZ[i - 1] + (-v * Math.sin(yw) + C0.vz * Math.exp(-tau / 0.07)) * CDT;
    }
    // its lane: where it rolls at the end of the clip (the loop starts there)
    const k = Math.min(CN, ((spec.duration ?? tLand + 1.0) - tLand) / CDT);
    const i = Math.min(CN - 1, Math.floor(k));
    zA = Math.max(L.z + 9, Math.min(L.z + 24, CZ[i] + (CZ[i + 1] - CZ[i]) * (k - i)));
  }

  m.tLand = tLand;
  m.tLock = tLock;
  m.duration = spec.duration ?? tLand + (almost ? 1.0 : 0.72);
  const D = m.duration;
  m.ledge = L;
  m.yc = 13.5; // the view height a grind is framed on (the ledge lifts the action)
  m.xMid = (C0.x + 10) / 2; // a still camera takes in the pop, the grind and the touchdown
  m.xSpan = C0.x + 30;
  m.best = clamp01((almost ? tSlip + (spec.best ?? 0.12) : tLock + (spec.best ?? 0.4)) / D);
  m.marks = { pop: tPop / D, takeoff: tTO / D, lock: tLock / D, land: tLand / D };
  if (almost) m.marks.slip = tSlip / D;
  else m.marks.out = tOut / D;
  m.trail = almost
    ? [
        [tPop - 0.12, tLock + 0.08],
        [tSlip - 0.02, tLand + 0.25],
      ]
    : [
        [tPop - 0.12, tLock + 0.08],
        [tOut - 0.04, tLand + 0.2],
      ];

  // steel on the edge, per truck: 0 (off) … 1 (the clack); burst 0…1 = how fresh the last clack is
  const backEnd = almost ? tSlip + 0.04 : tO2;
  const frontEnd = almost ? tSlip + SLIP_A * 0.8 : tOut;
  m.sparks = function sparks(s, out) {
    out.back = 0;
    out.front = 0;
    out.burst = 0;
    if (s < tLock || s > Math.max(backEnd, frontEnd)) return out;
    const tau = s - tLock;
    const clack = Math.exp(-tau / 0.07);
    out.burst = clack;
    if (s < backEnd) out.back = 0.5 + 0.5 * clack;
    if (s < frontEnd) out.front = 0.5 + 0.5 * clack;
    if (!almost && s >= tOut) {
      out.back = 0.9; // the pop: the back truck bites
      out.burst = Math.max(out.burst, 0.7);
    }
    if (almost && s >= tSlip) {
      const k = (s - tSlip) / SLIP_A;
      out.front = 0.9 * (1 - k * 0.5); // the front truck scrapes as the board goes
      out.burst = Math.max(out.burst, 0.6);
    }
    return out;
  };
  return m;
}
