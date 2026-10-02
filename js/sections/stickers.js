// stickers — "50 stickers you can't buy": a sticker-bomb wall that builds itself as the scroll scrubs.
//
// The title is the first thing on the wall: a paper flyer (the slab, static HTML). All 50 achievements
// (assets/data/achievements.json) slap on around it one by one — a spring pop from 1.6×, the hard shadow
// snapping in on contact — at a deterministic tilt (−6° / +5° with a little jitter), overlapping each other and
// the flyer's edges like a bombed rail, in their tier looks (DESIGN §6). First One Down goes first, NBD slams
// last, and once the wall is complete NBD's note comes up on its own: "Every trick on the map, landed. Well,
// it's been done now." Secrets stay secrets: "???" in their tier colour. Tap, hover or focus lifts one and
// shows what it is for on a taped paper note. Sound (only when the visitor turned it on): 'sticker' for the
// first slap of a scrub burst, then 'tick' a semitone higher each, rate-limited; a tap is 'tick' ('stamp' for
// gold/legend).
//
// Performance: the slap keyframes are sampled once; at most CAP slaps run at a time (a fast scrub places the
// rest at once, and the oldest running ones finish early), and a sticker placed at once has no animation at all.
// The init never lands as one long task: the stickers are built a batch per frame, the glyphs come in six SVG
// sprites (not one image document per icon), the wall is solved in a Worker, and the solved stickers go into the
// page a batch per frame.
//
// The layout is pure math on the wall's box (wallKit, below): sizes from the free area, a jittered grid relaxed
// until every overlapping pair can lie one on the other without the top one covering the other's core (glyph,
// name, "???"), so every sticker stays readable and keeps a tappable patch. The flyer's words are solid: a
// sticker may cover its paper edge, never a letter. Who lies on whom then gives the slap order. It runs off the
// main thread (in idle slices on it where a Worker cannot start), and only when the wall's box really changes:
// a phone toolbar sliding in or out leaves the wall as it is (stickers.css keeps the wall at the small
// viewport's height; a height-only change of a toolbar's size is ignored here too).

const FIRST = 'first-one-down';
const LAST = 'nbd';
const SEED = 0x50_57_1c;
const ENTER = 0.62; // the build starts when the section's top passes 62 % of the viewport
const B0 = 0.14; // share of the build done before the stage pins
const PIN_END = 0.8; // the wall is complete at this pinned progress; the rest of the pin holds it
const CLEAR_PAD = 4; // air between the flyer's letters and a sticker (px)
const TOOLBAR_PX = 120; // a height-only change up to this (a phone's toolbar) keeps the wall
const BUILD_BATCH = 10; // stickers built per frame
const MOUNT_BATCH = 5; // stickers put into the page per frame
const GLYPH_PITCH = 32; // the sprite: 24 px glyphs, 8 px of air between them
const CAP = 8; // slaps animated at once
const SYNC_MS = 48; // the wall changes at most this often while scrolling
const SLAP_EVERY_MS = 110; // the slap budget refills one slap this often (see takeSlap)
const BURST_MS = 420; // a pause longer than this starts a new slap burst ('sticker' again)
const SOUND_GAP_MS = 55;
const NOTE_LINGER_MS = 160; // the hover note waits this long for the pointer to reach it
const HOVER_SWITCH_MS = 140; // with a hover note up, another sticker lifts once the pointer rests on it this long

/**
 * The wall's solver: pure geometry, no DOM. In: the stickers' shapes (in units), the wall's box, the flyer's
 * words as solid boxes. Out: the unit, every sticker's centre, and the slap order. Self-contained — it is also
 * the source of the solver's Worker, so it uses nothing from outside its own body.
 */
function wallKit() {
  const COVERED = 0.74; // a sticker's footprint once its neighbours have covered its edges
  const FILL = 0.7; // how much of the free area the footprints cover at the start (relaxing shrinks from there)
  const U_MIN = 46; // the smallest unit: a square sticker stays a 44 px target, even on a 320 px phone
  const U_MAX = 120;
  const clamp = (v, min = 0, max = 1) => (v < min ? min : v > max ? max : v);
  // mulberry32, as ctx.dom.prng: the same wall on the page and in the Worker.
  function prng(seed = 1) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Sizes a sticker for unit `u`: the face (w, h), its rotated box (hx, hy) and its core — what nothing on
   * top of it may cover: the glyph of a square, the "???" of a secret, glyph and name of a badge, the
   * printed name of a strip (its glyph cell may go under a neighbour, as on a real wall). The core is a
   * rotated box too (chx, chy), centred at the sticker's centre + (ox, oy).
   */
  function size(n, u) {
    n.w = n.wU * u;
    n.h = n.hU * u;
    const th = (n.rot * Math.PI) / 180;
    const cos = Math.cos(th);
    const sin = Math.sin(th);
    const c = Math.abs(cos);
    const s = Math.abs(sin);
    n.hx = (n.w * c + n.h * s) / 2;
    n.hy = (n.w * s + n.h * c) / 2;
    let cw;
    let ch;
    let cox = 0;
    if (n.hidden) [cw, ch] = [n.w * 0.7, n.h * 0.5];
    else if (n.kind === 'sq') [cw, ch] = [n.w * 0.54, n.h * 0.54];
    else if (n.kind === 'badge') [cw, ch] = [n.w * 0.76, n.h * 0.76];
    else {
      const fs = n.fsU * u;
      const tw = n.twU * u;
      cw = tw + fs * 0.7;
      ch = (n.nLines * 0.86 + 0.34) * fs;
      cox = -n.w / 2 + n.h * 0.05 + n.cellU * u + fs * 0.42 + tw / 2;
    }
    n.chx = (cw * c + ch * s) / 2;
    n.chy = (cw * s + ch * c) / 2;
    n.ox = cox * cos;
    n.oy = cox * sin;
    n.m = n.w * n.h;
  }

  /**
   * Finds the wall for a W × H box: starts from a unit that fills the box, relaxes, and while it is still
   * jammed takes 1.5 % smaller stickers and relaxes again from where it was, keeping the best wall seen;
   * then the stacking (slap order). A generator that yields after every sweep, so it can also run in slices.
   */
  function* solve(nodes, W, H, clears, seed) {
    const N = nodes.length;

    // Wherever two stickers overlap, one lies on top, and the one on top must not cover the other's core.
    // reach(t, b): how far t, lying on b, still reaches into b's core (0: t may lie on b).
    const reach = (t, b) => {
      const px = t.hx + b.chx - Math.abs(b.x + b.ox - t.x);
      const py = t.hy + b.chy - Math.abs(b.y + b.oy - t.y);
      return px > 0 && py > 0 ? Math.min(px, py) : 0;
    };
    const canTop = (a, b) => !(a.pin === -1 || b.pin === 1);
    const touch = (a, b) => Math.abs(b.x - a.x) < a.hx + b.hx && Math.abs(b.y - a.y) < a.hy + b.hy;
    const hitsWords = (a, x, y) => clears.some((c) => Math.abs(x - c.x) < a.hx + c.hx && Math.abs(y - c.y) < a.hy + c.hy);

    /**
     * Moves sticker `a` off the flyer's words (`clears`: boxes {x, y, hx, hy}, centre + half extents) to the
     * nearest spot that is on the wall and clear of every box — the boxes touch each other, so the way out of
     * one may lead past several (down past the fine print, say, when the flyer is as wide as the phone).
     */
    function clearOut(a) {
      if (!hitsWords(a, a.x, a.y)) return;
      const xs = [a.x];
      const ys = [a.y];
      for (const c of clears) {
        xs.push(c.x - c.hx - a.hx, c.x + c.hx + a.hx);
        ys.push(c.y - c.hy - a.hy, c.y + c.hy + a.hy);
      }
      // On the wall if at all possible; on a jammed wall (the smallest phones), half off its edge rather than on
      // a letter.
      for (const slack of [0.5, a.hx * 0.6]) {
        let best = null;
        for (const x of xs) {
          if (x < a.x0 - slack || x > a.x1 + slack) continue;
          for (const y of ys) {
            if (y < a.y0 - slack || y > a.y1 + slack || hitsWords(a, x, y)) continue;
            const cost = Math.hypot(x - a.x, y - a.y);
            if (!best || cost < best.cost) best = { x, y, cost };
          }
        }
        if (best) {
          a.x = best.x;
          a.y = best.y;
          return;
        }
      }
    }

    /**
     * Bombs the wall for unit `u`: a jittered grid over the free wall (or the previous pass, when `warm`)
     * relaxed until every overlapping pair can be stacked so that neither covers the other's core — each pair
     * keeps whichever stacking needs the smaller push. A sticker against the wall cannot give way, so the other
     * one takes the push. Stays inside the box (a little bleed: a real bomb runs over the edges) and off the
     * flyer's words. Returns the deepest remaining reach (px).
     */
    function* pack(u, warm) {
      for (const n of nodes) {
        size(n, u);
        const bx = Math.min(n.hx * 0.12, 8);
        const by = Math.min(n.hy * 0.12, 8);
        n.x0 = n.hx - bx;
        n.x1 = Math.max(n.x0, W - n.hx + bx);
        n.y0 = n.hy - by;
        n.y1 = Math.max(n.y0, H - n.hy + by);
      }
      if (!warm) {
        // Cells over the whole box, fine enough that about N of them fall outside the flyer's words.
        const r2 = prng(seed ^ 0x9e37);
        const covered = clears.reduce((s, c) => s + 4 * c.hx * c.hy, 0);
        const share = clamp(1 - covered / (W * H), 0.25, 1);
        const want = N / share;
        const cols = Math.max(3, Math.round(Math.sqrt((want * W) / H)));
        const rows = Math.ceil(want / cols);
        const inClear = (x, y) => clears.some((c) => Math.abs(x - c.x) < c.hx && Math.abs(y - c.y) < c.hy);
        let cells = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: ((c + 0.5 + (r % 2 ? 0.25 : -0.25)) / cols) * W, y: ((r + 0.5) / rows) * H, k: r2() });
        const open = cells.filter((cell) => !inClear(cell.x, cell.y));
        if (open.length >= N * 0.6) cells = open;
        cells.sort((a, b) => a.k - b.k);
        const dist = (cell) => Math.hypot(cell.x - W / 2, cell.y - H * 0.55);
        const centre = cells.reduce((best, cell) => (dist(cell) < dist(best) ? cell : best), cells[0]);
        const rest = cells.filter((cell) => cell !== centre);
        let ci = 0;
        for (const n of nodes) {
          const cell = n.last ? centre : rest[ci++ % rest.length];
          n.x = clamp(cell.x + (r2() - 0.5) * (W / cols) * 0.5, n.x0, n.x1);
          n.y = clamp(cell.y + (r2() - 0.5) * (H / rows) * 0.5, n.y0, n.y1);
        }
      }
      const iterations = warm ? 200 : 360;
      const sweep = prng(seed ^ Math.round(u * 1000));
      const seq = [...nodes];
      // Moves a and b apart along one axis by `push` (a against −sgn, b along +sgn), the lighter one more;
      // whatever a wall stops one of them from taking, the other takes. Returns how far they actually moved.
      const shove = (a, b, key, sgn, push) => {
        const lo = key === 'x' ? 'x0' : 'y0';
        const hi = key === 'x' ? 'x1' : 'y1';
        const wa = b.m / (a.m + b.m);
        const wantA = a[key] - sgn * push * wa;
        const gotA = clamp(wantA, a[lo], a[hi]);
        const wantB = b[key] + sgn * (push * (1 - wa) + Math.abs(wantA - gotA));
        const gotB = clamp(wantB, b[lo], b[hi]);
        const gotA2 = clamp(gotA - sgn * Math.abs(wantB - gotB), a[lo], a[hi]);
        const moved = Math.abs(gotA2 - a[key]) + Math.abs(gotB - b[key]);
        a[key] = gotA2;
        b[key] = gotB;
        return moved;
      };
      for (let it = 0; it < iterations; it++) {
        const f = it < iterations * 0.75 ? 1 : 0.5;
        let busy = false;
        // A fresh sweep order every pass, so no pair always wins the argument.
        for (let i = N - 1; i > 0; i--) {
          const k = Math.floor(sweep() * (i + 1));
          [seq[i], seq[k]] = [seq[k], seq[i]];
        }
        for (let i = 0; i < N; i++) {
          const a = seq[i];
          for (let j = i + 1; j < N; j++) {
            const b = seq[j];
            if (!touch(a, b)) continue;
            const ra = canTop(a, b) ? reach(a, b) : Infinity;
            const rb = canTop(b, a) ? reach(b, a) : Infinity;
            const r = Math.min(ra, rb);
            if (r <= 0) continue;
            busy = true;
            // The cheaper stacking: `t` on `under`. Push t off under's core.
            const [t, under] = ra <= rb ? [a, b] : [b, a];
            const cx = under.x + under.ox;
            const cy = under.y + under.oy;
            const px = t.hx + under.chx - Math.abs(cx - t.x);
            const py = t.hy + under.chy - Math.abs(cy - t.y);
            let alongX = px / (t.hx + under.chx) < py / (t.hy + under.chy);
            for (let attempt = 0; attempt < 2; attempt++) {
              const key = alongX ? 'x' : 'y';
              const d = alongX ? cx - t.x : cy - t.y;
              const sgn = d === 0 ? (i % 2 ? 1 : -1) : Math.sign(d); // under's core lies this way from t
              const push = (alongX ? px : py) * f;
              const moved = shove(t, under, key, sgn, push);
              if (moved > push * 0.5 || attempt) break;
              alongX = !alongX;
            }
          }
          // The flyer's words are solid.
          clearOut(a);
        }
        for (const a of nodes) {
          a.x = clamp(a.x, a.x0, a.x1);
          a.y = clamp(a.y, a.y0, a.y1);
        }
        if (!busy) break; // a clean sweep: settled
        yield;
      }
      // Last word to the flyer: nothing ends on its letters, even where the wall is jammed.
      for (const a of nodes) clearOut(a);
      return worstReach();
    }

    /** The deepest reach left anywhere, stacking each pair the better way (px). */
    function worstReach() {
      let worst = 0;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = nodes[i];
          const b = nodes[j];
          if (!touch(a, b)) continue;
          const ra = canTop(a, b) ? reach(a, b) : Infinity;
          const rb = canTop(b, a) ? reach(b, a) : Infinity;
          worst = Math.max(worst, Math.min(ra, rb));
        }
      }
      return worst;
    }

    /**
     * Stacking → slap order. Every overlapping pair that can only stack one way becomes an edge (under before
     * over); the rest is free. Kahn's algorithm takes the lowest priority among the stickers whose
     * underlayers are all down, so the order stays random-looking within the rules.
     */
    function stack() {
      const below = nodes.map(() => new Set()); // below[i]: stickers that must be slapped before i
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < N; j++) {
          const b = nodes[j];
          if (!touch(a, b)) continue;
          const ra = canTop(a, b) ? reach(a, b) : Infinity;
          const rb = canTop(b, a) ? reach(b, a) : Infinity;
          if (ra === 0 && rb === 0) continue; // free: either way is fine
          if (ra <= rb) below[i].add(j); // a on top: b first
          else below[j].add(i);
        }
      }
      const done = new Set();
      const out = [];
      while (out.length < N) {
        let pick = -1;
        for (let i = 0; i < N; i++) {
          if (done.has(i)) continue;
          let ready = true;
          for (const k of below[i]) {
            if (!done.has(k)) {
              ready = false;
              break;
            }
          }
          if (ready && (pick < 0 || nodes[i].prio < nodes[pick].prio)) pick = i;
        }
        if (pick < 0) {
          // A cycle (rare): take the one with the fewest stickers still to come under it.
          let fewest = Infinity;
          for (let i = 0; i < N; i++) {
            if (done.has(i)) continue;
            let left = 0;
            for (const k of below[i]) if (!done.has(k)) left++;
            if (left < fewest || (left === fewest && nodes[i].prio < nodes[pick].prio)) {
              fewest = left;
              pick = i;
            }
          }
        }
        done.add(pick);
        out.push(pick);
      }
      return out;
    }

    const free = Math.max(W * H * 0.25, W * H - clears.reduce((s, c) => s + 4 * c.hx * c.hy, 0));
    const foot = nodes.reduce((s, n) => s + n.wU * n.hU, 0) * COVERED;
    const widest = Math.max(...nodes.map((n) => n.wU));
    let u = Math.max(U_MIN, Math.min(Math.sqrt((free * FILL) / foot), (W * 0.92) / widest, U_MAX));
    let deepest = yield* pack(u, false);
    const snap = () => nodes.map((n) => [n.x, n.y]);
    let best = { deepest, u, at: snap() };
    for (let round = 1; deepest > 2 && round < 12 && u > U_MIN; round++) {
      u = Math.max(U_MIN, u * 0.985);
      deepest = yield* pack(u, true);
      if (deepest < best.deepest - 0.5) best = { deepest, u, at: snap() };
    }
    if (best.deepest < deepest) {
      u = best.u;
      for (const n of nodes) size(n, u);
      best.at.forEach(([x, y], i) => {
        nodes[i].x = x;
        nodes[i].y = y;
      });
    }
    return { u, xy: snap(), order: stack() };
  }

  return { size, solve };
}

// The solver's Worker is this module itself, loaded as a module Worker (same origin, already in the HTTP cache):
// there it only answers solve requests, run to the end.
if (typeof globalThis.WorkerGlobalScope === 'function' && globalThis instanceof globalThis.WorkerGlobalScope) {
  const kit = wallKit();
  globalThis.onmessage = (event) => {
    const { id, geo, W, H, clears, seed } = event.data;
    const steps = kit.solve(geo, W, H, clears, seed);
    let r;
    do r = steps.next();
    while (!r.done);
    globalThis.postMessage({ id, ...r.value });
  };
}

export default async function init(root, ctx) {
  const { $, h, clamp, prng } = ctx.dom;
  const { motion, sound } = ctx;
  // The init's steps each in a task right after a frame: never two of them in one frame (back-to-back yields can
  // run several steps before the page renders again).
  const afterFrame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  const stage = $('[data-stage]', root);
  const wall = $('[data-wall]', root);
  const slab = $('[data-slab]', root);
  const slabTexts = [...root.querySelectorAll('[data-slab-text]')];
  const list = $('[data-list]', root);
  const foot = $('.stk__foot', root);
  const note = $('[data-note]', root);
  const tierCounters = Object.fromEntries([...root.querySelectorAll('[data-tier-count]')].map((el) => [el.dataset.tierCount, el]));

  const [data] = await Promise.all([
    ctx.data('achievements'),
    // Metrics for the names printed on the stickers, and the flyer's final size (its words are the solid part
    // of the wall).
    // (with the flyer's own text, so the Cyrillic subsets load on the Russian page too).
    document.fonts?.load?.('900 100px "Sofia Sans Extra Condensed"', `ABC ${slabTexts[0]?.textContent ?? ''}`).catch(() => null),
    document.fonts?.load?.('400 14px Onest', slabTexts[1]?.textContent || 'a').catch(() => null),
    document.fonts?.load?.('500 11px "JetBrains Mono"', slabTexts[2]?.textContent || 'A').catch(() => null),
  ]);
  const tiers = Object.fromEntries(data.tiers.map((t) => [t.id, t]));
  for (const el of root.querySelectorAll('[data-tier-xp]')) {
    const t = tiers[el.dataset.tierXp];
    if (t) el.textContent = `+${ctx.i18n.format(t.xp)} XP`;
  }

  // ---------------------------------------------------------------- text metrics (Sofia 900, at 100 px)

  const measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = '900 100px "Sofia Sans Extra Condensed", "Arial Narrow", sans-serif';
  const textW = (s) => measureCtx.measureText(s.toUpperCase()).width + s.length * 2; // + letter-spacing .02em
  function split2(name) {
    const words = name.split(' ');
    if (words.length < 2) return [name];
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
      const w = Math.max(textW(lines[0]), textW(lines[1]));
      if (!best || w < best.w) best = { lines, w };
    }
    return best.lines;
  }

  // ---------------------------------------------------------------- the 50 stickers (in u units)

  const rnd = prng(SEED);
  const nodes = data.achievements.map((a, index) => {
    const tier = tiers[a.tier];
    const name = a.name.en; // app UI: English on both pages
    const node = {
      index,
      id: a.id,
      tier: a.tier,
      hidden: a.hidden,
      icon: a.iconName,
      name,
      desc: a.description[ctx.lang] ?? a.description.en,
      xp: tier.xp,
      kind: 'sq',
      lines: [name],
      on: false,
      forced: false,
    };
    // Shape: secrets and short bronze names are the app's square; long names ride on bumper strips;
    // silver / gold / legend with short names are badges with the name printed under the glyph.
    if (a.hidden) node.kind = 'sq';
    else if (a.tier === 'legend') node.kind = 'badge';
    else if (name.length >= 13) node.kind = 'strip';
    else node.kind = a.tier === 'bronze' ? 'sq' : 'badge';

    if (node.kind === 'sq') {
      node.wU = node.hU = a.hidden ? 0.88 + rnd() * 0.1 : 0.96;
    } else if (node.kind === 'badge') {
      const side = a.tier === 'legend' ? 1.52 : a.tier === 'gold' ? 1.2 : 1.1;
      const avail = side * 0.8;
      let fs = side * 0.16;
      let lines = [name];
      if ((textW(name) * fs) / 100 > avail) {
        lines = split2(name);
        fs = side * 0.15;
      }
      const widest = Math.max(...lines.map(textW));
      fs = Math.min(fs, (avail * 100) / widest);
      Object.assign(node, { wU: side, hU: side, lines, fsU: fs });
    } else {
      const hU = a.tier === 'gold' ? 0.74 : 0.68;
      const lines = name.length > 11 ? split2(name) : [name];
      const fs = lines.length > 1 ? hU * 0.3 : hU * 0.4;
      const tw = (Math.max(...lines.map(textW)) * fs) / 100;
      const wU = hU + fs * 0.42 + tw + fs * 0.6 + hU * 0.1;
      Object.assign(node, { wU, hU, lines, fsU: fs, twU: tw, cellU: hU - hU * 0.1 });
    }
    // Tilt: the design alternates −6° and +5°; a little jitter so the bomb never looks stamped out.
    const base = rnd() < 0.5 ? -6 : 5;
    const jitter = (rnd() - 0.5) * (node.kind === 'strip' ? 3 : 4.5);
    node.rot = node.kind === 'strip' ? base * 0.55 + jitter : base + jitter;
    node.key = rnd();
    // A few have a corner peeling back, as on any wall that has seen a winter (never a strip: its edge is text).
    const peel = rnd();
    node.peel = node.kind !== 'strip' && peel < 0.2 ? (peel < 0.1 ? 'br' : 'tr') : null;
    node.nLines = node.lines.length;
    node.last = a.id === LAST;
    return node;
  });
  const N = nodes.length;
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  let reading = nodes; // keyboard and screen-reader order: the wall read top-left to bottom-right
  let rover = null; // the one sticker in the tab order (none until the wall is laid out: the list stands in)
  let roverTouched = false; // until a visitor focuses one, the tab stop is the wall's top-left sticker
  function setRover(n) {
    if (rover === n) return;
    if (rover) rover.btn.tabIndex = -1;
    rover = n;
    if (n) n.btn.tabIndex = 0;
  }

  // Slap order = stacking order (later is on top). The layout decides it (see stack()): who lies on whom
  // wherever two overlap, then a topological order that leans on each sticker's priority — First One Down
  // first, NBD last, gold and legend leaning late so they end up on top.
  for (const n of nodes) {
    n.pin = n.id === FIRST ? -1 : n.id === LAST ? 1 : 0; // −1 under everything it touches, +1 over
    n.prio = n.id === FIRST ? -10 : n.id === LAST ? 10 : n.key + (n.tier === 'gold' ? 0.08 : n.tier === 'legend' ? 0.16 : 0);
  }
  let order = [...nodes].sort((a, b) => a.prio - b.prio);
  order.forEach((n, i) => {
    n.z = i + 1;
  });

  // ---------------------------------------------------------------- markup (built once)

  const sr = (n) =>
    n.hidden
      ? ctx.t('srSecret', { tier: ctx.t(`tier.${n.tier}`), xp: n.xp })
      : ctx.t('srEarned', { tier: ctx.t(`tier.${n.tier}`), xp: n.xp, description: n.desc });

  await afterFrame();

  // The glyph is a background image (the app's icon, ink, stroke 2), not inline SVG: an inline SVG scaled from
  // its 24 grid is one more transform for the browser to sort into layers on every frame, 33 times over. The icons
  // come in sprites, one per glyph size (squares, the three badges, the two strips): six SVG images for the browser
  // to build instead of one per icon, each always drawn at its one size (an SVG image drawn at another size is laid
  // out again). The sprites are set once on the wall; a glyph names its sprite and its place on the strip
  // (--gi, --gs, --gx: stickers.css cuts it out).
  const sprites = new Map(); // glyph size → { names, at }
  for (const n of nodes) {
    if (n.hidden) continue;
    const key = n.kind === 'sq' ? 'sq' : `${n.kind}-${n.hU}`;
    if (!sprites.has(key)) sprites.set(key, { names: [], at: new Map() });
    const s = sprites.get(key);
    if (!s.at.has(n.icon)) s.at.set(n.icon, s.names.push(n.icon) - 1);
    n.sprite = s;
  }
  [...sprites.values()].forEach((s, i) => {
    const w = GLYPH_PITCH * (s.names.length - 1) + 24;
    const cells = s.names.map((name, k) => `<g transform="translate(${k * GLYPH_PITCH} 0)">${(ctx.icon(name).match(/<path [^>]*\/>/g) ?? []).join('')}</g>`);
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="24" viewBox="0 0 ${w} 24" fill="none" ` +
      `stroke="#11110F" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${cells.join('')}</svg>`;
    wall.style.setProperty(`--stk-g${i}`, `url("data:image/svg+xml,${encodeURIComponent(svg)}")`);
    s.image = `var(--stk-g${i})`;
    s.size = `${((w / 24) * 100).toFixed(4)}% 100%`;
  });
  await afterFrame();

  function face(n) {
    const cls = ['stk-face', `stk-face--${n.tier}`];
    if (n.hidden) return h('span', { class: [...cls, 'stk-face--secret'] }, h('span', { class: 'stk-face__q' }, '???'));
    const s = n.sprite;
    const at = `${((s.at.get(n.icon) / Math.max(1, s.names.length - 1)) * 100).toFixed(4)}%`;
    const glyph = h('i', { class: 'stk-face__glyph', style: { '--gi': s.image, '--gs': s.size, '--gx': at } });
    const name = n.kind === 'sq' ? null : h('span', { class: 'stk-face__name' }, n.lines.map((l) => h('span', {}, l)));
    if (n.kind === 'strip') return h('span', { class: [...cls, 'stk-face--strip'] }, h('span', { class: 'stk-face__cell' }, glyph), name);
    if (n.kind === 'badge') return h('span', { class: [...cls, 'stk-face--badge'] }, glyph, name);
    return h('span', { class: cls }, glyph);
  }

  // ---------------------------------------------------------------- layout

  const kit = wallKit(); // size() for the page's own copy of each sticker; solve() where no Worker can run
  let laidOut = false; // the solved wall is on the page
  let mounted = false; // the stickers are in the list
  let want = null; // the box the latest solve is for: { W, H, ck }
  let job = 0; // the latest solve
  let shown = 0; // the solve on the page
  let words = []; // the flyer's words as boxes in wall coordinates (the last layout's), for the note to avoid
  let builtDone;
  const built = new Promise((resolve) => (builtDone = resolve)); // every sticker's markup exists

  /** Writes a solved wall onto the stickers: positions, sizes, stacking, reading order. */
  function apply(u) {
    order.forEach((n, i) => {
      n.z = i + 1;
      n.el.style.setProperty('--z', n.z);
    });
    for (const n of nodes) {
      const k = Math.min(n.w, n.h) / 50;
      const st = n.el.style;
      st.setProperty('--w', `${n.w.toFixed(1)}px`);
      st.setProperty('--h', `${n.h.toFixed(1)}px`);
      st.setProperty('--x', `${(n.x - n.w / 2).toFixed(1)}px`);
      st.setProperty('--y', `${(n.y - n.h / 2).toFixed(1)}px`);
      st.setProperty('--k', k.toFixed(3));
      if (n.fsU) st.setProperty('--fs', `${(n.fsU * u).toFixed(2)}px`);
      if (n.cellU) st.setProperty('--cell', `${(n.cellU * u).toFixed(1)}px`);
    }
    // Keyboard and screen-reader order follows the wall, top-left to bottom-right, in bands one unit tall.
    reading = [...nodes].sort((a, b) => Math.floor(a.y / u) - Math.floor(b.y / u) || a.x - b.x);
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  /**
   * Puts the stickers into the list in reading order: the first time a batch per frame, after the sprites are
   * built (each batch is one small style and layout in its own frame, never all 50 stickers in one) — unless the
   * wall is already half on screen (a jump to it, a fast flick): then the visitor is waiting for it, and it goes
   * in at once.
   */
  const wallShown = () => {
    const start = ctx.scroll.rangeOf?.(root.id)?.start;
    return inView && (start === undefined || start - ctx.scroll.y < 0.5 * ctx.scroll.vh);
  };
  async function mount() {
    if (!mounted) {
      const now = wallShown();
      const batch = now ? N : MOUNT_BATCH;
      if (!now) await warmSprites();
      for (let i = 0; i < N; i += batch) {
        await nextFrame();
        list.append(...reading.slice(i, i + batch).map((n) => n.el));
      }
      mounted = true;
      warmSprites().then((probes) => probes.forEach((probe) => probe.remove()));
    }
    if (reading.every((n, i) => list.children[i] === n.el)) return; // already in reading order
    const focused = document.activeElement;
    list.append(...reading.map((n) => n.el));
    if (focused && list.contains(focused) && document.activeElement !== focused) focused.focus({ preventScroll: true });
  }

  /**
   * The flyer's words as solid boxes in wall coordinates: each title line on its own (a short line leaves a
   * notch a sticker may sit in), the fine print and the hint as they are shown. The flyer's paper around them
   * is fair game.
   */
  const range = document.createRange();
  function readClears(wr) {
    const out = [];
    const parts = slabTexts.flatMap((el) => (el.tagName === 'H2' ? [...el.querySelectorAll('.stk-title__l')] : [el]));
    for (const el of parts) {
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue; // not shown here (the fine print on short screens)
      out.push({
        x: r.left - wr.left + r.width / 2,
        y: r.top - wr.top + r.height / 2,
        hx: r.width / 2 + CLEAR_PAD,
        hy: r.height / 2 + CLEAR_PAD,
      });
    }
    return out;
  }

  /** Every sticker on the page still has its bottom (less its bleed) inside a wall `H` tall. */
  const fits = (H) => nodes.every((n) => n.y + n.hy - Math.min(n.hy * 0.12, 8) <= H + 0.5);

  /**
   * Solves the wall for its current box, if the box really changed. A height-only change up to a toolbar's
   * size (TOOLBAR_PX) at the same width, with the flyer's words where they were, keeps the wall as it is: in
   * iOS Safari the stage is 100dvh and grows ~80 px whenever the toolbar slides away, and re-solving would
   * reshuffle all 50 stickers under the visitor's thumb. (stickers.css already keeps the wall itself at the
   * small viewport's height there; this covers browsers whose small viewport moves with the toolbar.) A wall
   * that grew keeps its stickers; one that shrank keeps them as long as every sticker still fits.
   */
  function requestLayout() {
    relayout = 0;
    const wr = wall.getBoundingClientRect();
    const W = Math.round(wall.clientWidth);
    const H = Math.round(wall.clientHeight);
    if (W < 40 || H < 40) return; // not shown yet: the next resize brings it back here
    const clears = readClears(wr);
    const ck = clears.flatMap((c) => [c.x, c.y, c.hx, c.hy]).map((v) => Math.round(v)).join(',');
    if (want && W === want.W && ck === want.ck) {
      if (H === want.H) return;
      if (Math.abs(H - want.H) <= TOOLBAR_PX && (H > want.H || (laidOut && shown === job && fits(H)))) return;
    }
    want = { W, H, ck };
    words = clears;
    const id = ++job;
    // The solver gets plain copies: the stickers on the page keep their places until the new wall is in.
    const geo = nodes.map(({ wU, hU, rot, kind, hidden, fsU, twU, cellU, nLines, pin, prio, last }) => ({ wU, hU, rot, kind, hidden, fsU, twU, cellU, nLines, pin, prio, last }));
    const msg = { id, geo, W, H, clears, seed: SEED };
    if (!solveOff(msg)) solveHere(msg);
    if (!mounted) warmSprites();
  }

  /**
   * While the first wall is being solved: the sprites' SVG images are built one per frame (a hidden glyph each
   * asks for its sprite), so the first stickers to go in do not build all six in one frame. Resolves with the
   * hidden glyphs, which go once the stickers hold the images.
   */
  let warming = null;
  function warmSprites() {
    warming ??= (async () => {
      const probes = [];
      for (const s of sprites.values()) {
        await nextFrame();
        probes.push(wall.appendChild(h('i', { class: 'stk-face__glyph stk-warm', 'aria-hidden': 'true', style: { '--gi': s.image } })));
      }
      await nextFrame();
      return probes;
    })();
    return warming;
  }

  // Off the main thread: this module as a module Worker, one per solve (a newer box ends an older solve at once),
  // ended when its answer is in. (Not a Blob URL: registering one is a synchronous round trip to the browser.)
  let worker = null;
  let workerOk = typeof Worker === 'function';
  function endWorker() {
    worker?.terminate();
    worker = null;
  }
  function solveOff(msg) {
    if (!workerOk) return false;
    try {
      endWorker();
      const w = new Worker(import.meta.url, { type: 'module', name: 'stickers-wall' });
      worker = w;
      w.onmessage = (event) => {
        if (worker === w) endWorker();
        solved(event.data);
      };
      w.onerror = w.onmessageerror = (event) => {
        // No module Worker here after all (an old engine, a policy): the main thread takes over, in idle slices.
        event.preventDefault();
        if (worker === w) endWorker();
        workerOk = false;
        if (msg.id === job) solveHere(msg);
      };
      w.postMessage(msg);
      return true;
    } catch {
      workerOk = false;
      endWorker();
      return false;
    }
  }

  /** On the main thread: a slice of solving whenever the thread is idle, never more than ~8 ms at a time. */
  const idleSlice = () =>
    new Promise((resolve) => {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback((d) => resolve(clamp(d.timeRemaining() - 1, 3, 8)), { timeout: 200 });
      else ctx.yield().then(() => resolve(4));
    });
  async function solveHere(msg) {
    const steps = kit.solve(msg.geo, msg.W, msg.H, msg.clears, msg.seed);
    for (;;) {
      const budget = await idleSlice();
      if (msg.id !== job) return; // a newer box took over
      const t = performance.now();
      let r;
      do r = steps.next();
      while (!r.done && performance.now() - t < budget);
      if (r.done) return solved({ id: msg.id, ...r.value });
    }
  }

  // Solved walls go onto the page one after another (the first one takes a few frames to go in).
  let commits = Promise.resolve();
  function solved(res) {
    commits = commits.then(() => commit(res)).catch((error) => console.error('stickers: wall', error));
  }

  async function commit({ id, u, xy, order: ids }) {
    await built;
    if (id !== job) return; // a newer box took over
    for (const n of nodes) kit.size(n, u);
    xy.forEach(([x, y], i) => {
      nodes[i].x = x;
      nodes[i].y = y;
    });
    order = ids.map((i) => nodes[i]);
    const first = !laidOut;
    const wasOn = onCount;
    const wasLifted = lifted;
    const wasPinned = pinnedByTap;
    hideNote();
    apply(u);
    await mount();
    setRover(roverTouched && rover ? rover : reading[0]);
    laidOut = true;
    shown = id;
    // Stickers already on stay on without slapping again; on the first wall, the build catches up.
    for (const n of nodes) {
      n.anim?.cancel();
      n.shAnim?.cancel();
      n.on = false;
      n.el.classList.remove('is-on');
    }
    live.clear();
    onCount = 0;
    if (first) sync(countFor(build));
    else sync(wasOn, { animate: false });
    for (const n of nodes) if (n.forced) setOn(n, true, { animate: false }); // keyboard focus keeps its sticker
    syncLegend();
    // The list stood in for the wall in the tab order; now the stickers take over (and focus, if it was there).
    if (list.hasAttribute('tabindex')) {
      if (document.activeElement === list) rover?.btn.focus();
      list.removeAttribute('tabindex');
    }
    // A note that was up comes back on its sticker's new place (a focused one, the complete wall's NBD).
    const focusedNode = nodeOf(document.activeElement);
    if (focusedNode && focusedNode.on && document.activeElement.matches(':focus-visible')) showNote(focusedNode);
    else if (wasLifted && wasLifted.on && wasPinned) showNote(wasLifted, { fromTap: true });
    syncAuto();
  }

  // ---------------------------------------------------------------- slap / peel

  // Every sticker pops down from 1.6×; NBD, the last one, slams from higher up — the wall's full stop. The
  // keyframes are sampled once here; each slap is a plain WAAPI call on them (no per-slap sampling).
  const SLAPS = Object.fromEntries(
    [['pop', 1.6], ['slam', 1.9]].map(([spring, from]) => {
      const solved = motion.solveSpring(spring);
      const i = solved.samples.findIndex((v) => v >= 1);
      const contactAt = i > 0 ? i / (solved.samples.length - 1) : 0.3;
      const { keyframes, duration } = motion.springKeyframes(spring, (v) => ({ transform: `scale(${(from + (1 - from) * v).toFixed(4)})`, opacity: Math.min(1, v * 12) }));
      // The hard shadow snaps in on contact (DESIGN §8.1), not before.
      const shadow = [{ opacity: 0 }, { opacity: 0, offset: contactAt }, { opacity: 1, offset: Math.min(1, contactAt + 0.01) }, { opacity: 1 }];
      return [spring, { keyframes, shadow, duration, contactAt }];
    }),
  );
  const PEEL_KEYS = [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.1)', opacity: 0 }];

  let onCount = 0; // stickers on in `order` (the prefix), not counting forced ones
  let lastSlapAt = 0;
  let burstK = 0;
  let lastSoundAt = 0;
  let nbdContactAt = 0; // when NBD's slam lands (performance.now() time), for its note
  const live = new Set(); // stickers whose slap is running, oldest first

  function slapSound(n) {
    const now = performance.now();
    burstK = now - lastSlapAt > BURST_MS ? 0 : burstK + 1;
    lastSlapAt = now;
    if (!sound.enabled) return;
    if (n.id === LAST) {
      sound.play('sticker');
      lastSoundAt = now;
      return;
    }
    if (now - lastSoundAt < SOUND_GAP_MS) return;
    lastSoundAt = now;
    if (burstK === 0) sound.play('sticker');
    else sound.play('tick', { rate: 2 ** (Math.min(burstK, 12) / 12) });
  }

  // The slap budget: CAP slaps in hand, one more every SLAP_EVERY_MS. Read at a reading pace every sticker slaps;
  // a fast scroll places most of them at once and slaps a few (each slap is a short-lived layer the browser has
  // to make and drop, which is what a fast scroll cannot afford on a slow phone).
  let slapTokens = CAP;
  let slapTokensAt = 0;
  function takeSlap(now) {
    slapTokens = Math.min(CAP, slapTokens + (now - slapTokensAt) / SLAP_EVERY_MS);
    slapTokensAt = now;
    if (slapTokens < 1) return false;
    slapTokens -= 1;
    return true;
  }

  function stopAnim(n) {
    n.anim?.cancel();
    n.shAnim?.cancel();
    n.anim = n.shAnim = null;
    live.delete(n);
  }

  /** Keeps at most CAP slaps running: the oldest ones jump to rest. */
  function trimLive() {
    for (const n of live) {
      if (live.size <= CAP) break;
      n.anim?.finish();
      n.shAnim?.finish();
      n.anim = n.shAnim = null;
      live.delete(n);
    }
  }

  function setOn(n, on, { delay = 0, animate = true, silent = false } = {}) {
    if (n.on === on) return;
    n.on = on;
    stopAnim(n);
    if (on) {
      n.el.classList.add('is-on');
      if (!animate || ctx.reduced) return; // placed at once: no animation, no layer, no sound
      const slap = SLAPS[n.id === LAST ? 'slam' : 'pop'];
      const a = n.slapEl.animate(slap.keyframes, { duration: slap.duration, delay, fill: 'backwards', easing: 'linear' });
      n.anim = a;
      n.shAnim = n.shEl.animate(slap.shadow, { duration: slap.duration, delay, fill: 'backwards', easing: 'linear' });
      live.add(n);
      a.onfinish = () => {
        if (n.anim !== a) return;
        n.anim = n.shAnim = null;
        live.delete(n);
      };
      if (n.id === LAST) nbdContactAt = performance.now() + delay + slap.duration * slap.contactAt;
      if (!silent) {
        if (delay > 8) setTimeout(() => n.on && slapSound(n), delay);
        else slapSound(n);
      }
    } else {
      if (lifted === n) hideNote();
      if (!animate || ctx.reduced) {
        n.el.classList.remove('is-on');
        return;
      }
      const a = n.slapEl.animate(PEEL_KEYS, { duration: 110, easing: 'cubic-bezier(.7,0,.84,0)', fill: 'forwards' });
      n.anim = a;
      a.onfinish = () => {
        if (!n.on) n.el.classList.remove('is-on');
        if (n.anim === a) {
          a.cancel();
          n.anim = null;
        }
      };
    }
  }

  function countFor(b) {
    if (ctx.reduced) return N;
    return Math.min(N, Math.floor(N * Math.pow(clamp(b), 1.15) + 1e-6));
  }

  /**
   * Brings the wall to `target` stickers (a prefix of `order`). A scrub that adds or peels more than CAP at
   * once places all but the last CAP at once; those slap (or peel) on a short stagger.
   */
  function sync(target, { animate = true } = {}) {
    if (!laidOut) return;
    const adding = target - onCount;
    if (adding > 0) {
      // Who slaps: the newest ones, as many as the slap budget allows (NBD, the full stop, always does).
      const slapping = new Set();
      if (animate && !ctx.reduced) {
        const now = performance.now();
        for (let i = adding - 1; i >= 0 && slapping.size < CAP; i--) {
          const n = order[onCount + i];
          if (n.forced) continue;
          if (n.id === LAST || takeSlap(now)) slapping.add(n);
          else break;
        }
      }
      // A batch from a steady scroll lands evenly across the time until the next one; a flick is a drumroll.
      const batch = Math.max(1, slapping.size);
      const step = batch <= 3 ? SYNC_MS / batch : Math.min(42, 380 / batch);
      let k = 0;
      for (let i = 0; i < adding; i++) {
        const n = order[onCount + i];
        if (n.forced) continue;
        const slaps = slapping.has(n);
        setOn(n, true, { delay: slaps ? k++ * step : 0, animate: slaps });
      }
      trimLive();
    } else {
      for (let i = onCount - 1, k = 0; i >= target; i--, k++) {
        const n = order[i];
        if (n.forced) continue;
        setOn(n, false, { animate: animate && k < CAP });
      }
    }
    onCount = target;
    syncLegend();
    syncAuto();
  }

  // ---------------------------------------------------------------- legend

  const tierShown = { bronze: -1, silver: -1, gold: -1, legend: -1 };
  function syncLegend() {
    const counts = { bronze: 0, silver: 0, gold: 0, legend: 0 };
    for (const n of nodes) if (n.on) counts[n.tier]++;
    for (const [tier, el] of Object.entries(tierCounters)) {
      if (counts[tier] === tierShown[tier]) continue;
      tierShown[tier] = counts[tier];
      // The text node changes in place (no node swapped out and in on every batch of the scrub).
      if (el.firstChild?.nodeType === 3) el.firstChild.data = String(counts[tier]);
      else el.textContent = String(counts[tier]);
      el.closest('.stk-tier')?.classList.toggle('is-full', counts[tier] >= (tiers[tier]?.count ?? 0));
    }
  }

  // ---------------------------------------------------------------- lift + note (tap, hover, focus)

  const kicker = $('[data-note-kicker]', note);
  const xpEl = $('[data-note-xp]', note);
  const nameEl = $('[data-note-name]', note);
  const descEl = $('[data-note-desc]', note);
  let lifted = null;
  let pinnedByTap = false;
  let autoShown = false; // NBD's note is up because the wall is complete, not because of a visitor
  let autoSpent = false; // a visitor put it away or took over: not again until the wall is broken or re-entered
  let autoTimer = 0;
  let lingerTimer = 0;
  let inView = false;

  function showNote(n, { fromTap = false, auto = false } = {}) {
    clearTimeout(lingerTimer);
    if (lifted && lifted !== n) lifted.el.classList.remove('is-lift');
    if (!auto && laidOut && onCount >= N) autoSpent = true;
    autoShown = auto;
    lifted = n;
    pinnedByTap = fromTap;
    n.el.classList.add('is-lift');
    const tierWord = ctx.t(`tier.${n.tier}`);
    note.dataset.tier = n.tier;
    note.toggleAttribute('data-secret', n.hidden);
    kicker.textContent = n.hidden ? ctx.t('secretKicker', { tier: tierWord }) : ctx.t('kicker', { tier: tierWord });
    xpEl.textContent = `+${ctx.i18n.format(n.xp)} XP`;
    nameEl.textContent = n.hidden ? '???' : n.name;
    descEl.textContent = n.hidden ? ctx.t('secretBody') : n.desc;
    note.hidden = false;
    placeNote(n);
    if (!ctx.reduced) note.animate(NOTE_POP.keyframes, { duration: NOTE_POP.duration, easing: 'linear' });
  }
  const NOTE_POP = motion.springKeyframes('pop', (v) => ({ transform: `scale(${(0.9 + 0.1 * v).toFixed(4)})`, opacity: Math.min(1, v * 4) }));

  /**
   * The note goes above its sticker, below it, or beside it — the first that stays on the stage, clear of the
   * chrome, and covers the least of the flyer's words. Sideways it follows the sticker within the gutters.
   */
  function placeNote(n) {
    const sr0 = stage.getBoundingClientRect();
    const br = n.btn.getBoundingClientRect();
    const wr = wall.getBoundingClientRect();
    const gutter = parseFloat(getComputedStyle(foot).paddingLeft) || 16;
    const chrome = parseFloat(getComputedStyle(stage).paddingTop) || 100;
    const nw = note.offsetWidth;
    const nh = note.offsetHeight;
    const left = gutter;
    const right = Math.max(gutter, sr0.width - gutter - nw);
    const ceiling = chrome - 4;
    const floor = Math.max(ceiling, sr0.height - 10 - nh);
    const bx = br.left - sr0.left;
    const by = br.top - sr0.top;
    // Overlap (px²) of a note at (x, y) with the flyer's words.
    const ox = wr.left - sr0.left;
    const oy = wr.top - sr0.top;
    const covers = (x, y) =>
      words.reduce((sum, c) => {
        const w = Math.min(x + nw, ox + c.x + c.hx) - Math.max(x, ox + c.x - c.hx);
        const h = Math.min(y + nh, oy + c.y + c.hy) - Math.max(y, oy + c.y - c.hy);
        return sum + (w > 0 && h > 0 ? w * h : 0);
      }, 0);
    const midX = clamp(bx + br.width / 2 - nw / 2, left, right);
    const midY = clamp(by + br.height / 2 - nh / 2, ceiling, floor);
    const ways = [
      { x: midX, y: by - nh - 18 }, // above
      { x: midX, y: by + br.height + 18 }, // below
      { x: bx + br.width + 16, y: midY }, // right
      { x: bx - nw - 16, y: midY }, // left
      // A sticker on the flyer's edge: past the words, below or above them.
      ...words.map((c) => ({ x: midX, y: oy + c.y + c.hy + 14, far: true })),
      ...words.map((c) => ({ x: midX, y: oy + c.y - c.hy - nh - 14, far: true })),
    ].map((w, i) => ({ ...w, i, fits: w.x >= left - 0.5 && w.x <= right + 0.5 && w.y >= ceiling - 0.5 && w.y <= floor + 0.5 }));
    for (const w of ways) {
      w.covers = covers(w.x, w.y);
      w.away = w.far ? Math.abs(w.y + nh / 2 - (by + br.height / 2)) : 0;
    }
    ways.sort((a, b) => b.fits - a.fits || a.covers - b.covers || a.away - b.away || a.i - b.i);
    let { x, y } = ways[0];
    if (!ways[0].fits) {
      x = midX;
      y = clamp(by - nh - 18, ceiling, floor);
    }
    note.style.setProperty('--nx', `${x.toFixed(1)}px`);
    note.style.setProperty('--ny', `${y.toFixed(1)}px`);
  }

  function hideNote() {
    clearTimeout(lingerTimer);
    if (lifted) lifted.el.classList.remove('is-lift');
    lifted = null;
    pinnedByTap = false;
    autoShown = false;
    note.hidden = true;
  }

  /** A visitor put the note away. */
  function dismissNote() {
    if (laidOut && onCount >= N) autoSpent = true;
    hideNote();
  }

  /**
   * The wall's full stop: once all 50 are on and NBD has landed, its note comes up on its own — unless a
   * visitor is already looking at another sticker, or put this one away.
   */
  function syncAuto() {
    const complete = laidOut && onCount >= N;
    if (!complete) {
      clearTimeout(autoTimer);
      autoTimer = 0;
      autoSpent = false;
      if (autoShown) hideNote();
      return;
    }
    if (autoShown || autoSpent || autoTimer || lifted || !inView) return;
    const wait = ctx.reduced ? 0 : Math.max(0, nbdContactAt - performance.now()) + 160;
    autoTimer = setTimeout(() => {
      autoTimer = 0;
      const nbd = byId[LAST];
      if (laidOut && onCount >= N && !lifted && !autoSpent && inView && nbd.on) showNote(nbd, { auto: true });
    }, wait);
  }

  const nodeOf = (target) => {
    const btn = target?.closest?.('.stk-s__btn');
    return btn && list.contains(btn) ? byId[btn.dataset.id] : null;
  };

  list.addEventListener('click', (event) => {
    const n = nodeOf(event.target);
    if (!n || !n.on) return;
    if (lifted === n && pinnedByTap) {
      dismissNote();
      return;
    }
    showNote(n, { fromTap: true });
    if (sound.enabled) sound.play(n.tier === 'gold' || n.tier === 'legend' ? 'stamp' : 'tick');
  });
  // Mouse: hover lifts a sticker; the note stays while the pointer travels onto it, so it can be read.
  // While a hover note is up, crossing other stickers on the way to it does not take it away: the next
  // sticker lifts only once the pointer rests on it (HOVER_SWITCH_MS).
  let hoverTimer = 0;
  const lingerHide = () => {
    clearTimeout(lingerTimer);
    lingerTimer = setTimeout(() => {
      clearTimeout(hoverTimer);
      if (!pinnedByTap && !autoShown) hideNote();
    }, NOTE_LINGER_MS);
  };
  list.addEventListener('pointerover', (event) => {
    if (event.pointerType !== 'mouse' || pinnedByTap) return;
    const n = nodeOf(event.target);
    clearTimeout(hoverTimer);
    if (!n || !n.on) return;
    if (n === lifted) {
      clearTimeout(lingerTimer);
      return;
    }
    if (!lifted || autoShown) showNote(n);
    else hoverTimer = setTimeout(() => n.on && !pinnedByTap && showNote(n), HOVER_SWITCH_MS);
  });
  list.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'mouse' || pinnedByTap || autoShown || !lifted) return;
    const to = event.relatedTarget;
    if (nodeOf(to) === lifted || note.contains(to)) return;
    if (!nodeOf(to)) lingerHide(); // off the wall (onto another sticker: pointerover decides)
    else if (nodeOf(event.target) === lifted) lingerHide();
  });
  note.addEventListener('pointerover', () => {
    clearTimeout(lingerTimer);
    clearTimeout(hoverTimer);
  });
  note.addEventListener('pointerout', (event) => {
    if (event.pointerType !== 'mouse' || pinnedByTap || autoShown || !lifted) return;
    const to = event.relatedTarget;
    if (note.contains(to) || nodeOf(to) === lifted) return;
    lingerHide();
  });
  // A tap on the note puts it away.
  note.addEventListener('click', dismissNote);

  // Keyboard: the wall is one tab stop; arrows walk it in reading order (top-left to bottom-right).
  // A focused sticker is on whatever the build says, and the wall comes fully into view when focus arrives.
  list.addEventListener('keydown', (event) => {
    const n = nodeOf(event.target);
    if (!n) return;
    const i = reading.indexOf(n);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: reading.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = reading[clamp(to, 0, reading.length - 1)];
    setRover(next);
    next.btn.focus({ preventScroll: true });
  });
  /**
   * Keyboard focus arriving from outside the wall: puts the stage where the whole wall is on screen and
   * complete (the browser's own focus scroll only reveals the one sticker, often with the wall half built).
   */
  function bringWallIn() {
    const span = ctx.scroll.rangeOf?.(root.id);
    if (!span) return;
    const top = stage.getBoundingClientRect().top;
    const p = ctx.scroll.progressOf(root.id);
    if (ctx.reduced ? Math.abs(top) < 1 : Math.abs(top) < 1 && p >= PIN_END && p < 0.999) return;
    const y = Math.round(span.start + (span.end - span.start) * (ctx.reduced ? 0 : (PIN_END + 1) / 2));
    window.scrollTo({ top: y, behavior: 'instant' });
  }
  list.addEventListener('focusin', (event) => {
    const n = nodeOf(event.target);
    if (!n) return;
    roverTouched = true;
    setRover(n);
    n.forced = true; // on, whatever the build does while focus is here (the focus scroll moves the build)
    if (!n.on) setOn(n, true, { silent: true });
    syncLegend();
    const from = event.relatedTarget;
    const keyboard = event.target.matches(':focus-visible'); // not a click or a tap
    if (keyboard && (!from || from === list || !list.contains(from))) bringWallIn();
    if (keyboard) showNote(n);
  });
  list.addEventListener('focusout', (event) => {
    const n = nodeOf(event.target);
    if (n?.forced) {
      n.forced = false;
      if (order.indexOf(n) >= onCount) setOn(n, false, { animate: false });
      syncLegend();
    }
    if (!pinnedByTap && !autoShown && !list.contains(event.relatedTarget)) hideNote();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && lifted) {
      const btn = lifted.btn;
      const hadFocus = list.contains(document.activeElement);
      dismissNote();
      if (hadFocus) btn.focus({ preventScroll: true });
    }
  });
  // A tap anywhere else puts the sticker back.
  document.addEventListener(
    'click',
    (event) => {
      if (lifted && (pinnedByTap || autoShown) && !nodeOf(event.target) && !note.contains(event.target)) dismissNote();
    },
    true,
  );

  // ---------------------------------------------------------------- scroll → build

  let pinP = 0;
  let build = 0;
  // The wall changes at most every SYNC_MS while the page scrolls: each change re-lays the page's layers, so
  // three frames' worth of stickers go on together (on a stagger, so they still land one by one).
  let lastSyncAt = -1e9;
  let flushing = 0;
  function flush() {
    flushing = 0;
    const target = countFor(build);
    if (target === onCount) return;
    const wait = lastSyncAt + SYNC_MS - performance.now();
    if (wait > 1) {
      flushing = requestAnimationFrame(flush);
      return;
    }
    lastSyncAt = performance.now();
    sync(target);
  }
  function setBuild(b) {
    build = b;
    if (!flushing) flush();
  }
  // Before the pin: the first B0 of the build as the section rises into view. From the scroll engine's cached
  // geometry — no layout read in the middle of the frame's writes.
  function approach(y = ctx.scroll.y, vh = ctx.scroll.vh || window.innerHeight) {
    const start = ctx.scroll.rangeOf?.(root.id)?.start;
    const top = start === undefined ? root.getBoundingClientRect().top : start - y;
    setBuild(B0 * clamp((ENTER * vh - top) / (ENTER * vh)));
  }
  let offFrame = null;

  // Reduced motion: the wall is simply there (the stage is one screen tall then: stickers.css).
  function applyReduced() {
    for (const n of nodes) stopAnim(n);
    sync(countFor(build), { animate: false });
  }
  ctx.onReducedChange(applyReduced);

  // Lay the wall out, and again when its box or the flyer changes (rotation, resize, fonts; not a toolbar: see
  // requestLayout). The observer's first call, after the next layout, brings the first one — in a frame of its own,
  // while the stickers below are still being built.
  let relayout = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(relayout);
    relayout = requestAnimationFrame(requestLayout);
  });
  ro.observe(wall);
  ro.observe(slab);

  syncLegend(); // the counters start at zero; they climb as the stickers land

  // The stickers, built a batch per frame while the wall is being solved (the observer above has started it), and
  // kept out of the page until the solved wall goes in (commit() waits for them).
  for (let i = 0; i < N; i++) {
    if (i % BUILD_BATCH === 0) await afterFrame();
    const n = nodes[i];
    n.slapEl = h('span', { class: 'stk-s__slap', 'aria-hidden': 'true' }, h('i', { class: 'stk-s__sh' }), face(n), n.peel ? h('i', { class: 'stk-s__flap' }) : null);
    n.shEl = n.slapEl.firstChild;
    n.btn = h(
      'button',
      { class: 'stk-s__btn', type: 'button', tabindex: '-1', dataset: { id: n.id } },
      n.slapEl,
      h('span', { class: 'sr-only' }, n.hidden ? null : h('span', { lang: 'en' }, `${n.name}. `), sr(n)),
    );
    n.el = h('li', { class: ['stk-s', `stk-s--${n.kind}`], dataset: n.peel ? { id: n.id, peel: n.peel } : { id: n.id }, style: { '--z': n.z, '--r': `${n.rot.toFixed(2)}deg` } }, n.btn);
  }
  builtDone();

  return {
    progress(p) {
      pinP = p;
      if (p > 0) setBuild(B0 + (1 - B0) * clamp(p / PIN_END));
      else approach();
    },
    enter() {
      inView = true;
      offFrame?.();
      offFrame = ctx.scroll.onFrame(
        ({ y, vh }) => {
          if (pinP <= 0) approach(y, vh);
        },
        { early: true },
      );
      syncAuto();
    },
    leave() {
      inView = false;
      offFrame?.();
      offFrame = null;
      clearTimeout(autoTimer);
      autoTimer = 0;
      autoSpent = false;
      hideNote();
    },
  };
}
