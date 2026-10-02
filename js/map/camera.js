// Camera maths and level of detail. A camera is { x, y, zoom }: the world point shown at the centre of the
// canvas, and the zoom (screen pt per world unit). Level-of-detail ramps are the app's src/map/lod.ts.

export const LOD = Object.freeze({ midFrom: 0.5, fullFrom: 0.85, band: 0.06, maxZoom: 1.6, midLabelScale: 12 / 13, midLabelGap: 6 });

function ramp(zoom, threshold) {
  const t = (zoom - (threshold - LOD.band / 2)) / LOD.band;
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}
/** 0 at overview → 1 from mid up. */
export const midWeight = (zoom) => ramp(zoom, LOD.midFrom);
/** 0 below full → 1 at full. */
export const fullWeight = (zoom) => ramp(zoom, LOD.fullFrom);
/** Size factor of full-tier nodes and labels: below zoom 1 everything shrinks with the zoom (to 0.8). */
export const fullScale = (zoom) => (zoom >= 1 ? 1 : zoom < 0.8 ? 0.8 : zoom);
/** Label size relative to the 13 pt layout metrics: 12 pt at mid → full-tier size at full. */
export const labelScale = (zoom) => LOD.midLabelScale + (fullScale(zoom) - LOD.midLabelScale) * fullWeight(zoom);
/** Ring radius of an ordinary node from mid up: 7 at mid → 10 · fullScale at full. */
export const nodeRadiusAt = (zoom) => 7 + (10 * fullScale(zoom) - 7) * fullWeight(zoom);
/** A per-tier constant [overview, mid, full] blended across the bands; full scaled by fullScale. */
export function tierValue(values, zoom) {
  const lower = values[0] + (values[1] - values[0]) * midWeight(zoom);
  return lower + (values[2] * fullScale(zoom) - lower) * fullWeight(zoom);
}
export function tierOf(zoom) {
  return zoom < LOD.midFrom ? 'overview' : zoom < LOD.fullFrom ? 'mid' : 'full';
}

// ---------- framing

/** Free area of a viewport: { width, height } minus optional insets { top, right, bottom, left }. */
function area(vp) {
  const top = vp.top ?? 0;
  const bottom = vp.bottom ?? 0;
  const left = vp.left ?? 0;
  const right = vp.right ?? 0;
  return {
    w: Math.max(1, vp.width - left - right),
    h: Math.max(1, vp.height - top - bottom),
    // Offset of the free area's centre from the canvas centre, screen pt.
    ox: (left - right) / 2,
    oy: (top - bottom) / 2,
  };
}

/** Camera that shows world point (wx, wy) at the centre of the viewport's free area. */
export function cameraAt(wx, wy, zoom, vp) {
  const a = area(vp);
  return { x: wx - a.ox / zoom, y: wy - a.oy / zoom, zoom };
}

/** Camera that fits a world rect { x, y, w, h } into the free area with `pad` screen pt around it. */
export function fitRect(rect, vp, pad = 16, maxZoom = Infinity, minZoom = 0.02) {
  const a = area(vp);
  const zoom = Math.max(minZoom, Math.min(maxZoom, (a.w - 2 * pad) / rect.w, (a.h - 2 * pad) / rect.h));
  return cameraAt(rect.x + rect.w / 2, rect.y + rect.h / 2, zoom, vp);
}

// ---------- flights

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const EASE = Object.freeze({
  linear: (t) => t,
  inOutCubic: easeInOutCubic,
  inOutSine: (t) => (1 - Math.cos(Math.PI * t)) / 2,
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inCubic: (t) => t * t * t,
  // DESIGN §8 standard (0.2, 0, 0, 1) — a close quintic stand-in, no bezier solve per frame.
  standard: (t) => 1 - Math.pow(1 - t, 4),
});

/**
 * Smooth zoom-and-pan from camera a to camera b (van Wijk & Nuij, "Smooth and efficient zooming and panning"):
 * log-zoom is interpolated so the perceived speed is constant, and a long pan zooms out on the way and back in.
 * Returns (t ∈ [0, 1]) => camera. `rho` 0 gives the app's homing flight instead (zoom geometric, centre following
 * 1/zoom, src/map/camera.ts flyCamera); `ease` shapes t; `size` is the viewport's smaller side in pt.
 * The returned function carries `.S`, the path length in log-zoom units (for splitting a route into legs).
 */
export function flight(a, b, { rho = Math.SQRT2, ease = easeInOutCubic, size = 400 } = {}) {
  const w0 = size / a.zoom;
  const w1 = size / b.zoom;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  let at;
  let S;
  if (rho <= 0) {
    S = Math.abs(Math.log(w1 / w0)) + Math.sqrt(d2) / Math.max(w0, w1);
    const span = 1 / a.zoom - 1 / b.zoom;
    at = (u) => {
      const zoom = a.zoom * Math.pow(b.zoom / a.zoom, u);
      const q = Math.abs(span) < 1e-6 ? u : (1 / a.zoom - 1 / zoom) / span;
      return { x: a.x + dx * q, y: a.y + dy * q, zoom };
    };
  } else if (d2 < 1e-6) {
    S = Math.log(w1 / w0) / rho;
    at = (u) => ({ x: a.x + u * dx, y: a.y + u * dy, zoom: size / (w0 * Math.exp(rho * u * S)) });
    S = Math.abs(S);
  } else {
    const rho2 = rho * rho;
    const rho4 = rho2 * rho2;
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / rho;
    const coshr0 = Math.cosh(r0);
    const sinhr0 = Math.sinh(r0);
    at = (u) => {
      const s = u * S;
      const k = (w0 / (rho2 * d1)) * (coshr0 * Math.tanh(rho * s + r0) - sinhr0);
      const w = (w0 * coshr0) / Math.cosh(rho * s + r0);
      return { x: a.x + k * dx, y: a.y + k * dy, zoom: size / w };
    };
  }
  const fn = (t) => {
    const u = t <= 0 ? 0 : t >= 1 ? 1 : ease(t);
    if (u <= 0) return { ...a };
    if (u >= 1) return { ...b };
    return at(u);
  };
  fn.S = Math.max(1e-6, S);
  return fn;
}

/**
 * A flight through several cameras: each leg gets a share of t proportional to its path length; `ease` is
 * applied to the whole route and each leg is linear inside it, so the camera never stops at a waypoint.
 * Pass `holds` (an array of t-lengths, one per waypoint) to rest on a waypoint for that share of t instead.
 */
export function route(cameras, { rho = Math.SQRT2, ease = easeInOutCubic, size = 400, holds = null } = {}) {
  const legs = [];
  for (let i = 1; i < cameras.length; i++) legs.push(flight(cameras[i - 1], cameras[i], { rho, ease: EASE.linear, size }));
  const restTotal = holds ? holds.reduce((s, h) => s + (h || 0), 0) : 0;
  const moveTotal = legs.reduce((s, leg) => s + leg.S, 0);
  // Timeline: hold0, leg0, hold1, leg1, …, holdN.
  const pieces = [];
  let t = 0;
  for (let i = 0; i < cameras.length; i++) {
    const hold = holds ? holds[i] || 0 : 0;
    if (hold > 0) {
      pieces.push({ t0: t, t1: t + hold, cam: cameras[i] });
      t += hold;
    }
    if (i < legs.length) {
      const span = ((1 - restTotal) * legs[i].S) / moveTotal;
      pieces.push({ t0: t, t1: t + span, leg: legs[i] });
      t += span;
    }
  }
  return (time) => {
    const u = holds ? Math.max(0, Math.min(1, time)) : ease(Math.max(0, Math.min(1, time)));
    for (const p of pieces) {
      if (u <= p.t1 || p === pieces[pieces.length - 1]) {
        if (p.cam) return { ...p.cam };
        const k = p.t1 > p.t0 ? (u - p.t0) / (p.t1 - p.t0) : 1;
        return p.leg(holds ? ease(Math.max(0, Math.min(1, k))) : Math.max(0, Math.min(1, k)));
      }
    }
    return { ...cameras[cameras.length - 1] };
  };
}

// ---------- springs and pops

/** Response of a spring released at 0 towards 1 (mass 1), t in seconds (src/map/camera.ts springStep). */
export function springStep(t, stiffness, damping) {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(stiffness);
  const zeta = damping / (2 * w0);
  if (zeta >= 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
}

/** A node popping in: 0 → 1.12 → 1 over k ∈ [0, 1] (hard start, spring stop). */
export function popScale(k, from = 0) {
  if (k <= 0) return from;
  if (k >= 1) return 1;
  if (k < 0.55) {
    const u = k / 0.55;
    return from + (1.12 - from) * (1 - Math.pow(1 - u, 3));
  }
  const u = (k - 0.55) / 0.45;
  return 1.12 - 0.12 * (u * u * (3 - 2 * u));
}

export const clamp01 = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v);
