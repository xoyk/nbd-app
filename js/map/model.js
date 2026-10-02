// The runtime model of site/assets/data/map.json (scripts/site/map-data.mjs): nodes, line chains with their
// Path2D and arc-length positions, tracks, links, presets, and the graph helpers the animations need.
// Everything here is built once per data file; nothing runs per frame.

import { STATE_CODE } from './anatomy.js';

export const LOCKED = STATE_CODE.locked;
export const AVAILABLE = STATE_CODE.available;
export const LEARNING = STATE_CODE.learning;
export const LANDED = STATE_CODE.landed;
export const ON_LOCK = STATE_CODE.onLock;
export const isDone = (code) => code >= LANDED;

/** Corner radius of a bend (DESIGN.md §3.1). */
export const CORNER_RADIUS = 12;

/**
 * Appends a rounded octilinear polyline (flat [x0, y0, x1, y1, …]) to `path` and returns its length — the
 * app's src/map/geometry.ts roundedPolyline: every bend becomes an arc tangent to both legs, radius shrunk on
 * short legs (half of an inner leg, all of an end leg). `move` starts a new subpath at the first point.
 */
export function appendRounded(path, flatPoints, move, radius = CORNER_RADIUS) {
  const pts = [];
  for (let i = 0; i < flatPoints.length; i += 2) {
    const q = pts[pts.length - 1];
    if (!q || q[0] !== flatPoints[i] || q[1] !== flatPoints[i + 1]) pts.push([flatPoints[i], flatPoints[i + 1]]);
  }
  for (let i = pts.length - 2; i >= 1; i--) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    if (Math.abs(cross) < 1e-9 && dot > 0) pts.splice(i, 1);
  }
  if (pts.length === 0) return 0;
  if (move) path?.moveTo(pts[0][0], pts[0][1]);
  const n = pts.length;
  let length = 0;
  for (let i = 1; i < n; i++) length += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < n - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const cos = Math.max(-1, Math.min(1, ((b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])) / (l1 * l2)));
    const turn = Math.acos(cos);
    const tan = Math.tan(turn / 2);
    const room = Math.min(i === 1 ? l1 : l1 / 2, i === n - 2 ? l2 : l2 / 2);
    const r = tan < 1e-9 ? 0 : Math.min(radius, room / tan);
    if (r < 0.01) path?.lineTo(b[0], b[1]);
    else {
      path?.arcTo(b[0], b[1], c[0], c[1], r);
      length += r * turn - 2 * r * tan;
    }
  }
  path?.lineTo(pts[n - 1][0], pts[n - 1][1]);
  return length;
}

function boundsOf(flat, pad) {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    l = Math.min(l, flat[i]);
    r = Math.max(r, flat[i]);
    t = Math.min(t, flat[i + 1]);
    b = Math.max(b, flat[i + 1]);
  }
  return [l - pad, t - pad, r + pad, b + pad];
}

/** Point and unit direction at arc length `s` along a flat polyline with rounded corners (close enough for heads). */
export function pointAt(flat, s) {
  let rest = s;
  for (let i = 2; i < flat.length; i += 2) {
    const dx = flat[i] - flat[i - 2];
    const dy = flat[i + 1] - flat[i - 1];
    const len = Math.hypot(dx, dy);
    if (rest <= len || i === flat.length - 2) {
      const k = len > 0 ? Math.max(0, Math.min(1, rest / len)) : 0;
      return [flat[i - 2] + dx * k, flat[i - 1] + dy * k];
    }
    rest -= len;
  }
  return [flat[0], flat[1]];
}

export function buildModel(data) {
  const n = data.nodes.length;
  const lines = data.lines.map((l, i) => ({
    index: i,
    id: l.id,
    code: l.code,
    seg: l.seg,
    name: l.name,
    lit: l.c[0],
    reachable: l.c[1],
    unlit: l.c[2],
    stations: l.st,
    chain: l.tr,
    bullet: l.bullet || null,
    // Filled below.
    path: null,
    length: 0,
    bounds: null,
  }));

  const tracks = data.tracks.map((t, i) => ({
    index: i,
    line: t.l,
    from: t.f,
    to: t.t,
    feeder: !!t.fd,
    points: t.p,
    bounds: boundsOf(t.p, 4),
    length: appendRounded(null, t.p, true),
    /** Arc-length interval on its line's chain path. */
    s0: 0,
    s1: 0,
    path: null,
  }));

  // One continuous path per line: its chain of tracks (feeder first). Bends at a node (where a feeder meets its
  // line) stay sharp, as two separately stroked tracks would meet there under the node glyph.
  const hasPath2D = typeof Path2D !== 'undefined';
  for (const line of lines) {
    const path = hasPath2D ? new Path2D() : null;
    let s = 0;
    let bounds = null;
    line.chain.forEach((ti, k) => {
      const track = tracks[ti];
      track.s0 = s;
      s += appendRounded(path, track.points, k === 0);
      track.s1 = s;
      const b = track.bounds;
      bounds = bounds ? [Math.min(bounds[0], b[0]), Math.min(bounds[1], b[1]), Math.max(bounds[2], b[2]), Math.max(bounds[3], b[3])] : [...b];
    });
    line.path = path;
    line.length = s;
    line.bounds = bounds;
    line.root = line.chain.length ? tracks[line.chain[0]].from : line.stations[0];
  }

  const nodes = data.nodes.map((d, i) => ({
    index: i,
    id: d.id,
    name: d.name,
    x: d.x,
    y: d.y,
    line: d.l,
    seg: d.s,
    interchange: d.ix === 1,
    label: { x: d.lb[0], y: d.lb[1], w: d.lb[2], h: d.lb[3], align: d.lb[4] === 'l' ? 'left' : d.lb[4] === 'r' ? 'right' : 'center', lines: d.tx },
    stanceMask: d.sm,
    prereqs: d.pre,
    composedOf: d.cmp,
    difficulty: d.d,
    xp: d.xp,
    depth: d.dep,
    dist: d.dist,
    bait: d.bait || null,
    tag: d.tag || null,
    dependents: [],
    incoming: -1,
  }));
  for (const node of nodes) for (const p of node.prereqs) nodes[p].dependents.push(node.index);
  for (const t of tracks) nodes[t.to].incoming = t.index;
  const indexOf = new Map(nodes.map((node) => [node.id, node.index]));

  const links = data.links.map((l) => ({
    from: l.f,
    to: l.t,
    kind: l.k === 1 ? 'compose' : 'prereq',
    points: l.p,
    bounds: boundsOf(l.p, 4),
    path: null,
    length: appendRounded(null, l.p, true),
  }));
  const linksOf = new Map();
  links.forEach((link, i) => {
    for (const end of [link.from, link.to]) {
      if (!linksOf.has(end)) linksOf.set(end, []);
      linksOf.get(end).push(i);
    }
  });

  const segments = data.segments.map((s, i) => ({
    index: i,
    id: s.id,
    code: s.code,
    name: s.name,
    base: s.c[0],
    bounds: { x: s.b[0], y: s.b[1], w: s.b[2], h: s.b[3] },
    title: { x: s.title[0], y: s.title[1], align: s.title[2] === 'l' ? 'left' : s.title[2] === 'r' ? 'right' : 'center' },
    camera: { x: s.cam[0], y: s.cam[1], zoom: s.cam[2] },
    focus: { x: s.focus[0], y: s.focus[1] },
    count: s.n,
    nodes: nodes.filter((node) => node.seg === i).map((node) => node.index),
  }));

  const presets = {};
  for (const [name, p] of Object.entries(data.presets)) {
    const codes = new Uint8Array(n);
    const stances = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      codes[i] = Number(p.st[i]);
      stances[i] = parseInt(p.sk[i], 16);
    }
    const attempts = new Map(Object.entries(p.att ?? {}).map(([id, v]) => [indexOf.get(id), v]));
    presets[name] = { codes, stances, attempts };
  }

  // Nodes outward from the root along the track tree (the order of the ink-in and of the finale).
  const byDist = nodes.map((node) => node.index).sort((a, b) => nodes[a].dist - nodes[b].dist || a - b);

  return {
    tapes: tapeTable(data.tapes, segments),
    world: { width: data.world[0], height: data.world[1] },
    root: data.root,
    maxDist: data.maxDist,
    colors: data.colors,
    nodes,
    lines,
    tracks,
    links,
    linksOf,
    segments,
    presets,
    indexOf,
    byDist,
  };
}

/**
 * Segment tapes: per zoom entry (z0 + k·dz) and segment, the screen offset [dx, dy] from the segment's title point, or
 * null where the tape is left out (map.json `tapes.off`). An older map.json with world anchors (`tapes.at`) is
 * converted, so a cached data file keeps working with this renderer.
 */
function tapeTable(tapes, segments) {
  const { z0, dz } = tapes;
  const off = tapes.off
    ? tapes.off.map((entry) => entry.map((o) => (o ? [o[0], o[1]] : null)))
    : tapes.at.map((flat, k) => segments.map((s, i) => [(flat[2 * i] - s.title.x) * (z0 + k * dz), (flat[2 * i + 1] - s.title.y) * (z0 + k * dz)]));
  return { z0, dz, off };
}

/**
 * Where segment tape `s` sits at `zoom`: its screen offset from the title point, interpolated between the two
 * entries around the zoom (tapes slide out of each other's way as the camera pulls back), or null when it is left
 * out at this zoom. Above the last entry the last one holds.
 */
export function tapeOffset(tapes, s, zoom) {
  const n = tapes.off.length;
  const f = Math.max(0, Math.min(n - 1, (zoom - tapes.z0) / tapes.dz));
  const k = Math.min(n - 2, Math.floor(f));
  const u = Math.min(1, f - k);
  const a = tapes.off[k][s];
  if (!a) return null;
  const b = tapes.off[k + 1][s];
  return b ? [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u] : a;
}

/** Lazily built Path2D of a single track (marching dashes of an under-construction edge). */
export function trackPath(track) {
  if (!track.path) {
    track.path = new Path2D();
    appendRounded(track.path, track.points, true);
  }
  return track.path;
}

export function linkPath(link) {
  if (!link.path) {
    link.path = new Path2D();
    appendRounded(link.path, link.points, true);
  }
  return link.path;
}

/**
 * Display codes from stored ones: a node with no stored status (locked / available) is available when every
 * prerequisite is landed or on lock in normal stance (src/domain/progression.ts).
 */
export function resolveAvailability(model, codes) {
  for (const node of model.nodes) {
    const c = codes[node.index];
    if (c >= LEARNING) continue;
    let open = true;
    for (const p of node.prereqs) if (!isDone(codes[p])) open = false;
    codes[node.index] = open ? AVAILABLE : LOCKED;
  }
  return codes;
}

/** Transitive prerequisites of a node (not including it), roots first. */
export function upstream(model, index) {
  const seen = new Set();
  const visit = (i) => {
    for (const p of model.nodes[i].prereqs) {
      if (seen.has(p)) continue;
      seen.add(p);
      visit(p);
    }
  };
  visit(index);
  return [...seen].sort((a, b) => model.nodes[a].depth - model.nodes[b].depth || model.nodes[a].dist - model.nodes[b].dist);
}

/**
 * What landing node `index` would open from the display codes `codes` (left untouched): the nodes that go from
 * locked to available, in the unlock ripple's order (by angle around the landed node, DESIGN §8.2).
 */
export function openedBy(model, codes, index) {
  const after = new Uint8Array(codes);
  if (!isDone(after[index])) after[index] = LANDED;
  resolveAvailability(model, after);
  const opened = [];
  for (let j = 0; j < after.length; j++) if (codes[j] === LOCKED && after[j] === AVAILABLE) opened.push(j);
  const src = model.nodes[index];
  const angle = (j) => Math.atan2(model.nodes[j].y - src.y, model.nodes[j].x - src.x);
  return opened.sort((a, b) => angle(a) - angle(b));
}

/** Edge style index: 0 unlit, 1 reachable, 2 construction, 3 lit (src/map/edges.ts). */
export function edgeStyle(from, to) {
  if (to === LEARNING) return 2;
  if (isDone(to)) return isDone(from) ? 3 : 1;
  if (to === AVAILABLE) return 1;
  return 0;
}
