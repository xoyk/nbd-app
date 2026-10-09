// library · "Which trick?" — the reel. All the names in poster type on a drum (a canvas: rows are drawn, not laid
// out, so a spin never touches layout), the app's segment chips lighting as it passes them, the app's own search
// over names, aliases and stance names (library-search.js), and the stances the trick has.
//
// The scroll spins the drum through all of them: it slows down past KICKFLIP and rests a few names on, so the spin never
// finds it. The typing does: the scroll types "flip", each letter as the scroll asks for it (never two within
// MIN_LETTER_MS; a flick that asks for several at once gets them at a typist's pace, LETTER_MS, so every letter is
// still on screen), and each letter re-spins the drum through the narrowing set — 216 → 133 → 44 → 43 today — with the box
// up at the top row and the results running up into it from the drum's foot, the way the spin turns (scrolling forward,
// everything on the stage travels up; a conveyor, run(): what was on the drum leaves at the top, so the box is never
// empty), the first hit arriving in the box last — and scrolling back, each deleted letter runs it the other way, down;
// the count outlined behind them at
// poster size and knocked out of by every row that crosses it (an overprint: the type sits on it, never under a line
// through it; on a phone, whose rows run the screen's width, the results dissolve into the paper over the count).
// "flip" snaps KICKFLIP into the box and the stance row lights; a scroll that gets to the slide-down within SETTLE_MS
// of it waits that long for the payoff (busy / onSettled), and one already well into the slide-down has the rest typed
// at once (finish). Once the visitor types, or just steps into the field, it follows them.
//
//   const reel = createReel(el, { data, ctx, onLive, onSettled })
//   reel.spin(q)        0…1 through the scroll's spin (every trick, slowing past Kickflip); ignored once the visitor typed
//   reel.type(u, entering)  0…1 through the scroll's typing ("flip", a letter per quarter); ignored once the visitor
//                       typed. entering: the reel has just become the stage's beat (stale letters go at once);
//                       library.js calls it only then, or to clear the field while the sheet is still rising (inert)
//   reel.typed(n)       the same by letters (n of "flip", 0 = none)
//   reel.busy()         the scroll's typing has not paid off yet: letters still to type, or "flip" has found Kickflip
//                       less than SETTLE_MS ago (the stage holds the reel; onSettled() fires when the hold ends)
//   reel.finish()       every letter the scroll asked for at once, no run and no hold (the sheet is already going)
//   reel.resize()       after a layout change (the drum's box)
//   reel.focused        the visitor is in the field (the stage holds the reel while they type)
//   reel.userQuery      what the visitor typed (null: the scroll drives the reel)
//   reel.render()       draw now
//   reel.qa()           { query, n, top, settled, anchor, pos, busy } — what is on screen
//
// The step loop runs only while the reel is on screen (el not inert), and the live region speaks only then.

import { createSearch } from './library-search.js';

const TH = 0.3; // drum: radians per row
const STATE = [
  ['locked', 'locked'],
  ['open', 'open'],
  ['learning', 'learning'],
  ['landed', 'landed'],
  ['onlock', 'on lock'],
];
const STANCE_WORD = { normal: 'Normal', fakie: 'Fakie', nollie: 'Nollie', switch: 'Switch' };
// the app's empty search (src/i18n/en/search.ts empty / emptyBody): app UI, English on both pages
const EMPTY = ['NOT ON THE MAP', 'Check the spelling or try another name: aliases work too.'];
const INK = '#11110F';
const INK_SOFT = '#4A4840';
const DISPLAY = "'Sofia Sans Extra Condensed', 'Arial Narrow', sans-serif";
const BODY = "'Onest', system-ui, sans-serif";
const WORD = 'flip'; // what the scroll types
const POUR = [12, 8, 4, 0]; // rows each scroll letter's results run up from (the set narrows, the run shortens)
const MIN_LETTER_MS = 60; // a letter the scroll asks for is typed at once, never two within this
const LETTER_MS = 130; // several asked for at once (a flick): a typist's pace, so each one shows
const BACK_MS = 60; // and deletes faster
const POUR_MS = 560;
const FINISH_MS = 160; // "flip" has no run of its own: one under way finishes into the box this fast (< SETTLE_MS)
const ANCHOR_MS = 340;
const SLAM_MS = 260;
const COUNT_A = 0.35; // the count's outline: a watermark, under every row
// "flip" has found Kickflip: a scroll that reaches the slide-down sooner waits this long for the payoff (the timeline
// leaves room for it on a steady scroll: the typing ends 0.04 of the pin before the sheet goes down)
const SETTLE_MS = 180;
const STALE_A = 0.3; // the previous query's rows being carried away: never in the box's selected style
const BOX_SX = 0.85; // the box's row is condensed no further than this; past it, the whole row is set smaller
const FOOT = 0.7; // rows fade into the paper over the drum's last 0.7 of a row: none is cropped mid-glyph
// A phone held upright, results: the foot rises to the count's shoulder (COUNT_CLEAR of its figures' height from
// their top; a little above it) and the rows dissolve over FOOT_RUN of a row from there, so every digit is about three
// quarters bare paper (0.73–0.91 of its outline at 390 × 844, 390 × 664, 375 × 667, 320 × 568; it was 0.40–0.72)
const COUNT_CLEAR = -0.15;
const FOOT_RUN = 0.8;
const KNOCK_HOLD = 0.85; // a fading row still cuts the outline whole until its ink is this far gone: no line through it
// the section's desktop layout (library.js): a desktop, or a phone on its side, whose rows end short of the count
const SIDEWAYS = '(min-width: 900px), (min-width: 600px) and (max-height: 520px) and (orientation: landscape)';
const NATIVE = /[^\x00-\x7F]/; // a query in the page's own script (the trick names are English)
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',');

export function createReel(el, { data, ctx, onLive, onSettled }) {
  const { $, clamp, lerp } = ctx.dom;
  const T = data.tricks;
  const SEG = data.segments;
  const search = createSearch(T);
  const KICK = T.findIndex((t) => t[10] === 'kickflip');
  const REST = KICK + 5; // where the scroll's spin comes to rest: past Kickflip (Nightmare Flip)
  const ALL = T.map((_, i) => i);
  const input = $('[data-q]', el);
  const caret = $('[data-caret]', el);
  const countEl = $('[data-q-n]', el);
  const chipsRow = $('[data-chips]', el);
  const drum = $('[data-drum]', el);
  const frame = $('[data-drum-frame]', el);
  const cv = $('[data-drum-cv]', el);
  const chipEl = $('[data-drum-chip]', el);
  const stancesEl = $('[data-stances]', el);
  const stanceRow = $('[data-stance-row]', el);
  const g = cv.getContext('2d');

  // ------------------------------------------------------------ segment chips
  const chips = [];
  const allChip = document.createElement('span');
  allChip.className = 'lib-schip is-on';
  chipsRow.append(allChip);
  SEG.forEach(([name, , color]) => {
    const c = document.createElement('span');
    c.className = 'lib-schip';
    c.style.setProperty('--sw', color);
    c.innerHTML = `<i></i>${name} <small></small>`;
    chipsRow.append(c);
    chips.push(c);
  });
  /** The app's TrickPicker: "all N", then the segments with their counts; a query drops the empty ones. */
  function setCounts(counts) {
    const total = counts ? counts.reduce((a, b) => a + b, 0) : T.length;
    allChip.innerHTML = `all <small>${total}</small>`;
    chips.forEach((c, i) => {
      const n = counts ? counts[i] : SEG[i][1];
      c.lastChild.textContent = String(n);
      c.hidden = Boolean(counts) && !n;
    });
    countEl.textContent = String(total);
  }
  // The chips' offsets for the full list (phone: the row slides to keep the lit one in view during the spin), measured in
  // resize(), so a scroll frame never reads layout.
  let chipX = null;
  const chipWFor = new Map(); // the state chip's width in the window, per state
  let caretAt = { font: '', left: 0 };
  let wide = false;
  let upright = true; // a phone held upright: its rows run the drum's width, across the count
  setCounts(null);

  // ------------------------------------------------------------ state
  let list = ALL;
  let stances = null; // per list position: the stance the query named
  let wrap = true;
  let pos = REST;
  let litSeg = -2;
  let userQ = null; // what the visitor typed (null: the scroll drives the reel)
  let spinQ = 1; // the scroll's spin, 0…1
  let target = 0; // letters of "flip" the scroll asks for
  let shown = 0; // letters typed so far
  let lastLetter = 0;
  // a run of the drum (run): { sgn, from, t0, ms, to } the list easing onto row `to` in the box, up (sgn 1: the results
  // of a letter typed) or down (−1: a letter deleted); { fin, p0, v0, t0, ms, to } finishing (finishRun)
  let pour = null;
  const trail = []; // { list, wrap, off, lo, hi }: lists a run is carrying away, off the top or under the foot (draw)
  const clip = { lo: -Infinity, hi: Infinity }; // the list on screen's rows during a run (a run down brings a few)
  let anchor = 0; // the box: 0 in the drum's middle (the full list), 1 at the top row (results, like the app's list)
  let anchorTo = 0;
  let slamT0 = -1e9; // the count's slam when it changes
  let raf = 0;
  let last = 0;
  let size = { w: 0, h: 0, dpr: 1, rh: 64, fs: 54, x0: 16, boxR: 0, chipW: 0 };
  let shownFor = null;
  let focused = false;
  let focusValue = null; // the field's value when the visitor stepped in (the scroll's typing stops there)
  let lastDy = null;
  let holdUntil = 0; // "flip" found Kickflip: the scroll's payoff holds the stage until then
  let holdTimer = 0;

  function measure() {
    // the stance row's height is the same for every trick, but not empty: lay it out before the drum is measured
    if (!stanceRow.firstChild) stanceRow.innerHTML = stanceChips(KICK, 'normal');
    const w = drum.clientWidth;
    const h = drum.clientHeight;
    if (!w || !h) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    wide = matchMedia('(min-width: 900px)').matches;
    // phones only: an upright tablet's names end well short of the count, so it keeps the full list
    upright = !matchMedia(SIDEWAYS).matches && w < 600;
    // phones: a row a fifth of the drum or so; desktops: poster rows (~100 px capitals), two and a half to the drum
    const rh = wide ? clamp(Math.round(h / 2.7), 64, 196) : clamp(Math.round(h / 4.4), 44, 92);
    const left = parseFloat(getComputedStyle(frame).left);
    const gutter = Number.isFinite(left) ? Math.max(12, left) : 12;
    size = { w, h, dpr, rh, fs: Math.round(rh * (wide ? 0.86 : 0.84)), x0: gutter + 14, boxR: frame.offsetLeft + frame.offsetWidth, chipW: size.chipW };
    chipX = null;
    lastDy = null;
    drum.style.setProperty('--rh', `${rh + 10}px`);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    return true;
  }

  // ------------------------------------------------------------ the drum
  /** The box's centre and the drum's curvature: a drum around the middle row, a list hanging from the top row. */
  function geom() {
    const { h, rh } = size;
    const top = (rh + 10) / 2 + 4;
    const e = anchor * anchor * (3 - 2 * anchor); // the loop ramps it linearly; the box eases
    return { cy: lerp(h / 2, top, e), k: lerp(1, 0.4, e), e };
  }

  function draw(now = performance.now()) {
    const { w, h, dpr, rh, fs, x0 } = size;
    if (!w) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const L = list.length;
    const { cy, k, e } = geom();
    const dy = Math.round(cy - h / 2);
    if (dy !== lastDy) {
      lastDy = dy;
      frame.style.transform = chipEl.style.transform = dy ? `translate3d(0, ${dy}px, 0)` : '';
    }

    if (!L) return drawCount(L, cy, drawEmpty(cy) + 6, now);
    const count = drawCount(L, cy, cy + (rh + 10) / 2 + 10, now);

    const br = Math.round(rh * (wide ? 0.2 : 0.25)); // the line bullet
    const nameX = x0 + br * 2 + Math.round(rh * (wide ? 0.14 : 0.2));
    const chipRoom = size.chipW ? size.chipW + 28 : 24;
    const boxAvail = size.boxR - 14 - chipRoom - nameX;
    const freeAvail = w - nameX - 8;
    const minSx = wide ? 0.8 : 0.66;
    const nameFont = `900 ${fs}px ${DISPLAY}`;
    const codeFont = `900 ${Math.round(br * 0.95)}px ${DISPLAY}`;
    const halo = fs * 0.14; // the knock-out around every letter: the count breaks there, so it reads as behind the type
    // the drum's foot: rows fade into the paper from fa to fb. An upright phone's rows run the screen's width, so a
    // count they all crossed was left as stray slashes: as the box rises the foot rises with it to the count's
    // shoulder, and the results dissolve over the count instead (the row that crosses its top still knocks out of it:
    // still behind it). The spin (the box mid-drum), desktops and a phone on its side keep the drum's own foot.
    let fa = h - rh * FOOT;
    let fb = h;
    let hold = 0; // the knock-out stays whole this far into the fade
    if (upright && count) {
      const up = Math.min(fa, count.capTop + count.capH * COUNT_CLEAR);
      fa = lerp(fa, up, e);
      fb = lerp(fb, Math.min(h, up + rh * FOOT_RUN), e);
      hold = KNOCK_HOLD * e;
    }
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    // the list on screen, and the lists a run is carrying away (trail): each row i of a segment at d = i + off − pos
    // rows under the box, from its lo to its hi (the rows that were on screen when it was let go)
    for (let n = trail.length - 1; n >= 0; n--) {
      const tr = trail[n];
      if (tr.hi + tr.off - pos < -3 || tr.lo + tr.off - pos > 16) trail.splice(n, 1);
    }
    // a list being carried away is the previous query's: dimmed like the rows off the box even while it passes through
    // the box, so the box never shows a name in its selected style that the field no longer finds
    for (const sg of [{ list, wrap, off: 0, lo: clip.lo, hi: clip.hi }, ...trail]) {
      const stale = sg.list !== list;
      const Ls = sg.list.length;
      const base = pos - sg.off;
      const f = Math.floor(base);
      for (let j = -8; j <= 14; j++) {
        const at = f + j;
        if (at < sg.lo) continue;
        if (at > sg.hi) break;
        if (sg.wrap) drawRow(sg.list[((at % Ls) + Ls) % Ls], at - base, stale);
        else if (at >= 0 && at < Ls) drawRow(sg.list[at], at - base, stale);
      }
    }
    g.globalAlpha = 1;

    function drawRow(idx, d, stale) {
      const a = clamp(d * TH, -1.5, 1.5);
      const sy = lerp(1, Math.cos(a), k);
      if (sy < 0.12) return;
      const y = cy + rh * lerp(d, Math.sin(a) / TH, k);
      if (y < -rh || y > h + rh) return;
      const t = T[idx];
      const ad = Math.abs(d);
      const drumA = Math.max(0.08, 0.6 - (ad - 0.5) * 0.15);
      const listA = Math.max(0.2, 0.64 - (ad - 0.5) * 0.1);
      const alpha = stale ? Math.min(STALE_A, lerp(drumA, listA, e)) : ad < 0.5 ? 1 : lerp(drumA, listA, e);
      // the name, poster type. The box's row fits beside its chip: condensed down to BOX_SX, then set smaller as a
      // whole (never squeezed thin, never past the box's edge); the others may run off the screen's edge. A row
      // leaving or entering the box eases between the two.
      g.font = nameFont;
      const name = t[0].toUpperCase();
      const tw = g.measureText(name).width;
      const free = tw > freeAvail ? Math.max(minSx, freeAvail / tw) : 1;
      const kb = boxAvail / tw;
      const boxSx = kb >= 1 ? 1 : Math.max(BOX_SX, kb);
      const boxFs = kb >= BOX_SX ? fs : (fs * kb) / BOX_SX;
      const b = clamp((1 - ad) / 0.3); // in the box's layout while it overlaps the box; eased over its last 0.3 row
      const sx = lerp(free, boxSx, b);
      const nfs = lerp(fs, boxFs, b);
      const low = Math.max(br, nfs * 0.33); // the row's lowest point below its centre line
      if (y - Math.max(br, nfs * 0.45) * sy > fb) return; // all of it past the foot: already paper
      // the drum's foot: a row the canvas would crop fades into the paper instead (a gradient in the row's own space)
      const fading = y + low * sy > fa;
      const style = (hex, op = 1, keep = 0) => {
        if (!fading) return op < 1 ? `rgba(${rgbOf(hex)},${op})` : hex;
        const gr = g.createLinearGradient(0, (fa - y) / sy, 0, (fb - y) / sy);
        gr.addColorStop(0, `rgba(${rgbOf(hex)},${op})`);
        if (keep) gr.addColorStop(keep, `rgba(${rgbOf(hex)},${op})`);
        gr.addColorStop(1, `rgba(${rgbOf(hex)},0)`);
        return gr;
      };
      // the count under this row is knocked out (only where the two can meet)
      const knock = count && y + (low + halo) * sy > count.top;
      g.save();
      g.translate(0, y);
      g.scale(1, sy);
      // the line bullet: the line's lit colour, ink ring, ink code
      g.beginPath();
      g.arc(x0 + br, 0, br, 0, Math.PI * 2);
      if (knock && count.left < x0 + 2 * br + halo) {
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = g.strokeStyle = style(INK, 1, hold);
        g.lineWidth = 2 + halo;
        g.fill();
        g.stroke();
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = alpha;
      g.fillStyle = style(t[2]);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = style(INK);
      g.stroke();
      g.fillStyle = style(INK);
      g.font = codeFont;
      g.textAlign = 'center';
      g.fillText(t[1], x0 + br, br * 0.33);
      g.globalAlpha = 1;
      g.font = nfs === fs ? nameFont : `900 ${nfs.toFixed(1)}px ${DISPLAY}`;
      g.textAlign = 'left';
      g.translate(nameX, 0);
      if (sx < 1) g.scale(sx, 1);
      if (knock && nameX + ((tw * nfs) / fs) * sx + halo > count.left) {
        g.globalCompositeOperation = 'destination-out';
        g.strokeStyle = style(INK, 1, hold);
        g.lineWidth = nfs * 0.14;
        g.strokeText(name, 0, nfs * 0.33);
        g.fillStyle = g.strokeStyle;
        g.fillText(name, 0, nfs * 0.33);
        g.globalCompositeOperation = 'source-over';
      }
      g.fillStyle = style(INK, alpha);
      g.fillText(name, 0, nfs * 0.33);
      g.restore();
    }
  }

  /** The count, outlined behind the rows at poster size (the battle's date, on paper): 216 → 133 → 44 → 43. Sized to
   *  the paper under `top` (the box, or the empty search's words): it grows as the box rises and the results run in,
   *  except on a phone held upright, where a list keeps it at its spin size at the drum's foot and draw() dissolves
   *  the results over it (nothing found: no rows, so the 0 still fills the paper under the words). A watermark,
   *  lighter than any row; the rows knock themselves out of it (draw). Returns where its digits start (top, left: with
   *  the slam) and its figures' top and height (capTop, capH: at rest). */
  function drawCount(L, cy, top, now) {
    const { w, h, rh, x0 } = size;
    const slam = ctx.reduced ? 0 : 1 - easeOut(clamp((now - slamT0) / SLAM_MS));
    const { cnt, cfs, cw, capH } = countSize(L, top);
    g.save();
    // behind the box: never across the name in it
    const bh = (rh + 10) / 2 + 2;
    g.beginPath();
    g.rect(0, 0, w, Math.max(0, cy - bh));
    g.rect(0, cy + bh + 4, w, h);
    g.clip();
    const right = w - x0 * 0.5;
    const base = h - Math.round(cfs * 0.04);
    const sc = 1 + slam * 0.1;
    g.translate(right, base);
    if (slam) g.scale(sc, sc);
    g.textAlign = 'right';
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    g.lineWidth = wide ? 3.5 : 2.5;
    g.strokeStyle = INK;
    g.globalAlpha = COUNT_A;
    g.strokeText(cnt, 0, 0);
    g.restore();
    return { top: base - cfs * 0.8 * sc, left: right - (cw + 4) * sc, capTop: base - capH, capH };
  }
  /** The count's size for L under `top` (drawCount; rowsBelow reads it without drawing). Sets g.font. */
  function countSize(L, top) {
    const { w, h, rh } = size;
    const cnt = String(L);
    if (upright && L) top = Math.max(top, h / 2 + (rh + 10) / 2 + 10); // no bigger than under the box mid-drum
    let cfs = Math.round(clamp((h - top) / 0.74, 40, Math.min(h * 0.78, wide ? 420 : 330)));
    g.font = `900 ${cfs}px ${DISPLAY}`;
    let m = g.measureText(cnt);
    if (m.width > w * 0.6) {
      cfs = Math.floor((cfs * w * 0.6) / m.width);
      g.font = `900 ${cfs}px ${DISPLAY}`;
      m = g.measureText(cnt);
    }
    return { cnt, cfs, cw: m.width, capH: m.actualBoundingBoxAscent || cfs * 0.72 };
  }

  /** Nothing found: the app's empty search in the box, its hint under it, and the page's own word on names. */
  function drawEmpty(cy) {
    const { w, rh, fs, x0 } = size;
    const tf = Math.round(Math.min(fs * 0.62, wide ? 110 : 60));
    g.fillStyle = INK;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.font = `900 ${tf}px ${DISPLAY}`;
    const tw = g.measureText(EMPTY[0]).width;
    const avail = size.boxR - 14 - x0;
    g.save();
    g.translate(x0, cy + tf * 0.33);
    if (tw > avail) g.scale(avail / tw, 1);
    g.fillText(EMPTY[0], 0, 0);
    g.restore();
    const px = wide ? 17 : 15;
    const lh = Math.round(px * 1.42);
    const left = x0 - 10; // the page's gutter
    let y = cy + (rh + 10) / 2 + Math.round(px * 1.9);
    y = wrapText(EMPTY[1], left, y, w - left * 2, `500 ${px}px ${BODY}`, INK_SOFT, lh);
    // the page's own word on names, only for a query in its own script (someone who typed English needs no telling)
    const hint = NATIVE.test(input.value) ? ctx.t('search.hint') : '';
    if (hint) y = wrapText(hint, left, y + Math.round(lh * 0.45), w - left * 2, `600 ${px}px ${BODY}`, INK, lh);
    return y - lh * 0.6;
  }
  function wrapText(text, x, y, maxW, font, color, lh) {
    g.font = font;
    g.fillStyle = color;
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && g.measureText(next).width > maxW) {
        g.fillText(line, x, y);
        y += lh;
        line = word;
      } else line = next;
    }
    if (line) g.fillText(line, x, y);
    return y + lh;
  }

  function current() {
    const L = list.length;
    if (!L) return -1;
    const at = Math.round(pos);
    return wrap ? ((at % L) + L) % L : clamp(at, 0, L - 1);
  }
  /** The scroll's spin and its unfinished typing hold the box open: no chip, no stance row (it has not stopped). */
  const holding = () => userQ === null && (list === ALL || shown < WORD.length);

  /** The chips, the chip in the window, the stances: what the reel has stopped on. */
  function sync() {
    const k = current();
    const idx = k >= 0 ? list[k] : -1;
    // the segment chips: during the scroll's spin the one the drum passes lights; otherwise "all" (as in the app)
    const seg = list === ALL && userQ === null && idx >= 0 ? T[idx][3] : -1;
    if (seg !== litSeg) {
      litSeg = seg;
      allChip.classList.toggle('is-on', seg < 0);
      chips.forEach((c, i) => c.classList.toggle('is-on', i === seg));
      if (!wide) {
        let x = 0;
        if (seg >= 0) {
          chipX ??= measureChips();
          x = Math.min(chipX.max, Math.max(0, chipX.at[seg] - 64));
        }
        chipsRow.style.transform = x ? `translate3d(${-x}px, 0, 0)` : '';
      }
    }
    const settled = !holding() && !pour && Math.abs(pos - Math.round(pos)) < 0.04 && idx >= 0;
    const pick = idx >= 0 && stances ? stances[k] : 'normal';
    const key = settled ? `${idx}:${pick}` : list.length ? '' : '∅';
    if (key === shownFor) return;
    shownFor = key;
    if (!settled) {
      chipEl.textContent = '';
      size.chipW = 0;
      stancesEl.style.visibility = 'hidden';
      stancesEl.classList.remove('is-in');
      return;
    }
    const st = STATE[T[idx][4]] ?? STATE[0];
    // the preset's state is the normal slot's: shown only when the normal stance is the one picked
    chipEl.innerHTML = pick === 'normal' ? `<span class="chip chip--${st[0]}">${st[1]}</span>` : '';
    size.chipW = pick === 'normal' ? (chipWFor.get(st[0]) ?? chipEl.offsetWidth) : 0;
    stanceRow.innerHTML = stanceChips(idx, pick);
    const many = T[idx][11].length > 1;
    stancesEl.style.visibility = many ? 'visible' : 'hidden';
    stancesEl.classList.toggle('is-in', many);
    draw(); // the window's row leaves room for the chip
  }
  const stanceChips = (idx, pick) => T[idx][11].map(([s, name]) => `<span class="lib-stance${s === pick ? ' is-on' : ''}"><b>${STANCE_WORD[s]}</b><small>${escape(name)}</small></span>`).join('');
  const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function render(now) {
    draw(now);
    sync();
  }

  // ------------------------------------------------------------ lists
  function setList(q) {
    const was = list.length;
    if (!q.trim()) {
      list = ALL;
      stances = null;
      wrap = true;
      setCounts(null);
    } else {
      const hits = search(q);
      list = hits.map((h) => h.i);
      stances = hits.map((h) => h.stance);
      wrap = false; // a results list never wraps: what is above the first hit is nothing
      const counts = SEG.map(() => 0);
      for (const i of list) counts[T[i][3]]++;
      setCounts(counts);
    }
    if (list.length !== was) slamT0 = performance.now();
    litSeg = -2;
    shownFor = null;
    drum.setAttribute('aria-label', label(q));
  }
  /** What the drum says it shows (its accessible name; the live region reads the same when a search settles). */
  function label(q) {
    if (!q.trim()) return userQ === null ? ctx.t('spin') : ctx.t('reel', { name: T[KICK][0] });
    const L = list.length;
    const name = (k) => T[list[k]][0];
    const vars = { q: q.trim(), n: L, a: L > 0 ? name(0) : '', b: L > 1 ? name(1) : '', c: L > 2 ? name(2) : '' };
    if (!L && NATIVE.test(q)) return ctx.t('search.zeroNative', vars);
    return ctx.t(['search.zero', 'search.single', 'search.pair', 'search.trio'][L] ?? 'search.more', vars);
  }
  /** The live region speaks only while the reel is the stage's beat (an inert reel is off screen). */
  const announce = (q) => {
    if (!el.inert) onLive?.(label(q));
  };
  /** What is on the drum now (run): the list, whether it wraps, where it stands, its rows during a run. */
  const onDrum = () => ({ list, wrap, pos, lo: clip.lo, hi: clip.hi });
  /**
   * A letter typed (dir 1) or deleted (−1): the drum runs to the new list's row `to` in the box (0, the first hit; the
   * spin's place for the full list), eased over the tail of a POUR_MS ease from `from` rows. The drum is a conveyor:
   * what was on it (`was`, and whatever earlier runs are still carrying, the trail) goes on the way the run goes, and
   * the new list comes in behind it, the next row on, so the box is never empty, no row jumps and every row on the drum
   * moves one way. Typing, everything travels up — the new results come up from under the drum's foot, under the last
   * row still above it, and what was there leaves at the top — and the first hit arrives in the box last; deleting is
   * the same run backwards: the list comes back down from the top and what was there leaves under the foot. A letter that
   * leaves the same names in the same rows (fl → fli → flip: Kickflip, Heelflip, Varial Kickflip…) carries nothing
   * away: only the count changes, and a run under way goes on. `e`: the box's place when the run is over (1 the top
   * row, 0 mid-drum), where the drum's foot is measured.
   */
  function run(dir, from, to, now, was, e) {
    if (ctx.reduced || !was || !size.h) {
      stopPour();
      pos = to;
      return;
    }
    const foot = rowsBelow(e);
    const P = was.pos;
    // every segment's rows on screen now (d in (−1, foot)): the list that was the drum's, and the trail
    const segs = [{ list: was.list, wrap: was.wrap, off: 0, lo: was.lo, hi: was.hi }, ...trail];
    let dMin = Infinity;
    let dMax = -Infinity;
    for (const sg of segs) {
      const Ls = sg.list.length;
      let a = Math.max(sg.lo, Math.floor(P - sg.off - 1) + 1);
      let b = Math.min(sg.hi, Math.ceil(P - sg.off + foot) - 1);
      if (!sg.wrap) {
        a = Math.max(a, 0);
        b = Math.min(b, Ls - 1);
      }
      sg.a = a;
      sg.b = Ls && a <= b ? b : a - 1;
      if (sg.b >= sg.a) {
        dMin = Math.min(dMin, a + sg.off - P);
        dMax = Math.max(dMax, sg.b + sg.off - P);
      }
    }
    const top = segs[0];
    if (!wrap && !was.wrap && top.b >= top.a && top.b < list.length) {
      let same = true;
      for (let i = top.a; i <= top.b && same; i++) same = list[i] === was.list[i];
      if (same) {
        pos = P; // the run under way (if any) goes on, over the new list
        return;
      }
    }
    if (!list.length || !Number.isFinite(dMin)) {
      stopPour();
      pos = to;
      return;
    }
    let start;
    const keep = [];
    if (dir > 0) {
      // the new list's row `to` comes in under the lowest row on screen (at the foot or below it); rows past the foot go
      const d0 = Math.max(foot, dMax + 1);
      start = to - d0;
      clip.lo = wrap ? to : -Infinity;
      clip.hi = Infinity;
      for (const sg of segs) if (sg.b >= sg.a) keep.push({ list: sg.list, wrap: sg.wrap, off: sg.off - P + start, lo: sg.lo, hi: sg.b });
    } else {
      // the new list comes down from above the highest row on screen, `H` rows of it — the box down to the foot — so
      // what was there ends a row past the foot; rows above the box go
      const H = Math.ceil(foot) - 1;
      start = to + H + 1 - dMin;
      clip.lo = -Infinity;
      clip.hi = to + H;
      for (const sg of segs) if (sg.b >= sg.a) keep.push({ list: sg.list, wrap: sg.wrap, off: sg.off - P + start, lo: sg.a, hi: sg.hi });
    }
    trail.length = 0;
    trail.push(...keep);
    const dist = Math.abs(start - to);
    const F = Math.max(from, dist);
    pour = { sgn: dir, from: F, t0: now - (1 - Math.cbrt(dist / F)) * POUR_MS, ms: POUR_MS, to }; // the ease's tail: dist rows out
    pos = start;
  }
  /** "flip": no run of its own (Kickflip is in the box with its stance row at once) — but one still under way is not
   *  cut off: it finishes into the box within FINISH_MS from the speed it had (a cubic Hermite onto rest). */
  function finishRun(now) {
    if (ctx.reduced || !pour) {
      stopPour();
      pos = 0;
      return;
    }
    const [p, v] = pourAt(now);
    const off = p - pour.to;
    const cap = (3 * Math.abs(off)) / FINISH_MS; // monotonic onto rest
    pour = { fin: true, p0: off, v0: Math.max(-cap, Math.min(cap, v)), t0: now, ms: FINISH_MS, to: pour.to };
    pos = p;
  }
  /** Where the run is at `now`: [pos, its speed in rows per ms, u 0…1]. */
  function pourAt(now) {
    const u = clamp((now - pour.t0) / pour.ms);
    if (pour.fin) {
      const { p0, v0, ms } = pour;
      const m = v0 * ms;
      return [pour.to + p0 * (2 * u ** 3 - 3 * u ** 2 + 1) + m * (u ** 3 - 2 * u ** 2 + u), (p0 * (6 * u ** 2 - 6 * u) + m * (3 * u ** 2 - 4 * u + 1)) / ms, u];
    }
    const r = 1 - u;
    return [pour.to - pour.sgn * pour.from * r ** 3, (pour.sgn * 3 * pour.from * r * r) / pour.ms, u];
  }
  function stopPour() {
    pour = null;
    trail.length = 0;
    clip.lo = -Infinity;
    clip.hi = Infinity;
  }
  /** A run let go of at once (off screen, reduced motion): the drum where it was going. */
  function settleRun() {
    if (pour) pos = pour.to;
    stopPour();
  }
  /** How many rows under the box a row has faded into the paper whole (its top at the foot, draw()), with the box where
   *  it is once the anchor is at `e` (1 the top row, results; 0 mid-drum, the spin): the drum's own foot, or on a phone
   *  held upright with results the count's shoulder. */
  function rowsBelow(e = 1) {
    const { h, rh, fs } = size;
    if (!h || !rh) return 0;
    const E = e * e * (3 - 2 * e); // geom() eases the anchor
    const cy = lerp(h / 2, (rh + 10) / 2 + 4, E);
    const k = lerp(1, 0.4, E);
    let fb = h;
    if (upright && list.length) {
      const { cfs, capH } = countSize(list.length, cy + (rh + 10) / 2 + 10);
      const up = Math.min(h - rh * FOOT, h - Math.round(cfs * 0.04) - capH * (1 - COUNT_CLEAR));
      fb = lerp(h, Math.min(h, up + rh * FOOT_RUN), E);
    }
    const at = (d) => {
      const a = Math.min(1.5, d * TH);
      return cy + rh * lerp(d, Math.sin(a) / TH, k) - fs * 0.45 * lerp(1, Math.cos(a), k);
    };
    let d = 0;
    while (d < 14 && at(d) < fb) d += 0.05;
    return d;
  }
  const spinPos = (q) => {
    const p = ctx.reduced ? 1 : easeOut(clamp(q));
    return lerp(REST - T.length - 30, REST, p); // a lap and a bit, slowing past Kickflip
  };

  // ------------------------------------------------------------ the loop: letters, the run, the box, the count
  function kick() {
    if (!raf) {
      last = 0;
      raf = requestAnimationFrame(step);
    }
  }
  function step(now) {
    raf = 0;
    // off screen (another beat has the stage): nothing animates behind it. What the scroll last asked for is put
    // straight in place (no announcement: announce() speaks only on screen), so the way back never starts by
    // deleting stale letters; type() picks the loop up again there.
    if (el.inert) {
      if (userQ === null && shown !== target) letters(target, now);
      settleRun(); // a run ends where it was going
      anchor = anchorTo;
      slamT0 = -1e9;
      render(now);
      return;
    }
    const dt = last ? Math.min(100, now - last) : 16.7;
    last = now;
    let busy = false;
    if (userQ === null && shown !== target) {
      // the letter the scroll asks for goes in as it asks (MIN_LETTER_MS apart); a flick's backlog at a typist's pace
      const gap = shown > target ? BACK_MS : target - shown > 1 ? LETTER_MS : MIN_LETTER_MS;
      if (ctx.reduced) letters(target, now);
      else if (now - lastLetter >= gap) letters(shown + Math.sign(target - shown), now);
      busy = shown !== target;
    }
    if (pour) {
      const [p, , u] = pourAt(now);
      pos = p;
      if (u >= 1) settleRun();
      else busy = true;
    }
    if (anchor !== anchorTo) {
      if (ctx.reduced) anchor = anchorTo;
      else {
        const s = dt / ANCHOR_MS;
        anchor = anchorTo > anchor ? Math.min(anchorTo, anchor + s) : Math.max(anchorTo, anchor - s);
      }
      busy ||= anchor !== anchorTo;
    }
    if (!ctx.reduced && now - slamT0 < SLAM_MS) busy = true;
    render(now);
    if (busy) raf = requestAnimationFrame(step);
  }
  /** The scroll's field shows n letters of "flip": the list, the box and the run follow. */
  function letters(n, now) {
    const forward = n > shown;
    shown = n;
    lastLetter = now;
    input.value = WORD.slice(0, n);
    placeCaret();
    const was = onDrum();
    if (!n) {
      // back to the spin: the full list comes back down from the top onto where the spin rests, mid-drum
      releaseHold();
      setList('');
      anchorTo = 0;
      run(-1, POUR[0], spinPos(spinQ), now, was, 0);
      return;
    }
    setList(input.value);
    anchorTo = 1;
    if (!forward) run(-1, POUR[n], 0, now, was, 1); // the typing backwards: the run down
    else if (n === WORD.length) finishRun(now);
    else run(1, POUR[n - 1], 0, now, was, 1);
    if (n === WORD.length && forward && !el.inert) {
      // "flip" has found Kickflip (no run of its own on the last letter, finishRun: it is in the box with its stance row now): a scroll
      // already at the slide-down waits SETTLE_MS for the payoff (on screen only: off it, nobody is waiting)
      holdUntil = performance.now() + SETTLE_MS;
      clearTimeout(holdTimer);
      holdTimer = setTimeout(() => {
        holdUntil = 0;
        onSettled?.();
      }, SETTLE_MS);
      announce(WORD);
    } else releaseHold();
  }
  function releaseHold() {
    holdUntil = 0;
    clearTimeout(holdTimer);
  }
  // ------------------------------------------------------------ the caret (the scroll "types")
  const measureCtx = document.createElement('canvas').getContext('2d');
  function placeCaret() {
    measureCtx.font = caretAt.font;
    caret.style.left = `${caretAt.left + (input.value ? measureCtx.measureText(input.value).width + 1 : 0)}px`;
  }
  const measureChips = () => ({ at: chips.map((c) => c.offsetLeft), max: Math.max(0, chipsRow.scrollWidth - chipsRow.parentElement.clientWidth + 2 * size.x0) });
  /** Everything a frame needs from layout, read once (init, resize): chip widths, the caret, the chips' offsets. */
  function measureStatic() {
    const cs = getComputedStyle(input);
    caretAt = { font: `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`, left: input.offsetLeft };
    const keep = chipEl.innerHTML;
    for (const [k, word] of STATE) {
      chipEl.innerHTML = `<span class="chip chip--${k}">${word}</span>`;
      chipWFor.set(k, chipEl.firstChild.getBoundingClientRect().width); // with its scale (poster size on a desktop)
    }
    chipEl.innerHTML = keep;
    // the full list: every chip shown. Its height is kept, so a query that drops chips (a desktop's two rows → one) never
    // changes the drum's size under the scroll.
    const box = chipsRow.parentElement;
    box.style.minHeight = '';
    if (list !== ALL) setCounts(null);
    chipX = wide ? null : measureChips();
    box.style.minHeight = `${box.offsetHeight}px`;
    if (list !== ALL) {
      const counts = SEG.map(() => 0);
      for (const i of list) counts[T[i][3]]++;
      setCounts(counts);
    }
  }

  // ------------------------------------------------------------ the visitor types
  let liveTimer = 0;
  input.addEventListener('input', () => {
    userQ = input.value;
    caret.hidden = true;
    const now = performance.now();
    if (!userQ.trim()) {
      // cleared: back to the full list, stopped on Kickflip (what the live region then says)
      stopPour();
      setList('');
      pos = KICK;
      anchorTo = 0;
    } else {
      const was = onDrum();
      setList(userQ);
      anchorTo = 1;
      run(1, 5, 0, now, was, 1);
    }
    kick();
    render(now);
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => announce(userQ), 450);
    focusValue = null; // typed: theirs now, whatever happens on blur
  });
  // Stepping into the field is the visitor taking over: the scroll's typing stops at what is shown, and the reel stays
  // on that list (the visitor's now). It goes back to the scroll only if they leave the field as they found it, empty.
  input.addEventListener('focus', () => {
    focused = true;
    if (userQ !== null) return;
    focusValue = input.value;
    target = shown;
    userQ = input.value;
    caret.hidden = true;
    releaseHold();
    if (!shown && !pour) pos = Math.round(pos); // caught mid-spin: stop on the name in the box
    kick();
    render();
  });
  input.addEventListener('blur', () => {
    focused = false;
    if (focusValue === '' && input.value === '' && userQ === '') {
      userQ = null;
      caret.hidden = false;
      setList('');
      render();
    }
    focusValue = null;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });

  drum.setAttribute('aria-label', label(''));

  return {
    get focused() {
      return focused;
    },
    get userQuery() {
      return userQ;
    },
    /** q 0…1: a lap and a bit of the full list, slowing down past Kickflip to rest a few names on. */
    spin(q) {
      if (userQ !== null) return;
      spinQ = clamp(q);
      if (shown || target) return;
      const next = spinPos(spinQ);
      if (pour) {
        pour.to = next; // the run back down onto the spin lands where the spin is now
        return;
      }
      if (Math.abs(next - pos) < 1e-4 && shownFor !== null) return;
      pos = next;
      render();
    },
    /** u 0…1 through the scroll's typing: a letter of "flip" per quarter, typed at a typist's pace. `entering`: the
     *  reel has just become the stage's beat — letters left from an earlier pass are not deleted on screen. */
    type(u, entering = false) {
      if (userQ !== null) return;
      const n = u <= 0 ? 0 : Math.min(WORD.length, Math.floor(clamp(u) * WORD.length) + 1);
      if (entering && n < shown) {
        target = n;
        letters(n, performance.now());
        settleRun(); // off screen until now: nobody watches the run
        if (n) pos = 0;
        anchor = anchorTo;
        render();
      }
      if (n === target && shown === target && !pour && anchor === anchorTo) return;
      target = n;
      kick();
    },
    /** The scroll's typing has not paid off yet: letters still to type, or "flip" found Kickflip under SETTLE_MS ago. */
    busy() {
      return userQ === null && (shown < target || performance.now() < holdUntil);
    },
    /** Every letter the scroll asked for, at once: no run, no payoff hold (the scroll is already well into the
     *  slide-down, so the sheet goes on with the thumb; it leaves with "flip" found, never half typed). */
    finish() {
      if (userQ !== null) return;
      target = WORD.length;
      if (shown !== target) letters(target, performance.now());
      stopPour();
      pos = 0;
      anchor = anchorTo;
      releaseHold();
      render();
      kick(); // the count's slam plays out
    },
    typed(n) {
      this.type(n <= 0 ? 0 : (n - 0.5) / WORD.length);
    },
    resize() {
      if (measure()) {
        measureStatic();
        placeCaret();
        litSeg = -2;
        shownFor = null;
        render();
      }
    },
    render,
    qa: () => ({ query: input.value, n: list.length, top: list.length ? T[list[current()]][0] : null, settled: Boolean(shownFor), anchor, pos, busy: userQ === null && (shown < target || performance.now() < holdUntil) }),
  };
}
