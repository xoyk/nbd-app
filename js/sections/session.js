// session — "Count makes in a row": a working session counter, the session after the landing.
//
// The title is the scoreboard: COUNT MAKES · the makes in a row, poster size · IN A ROW. It lights up and slams
// on every make and drops back to a dark 0 with a little shake on a miss; a Caveat note next to IN A ROW reacts
// to the run. Under it, the app's log screen (src/features/session/LogScreen.tsx) on paper: Kickflip, normal
// stance, LANDED — the story's Kickflip is landed (the section before stamps it), and today is another day. Three
// misses so far. The kicker over the board follows the visitor, not the story: "Kickflip · next session" until they
// have held LANDED! themselves (landed.js sends `nbd:landed` and marks its section data-landed), then
// "Kickflip · landed · next session" — the page never says landed before the visitor has landed it.
// MISS and MAKE work: the counters and the make/miss dot strip. As in the app (src/domain/sessions.ts applyTry),
// a make on a landed slot records a make-day: the first make of the day moves the pip, and the app's ink tape
// says so over the counters for 1.5 s ("+1 day · 2/3"). Three different days and it is on lock.
//
// Sound (opt-in, ctx.sound): MAKE pops on the app's ladder — k = makes in a row − 1, a semitone a step,
// capped at +8 (src/sound/logic.ts makeStep); MISS scuffs and the ladder starts over. Haptics: vibrate(10).
//
// Input: the pressed look comes on pointerdown. A mouse or pen logs on pointerdown (instant); a finger logs
// on the tap's click (no 300 ms delay with touch-action: manipulation), so a thumb that starts a page scroll
// on these half-screen buttons never logs a try. Keyboard: Space / Enter on the focused button. Taps closer
// than 250 ms are dropped, like the app's BigLogButtons.

const START = ['miss', 'miss', 'miss'];
const THROTTLE_MS = 250; // sessionMetrics.logThrottleMs
const LADDER_STEPS = 9; // k = 0 … 8
const STREAK = 5;
const TOP = LADDER_STEPS;
const DOT_PITCH = 9 + 3.6; // sessionMetrics.dotInk + dotInkGap
const LABEL_DOTS = 3; // LOG.stripLabelDots
const TAPE_MS = 1500; // LOG.tapeMs

/** The app's English plural (one / other), on both pages: the device speaks the app's English. */
const en = (n, one, other) => (n === 1 ? one : other);

export default function init(root, ctx) {
  const { motion, sound, dom } = ctx;
  const { $, $$ } = dom;

  const board = $('[data-board]', root);
  const kicker = $('[data-kicker]', root);
  const big = $('[data-big]', root);
  const bigBox = big.parentElement;
  const hand = $('[data-hand]', root);
  const bestEl = $('[data-best]', root);
  const rungs = $$('[data-ladder] i', root);
  const makesEl = $('[data-makes]', root);
  const makesLabel = $('[data-makes-label]', root);
  const triesEl = $('[data-tries]', root);
  const triesLabel = $('[data-tries-label]', root);
  const runEl = $('[data-run]', root);
  const strip = $('[data-strip]', root);
  const tape = $('[data-tape]', root);
  const live = $('[data-live]', root);
  const sndButton = $('[data-snd]', root);
  const buttons = $$('[data-log]', root);

  // ---------------------------------------------------------------- state

  const results = [...START];
  let madeToday = false; // the first make of the day moves the make-day pip (1/3 → 2/3)
  let best = 0;
  let lastLogAt = -Infinity;
  let handKey = 'idle';

  const count = () => {
    let makes = 0;
    for (const r of results) if (r === 'make') makes += 1;
    let run = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === 'make'; i -= 1) run += 1;
    return { makes, tries: results.length, run };
  };

  // ---------------------------------------------------------------- drawing

  const reduced = () => ctx.reduced;

  /** The big number: slam from above, scaled from its baseline (spring slam). */
  function slamBig(from) {
    if (reduced()) return;
    const dy = -0.09 * bigBox.offsetHeight;
    motion.animate(
      big,
      (v) => ({ transform: `translate3d(0, ${(dy * (1 - v)).toFixed(2)}px, 0) scale(${(from + (1 - from) * v).toFixed(4)})` }),
      { spring: 'slam' },
    );
  }

  /** A miss: the run falls off the board, the dark 0 takes its place with a little shake. */
  function dropBig(previous) {
    if (reduced() || previous === 0) return;
    const text = String(previous);
    const ghost = dom.h('span', { class: 'ss-big__ghost', 'data-digits': String(text.length) }, text);
    bigBox.append(ghost);
    const fall = motion.animate(
      ghost,
      [
        { transform: 'translate3d(0, 0, 0) rotate(0deg)', opacity: 1 },
        { transform: 'translate3d(4%, 38%, 0) rotate(9deg)', opacity: 0 },
      ],
      { duration: 320, easing: 'in' },
    );
    fall.finished.then(() => ghost.remove(), () => ghost.remove());
    motion.shake(bigBox, 5);
  }

  function setBig(n) {
    board.classList.toggle('is-zero', n === 0);
    big.textContent = String(n);
    big.dataset.state = n === 0 ? 'zero' : 'lit';
    big.dataset.digits = String(String(n).length);
  }

  function setLadder(run, popNew) {
    const lit = Math.min(run, LADDER_STEPS);
    rungs.forEach((rung, i) => rung.classList.toggle('is-on', i < lit));
    if (popNew && run >= 1 && run <= LADDER_STEPS && !reduced()) {
      motion.animate(rungs[run - 1], (v) => ({ transform: `scaleY(${(0.2 + 0.8 * v).toFixed(4)})` }), { spring: 'pop' });
    }
  }

  function setHand(key) {
    if (key === handKey) return;
    handKey = key;
    hand.textContent = ctx.t(`hand.${key}`);
    if (!reduced()) {
      motion.animate(hand, (v) => ({ transform: `scale(${(1.35 - 0.35 * v).toFixed(4)}) rotate(${(-5 * (1 - v)).toFixed(2)}deg)`, opacity: Math.min(1, v * 3) }), {
        spring: 'pop',
      });
    }
  }

  function perLine() {
    const width = strip.clientWidth || 300;
    return Math.max(LABEL_DOTS + 1, Math.floor((width + 3.6) / DOT_PITCH));
  }

  /** The dot strip: every try in order, newest last; older ones fold into a leading "+n" when it runs out of room. */
  function drawStrip(popLast) {
    const fit = perLine();
    const max = results.length > fit ? fit - LABEL_DOTS : fit;
    const hidden = Math.max(0, results.length - max);
    const frag = document.createDocumentFragment();
    if (hidden > 0) frag.append(dom.h('span', { class: 'ss-strip__more' }, `+${hidden}`));
    for (let i = hidden; i < results.length; i += 1) frag.append(dom.h('i', { class: results[i] === 'miss' ? 'is-miss' : '' }));
    strip.replaceChildren(frag);
    if (popLast && !reduced()) {
      const dot = strip.lastElementChild;
      motion.animate(dot, (v) => ({ transform: `scale(${(0.2 + 0.8 * v).toFixed(4)})` }), { spring: 'pop' });
    }
  }

  function bump(el, from = 1.16) {
    if (reduced()) return;
    motion.animate(el, (v) => ({ transform: `scale(${(from + (1 - from) * v).toFixed(4)})` }), { spring: 'pop' });
  }

  const counterLabels = $$('.ss-counter small', root);
  /** Like the app's adjustsFontSizeToFit (minimumFontScale 0.75): a label that runs out of room shrinks. */
  function fitLabels() {
    for (const label of counterLabels) {
      label.style.fontSize = '';
      const room = label.clientWidth;
      const need = label.scrollWidth;
      if (need > room + 0.5) label.style.fontSize = `${Math.max(0.75, room / need) * parseFloat(getComputedStyle(label).fontSize)}px`;
    }
  }

  function drawCounters({ makes, tries, run }) {
    makesEl.textContent = dom.formatNumber(makes);
    makesLabel.textContent = en(makes, 'make', 'makes');
    triesEl.textContent = dom.formatNumber(tries);
    triesLabel.textContent = en(tries, 'try', 'tries');
    runEl.textContent = dom.formatNumber(run);
    fitLabels();
  }

  // The app's make-day tape: hangs from the counters' top rule for 1.5 s, then goes.
  let tapeTimer = 0;
  function showTape() {
    clearTimeout(tapeTimer);
    tape.hidden = false;
    if (!reduced()) motion.pop(tape, { from: 1.5 });
    tapeTimer = setTimeout(() => {
      tape.hidden = true;
    }, TAPE_MS);
  }

  // ---------------------------------------------------------------- logging

  /** A 10 ms tick where the browser has vibration (Android); only inside a real gesture. */
  function buzz() {
    if (typeof navigator.vibrate !== 'function') return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    try {
      navigator.vibrate(10);
    } catch {
      /* not allowed here */
    }
  }

  function log(result) {
    const now = performance.now();
    if (now - lastLogAt < THROTTLE_MS) return;
    lastLogAt = now;

    const before = count();
    results.push(result);
    const c = count();
    const newDay = result === 'make' && !madeToday;
    if (newDay) madeToday = true;

    // Sound and touch first: they are the instant part of the feedback.
    if (result === 'make') sound.ladder(c.run - 1);
    else sound.play('scuff');
    buzz();

    // The app's screen.
    drawCounters(c);
    drawStrip(true);
    if (result === 'make') bump(makesEl);
    bump(triesEl);
    if (newDay) showTape();

    // The board.
    setBig(c.run);
    if (result === 'make') {
      slamBig(c.run === STREAK || c.run === TOP ? 1.6 : 1.35);
      if ((c.run === STREAK || c.run === TOP) && !reduced()) motion.shake(board, 3);
    } else {
      dropBig(before.run);
    }
    setLadder(c.run, result === 'make');
    if (c.run > best) {
      best = c.run;
      bestEl.textContent = dom.formatNumber(best);
      bump(bestEl, 1.4);
    }

    // The hand-written note reacts to the run: a make that starts one is "there it is", a long one is
    // "it's clicking", then "on fire"; a miss after three or more is "no drama", else back to the dare.
    if (result === 'make') {
      if (c.run >= TOP) setHand('top');
      else if (c.run >= STREAK) setHand('streak');
      else if (c.run === 1) setHand('first');
    } else {
      setHand(before.run >= 3 ? 'broke' : 'idle');
    }

    // Screen readers.
    const vars = { run: c.run, makes: c.makes, tries: c.tries };
    live.textContent = ctx.t(newDay ? 'live.day' : `live.${result}`, vars);
  }

  // ---------------------------------------------------------------- input

  for (const button of buttons) {
    const result = button.dataset.log;
    // A mouse or pen press logs on pointerdown; its click is then skipped. A press dragged off the button
    // never clicks, so the flag is dropped once the press ends (after the click, if there is one) — or a
    // later Space / Enter or tap would be eaten.
    let loggedOnDown = false;
    const press = (on) => button.classList.toggle('is-pressed', on);
    const release = () => {
      press(false);
      if (loggedOnDown) setTimeout(() => (loggedOnDown = false), 0);
    };

    button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      press(true);
      if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
        loggedOnDown = true;
        log(result);
      }
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) button.addEventListener(type, release);
    button.addEventListener('click', (e) => {
      const skip = loggedOnDown && e.detail > 0;
      loggedOnDown = false;
      if (skip) return;
      log(result); // a finger's tap, or Space / Enter (detail 0)
    });
    button.addEventListener('keydown', (e) => {
      if (e.key !== ' ' && e.key !== 'Enter') return;
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      press(true);
    });
    button.addEventListener('keyup', () => press(false));
    button.addEventListener('blur', () => press(false));
    button.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- the kicker: landed once the visitor has landed it

  const markLanded = () => {
    if (kicker) kicker.textContent = ctx.t('kicker');
  };
  if (document.querySelector('[data-section="landed"][data-landed]')) markLanded();
  document.addEventListener('nbd:landed', markLanded);

  // ---------------------------------------------------------------- the section's sound toggle

  function renderSound(state = sound.state) {
    const label = !state.available ? ctx.i18n.t('site.soundUnavailable') : state.enabled ? ctx.t('soundOn') : ctx.t('soundOff');
    sndButton.setAttribute('aria-pressed', String(state.enabled && state.available));
    sndButton.setAttribute('aria-label', label);
    sndButton.title = label;
    sndButton.dataset.state = !state.available ? 'unavailable' : state.enabled ? (state.status === 'loading' ? 'loading' : 'on') : 'off';
  }
  sndButton.addEventListener('click', () => {
    if (!sound.available && sound.status === 'unavailable') return;
    sound.toggle().then(() => {
      // The first step of the ladder, so the visitor hears what MAKE will sound like.
      if (sound.enabled) sound.ladder(0);
    });
    renderSound();
  });
  const offSound = sound.onChange(renderSound);
  renderSound();

  // ---------------------------------------------------------------- first view

  // The number drops in once, when the board is well into the screen.
  let played = false;
  let offTrack = null;
  offTrack = ctx.scroll.track(
    board,
    (p) => {
      if (played || p < 0.12) return;
      played = true;
      offTrack?.();
      if (reduced()) return;
      slamBig(1.25);
      motion.animate(hand, (v) => ({ transform: `scale(${(1.4 - 0.4 * v).toFixed(4)}) rotate(${(-6 * (1 - v)).toFixed(2)}deg)`, opacity: Math.min(1, v * 3) }), {
        spring: 'pop',
        delay: 260,
      });
    },
    { enter: 1, exit: 0 },
  );

  // The markup already holds the first state (0 makes, 3 tries, three misses, a dark 0): init reads no layout.
  // enter() lays the strip out to its real width and fits the counter labels once the section is on screen.

  let resizeTimer = 0;
  const onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawStrip(false);
      fitLabels();
    }, 120);
  };

  return {
    enter() {
      drawStrip(false);
      fitLabels();
      window.addEventListener('resize', onResize, { passive: true });
    },
    leave() {
      window.removeEventListener('resize', onResize);
      clearTimeout(resizeTimer);
      for (const b of buttons) b.classList.remove('is-pressed');
    },
    /** QA: log a sequence ('mmmx…' = make, make, make, miss) without the throttle. */
    play(seq) {
      for (const ch of seq) {
        lastLogAt = -Infinity;
        log(ch === 'x' ? 'miss' : 'make');
      }
    },
    destroy() {
      document.removeEventListener('nbd:landed', markLanded);
      offSound();
      offTrack?.();
      clearTimeout(tapeTimer);
    },
  };
}
