// Mid-tier label declutter (the app's src/map/declutter.ts). At mid zoom labels keep a constant screen size
// while positions shrink, so a greedy pass per zoom bucket keeps the most important ones: learning > on lock >
// landed > open > interchange; locked ordinary nodes are never named at mid. Computed when states change.

import { LOD } from './camera.js';

export const BUCKET = Object.freeze({ from: 0.45, step: 0.05, count: 9 });
export const bucketOf = (zoom) => {
  const i = Math.floor((zoom - BUCKET.from) / BUCKET.step + 1e-6);
  return i < 0 ? 0 : i >= BUCKET.count ? BUCKET.count - 1 : i;
};
const bucketZoom = (b) => BUCKET.from + b * BUCKET.step;

const MID_NODE_OUTER = { ordinary: 9, interchange: 10.5 };

function priority(code, interchange) {
  // codes: 0 locked, 1 available, 2 learning, 3 landed, 4 on lock
  if (code === 2) return 5;
  if (code === 4) return 4;
  if (code === 3) return 3;
  if (code === 1) return 2;
  return interchange ? 1 : 0;
}

/** How far a mid-tier label is pulled towards its node, screen pt, as [dx, dy]. */
export function midLabelPull(node, scale = LOD.midLabelScale, gap = LOD.midLabelGap) {
  const l = node.label.x;
  const t = node.label.y;
  const r = l + node.label.w;
  const b = t + node.label.h;
  const nx = Math.min(r, Math.max(l, node.x)) - node.x;
  const ny = Math.min(b, Math.max(t, node.y)) - node.y;
  const d = Math.hypot(nx, ny);
  if (d < 1e-6) return [0, 0];
  const target = (node.interchange ? MID_NODE_OUTER.interchange : MID_NODE_OUTER.ordinary) + gap;
  const pull = Math.max(0, d * scale - target);
  return [(-nx / d) * pull, (-ny / d) * pull];
}

const boxesIntersect = (a, b, m = 0) => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
const distBoxPoint = (box, x, y) => Math.hypot(Math.max(box[0] - x, 0, x - box[2]), Math.max(box[1] - y, 0, y - box[3]));
function distBoxSeg(box, ax, ay, bx, by) {
  // Sampled: labels and tracks are axis-aligned or 45°, a few samples per segment are exact enough here.
  const len = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(len / 6));
  let best = Infinity;
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    best = Math.min(best, distBoxPoint(box, ax + (bx - ax) * k, ay + (by - ay) * k));
    if (best === 0) return 0;
  }
  return best;
}

export function createDeclutter(model) {
  const statics = [];
  const pulls = model.nodes.map((node) => midLabelPull(node));
  const staticsOf = (b) => {
    if (statics[b]) return statics[b];
    const zoom = bucketZoom(b);
    const scale = LOD.midLabelScale;
    const boxes = [];
    const clears = [];
    const box = (i) => {
      if (!boxes[i]) {
        const node = model.nodes[i];
        const sx = node.x * zoom + pulls[i][0];
        const sy = node.y * zoom + pulls[i][1];
        const { label } = node;
        boxes[i] = [
          sx + (label.x - node.x) * scale,
          sy + (label.y - node.y) * scale,
          sx + (label.x + label.w - node.x) * scale,
          sy + (label.y + label.h - node.y) * scale,
        ];
      }
      return boxes[i];
    };
    const clear = (i) => {
      if (clears[i] === undefined) {
        const bx = box(i);
        let ok = true;
        for (const other of model.nodes) {
          if (other.index !== i && distBoxPoint(bx, other.x * zoom, other.y * zoom) < 11) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const world = [bx[0] / zoom, bx[1] / zoom, bx[2] / zoom, bx[3] / zoom];
          const clearance = 4 / zoom;
          for (const track of model.tracks) {
            if (!boxesIntersect(world, track.bounds, clearance)) continue;
            const p = track.points;
            for (let q = 2; q < p.length && ok; q += 2) if (distBoxSeg(world, p[q - 2], p[q - 1], p[q], p[q + 1]) < clearance) ok = false;
            if (!ok) break;
          }
        }
        clears[i] = ok;
      }
      return clears[i];
    };
    statics[b] = { box, clear, zoom };
    return statics[b];
  };

  /** keep[i] = 1 when node i's label is shown at mid in bucket `b`, for the display codes given. */
  function pass(b, codes, obstacles = []) {
    const st = staticsOf(b);
    const n = model.nodes.length;
    const keep = new Uint8Array(n);
    const order = [];
    const pr = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      pr[i] = priority(codes[i], model.nodes[i].interchange);
      if (pr[i] >= 5 || (pr[i] > 0 && st.clear(i))) order.push(i);
    }
    order.sort((a, c) => pr[c] - pr[a] || a - c);
    const kept = [];
    for (const i of order) {
      const bx = st.box(i);
      if (pr[i] >= 5) {
        keep[i] = 1;
        kept.push(bx);
        continue;
      }
      let free = true;
      for (let k = 0; k < kept.length && free; k++) if (boxesIntersect(bx, kept[k], 2)) free = false;
      for (let k = 0; k < obstacles.length && free; k++) if (boxesIntersect(bx, obstacles[k], 2)) free = false;
      if (free) {
        keep[i] = 1;
        kept.push(bx);
      }
    }
    return keep;
  }

  return { pass, pulls, bucketZoom };
}
