// plan — "A plan every week". Three parts, each driven by ctx.scroll.track (the section itself is not pinned):
//
// 1. The deal. While the board is below the screen its three quest cards wait as a deck at the right edge; when
//    the board comes up they fly to their places one after another (80 ms apart, a sheet slide with a pop wobble,
//    ±1° at rest, the hard card shadow snapping in on contact, a tick a step higher each time), then the ALL THREE
//    row, then "Skate 2 days" fills to 1 / 2. The two swap buttons work: one swap a week, the new quest comes from
//    the real templates in assets/data/quests.json. They are always in the tab order: focus on the board lays the
//    cards down at once.
// 2. The rain check (paper, one screen held). Rain falls over the page but never on its words (every stroke falls
//    through a stretch of sky clear of the copy, and stops above the weeks as if they were the ground); as you
//    scroll, an umbrella opens over the big 1 WK (the "1" is its shaft), the rain stops on its canopy, next week
//    becomes a rain check, and the count does not move. PAUSE works. It falls only while the stage is on screen.
// 3. The ranks: one yellow line, eight nodes Grom → SOTY. The light runs along it with the scroll, lands Grom and
//    Park Rat as stickers, slams the LVL 17 badge onto Local, counts the Kickflip's +160 into 7 575 XP and stops
//    as far toward Flow as that reaches.
//
// The markup is the final frame of all three (what no-JS and reduced motion show); this script only moves things
// with transform / opacity / classes and swaps a few words on one line, so no height ever changes.
// Reduced motion: no flights, no falling rain, no scrubbed umbrella or light — the final frames. Sound only
// through ctx.sound (silent until the visitor turns it on).

/** Rest tilt of each dealt card (deg) — tape-like, never more than a degree. */
const TILT = [-0.8, 0.7, -0.5];
/** The deck at the right edge: x in % of the card's width, y in px around the first slot, tilt in deg. */
const DECK = [
  { x: 46, y: -10, r: 5 },
  { x: 50, y: 2, r: 9 },
  { x: 43, y: 12, r: 2.5 },
];
/** A swapped-in card comes off the deck, past the edge. */
const OFF = { x: 118, y: 36, r: 12 };
const STAGGER = 80;
/** The umbrella opens over this stretch of the rain track's p. */
const OPEN = [0.18, 0.7];
/** The invented user after the Kickflip (the App Store screenshots' preset + the landed section's +160). */
const XP_FROM = 7415;
const XP_TO = 7575;
const GAIN = 0.1231; // (7 575 − 7 415) / (8 500 − 7 200), on the LVL 17 → 18 bar
const BAR_FROM = 0.1654; // (7 415 − 7 200) / 1 300
/** Where 7 575 XP stands on the line: Local (node 2) + (7 575 − 2 600) / (9 950 − 2 600) of the way to Flow. */
const MARK = (2 + (XP_TO - 2600) / (9950 - 2600)) / 7;

export default async function init(root, ctx) {
  const { motion, sound, scroll, dom } = ctx;
  const { $, $$, clamp, smoothstep, prng, h, formatNumber } = dom;
  const offs = [];
  let entered = false;

  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  root.append(live);
  const say = (text) => {
    live.textContent = '';
    requestAnimationFrame(() => {
      live.textContent = text;
    });
  };

  const quests = await ctx.data('quests').catch(() => null);
  // Init runs while the visitor scrolls: give the frame back between the heavier steps.
  const breathe = () => globalThis.scheduler?.yield?.() ?? new Promise((resolve) => setTimeout(resolve));

  // A jump (NBD.goto, a keyboard End, a link) changes many states in one frame: no flights and no sound for
  // those. Decided once per frame, before the sections and tracks run.
  let jumping = false;
  offs.push(scroll.onFrame(({ dy, vh }) => (jumping = Math.abs(dy) > vh * 0.9), { early: true }));

  // ---------------------------------------------------------------- 1 · the deal

  const board = $('[data-board]', root);
  const cards = $$('[data-card]', board);
  const slots = cards.map((card) => card.closest('[data-slot]'));
  const sweep = $('[data-sweep]', board);
  const hint = $('[data-hint]', board);
  const hintText = $('[data-hint-text]', board);
  const swapsN = $('[data-swaps-n]', board);
  const swapButtons = $$('[data-swap]', board);
  const firstBar = $('[data-q-bar]', cards[0]);
  const firstCount = $('[data-q-count]', cards[0]);

  const tf = (x, y, r) => `translate3d(${x.toFixed(2)}%, ${y.toFixed(1)}px, 0) rotate(${r.toFixed(2)}deg)`;

  // A dealt card slides in on the near-critical 'sheet' spring (it stops, it doesn't bounce back across the
  // table) while its tilt rides the bouncier 'pop' spring — the slap and wobble of a card hitting the table.
  const slide = motion.solveSpring('sheet');
  const wobble = motion.solveSpring('pop');
  const DEAL_MS = Math.max(slide.duration, wobble.duration);
  // The moment the card touches the table: the slide is 97 % of the way in.
  const contactMs = (() => {
    const i = slide.samples.findIndex((v) => v >= 0.97);
    return Math.max(60, Math.round((i < 0 ? slide.samples.length : i) * (1000 / 120)));
  })();
  function dealFrames(from, rest) {
    const frames = [];
    const N = 36;
    for (let k = 0; k <= N; k++) {
      const ms = (k / N) * DEAL_MS;
      const p = slide.at(ms / slide.duration);
      const r = wobble.at(ms / wobble.duration);
      frames.push({ offset: k / N, transform: tf(from.x * (1 - p), from.y * (1 - p), from.r + (rest - from.r) * r) });
    }
    return frames;
  }

  // Geometry, cached (no layout reads in the scroll frame): each slot's top, so the deck can sit on the middle one.
  const DECK_Y = 26; // the deck lies a little below the first slot, close under the week's header
  const geo = { slotTop: [0, 0, 0], h: 1, vh: 1, pDeal: 0.4, pSeen: 0.3 };
  function measureDeal() {
    geo.slotTop = slots.map((slot) => slot.offsetTop);
    geo.h = board.offsetHeight;
    geo.vh = window.innerHeight;
    // Deal once the deck's middle is 70 % down the screen (p = 0 is the board's top at the bottom edge): the
    // deck is seen whole for a moment, then dealt.
    const deckMid = geo.slotTop[0] + DECK_Y + slots[0].offsetHeight / 2;
    geo.pDeal = clamp((deckMid + 0.3 * geo.vh) / (geo.vh + geo.h), 0.05, 0.9);
    // The whole deck is on screen (its tilted bottom edge above the screen's).
    geo.pSeen = clamp((deckMid + slots[0].offsetHeight / 2 + 28) / (geo.vh + geo.h), 0.01, geo.pDeal);
  }
  const deckAt = (i) => ({ x: DECK[i].x, y: geo.slotTop[0] - geo.slotTop[i] + DECK_Y + DECK[i].y, r: DECK[i].r });

  const cardState = cards.map(() => ({ anim: null, timer: 0, busy: false }));
  let dealt = null; // null (not rendered yet) | 'deck' | 'table'
  let dealP = 0;
  let extras = []; // sweep / hint / bar animations of the last deal
  let extraTimer = 0;

  function stopCard(i) {
    cardState[i].anim?.cancel();
    cardState[i].anim = null;
    clearTimeout(cardState[i].timer);
  }
  function stopExtras() {
    clearTimeout(extraTimer);
    extras.forEach((a) => a.cancel());
    extras = [];
  }
  function placeCard(i, t, { down = true, z = '' } = {}) {
    stopCard(i);
    const card = cards[i];
    card.style.transform = t;
    card.style.zIndex = z;
    card.classList.toggle('is-down', down);
    card.classList.remove('is-flying');
  }
  function setExtras(on) {
    sweep.style.opacity = on ? '1' : '0';
    hint.style.opacity = on ? '1' : '0';
    firstBar.style.transform = `scaleX(${on ? 0.5 : 0})`;
    firstCount.textContent = on ? '1' : '0';
  }

  /** Everything on the table, at once. */
  function restAll() {
    stopExtras();
    cards.forEach((_, i) => {
      if (!cardState[i].busy) placeCard(i, tf(0, 0, TILT[i]));
    });
    setExtras(true);
    dealt = 'table';
  }
  /** The deck at the right edge (only ever while the board is off screen below). */
  function toDeck() {
    stopExtras();
    cards.forEach((_, i) => {
      const d = deckAt(i);
      placeCard(i, tf(d.x, d.y, d.r), { z: String(3 - i) });
    });
    setExtras(false);
    dealt = 'deck';
  }

  /** Flies card i from `from` to its place; the shadow and the tick land on contact. */
  function fly(i, { from, delay = 0, quiet = false }) {
    const card = cards[i];
    stopCard(i);
    card.classList.remove('is-down');
    card.classList.add('is-flying');
    const anim = motion.animate(card, dealFrames(from, TILT[i]), { duration: DEAL_MS, easing: 'linear', delay });
    cardState[i].anim = anim;
    cardState[i].timer = setTimeout(() => {
      card.classList.add('is-down');
      if (!quiet) sound.play('tick', { rate: 2 ** ((i * 3) / 12), volume: 0.85 });
    }, delay + contactMs);
    return anim.finished.then(
      () => {
        if (cardState[i].anim !== anim) return;
        placeCard(i, tf(0, 0, TILT[i]));
      },
      () => {},
    );
  }

  function dealAll(quiet) {
    dealt = 'table';
    stopExtras();
    cards.forEach((_, i) => {
      if (!cardState[i].busy) fly(i, { from: deckAt(i), delay: i * STAGGER, quiet });
    });
    // ALL THREE pops up once the last card is down, then the show-up quest fills to 1 / 2.
    const after = (cards.length - 1) * STAGGER + contactMs + 60;
    extras = [
      motion.animate(sweep, (v) => ({ opacity: Math.min(1, v * 2), transform: `translate3d(0, ${(10 * (1 - v)).toFixed(2)}px, 0)` }), { spring: 'pop', delay: after }),
      motion.animate(hint, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: after + 160, easing: 'out' }),
      motion.animate(firstBar, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(0.5)' }], { duration: 600, delay: after + 220, easing: 'out' }),
    ];
    sweep.style.opacity = '1';
    hint.style.opacity = '1';
    firstBar.style.transform = 'scaleX(0.5)';
    extraTimer = setTimeout(() => {
      firstCount.textContent = '1';
      if (!quiet) sound.play('tick', { rate: 1.5, volume: 0.6 });
    }, after + 820);
  }

  const busy = () => cardState.some((s) => s.busy);
  const focusInBoard = () => board.contains(document.activeElement);

  // Nobody is left looking at a pile: a deck that sits on screen while the page rests deals itself.
  let dwell = 0;
  function renderDeal(p) {
    dealP = p;
    clearTimeout(dwell);
    if (busy()) return;
    if (ctx.reduced) {
      if (dealt !== 'table') restAll();
      return;
    }
    if (dealt === null) {
      // First frame: the deck only if the board is below the screen — never a jump the visitor can see.
      if (p <= 0 && !focusInBoard()) toDeck();
      else restAll();
      return;
    }
    if (dealt === 'deck' && p >= geo.pDeal) {
      if (jumping) restAll();
      else dealAll(false);
    } else if (dealt === 'table' && p <= 0 && !focusInBoard()) {
      toDeck();
    } else if (dealt === 'deck' && p >= geo.pSeen) {
      dwell = setTimeout(() => {
        if (dealt === 'deck' && dealP >= geo.pSeen && !busy()) dealAll(false);
      }, 600);
    }
  }

  // Keyboard: the swap buttons never leave the tab order; focus on the board lays every card down at once.
  board.addEventListener('focusin', () => {
    if (dealt !== 'table') restAll();
  });

  // The swap: one a week, from the real templates of the same slot.
  function fillCard(card, q) {
    card.dataset.quest = q.id;
    $('[data-q-title]', card).textContent = q.title.en;
    $('[data-q-desc]', card).textContent = q.description.en;
    $('[data-q-xp]', card).textContent = `+${q.xp} XP`;
    $('[data-q-n]', card).textContent = String(q.n);
    $('[data-q-count]', card).textContent = '0';
    $('[data-q-bar]', card).style.setProperty('--f', '0');
  }

  async function swap(btn) {
    if (btn.getAttribute('aria-disabled') === 'true') {
      say(ctx.t('swapUsed'));
      return;
    }
    const card = btn.closest('[data-card]');
    const i = cards.indexOf(card);
    const slot = card.closest('[data-slot]')?.dataset.slot;
    const pool = (quests?.quests ?? []).filter((q) => q.cadence === 'weekly' && q.slot === slot && q.id !== card.dataset.quest);
    const next = pool[0];
    if (!next || cardState[i].busy) return;
    if (dealt !== 'table') restAll();
    cardState[i].busy = true;
    sound.play('tick', { volume: 0.8 });
    swapsN.textContent = '0';
    for (const b of swapButtons) b.setAttribute('aria-disabled', 'true');
    if (!ctx.reduced) {
      card.classList.remove('is-down');
      const out = motion.animate(card, [{ transform: tf(0, 0, TILT[i]) }, { transform: tf(-125, 34, -13) }], { duration: 190, easing: 'in' });
      cardState[i].anim = out;
      await out.finished.catch(() => {});
    }
    // The new quest's words may be shorter: the card keeps its height, so nothing below moves.
    card.style.minHeight = `${card.offsetHeight}px`;
    fillCard(card, next);
    btn.setAttribute('aria-label', ctx.t('swapA11y', { title: next.title.en }));
    hintText.textContent = ctx.t('swapUsed');
    if (ctx.reduced) placeCard(i, tf(0, 0, TILT[i]));
    else await fly(i, { from: OFF });
    cardState[i].busy = false;
    say(ctx.t('swapped', { title: next.title.en }));
    renderDeal(dealP); // the scroll may have gone on while the card was in the air
  }
  for (const btn of swapButtons) btn.addEventListener('click', () => swap(btn));

  // ---------------------------------------------------------------- 2 · the rain check

  const rainEl = $('[data-rain]', root);
  const pinTrack = $('[data-pin-track]', root);
  const stage = $('[data-stage]', root);
  const sky = $('[data-sky]', root);
  const copy = $('[data-copy]', root);
  const streak = $('[data-streak]', root);
  const count = $('.streak__count', streak);
  const umb = $('[data-umb]', root);
  const hand = $('[data-hand]', root);
  const rcCount = $('[data-rc]', root);
  const rcBox = $('[data-rc-box]', root);
  const weeks = $('[data-weeks]', root);
  const rainCell = $('.wk--rain', weeks);
  const pauseBtn = $('[data-pause]', root);
  const pauseLabel = $('[data-pause-label]', root);

  // Rain: ink strokes over the whole stage, seeded so every visit gets the same drawing. Spread past the right
  // edge, because the wind carries every stroke a quarter of its fall to the left. Built as one string (one parse,
  // one style pass), the numbers kept here so measuring never reads them back from the DOM. `keep` decides, per
  // stroke, whether it falls at all when its clear stretch is short: the rain stays as dense as over open paper.
  const rnd = prng(1717);
  const DROPS = Math.round(clamp(window.innerWidth / 6.5, 48, 150));
  const drops = [];
  let html = '';
  for (let k = 0; k < DROPS; k++) {
    const dur = 0.55 + rnd() * 0.3;
    const x = ((k + 0.15 + rnd() * 0.7) / DROPS) * 1.28;
    const len = Math.round(16 + rnd() * 22);
    const phase = rnd();
    const base = `left:${(x * 100).toFixed(2)}%;--len:${len}px`;
    const r = rnd();
    drops.push({ el: null, x, len, dur, phase, r, keep: (r * 7919) % 1, base, dx: 9, on: null, dry: false });
    html += `<i class="drop" style="${base}"></i>`;
  }
  sky.insertAdjacentHTML('beforeend', html);
  Array.from(sky.children).forEach((el, k) => (drops[k].el = el));
  await breathe();

  /** The copy the rain keeps off, in the sky's px, padded: the heading, the paragraph and the hand note (their
   *  text, not their boxes), and the ground — the weeks, their labels, the caption, Pause and the hint, as one
   *  block. The STREAK row stays in the rain: the canopy sits right under it. */
  const PAD = 12;
  function dryRects(skyBox) {
    const rects = [];
    const add = (r) => {
      if (r.width > 0 && r.height > 0) {
        rects.push({ x0: r.left - skyBox.left - PAD, x1: r.right - skyBox.left + PAD, y0: r.top - skyBox.top - PAD, y1: r.bottom - skyBox.top + PAD });
      }
    };
    const range = document.createRange();
    for (const el of [...copy.children, hand]) {
      range.selectNodeContents(el);
      add(range.getBoundingClientRect());
    }
    const ground = [$('.streak__field', streak), $('.streak__foot', streak), $('.streak__hint', streak)].map((el) => el.getBoundingClientRect());
    const top = Math.min(...ground.map((r) => r.top));
    const bottom = Math.max(...ground.map((r) => r.bottom));
    const left = Math.min(...ground.map((r) => r.left));
    const right = Math.max(...ground.map((r) => r.right));
    add({ left, right, top, bottom, width: right - left, height: bottom - top });
    return rects;
  }

  /** Where each stroke falls: one stretch of its line clear of the copy (ty from t0 to t1, px), ending on the
   *  canopy instead (t1s) for the strokes that meet it once it is fully open. Every stroke falls at the same speed,
   *  and `keep` picks its stretch with odds by length (or none, for the share of its line the copy covers), so the
   *  rain is as dense over every bit of open paper as over a page with no words on it. */
  function measureRain() {
    const firstCell = weeks.firstElementChild;
    if (firstCell) streak.style.setProperty('--cell-px', `${firstCell.offsetWidth}px`);
    const skyBox = sky.getBoundingClientRect();
    const dry = dryRects(skyBox);
    const cb = count.getBoundingClientRect();
    const cnt = { x0: cb.left - skyBox.left - 4, x1: cb.right - skyBox.left + 4, y0: cb.top - skyBox.top - 4, y1: cb.bottom - skyBox.top + 4 };
    const keepTf = umb.style.transform;
    umb.style.transform = 'none';
    const u = umb.getBoundingClientRect();
    umb.style.transform = keepTf;
    // The canopy is a half disc of radius 96 centred at (0, 0) in a viewBox of x −100…100, y −114…4.
    const s = u.width / 200;
    const cx = u.left - skyBox.left + 100 * s;
    const cy = u.top - skyBox.top + 114 * s;
    const R = Math.max(1, 96 * s);
    const H = skyBox.height;
    const W = skyBox.width;
    for (const d of drops) {
      const x0 = d.x * W;
      const len = d.len;
      // The stroke lies along x = x0 + 1 + len / 8 − y / 4 (its tilt is its wind). Blocked: every ty at which its
      // body [ty, ty + len] overlaps a dry rect where the line is inside it.
      const full = [-len, H + len + 12];
      let free = [full];
      for (const r of dry) {
        const ya = (x0 + 1 + len / 8 - r.x1) * 4;
        const yb = (x0 + 1 + len / 8 - r.x0) * 4;
        const lo = Math.max(r.y0, ya) - len;
        const hi = Math.min(r.y1, yb);
        if (hi <= lo + len) continue;
        free = free.flatMap(([a, b]) => (hi <= a || lo >= b ? [[a, b]] : [[a, lo], [hi, b]].filter(([p, q]) => q - p > 0)));
      }
      // A stretch too short to read as a falling stroke is a flicker: it stays dry.
      const fullSpan = full[1] - full[0];
      let u = d.keep * fullSpan;
      const pick = free.filter(([a, b]) => b - a >= 3 * len).find(([a, b]) => (u -= b - a) < 0);
      const [t0, t1] = pick ?? [-len, 0];
      const span = t1 - t0;
      d.dry = !pick;
      d.el.classList.toggle('is-dry', d.dry);
      // Where this stroke crosses the canopy's middle height, relative to its centre (in radii).
      const dx = (x0 - 0.25 * (cy - R / 2 + len) - cx) / R;
      const onCanopy = Math.abs(dx) < 0.97;
      let tShield = onCanopy ? Math.round(cy - R * Math.sqrt(Math.max(0, 1 - dx * dx)) - len + 4) : Infinity;
      // Under the open canopy all of 1 WK stays dry: a stroke that passes the canopy's edge and the wind carries in
      // under it stops short of the count (once the umbrella is fully open, hence 0.965 below).
      const ca = (x0 + 1 + len / 8 - cnt.x1) * 4;
      const cLo = Math.max(cnt.y0, ca) - len;
      const cHi = Math.min(cnt.y1, (x0 + 1 + len / 8 - cnt.x0) * 4);
      const hitsCount = cHi > cLo + len;
      if (hitsCount) tShield = Math.min(tShield, Math.round(cLo));
      d.dx = tShield > t0 + len && tShield < t1 ? (onCanopy ? Math.abs(dx) : 0.965) : 9;
      const shield = d.dx < 0.97 ? `;--t1s:${tShield}px` : '';
      // The still frame (reduced motion): every stroke somewhere in its clear stretch, none through the canopy or
      // under it; one with no room left stays out of the picture.
      const lo = Math.max(t0, 8);
      const hi = Math.min(t1, H - 22 - len);
      let y = Math.round(lo + d.r * Math.max(0, hi - lo));
      const xAt = (x0 - 0.25 * (y + len) - cx) / R;
      if (Math.abs(xAt) < 1.06 && y + len > cy - R - 6) y = Math.round(cy - R * Math.sqrt(Math.max(0, 1 - xAt * xAt)) - len - 10);
      if (hi < lo || y < lo || (hitsCount && y > cLo && y < cHi)) y = -2 * H;
      const dur = (d.dur * span) / fullSpan;
      d.el.style.cssText = `${d.base};--dur:${dur.toFixed(3)}s;--delay:${(-d.phase * dur).toFixed(3)}s;--t0:${Math.round(t0)}px;--t1:${Math.round(t1)}px${shield};--y:${y}px`;
    }
    // Re-apply the open state against the new geometry, and restart a running rain on its new lines (a running
    // animation does not pick up changed custom properties everywhere).
    open = -1;
    shielded = -1;
    if (rainEl.classList.contains('is-onscreen')) {
      rainEl.classList.remove('is-onscreen');
      requestAnimationFrame(syncRain);
    }
  }

  let open = -1;
  let shielded = -1;
  let covered = null;
  let popAnim = null;
  let paused = false;

  function setOpen(o) {
    if (o === open) return;
    open = o;
    if (o < 1) {
      popAnim?.cancel();
      popAnim = null;
    }
    // Closed it is a black spike over the "1"; it opens sideways from its tip, the way an umbrella does.
    umb.style.transform = o >= 1 ? 'none' : `scale(${(0.07 + 0.93 * o).toFixed(4)}, ${(1.16 - 0.16 * o).toFixed(4)})`;
    const reach = 0.97 * o;
    if (reach === shielded) return;
    shielded = reach;
    for (const d of drops) {
      const on = d.dx < reach && !d.dry;
      if (on !== d.on) {
        d.on = on;
        d.el.classList.toggle('is-shielded', on);
      }
    }
  }

  function setCovered(on, animate) {
    if (on === covered) return;
    covered = on;
    streak.classList.toggle('is-covered', on);
    rcCount.textContent = on ? '0' : '1';
    rcBox.classList.toggle('is-spent', on);
    hand.getAnimations().forEach((a) => a.cancel());
    rainCell.getAnimations().forEach((a) => a.cancel());
    if (on && animate && !ctx.reduced) {
      popAnim = motion.animate(umb, (v) => ({ transform: `scale(${(1.07 - 0.07 * v).toFixed(4)}, ${(0.95 + 0.05 * v).toFixed(4)})` }), { spring: 'pop' });
      sound.play('tick', { rate: 0.84, volume: 0.9 });
      motion.animate(rainCell, (v) => ({ transform: `scale(${(0.8 + 0.2 * v).toFixed(4)})` }), { spring: 'pop', delay: 120 });
      motion.animate(hand, (v) => ({ opacity: Math.min(1, v * 1.4), transform: `translate3d(${(14 * (1 - v)).toFixed(2)}px, 0, 0)` }), { spring: 'settle', delay: 380 });
    }
  }

  let rainP = 0;
  function renderRain(p) {
    rainP = p;
    if (ctx.reduced) {
      setOpen(1);
      setCovered(true, false);
      return;
    }
    const first = covered === null;
    const o = smoothstep(OPEN[0], OPEN[1], p);
    setOpen(o);
    if (o >= 1) setCovered(true, !first && !jumping);
    else if (o < 0.9) setCovered(false, false);
  }

  let onscreen = false;
  const syncRain = () => rainEl.classList.toggle('is-onscreen', onscreen && entered && !ctx.reduced);

  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    streak.classList.toggle('is-paused', paused);
    // The name is the visible word (the app's English): no aria-pressed on top of a changing label.
    pauseLabel.textContent = paused ? 'Resume' : 'Pause';
    sound.play('tick', { rate: paused ? 0.9 : 1.12 });
    say(ctx.t(paused ? 'paused' : 'resumed'));
    if (paused && !ctx.reduced) {
      $$('.wk:not(.wk--done):not(.wk--rain)', weeks).forEach((cell, k) => {
        motion.animate(cell, (v) => ({ transform: `scale(${(0.82 + 0.18 * v).toFixed(4)})` }), { spring: 'pop', delay: k * 40 });
      });
    }
  });

  // ---------------------------------------------------------------- 3 · the ranks line

  const rline = $('[data-rline]', root);
  const rks = $$('.rk', rline);
  const lit = $('[data-lit]', rline);
  const head = $('[data-head]', rline);
  const rail = lit.parentElement;
  const NOW = rks.findIndex((rk) => rk.classList.contains('rk--now'));
  const badge = $('[data-badge]', rline);
  const xpEl = $('[data-xp]', root);
  const gainEl = $('[data-gain]', root);
  const gainTf = (g) => `translateX(${(BAR_FROM * 100).toFixed(2)}%) scaleX(${g.toFixed(4)})`;

  const rkLit = rks.map(() => null);
  const rkAnim = rks.map(() => null);
  let railW = 1;
  let lineP = 0;
  let lineReady = false;
  let xpRun = 0;

  function setXp(final, animate) {
    const run = ++xpRun;
    gainEl.getAnimations().forEach((a) => a.cancel());
    gainEl.style.transform = gainTf(final ? GAIN : 0);
    if (!final || !animate || ctx.reduced) {
      xpEl.textContent = formatNumber(final ? XP_TO : XP_FROM);
      return;
    }
    xpEl.textContent = formatNumber(XP_FROM);
    motion.animate(gainEl, [{ transform: gainTf(0) }, { transform: gainTf(GAIN) }], { duration: 700, delay: 260, easing: 'out' });
    const start = performance.now() + 260;
    const step = (now) => {
      if (run !== xpRun) return;
      const k = clamp((now - start) / 700);
      xpEl.textContent = formatNumber(Math.round(XP_FROM + (XP_TO - XP_FROM) * motion.ease.out(k)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function lightRk(i, on, animate, quiet) {
    if (rkLit[i] === on) return;
    rkLit[i] = on;
    const rk = rks[i];
    rk.classList.toggle('is-lit', on);
    rkAnim[i]?.cancel();
    rkAnim[i] = null;
    if (i === NOW) setXp(on, animate);
    if (!on || !animate || ctx.reduced) return;
    if (i === NOW) {
      rkAnim[i] = motion.slam(badge, { from: 1.7, dy: -12 });
      if (!quiet) sound.play('select');
    } else {
      const sticker = $('.n-on', rk);
      if (sticker) rkAnim[i] = motion.animate(sticker, (v) => ({ transform: `scale(${(1.6 - 0.6 * v).toFixed(4)})` }), { spring: 'pop' });
      if (!quiet) sound.play('tick', { rate: 2 ** ((i * 4) / 12), volume: 0.8 });
    }
  }

  function renderLine(p) {
    lineP = p;
    const first = !lineReady;
    lineReady = true;
    const quiet = first || jumping;
    const f = ctx.reduced ? MARK : MARK * motion.ease.standard(clamp(p / 0.85));
    lit.style.transform = `scaleX(${f.toFixed(4)})`;
    head.style.transform = `translate3d(${(f * railW).toFixed(1)}px, 0, 0)`;
    head.style.opacity = f > 0.004 && f < MARK - 0.002 ? '1' : '0';
    for (let i = 0; i <= NOW; i++) lightRk(i, f >= i / 7 - 0.002, !first && !jumping, quiet);
  }

  // ---------------------------------------------------------------- measure, tracks, reduced motion

  function measureAll() {
    measureDeal();
    measureRain();
    railW = rail.offsetWidth;
  }
  await breathe();
  measureAll();
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => {
      measureAll();
      if (dealt === 'deck') toDeck();
      if (covered !== null) renderRain(rainP);
      if (lineReady) renderLine(lineP);
    });
    ro.observe(board);
    ro.observe(stage);
    ro.observe(copy); // the words around the rain settle when the fonts arrive; the stage keeps its size
    ro.observe(streak);
    ro.observe(rline);
    offs.push(() => ro.disconnect());
  }

  offs.push(scroll.track(board, renderDeal, { enter: 1, exit: 0 }));
  offs.push(scroll.track(pinTrack, renderRain, { enter: 0.35, exit: 1 }));
  // The rain falls only while its stage can be seen (the pin's whole length; not the words above it on a phone,
  // nor the torn edges).
  offs.push(
    scroll.track(
      pinTrack,
      (p) => {
        onscreen = p > 0 && p < 1;
        syncRain();
      },
      { enter: 1, exit: 0 },
    ),
  );
  offs.push(scroll.track(rline, renderLine, { enter: 0.88, exit: 0.4 }));

  function applyReduced() {
    rainEl.classList.toggle('is-still', ctx.reduced);
    syncRain();
    if (ctx.reduced) {
      restAll();
      popAnim?.cancel();
      setOpen(1);
      setCovered(true, false);
      hand.getAnimations().forEach((a) => a.cancel());
    }
    if (lineReady) renderLine(lineP);
  }
  applyReduced();
  offs.push(ctx.onReducedChange(applyReduced));

  return {
    enter() {
      entered = true;
      syncRain();
    },
    leave() {
      entered = false;
      syncRain();
    },
  };
}
