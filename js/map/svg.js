// One node of the map as an SVG string, at the full-tier anatomy (DESIGN.md §3.2) and any size — the same layers,
// numbers and colours the canvas map stamps its nodes from (anatomy.js), for big crisp use: a 300 px Kickflip in
// the states section, the sticker on the trick hero, a mini stance ring on a stance tile.
//
//   renderNodeSVG({ state: 'learning', lineId: 'flip-kickflip', size: 300,
//                   stances: { normal: 'learning', fakie: 'none', nollie: 'none', switch: 'none' },
//                   pulse: 'animated' })
//   stanceRingSVG({ stances: { normal: 'landed', fakie: 'none' }, lineId: 'flip-kickflip', size: 26, r: 10, width: 3 })

import { COLORS, LINE_COLORS, mixHex, nodeLayers, PULSE, resolvePaint, ringDash, STANCE_RING, stanceArcs, stripeChords, polar } from './anatomy.js';

let uid = 0;
const f = (v) => String(Math.round(v * 1000) / 1000);

/** Line colours { lit, reachable, unlit } from a line id, a lit colour, or an object that already has them. */
export function lineColors({ lineId, color, colors } = {}) {
  if (colors && colors.lit) return colors;
  if (!color && LINE_COLORS[lineId]) {
    const [lit, reachable, unlit] = LINE_COLORS[lineId];
    return { lit, reachable, unlit };
  }
  const lit = color ?? COLORS.paper;
  // tokens: reachable = mix(lit, grip, 0.62), unlit = mix(lit, grip, 0.38) in sRGB.
  return { lit, reachable: mixHex(COLORS.grip, lit, 0.62), unlit: mixHex(COLORS.grip, lit, 0.38) };
}

function arcD(r, startDeg, endDeg) {
  const [x0, y0] = polar(0, 0, r, startDeg);
  const [x1, y1] = polar(0, 0, r, endDeg);
  const sweep = (((endDeg - startDeg) % 360) + 360) % 360;
  return `M${f(x0)} ${f(y0)}A${f(r)} ${f(r)} 0 ${sweep > 180 ? 1 : 0} 1 ${f(x1)} ${f(y1)}`;
}

function layerSVG(layer, line, id) {
  switch (layer.type) {
    case 'disc':
      return `<circle cx="${f(layer.dx)}" cy="${f(layer.dy)}" r="${f(layer.r)}" fill="${resolvePaint(layer.fill, line)}"/>`;
    case 'ring': {
      const dash = layer.dashCount ? ` stroke-dasharray="${ringDash(layer.r, layer.dashCount).map(f).join(' ')}"` : '';
      // A <circle> starts at 3 o'clock and runs clockwise, like the canvas and Skia rings.
      return `<circle r="${f(layer.r)}" fill="none" stroke="${resolvePaint(layer.stroke, line)}" stroke-width="${f(layer.width)}"${dash}/>`;
    }
    case 'stripes': {
      const d = stripeChords(layer.coverR, layer.pitch, layer.angleDeg)
        .map(([x0, y0, x1, y1]) => `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`)
        .join('');
      return `<clipPath id="${id}-c"><circle r="${f(layer.clipR)}"/></clipPath><path clip-path="url(#${id}-c)" d="${d}" stroke="${resolvePaint(layer.stroke, line)}" stroke-width="${f(layer.width)}" stroke-linecap="butt" fill="none"/>`;
    }
    case 'plus':
      return `<path d="M${f(-layer.arm)} 0H${f(layer.arm)}M0 ${f(-layer.arm)}V${f(layer.arm)}" stroke="${resolvePaint(layer.stroke, line)}" stroke-width="${f(layer.width)}" stroke-linecap="butt" fill="none"/>`;
    case 'check':
      return `<path d="${layer.points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('')}" stroke="${resolvePaint(layer.stroke, line)}" stroke-width="${f(layer.width)}" stroke-linecap="square" stroke-linejoin="miter" fill="none"/>`;
    default:
      return '';
  }
}

function arcsSVG(arcs, line, r = STANCE_RING.r, width = STANCE_RING.width) {
  return arcs
    .map((arc) => {
      const dash = arc.dash ? ` stroke-dasharray="${arc.dash.join(' ')}"` : '';
      return `<path d="${arcD(r, arc.startDeg, arc.endDeg)}" fill="none" stroke="${resolvePaint(arc.paint, line)}" stroke-width="${f(width)}" stroke-linecap="butt"${dash}/>`;
    })
    .join('');
}

function pulseSVG(id, mode, interchange) {
  const extra = interchange ? 2 : 0;
  if (mode === 'static') {
    return `<circle r="${f(PULSE.full.rFrom + extra)}" fill="none" stroke="${COLORS.red}" stroke-width="1.5"/>`;
  }
  const stops = PULSE.stops.map(([o, a]) => `<stop offset="${o}" stop-color="${COLORS.red}" stop-opacity="${a}"/>`).join('');
  const grad = `<radialGradient id="${id}-g">${stops}</radialGradient>`;
  const ember = `<circle r="${f(PULSE.full.rFrom + 7 + extra)}" fill="url(#${id}-g)" opacity="0.75"/>`;
  if (mode !== 'animated') return grad + ember;
  const dur = `${PULSE.periodMs / 1000}s`;
  // r 14 → 26 and opacity .55 → 0, ease-out (cubic), looping — the app's pulse.
  const spline = 'keySplines="0.33 1 0.68 1" calcMode="spline" keyTimes="0;1"';
  return (
    grad +
    ember +
    `<circle r="${f(PULSE.full.rFrom + extra)}" fill="url(#${id}-g)" opacity="${PULSE.opacityFrom}">` +
    `<animate attributeName="r" values="${f(PULSE.full.rFrom + extra)};${f(PULSE.full.rTo + extra)}" dur="${dur}" repeatCount="indefinite" ${spline}/>` +
    `<animate attributeName="opacity" values="${PULSE.opacityFrom};0" dur="${dur}" repeatCount="indefinite" ${spline}/>` +
    `</circle>`
  );
}

/**
 * One node as an SVG string.
 *   state: 'locked' | 'available' | 'learning' | 'landed' | 'onLock'
 *   lineId (e.g. 'flip-kickflip') | color (lit hex) | colors ({ lit, reachable, unlit })
 *   size: px of the square element (default 300); the viewBox spans ±extent pt around the centre
 *   stances: { normal, fakie, nollie, switch } → 'none' | 'learning' | 'landed' | 'onLock'; only the slots the
 *            trick has (Kickflip has four). The ring shows once any slot is past 'none' (DESIGN §3.2).
 *   interchange: true for a combo trick (paper ring, larger)
 *   tier: 'full' (default) | 'mid' | 'overview'
 *   pulse: 'none' | 'static' (Reduce Motion ring) | 'ember' | 'animated' (SMIL, 1.6 s) — learning nodes only;
 *          default 'animated' for learning
 *   extent: half-size of the viewBox in pt (default 22, or 27 with an animated pulse)
 *   title: accessible name; omitted → aria-hidden
 *   className: class attribute
 */
export function renderNodeSVG({
  state = 'available',
  lineId,
  color,
  colors,
  size = 300,
  stances = null,
  interchange = false,
  tier = 'full',
  pulse,
  extent,
  title,
  className,
} = {}) {
  const line = lineColors({ lineId, color, colors });
  const id = `nbdn${++uid}`;
  const kind = interchange ? 'interchange' : 'ordinary';
  const pulseMode = state === 'learning' ? (pulse ?? 'animated') : 'none';
  const half = extent ?? (pulseMode === 'animated' || pulseMode === 'ember' ? 28 : 22);
  const arcs = tier === 'full' && stances ? stanceArcs(stances) : [];
  const body =
    (pulseMode !== 'none' ? pulseSVG(id, pulseMode, interchange) : '') +
    arcsSVG(arcs, line) +
    nodeLayers(tier, kind, state)
      .map((layer, k) => layerSVG(layer, line, `${id}-${k}`))
      .join('');
  const label = title ? `role="img" aria-label="${String(title).replace(/"/g, '&quot;')}"` : 'aria-hidden="true"';
  const cls = className ? ` class="${className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-half)} ${f(-half)} ${f(2 * half)} ${f(2 * half)}" width="${size}" height="${size}"${cls} ${label}>${body}</svg>`;
}

/**
 * The stance ring alone: four arcs in reading order (normal top-left, fakie top-right, nollie bottom-left, switch
 * bottom-right). `stances` as for renderNodeSVG; `force` draws it even when every slot is 'none'. r / width default
 * to the map's 18 / 3; the stance tiles use the mini ring r 10, width 3 at 26 px.
 */
export function stanceRingSVG({ stances = {}, lineId, color, colors, size = 26, r = STANCE_RING.r, width = STANCE_RING.width, force = true, className } = {}) {
  const line = lineColors({ lineId, color, colors });
  let arcs = stanceArcs(stances);
  if (!arcs.length && force) {
    arcs = Object.keys(stances).map((stance) => {
      const [startDeg, endDeg] = STANCE_RING.arcs[stance];
      return { stance, startDeg, endDeg, paint: 'unlit', dash: null };
    });
  }
  const half = r + width / 2 + 0.5;
  const cls = className ? ` class="${className}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(-half)} ${f(-half)} ${f(2 * half)} ${f(2 * half)}" width="${size}" height="${size}"${cls} aria-hidden="true">${arcsSVG(arcs, line, r, width)}</svg>`;
}
