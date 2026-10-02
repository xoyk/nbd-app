// Bitmaps the map is stamped from: node glyphs per (tier, kind, state, line, ring), label plates with their grip
// halo, +XP bait, the learning tape tag, line bullets, segment tape strips and their percentage glyphs, and the two
// radial glows. All of them are drawn once at the canvas's device-pixel scale into atlas pages (one atlas per pixel
// ratio for the whole page: js/map/index.js shares it between maps) and blitted with drawImage per frame.

import { COLORS, nodeLayers, nodeRadius, resolvePaint, stanceArcs, ringDash, stripeChords, PULSE, STANCE_RING } from './anatomy.js';

const RAD = Math.PI / 180;

// ---------- fonts (the site's own WOFF2 subsets of the app's families)

export const FAMILY = { sofia: 'NBD Map Sofia', mono: 'NBD Map Mono' };
let fontsPromise = null;
let fontsReady = false;
export const fontsLoaded = () => fontsReady;

/** Loads the three faces the map draws with; resolves when they (and document.fonts) are ready. */
export function loadFonts() {
  if (fontsPromise) return fontsPromise;
  const url = (file) => new URL(`../../assets/fonts/${file}`, import.meta.url).href;
  const faces = [
    new FontFace(FAMILY.sofia, `url(${url('sofia-800.woff2')}) format("woff2")`, { weight: '800' }),
    new FontFace(FAMILY.sofia, `url(${url('sofia-900.woff2')}) format("woff2")`, { weight: '900' }),
    new FontFace(FAMILY.mono, `url(${url('mono-700.woff2')}) format("woff2")`, { weight: '700' }),
  ];
  fontsPromise = Promise.all(
    faces.map((face) =>
      face.load().then((loaded) => {
        document.fonts.add(loaded);
        return loaded;
      }),
    ),
  )
    .then(() => document.fonts.ready)
    .then(() => {
      fontsReady = true;
    });
  return fontsPromise;
}

const FONT = {
  label: `800 13px "${FAMILY.sofia}"`,
  tape: `800 13px "${FAMILY.sofia}"`,
  bullet: `900 11.5px "${FAMILY.sofia}"`,
  mono: `700 11px "${FAMILY.mono}"`,
};
const SPACING = { label: 0.3, tape: 0.65, bullet: 0.2, mono: 0.22 };

// ---------- text with letter spacing, kerning kept (positions from prefix widths)

const capCache = new Map();
function capHeight(ctx, font) {
  if (!capCache.has(font)) {
    ctx.save();
    ctx.font = font;
    const m = ctx.measureText('H');
    capCache.set(font, m.actualBoundingBoxAscent || parseFloat(font.split(' ')[1]) * 0.7);
    ctx.restore();
  }
  return capCache.get(font);
}

/** Per-character x positions and the run width (without the trailing spacing), for `ctx.font`. */
function layoutRun(ctx, text, spacing) {
  const chars = [...text];
  const xs = [];
  let prefix = '';
  for (let i = 0; i < chars.length; i++) {
    xs.push(ctx.measureText(prefix).width + i * spacing);
    prefix += chars[i];
  }
  const width = chars.length ? ctx.measureText(prefix).width + (chars.length - 1) * spacing : 0;
  return { chars, xs, width };
}

function drawRun(ctx, run, x, y, mode) {
  for (let i = 0; i < run.chars.length; i++) {
    if (run.chars[i] === ' ' || run.chars[i] === ' ') continue;
    if (mode === 'stroke') ctx.strokeText(run.chars[i], x + run.xs[i], y);
    else ctx.fillText(run.chars[i], x + run.xs[i], y);
  }
}

let measureCtx = null;
function measurer() {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  return measureCtx;
}
export function textWidth(kind, text) {
  const ctx = measurer();
  ctx.font = FONT[kind];
  return layoutRun(ctx, text, SPACING[kind]).width;
}

// ---------- atlas

const PAGE = 1024;
const GUTTER = 2;

export class Atlas {
  constructor(scale) {
    this.scale = scale;
    this.pages = [];
    this.entries = new Map();
  }
  get size() {
    return this.entries.size;
  }
  clear() {
    this.pages = [];
    this.entries.clear();
  }
  /** Room for w × h device px; returns { canvas, ctx, x, y }. */
  alloc(w, h) {
    const W = Math.ceil(w) + GUTTER;
    const H = Math.ceil(h) + GUTTER;
    for (const page of this.pages) {
      for (const row of page.rows) {
        if (H <= row.h && H >= row.h * 0.6 && row.x + W <= PAGE) {
          const spot = { canvas: page.canvas, ctx: page.ctx, x: row.x, y: row.y };
          row.x += W;
          return spot;
        }
      }
      if (page.bottom + H <= PAGE && W <= PAGE) {
        const row = { y: page.bottom, h: H, x: W };
        page.rows.push(row);
        page.bottom += H;
        return { canvas: page.canvas, ctx: page.ctx, x: 0, y: row.y };
      }
    }
    if (W > PAGE || H > PAGE) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w);
      canvas.height = Math.ceil(h);
      return { canvas, ctx: canvas.getContext('2d'), x: 0, y: 0 };
    }
    const canvas = document.createElement('canvas');
    canvas.width = PAGE;
    canvas.height = PAGE;
    const page = { canvas, ctx: canvas.getContext('2d'), rows: [], bottom: 0 };
    this.pages.push(page);
    return this.alloc(w, h);
  }
  /**
   * The bitmap of `key`, drawn on first use: draw(ctx) paints in pt with (0, 0) at the anchor; the box
   * [left, top, width, height] (pt, relative to the anchor) is what is kept.
   */
  get(key, box, draw) {
    let e = this.entries.get(key);
    if (e) return e;
    const s = this.scale;
    const [left, top, width, height] = box;
    const sw = Math.ceil(width * s);
    const sh = Math.ceil(height * s);
    const spot = this.alloc(sw, sh);
    const ctx = spot.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(spot.x, spot.y, sw, sh);
    ctx.clip();
    ctx.setTransform(s, 0, 0, s, spot.x - left * s, spot.y - top * s);
    draw(ctx);
    ctx.restore();
    e = { canvas: spot.canvas, sx: spot.x, sy: spot.y, sw, sh, left, top, w: sw / s, h: sh / s };
    this.entries.set(key, e);
    return e;
  }
}

/** Blits an atlas entry with its anchor at (x, y) pt, scaled by k around the anchor. */
export function blit(ctx, e, x, y, k = 1) {
  ctx.drawImage(e.canvas, e.sx, e.sy, e.sw, e.sh, x + e.left * k, y + e.top * k, e.w * k, e.h * k);
}

// ---------- nodes

export function drawNodeLayers(ctx, layers, line) {
  for (const layer of layers) {
    switch (layer.type) {
      case 'disc':
        ctx.fillStyle = resolvePaint(layer.fill, line);
        ctx.beginPath();
        ctx.arc(layer.dx, layer.dy, layer.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'ring':
        ctx.strokeStyle = resolvePaint(layer.stroke, line);
        ctx.lineWidth = layer.width;
        ctx.lineCap = 'butt';
        ctx.setLineDash(layer.dashCount ? ringDash(layer.r, layer.dashCount) : []);
        ctx.beginPath();
        ctx.arc(0, 0, layer.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      case 'stripes':
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, layer.clipR, 0, Math.PI * 2);
        ctx.clip();
        ctx.strokeStyle = resolvePaint(layer.stroke, line);
        ctx.lineWidth = layer.width;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        for (const [x0, y0, x1, y1] of stripeChords(layer.coverR, layer.pitch, layer.angleDeg)) {
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
        }
        ctx.stroke();
        ctx.restore();
        break;
      case 'plus':
        ctx.strokeStyle = resolvePaint(layer.stroke, line);
        ctx.lineWidth = layer.width;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(-layer.arm, 0);
        ctx.lineTo(layer.arm, 0);
        ctx.moveTo(0, -layer.arm);
        ctx.lineTo(0, layer.arm);
        ctx.stroke();
        break;
      case 'check':
        ctx.strokeStyle = resolvePaint(layer.stroke, line);
        ctx.lineWidth = layer.width;
        ctx.lineCap = 'square';
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        layer.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        ctx.stroke();
        break;
      default:
        break;
    }
  }
}

export function drawStanceArcs(ctx, arcs, line, r = STANCE_RING.r, width = STANCE_RING.width) {
  for (const arc of arcs) {
    ctx.strokeStyle = resolvePaint(arc.paint, line);
    ctx.lineWidth = width;
    ctx.lineCap = 'butt';
    ctx.setLineDash(arc.dash ? [...arc.dash] : []);
    ctx.beginPath();
    ctx.arc(0, 0, r, arc.startDeg * RAD, arc.endDeg * RAD);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

/** Node glyph bitmap; anchor = node centre. `slots` only at the full tier (the stance ring). */
export function nodeSprite(atlas, tier, kind, state, line, lineIndex, slots) {
  const arcs = tier === 'full' && slots ? stanceArcs(slots) : [];
  const ringKey = arcs.map((a) => `${a.stance[0]}${a.paint[0]}${a.dash ? 'd' : ''}`).join('');
  // As small as the glyph (with its hard shadow, and its stance ring when it has one) plus a pixel of air.
  const e = Math.ceil(Math.max(nodeRadius(tier, kind, state), arcs.length ? STANCE_RING.outerR : 0) + 1.5);
  return atlas.get(`n|${tier}|${kind}|${state}|${lineIndex}|${ringKey}`, [-e, -e, 2 * e, 2 * e], (ctx) => {
    drawStanceArcs(ctx, arcs, line);
    drawNodeLayers(ctx, nodeLayers(tier, kind, state), line);
  });
}

// ---------- labels and decorations

const HALO = 3.5;
const LABEL_LINE = 14;

/** Label plate of a node: anchor = node centre, box in layout pt at zoom 1 (13 pt type, 14 pt lines). */
export function labelSprite(atlas, node, muted) {
  const { label } = node;
  const pad = 3;
  const left = label.x - node.x - pad;
  const top = label.y - node.y - pad;
  return atlas.get(`l|${node.index}|${muted ? 1 : 0}`, [left, top, label.w + 2 * pad, label.h + 2 * pad], (ctx) => {
    ctx.font = FONT.label;
    const cap = capHeight(ctx, FONT.label);
    const base = (LABEL_LINE + cap) / 2;
    const runs = label.lines.map((text) => layoutRun(ctx, text, SPACING.label));
    const place = (run, i) => {
      const free = label.w - run.width;
      const x = label.x - node.x + (label.align === 'left' ? 0 : label.align === 'right' ? free : free / 2);
      return [x, label.y - node.y + i * LABEL_LINE + base];
    };
    ctx.lineJoin = 'round';
    ctx.lineWidth = HALO;
    ctx.strokeStyle = COLORS.grip;
    runs.forEach((run, i) => drawRun(ctx, run, ...place(run, i), 'stroke'));
    ctx.fillStyle = muted ? COLORS.muted : COLORS.primary;
    runs.forEach((run, i) => drawRun(ctx, run, ...place(run, i), 'fill'));
  });
}

const MONO_LINE = 12;

/** +XP bait under an open node: yellow mono with a grip halo. Anchor = node centre. */
export function baitSprite(atlas, node) {
  const [dx, dy] = node.bait;
  const text = `+${node.xp} XP`;
  const w = textWidth('mono', text);
  return atlas.get(`x|${node.index}`, [dx - 3, dy - 3, w + 6, MONO_LINE + 6], (ctx) => {
    ctx.font = FONT.mono;
    const run = layoutRun(ctx, text, SPACING.mono);
    const y = dy + (MONO_LINE + capHeight(ctx, FONT.mono)) / 2;
    ctx.lineJoin = 'round';
    ctx.lineWidth = HALO;
    ctx.strokeStyle = COLORS.grip;
    drawRun(ctx, run, dx, y, 'stroke');
    ctx.fillStyle = COLORS.yellow;
    drawRun(ctx, run, dx, y, 'fill');
  });
}

const TAG = { padX: 5, padY: 2, dot: 6, dotGap: 4, h: MONO_LINE + 4, rotation: -1 };

/** The learning tape tag (DESIGN §3.8): paper, red dot, "learning·47", −1°, hard shadow. Anchor = node centre. */
export function tagSprite(atlas, node, text) {
  const [dx, dy] = node.tag;
  const w = TAG.padX * 2 + TAG.dot + TAG.dotGap + textWidth('mono', text);
  return atlas.get(`t|${node.index}|${text}`, [dx - 4, dy - 4, w + 9, TAG.h + 9], (ctx) => {
    ctx.translate(dx + w / 2, dy + TAG.h / 2);
    ctx.rotate(TAG.rotation * RAD);
    ctx.translate(-(dx + w / 2), -(dy + TAG.h / 2));
    ctx.fillStyle = COLORS.shadow;
    ctx.fillRect(dx + 2, dy + 2, w, TAG.h);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(dx, dy, w, TAG.h);
    ctx.fillStyle = COLORS.red;
    ctx.beginPath();
    ctx.arc(dx + TAG.padX + TAG.dot / 2, dy + TAG.h / 2, TAG.dot / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = FONT.mono;
    const run = layoutRun(ctx, text, SPACING.mono);
    ctx.fillStyle = COLORS.ink;
    drawRun(ctx, run, dx + TAG.padX + TAG.dot + TAG.dotGap, dy + TAG.padY + (MONO_LINE + capHeight(ctx, FONT.mono)) / 2, 'fill');
  });
}

const BULLET = 18;

/** Line-code bullet (K1, F2…) next to a line's first node: ink disc, line colour, ink code. Anchor = that node. */
export function bulletSprite(atlas, line, started) {
  const [dx, dy] = line.bullet;
  const color = started ? line.lit : line.reachable;
  return atlas.get(`b|${line.index}|${started ? 1 : 0}`, [dx - 1, dy - 1, BULLET + 2, BULLET + 2], (ctx) => {
    const r = BULLET / 2;
    ctx.fillStyle = COLORS.ink;
    ctx.beginPath();
    ctx.arc(dx + r, dy + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(dx + r, dy + r, r - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = FONT.bullet;
    const run = layoutRun(ctx, line.code, SPACING.bullet);
    ctx.fillStyle = COLORS.ink;
    drawRun(ctx, run, dx + r - run.width / 2, dy + (BULLET + capHeight(ctx, FONT.bullet)) / 2, 'fill');
  });
}

// ---------- segment tapes: the paper strip (swatch, title, an empty slot for the percentage) is an atlas entry, one
// per width of its percentage ('7%', '59%', '100%': mono digits are all one width, so three at most per segment), and
// the percentage is stamped on it glyph by glyph from tilted glyph bitmaps — a finale counting every tape up to 100 %
// makes no new canvas, and no tape ever shows a stale number.

const TAPE = { h: 20, swatch: 5, divider: 1, padX: 7, gap: 7, rotations: [-1, 1, -0.6, 0.8] };
const tapeTilt = (order) => TAPE.rotations[order % TAPE.rotations.length];
const stripCache = new Map();

/**
 * Where a segment tape's paper strip stands: { x, w, pctW } in pt from the tape's anchor (the strip's left edge, its
 * width, the percentage's width). The declutter's obstacles come from here too, so they never make a bitmap. Kept only
 * once the map's fonts are in (before that the widths are a fallback face's).
 */
export function tapeStrip(segment, percent) {
  const key = `${segment.index}|${percent}`;
  let s = stripCache.get(key);
  if (s) return s;
  const name = segment.name.en.toUpperCase();
  const pctW = textWidth('mono', `${percent}%`);
  const w = TAPE.swatch + TAPE.divider + TAPE.padX + textWidth('tape', name) + TAPE.gap + pctW + TAPE.padX;
  const x = segment.title.align === 'left' ? 0 : segment.title.align === 'right' ? -w : -w / 2;
  s = { x, w, pctW };
  if (fontsReady) stripCache.set(key, s);
  return s;
}

/** A segment tape's strip without its percentage (tilted, hard shadow): atlas entry, anchor = the tape's anchor. */
export function tapeBody(atlas, segment, order, percent) {
  const { x, w, pctW } = tapeStrip(segment, percent);
  const pad = 6;
  return atlas.get(`tb|${segment.index}|${pctW.toFixed(2)}`, [x - pad, -pad, w + 2 * pad + 2, TAPE.h + 2 * pad + 2], (ctx) => {
    ctx.translate(x + w / 2, TAPE.h / 2);
    ctx.rotate(tapeTilt(order) * RAD);
    ctx.translate(-(x + w / 2), -TAPE.h / 2);
    ctx.fillStyle = COLORS.shadow;
    ctx.fillRect(x + 2, 2, w, TAPE.h);
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(x, 0, w, TAPE.h);
    ctx.fillStyle = segment.base;
    ctx.fillRect(x, 0, TAPE.swatch, TAPE.h);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(x + TAPE.swatch, 0, TAPE.divider, TAPE.h);
    ctx.font = FONT.tape;
    const title = layoutRun(ctx, segment.name.en.toUpperCase(), SPACING.tape);
    drawRun(ctx, title, x + TAPE.swatch + TAPE.divider + TAPE.padX, (TAPE.h + capHeight(ctx, FONT.tape)) / 2, 'fill');
  });
}

/** One glyph of a tape's percentage, tilted like tape `order`: atlas entry, anchor = the glyph's baseline origin. */
export function tapeGlyph(atlas, order, ch) {
  const tilt = tapeTilt(order);
  return atlas.get(`tg|${tilt}|${ch}`, [-3, -12, 14, 16], (ctx) => {
    ctx.rotate(tilt * RAD);
    ctx.font = FONT.mono;
    ctx.fillStyle = COLORS.inkSoft;
    ctx.fillText(ch, 0, 0);
  });
}

const glyphRuns = new Map();
/**
 * Where tape `order`'s percentage glyphs go on its strip: [[char, dx, dy], …] in pt from the tape's anchor, the tilt
 * about the strip's centre included (each glyph is drawn tilted about its own origin, so that is the same picture).
 */
export function tapeGlyphs(segment, order, percent) {
  const key = `${segment.index}|${percent}`;
  let run = glyphRuns.get(key);
  if (run) return run;
  const { x, w } = tapeStrip(segment, percent);
  const ctx = measurer();
  ctx.font = FONT.mono;
  const pct = layoutRun(ctx, `${percent}%`, SPACING.mono);
  const x0 = x + TAPE.swatch + TAPE.divider + TAPE.padX + textWidth('tape', segment.name.en.toUpperCase()) + TAPE.gap;
  const y0 = (TAPE.h + capHeight(ctx, FONT.mono)) / 2;
  const cx = x + w / 2;
  const cy = TAPE.h / 2;
  const a = tapeTilt(order) * RAD;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  run = pct.chars.map((ch, i) => {
    const px = x0 + pct.xs[i] - cx;
    const py = y0 - cy;
    return [ch, cx + px * cos - py * sin, cy + px * sin + py * cos];
  });
  if (fontsReady) glyphRuns.set(key, run);
  return run;
}

/** Every glyph a tape percentage can use, for the prewarm. */
export const TAPE_CHARS = '0123456789%';

// ---------- glows

function radialSprite(color, stops, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(',');
  for (const [offset, alpha] of stops) g.addColorStop(offset, `rgba(${rgb},${alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

let glows = null;
/** The warm light pool (DESIGN §3.5) and the red learning glow, as unit radial sprites. */
export function glowSprites() {
  if (!glows) {
    glows = {
      pool: radialSprite(COLORS.pool, [[0, 0.2], [0.5, 0.08], [1, 0]], 128),
      pulse: radialSprite(COLORS.red, PULSE.stops, 96),
    };
  }
  return glows;
}
