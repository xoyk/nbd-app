// Node anatomy — DESIGN.md §3.2 — as data, ported from the app's src/theme/node.ts so the canvas map and the
// big SVG nodes are the same drawing. A node is a list of layers drawn back to front, centred on (0, 0) at 1×
// (screen pt; nodes never scale with the map zoom). Numbers are the app's tokens (docs/design/tokens.json).

export const COLORS = Object.freeze({
  grip: '#0F0F0E',
  surface1: '#181816',
  surface3: '#2E2E2A',
  paper: '#ECE6D6',
  ink: '#11110F',
  inkSoft: '#4A4840',
  primary: '#ECE6D6',
  muted: '#8A8678',
  red: '#FF4524',
  yellow: '#FFD21A',
  pool: '#FFC98A',
  shadow: '#000000',
  neutralLit: '#ECE6D6',
  neutralReachable: '#98948A',
  neutralUnlit: '#63615A',
});

// The 39 lines' premixed colours [lit, reachable, unlit] (docs/design/tokens.json lines.<id>; never alpha).
export const LINE_COLORS = Object.freeze({
  'basics-rolling': ['#EDE8D8', '#99968B', '#63615B'],
  'basics-turning': ['#C0BEB5', '#7D7C76', '#52524D'],
  'basics-street': ['#8B9AAB', '#5C656F', '#3E444A'],
  'ollie-pop': ['#FBA01D', '#A16917', '#694614'],
  'ollie-style': ['#FBCE9F', '#A18568', '#695845'],
  'ollie-spin': ['#C87F37', '#825427', '#553A1E'],
  'shuv-bs': ['#28D3F4', '#1E899D', '#185965'],
  'shuv-fs': ['#AAEFF7', '#6F9A9E', '#4A6467'],
  'shuv-bigspin': ['#24A5DA', '#1C6C8C', '#17485C'],
  'flip-kickflip': ['#FE429D', '#A32F67', '#6A2244'],
  'flip-heelflip': ['#FEA9D1', '#A36E87', '#6A4A58'],
  'flip-rotation': ['#D84BDE', '#8C348F', '#5B265D'],
  'flip-pressure': ['#FCD4EC', '#A28998', '#695A62'],
  'flip-late': ['#FE84A9', '#A3586E', '#6A3B49'],
  'grind-slappy': ['#ADF3D7', '#719C8B', '#4B665A'],
  'grind-basic': ['#3CE074', '#2B914D', '#205E35'],
  'grind-nose': ['#3BAC56', '#2A703B', '#204B29'],
  'grind-smith': ['#4BC6A5', '#34806C', '#265547'],
  'grind-combo': ['#B4F48B', '#759D5B', '#4E663D'],
  'slide-board': ['#A785FC', '#6D58A2', '#493C68'],
  'slide-nosetail': ['#D1C4FD', '#877FA2', '#595469'],
  'slide-blunt': ['#B65CE6', '#773F94', '#4E2C60'],
  'slide-combo': ['#92A8FE', '#606EA3', '#414969'],
  'manual-tail': ['#37D8C9', '#288C82', '#1E5B55'],
  'manual-nose': ['#A9EEE4', '#6E9993', '#4A645F'],
  'manual-balance': ['#16A7A3', '#136D6A', '#124947'],
  'oldschool-footplant': ['#D3B378', '#897550', '#594D36'],
  'oldschool-no-comply': ['#E9DAB6', '#968D76', '#625C4E'],
  'oldschool-freestyle': ['#AB7C42', '#70532E', '#4A3822'],
  'oldschool-street': ['#B99684', '#786357', '#50423B'],
  'transition-basics': ['#689CFD', '#4666A2', '#314569'],
  'transition-stalls': ['#B5D4FD', '#7689A2', '#4E5A69'],
  'transition-rocks': ['#5B79F7', '#3E519E', '#2C3767'],
  'transition-grinds': ['#3FBCF0', '#2D7A9A', '#215164'],
  'transition-inverts': ['#EAEEFC', '#9799A2', '#626468'],
  'grab-basics': ['#B5EF32', '#769A24', '#4E641C'],
  'grab-style': ['#E0F6AB', '#919E6F', '#5E674A'],
  'grab-airs': ['#84C03F', '#587D2C', '#3B5221'],
  'grab-lip': ['#B8C77C', '#788152', '#4F5538'],
});

export const STATES = Object.freeze(['locked', 'available', 'learning', 'landed', 'onLock']);
export const STATE_CODE = Object.freeze({ locked: 0, available: 1, learning: 2, landed: 3, onLock: 4 });
export const STANCES = Object.freeze(['normal', 'fakie', 'nollie', 'switch']);
export const TIERS = Object.freeze(['overview', 'mid', 'full']);

const FULL = {
  ringR: 10,
  ringW: 2.5,
  stickerR: 10,
  stickerBorder: 2.5,
  keylineOuterR: 13.1 + 1.2 / 2, // 13.7
  outerR: 14.3 + 1.2 / 2, // 14.9
  xRingR: 12,
  xRingW: 3,
  xDiscR: 9.5,
  xDiscKeyline: 1,
  xBandR: 13.5,
  xKeylineOuterR: 14.1,
  xOuterR: 15.1,
  glyph: 1,
  shadow: [2, 2.5],
};
const MID = {
  ringR: 7,
  ringW: 2,
  stickerR: 7,
  stickerBorder: 2,
  keylineOuterR: 10.6 - 1.2,
  outerR: 10.6,
  xRingR: 8.5,
  xRingW: 2.5,
  xDiscR: 6.5,
  xDiscKeyline: 1,
  xBandR: 9.5,
  xKeylineOuterR: 9.5 + 0.6,
  xOuterR: 11,
  glyph: 0.7,
  shadow: [1.5, 1.5],
};
const PLUS_ARM = 4.5;
const PLUS_W = 2;
const STRIPE_W = 2.5;
const STRIPE_GAP = 2.5;
const CHECK_W = 2.25;
const CHECK = [[-4.4, 0.4], [-1.4, 3.4], [4.6, -3.2]];
const CORE_R = 5.5;
const BULLSEYE_R = 2;
const LOCKED_X_DOT_R = 3;
export const LOCKED_DASH_COUNT = Object.freeze({ ordinary: 10, interchange: 12 });
const round = (v) => Math.round(v * 1000) / 1000;

const disc = (r, fill, dx = 0, dy = 0) => ({ type: 'disc', r, fill, dx, dy });
const ring = (r, width, stroke, dashCount = null) => ({ type: 'ring', r, width, stroke, dashCount });

function glyphTier(t, kind, state) {
  const x = kind === 'interchange';
  const r = x ? t.xRingR : t.ringR;
  const w = x ? t.xRingW : t.ringW;
  const ringPaint = x ? 'paper' : 'lit';
  const [sx, sy] = t.shadow;
  const sticker = () =>
    x
      ? [disc(t.xBandR, 'paper'), disc(t.xDiscR, 'lit'), ring(t.xDiscR, t.xDiscKeyline, 'ink')]
      : [disc(t.stickerR + t.stickerBorder, 'paper'), disc(t.stickerR, 'lit')];
  switch (state) {
    case 'locked':
      return [
        disc(r, 'grip'),
        // The app draws an ordinary locked ring in a premix between the line's reachable and the neutral
        // reachable (src/map/scene.ts drawNodeLayers): on an unlit track the dashed ghost would vanish.
        ring(r, w, x ? 'neutralUnlit' : 'ghost', LOCKED_DASH_COUNT[kind]),
        ...(x ? [disc(round(LOCKED_X_DOT_R * t.glyph), 'unlit')] : []),
      ];
    case 'available':
      return [
        disc(r, 'surface1'),
        ring(r, w, ringPaint),
        { type: 'plus', arm: round(PLUS_ARM * t.glyph), width: round(PLUS_W * t.glyph), stroke: 'lit' },
      ];
    case 'learning':
      return [
        disc(r, 'surface1'),
        {
          type: 'stripes',
          clipR: r - w / 2,
          coverR: r,
          width: round(STRIPE_W * t.glyph),
          pitch: round((STRIPE_W + STRIPE_GAP) * t.glyph),
          angleDeg: -45,
          stroke: 'lit',
        },
        ring(r, w, ringPaint),
      ];
    case 'landed': {
      const outer = x ? t.xBandR : t.stickerR + t.stickerBorder;
      return [
        disc(outer, 'shadow', sx, sy),
        ...sticker(),
        { type: 'check', points: CHECK.map(([px, py]) => [round(px * t.glyph), round(py * t.glyph)]), width: round(CHECK_W * t.glyph), stroke: 'ink' },
      ];
    }
    case 'onLock': {
      const outer = x ? t.xOuterR : t.outerR;
      const keyline = x ? t.xKeylineOuterR : t.keylineOuterR;
      return [
        disc(outer, 'shadow', sx, sy),
        disc(outer, 'paper'),
        disc(round(keyline), 'ink'),
        ...sticker(),
        disc(round(CORE_R * t.glyph), 'ink'),
        disc(round(BULLSEYE_R * t.glyph), 'paper'),
      ];
    }
    default:
      return [];
  }
}

function overview(kind, state) {
  const x = kind === 'interchange';
  const e = x ? 1 : 0;
  switch (state) {
    case 'locked':
      return [disc(1.75 + e, x ? 'neutralReachable' : 'reachable')];
    case 'available':
      return [disc(2.5 + e, 'grip'), ring(2.5 + e, 1.25, x ? 'paper' : 'lit')];
    case 'learning':
      return [disc(3 + e, 'lit'), ring(3 + e, 1, 'grip')];
    case 'landed':
      return [disc(3 + e, 'lit'), ring(3 + e, 1, 'paper')];
    case 'onLock':
      return [disc(3.6 + e, 'paper'), ring(3.6 + e, 1.2, 'lit'), disc(1.4, 'ink')];
    default:
      return [];
  }
}

const TABLE = {};
for (const tier of TIERS) {
  TABLE[tier] = {};
  for (const kind of ['ordinary', 'interchange']) {
    TABLE[tier][kind] = {};
    for (const state of STATES) {
      TABLE[tier][kind][state] = tier === 'overview' ? overview(kind, state) : glyphTier(tier === 'mid' ? MID : FULL, kind, state);
    }
  }
}

/** Draw list of a node, back to front, centred on (0, 0) at 1×. Excludes the learning pulse and the stance ring. */
export function nodeLayers(tier, kind, state) {
  return TABLE[tier][kind][state];
}

/** Outer radius of the drawn glyph (no shadow offset, pulse or stance ring). */
export function nodeRadius(tier, kind, state) {
  let max = 0;
  for (const layer of TABLE[tier][kind][state]) {
    if (layer.type === 'disc') max = Math.max(max, layer.r + Math.hypot(layer.dx, layer.dy));
    else if (layer.type === 'ring') max = Math.max(max, layer.r + layer.width / 2);
  }
  return max;
}

/** Premixed solid between two #RRGGBB colours (DESIGN rule 2: never alpha on the map). */
export function mixHex(a, b, t) {
  let out = '#';
  for (let i = 0; i < 3; i++) {
    const ca = parseInt(a.slice(1 + i * 2, 3 + i * 2), 16);
    const cb = parseInt(b.slice(1 + i * 2, 3 + i * 2), 16);
    out += Math.round(ca + (cb - ca) * t).toString(16).padStart(2, '0');
  }
  return out.toUpperCase();
}

/** Concrete colour of a symbolic paint for a node whose line colours are { lit, reachable, unlit }. */
export function resolvePaint(paint, line, surface = 'grip') {
  switch (paint) {
    case 'lit':
      return line.lit;
    case 'reachable':
      return line.reachable;
    case 'unlit':
      return line.unlit;
    case 'ghost':
      return mixHex(line.reachable, COLORS.neutralReachable, 0.5);
    case 'paper':
      return COLORS.paper;
    case 'ink':
      return COLORS.ink;
    case 'grip':
      return COLORS.grip;
    case 'surface1':
      return COLORS.surface1;
    case 'shadow':
      return surface === 'paper' ? COLORS.ink : COLORS.shadow;
    case 'neutralReachable':
      return COLORS.neutralReachable;
    case 'neutralUnlit':
      return COLORS.neutralUnlit;
    case 'red':
      return COLORS.red;
    default:
      return paint;
  }
}

// ---------- learning pulse (the red glow, one of the only two glows)

export const PULSE = Object.freeze({
  periodMs: 1600,
  opacityFrom: 0.55,
  stops: [[0, 1], [0.45, 0.4], [1, 0]],
  full: { rFrom: 14, rTo: 26 },
  overview: { r1: 7, w1: 1.5, r2: 11, w2: 1, a2: 0.45 },
});

// ---------- stance ring

const HALF_GAP = 11;
const QUADRANT_START = { normal: 180, fakie: 270, nollie: 90, switch: 0 };
export const STANCE_RING = Object.freeze({
  r: 18,
  width: 3,
  learningDash: [2, 2],
  arcs: Object.fromEntries(STANCES.map((s) => [s, [QUADRANT_START[s] + HALF_GAP, QUADRANT_START[s] + 90 - HALF_GAP]])),
  paint: { none: 'unlit', learning: 'lit', landed: 'lit', onLock: 'paper' },
  outerR: 19.5,
});

/**
 * Arcs to draw for the slots a trick has, in reading order, or [] when the ring is not shown: only tricks with
 * 2+ stance slots, and only once any slot is learning / landed / on lock (the ring is something a node grows).
 * `slots`: { normal: 'none'|'learning'|'landed'|'onLock', fakie: …, … } — only existing slots as keys.
 */
export function stanceArcs(slots) {
  const present = STANCES.filter((s) => slots[s] !== undefined);
  if (present.length < 2 || !present.some((s) => slots[s] !== 'none')) return [];
  return present.map((stance) => {
    const status = slots[stance];
    const [startDeg, endDeg] = STANCE_RING.arcs[stance];
    return { stance, startDeg, endDeg, paint: STANCE_RING.paint[status] ?? 'unlit', dash: status === 'learning' ? STANCE_RING.learningDash : null };
  });
}

/**
 * The slots of a node on the map from its compact state (src/map/scene.ts ringSlots): the normal slot follows
 * the node's state; the other stances are known only as landed or not.
 * mask: slots the trick has (bit 0 normal, 1 fakie, 2 nollie, 3 switch); landed: landed stances, same bits.
 */
export function ringSlots(mask, state, landed) {
  const slots = {};
  STANCES.forEach((stance, bit) => {
    if (!(mask & (1 << bit))) return;
    if (bit === 0) {
      slots[stance] = state === 'onLock' ? 'onLock' : state === 'landed' ? 'landed' : state === 'learning' ? 'learning' : 'none';
    } else {
      slots[stance] = landed & (1 << bit) ? 'landed' : 'none';
    }
  });
  return slots;
}

// ---------- geometry helpers (0° = east, clockwise on screen)

const RAD = Math.PI / 180;
export function polar(cx, cy, r, deg) {
  return [cx + r * Math.cos(deg * RAD), cy + r * Math.sin(deg * RAD)];
}

/** [dash, gap] that puts exactly n equal dashes and gaps on a ring of centre radius r. */
export function ringDash(r, n) {
  const length = (Math.PI * r) / n;
  return [length, length];
}

/** Hazard stripes as chords of the circle of radius `radius`: [[x0, y0, x1, y1], …], one through the centre. */
export function stripeChords(radius, pitch, angleDeg) {
  const ux = Math.cos(angleDeg * RAD);
  const uy = Math.sin(angleDeg * RAD);
  const px = -uy;
  const py = ux;
  const count = Math.ceil(radius / pitch) - 1;
  const out = [];
  for (let i = -count; i <= count; i++) {
    const offset = i * pitch;
    const half = Math.sqrt(radius * radius - offset * offset);
    if (!(half > 0)) continue;
    const mx = px * offset;
    const my = py * offset;
    out.push([mx - ux * half, my - uy * half, mx + ux * half, my + uy * half]);
  }
  return out;
}
