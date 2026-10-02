// Sound for the promo page: the app's own recordings over Web Audio, mixed like the app (src/sound/mix.ts,
// docs/design/sound.md). Off by default; nothing is fetched until the visitor turns it on.
//
//   const sound = createSound({ base: './' });             (sections get it as ctx.sound)
//   button.onclick = () => sound.toggle();                  // MUST run inside a click/tap (iOS unlock)
//   sound.play('land');  sound.play('tick', { rate: 2 ** (2 / 12), volume: 0.8 });
//   sound.ladder(k);      // k-th consecutive make (0 = the first): pop k semitones up, capped at +8
//   sound.roll(speed01);  // the rolling bed follows a gesture's speed; call it on every move, it fades by itself
//   sound.enabled / sound.available / sound.ready / sound.status;  sound.onChange(fn) → off
//
// Rules carried over from the app:
// - The bed (roll_loop) is ONE looping source, started once at gain 0 when sound comes on; afterwards only
//   its gain moves. Never start/stop it per gesture, never change its rate.
// - At most 3 one-shots at once (the bed does not count); a stronger sound takes the place of a weaker one;
//   each sound has a minimum interval and a pool (pop and tick overlap themselves, the rest restart).
// - The files are played exactly as cut: no trimming, fades or limiting here.
// - The audio session is 'ambient' where the browser lets us say so: it mixes with the visitor's music and
//   the iPhone's silent switch mutes it, as in the app. ('playback' would sound through the switch but stop the
//   visitor's music.) No page can read the switch, so main.js says so on iOS when sound comes on.
// - Hidden page → the context is suspended. A failed decode never throws: the toggle says "unavailable".

/** src/sound/mix.ts ONE_SHOTS. */
export const ONE_SHOTS = {
  land: { volume: 1, pool: 1, minIntervalMs: 150, priority: 3 },
  claps: { volume: 0.85, pool: 1, minIntervalMs: 600, priority: 3 },
  stamp: { volume: 0.9, pool: 1, minIntervalMs: 150, priority: 2 },
  lock: { volume: 0.85, pool: 1, minIntervalMs: 150, priority: 2 },
  sticker: { volume: 0.85, pool: 1, minIntervalMs: 120, priority: 2 },
  grind: { volume: 0.75, pool: 1, minIntervalMs: 250, priority: 2 },
  drop_in: { volume: 0.85, pool: 1, minIntervalMs: 400, priority: 2 },
  tail_stop: { volume: 0.8, pool: 1, minIntervalMs: 400, priority: 2 },
  pop: { volume: 0.9, pool: 2, minIntervalMs: 70, priority: 2 },
  scuff: { volume: 0.8, pool: 1, minIntervalMs: 70, priority: 1 },
  tick: { volume: 0.9, pool: 2, minIntervalMs: 35, priority: 0 },
  select: { volume: 1, pool: 1, minIntervalMs: 120, priority: 1 },
};
export const SOUND_NAMES = ['roll_loop', ...Object.keys(ONE_SHOTS)];
export const MAX_VOICES = 3;
/** src/sound/mix.ts ROLL (the parts that apply to Web Audio). */
export const ROLL = { maxVolume: 0.85, gamma: 0.6, attackMs: 90, releaseMs: 120, idleMs: 400, volumeStep: 0.03 };
export const LADDER_MAX_STEPS = 8;
export const semitones = (k) => 2 ** (k / 12);

const STORAGE_KEY = 'nbd.sound';
const readPref = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};
const writePref = (on) => {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* private mode or blocked storage: the toggle still works for this visit */
  }
};

export function createSound({ base = './' } = {}) {
  const Ctor = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  const listeners = new Set();
  const buffers = new Map();
  const lastAt = new Map();
  let voices = [];
  let ctx = null;
  let master = null;
  let bed = null; // { gain, sent, idle }
  let enabled = readPref();
  let status = Ctor ? (enabled ? 'locked' : 'off') : 'unavailable';
  let loading = null;

  const emit = () => {
    const state = api.state;
    for (const fn of listeners) {
      try {
        fn(state);
      } catch (error) {
        console.error(error);
      }
    }
  };
  const setStatus = (next) => {
    if (next !== status) {
      status = next;
      emit();
    }
  };

  function ensureContext() {
    if (!Ctor) return null;
    if (!ctx) {
      try {
        // Mix with the visitor's music and follow the silent switch, like the app's .ambient session.
        if (navigator.audioSession) navigator.audioSession.type = 'ambient';
      } catch {
        /* not supported */
      }
      try {
        ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        ctx = null;
        setStatus('unavailable');
        return null;
      }
      ctx.onstatechange = emit; // 'running' arrives after resume() resolves: `ready` changes then
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
      // iOS unlock: a one-sample silent buffer started inside the gesture.
      try {
        const silent = ctx.createBuffer(1, 1, ctx.sampleRate);
        const src = ctx.createBufferSource();
        src.buffer = silent;
        src.connect(ctx.destination);
        src.start(0);
      } catch {
        /* ignore */
      }
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
    return ctx;
  }

  function decode(arrayBuffer) {
    return new Promise((resolve, reject) => {
      // Old Safari only has the callback form; newer ones return a promise too.
      const maybe = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (maybe && typeof maybe.then === 'function') maybe.then(resolve, reject);
    });
  }

  function load() {
    if (loading) return loading;
    setStatus('loading');
    loading = Promise.all(
      SOUND_NAMES.map(async (name) => {
        try {
          const response = await fetch(`${base}assets/sound/${name}.m4a`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          buffers.set(name, await decode(await response.arrayBuffer()));
        } catch {
          // A sound that cannot be decoded just stays silent.
        }
      }),
    ).then(() => {
      if (buffers.size === 0) {
        setStatus('unavailable');
        return;
      }
      startBed();
      setStatus(enabled ? 'ready' : 'off');
    });
    return loading;
  }

  // The bed: started once, at gain 0; only its gain changes afterwards.
  function startBed() {
    if (bed || !buffers.has('roll_loop')) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    const src = ctx.createBufferSource();
    src.buffer = buffers.get('roll_loop');
    src.loop = true;
    src.connect(gain);
    src.start();
    bed = { gain, sent: 0, idle: 0 };
  }

  function rampMaster(to, tau = 0.02) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(to, t, tau);
  }

  /** Turns sound on or off (default: flip). Call it inside a click/tap handler. Resolves when ready/off. */
  function toggle(on = !enabled) {
    enabled = Boolean(on);
    writePref(enabled);
    if (!Ctor) {
      setStatus('unavailable');
      return Promise.resolve(api.state);
    }
    if (enabled) {
      if (!ensureContext()) return Promise.resolve(api.state);
      rampMaster(1);
      emit();
      // Off → on again: the sounds are decoded already (load() hands back the settled promise), but the context is
      // still waking from its suspend(). Wait for both, then say ready — so the caller's confirmation sound plays.
      // Always resume, whatever ctx.state says: a quick off → on can land while the off's suspend() is still pending
      // (the state still reads 'running'), and only a resume() queued after it brings the context back.
      const running = ctx.resume().catch(() => {});
      return Promise.all([load(), running]).then(() => {
        if (enabled && buffers.size) setStatus('ready');
        return api.state;
      });
    }
    stopVoices();
    if (ctx) {
      rampMaster(0, 0.015);
      const c = ctx;
      setTimeout(() => {
        if (enabled || c.state !== 'running') return;
        // Turned on again while this suspend was in flight: wake the context back up once it has settled.
        c.suspend().then(
          () => {
            if (enabled && !document.hidden) c.resume().catch(() => {});
          },
          () => {},
        );
      }, 120);
    }
    setStatus(status === 'unavailable' ? 'unavailable' : 'off');
    emit();
    return Promise.resolve(api.state);
  }

  // The preference survives a visit, but a browser lets audio start only from a gesture: the first tap
  // or key anywhere unlocks it. A mouse press counts at once (the LANDED! hold starts on pointerdown and
  // must not be silent); a touch only counts on its release, so the listeners stay until the context runs.
  if (enabled && Ctor) {
    const events = ['pointerdown', 'mousedown', 'pointerup', 'touchend', 'keydown', 'click'];
    const done = () => events.forEach((e) => window.removeEventListener(e, unlock, true));
    function unlock() {
      if (!enabled) return done();
      const c = ensureContext();
      if (!c) return done();
      load();
      if (c.state === 'running') done();
      else c.resume().then(() => c.state === 'running' && done(), () => {});
    }
    events.forEach((e) => window.addEventListener(e, unlock, { capture: true, passive: true }));
  }

  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      if (bed) {
        bed.gain.gain.cancelScheduledValues(ctx.currentTime);
        bed.gain.gain.setValueAtTime(0, ctx.currentTime);
        bed.sent = 0;
      }
      ctx.suspend().catch(() => {});
    } else if (enabled) {
      ctx.resume().catch(() => {});
    }
  });

  function stopVoice(v, at = ctx?.currentTime ?? 0) {
    try {
      v.gain.gain.cancelScheduledValues(at);
      v.gain.gain.setTargetAtTime(0, at, 0.004);
      v.source.stop(at + 0.03);
    } catch {
      /* already stopped */
    }
    v.endsAt = 0;
  }
  function stopVoices() {
    voices.forEach((v) => stopVoice(v));
    voices = [];
  }

  /** Plays a one-shot. Returns true when it really sounds. */
  function play(name, { rate = 1, volume = 1 } = {}) {
    const spec = ONE_SHOTS[name];
    if (!spec) {
      console.warn(`[sound] no one-shot "${name}"`);
      return false;
    }
    if (!enabled || !ctx || ctx.state !== 'running' || document.hidden) return false;
    const buffer = buffers.get(name);
    if (!buffer) return false;
    const now = performance.now();
    if (now - (lastAt.get(name) ?? -Infinity) < spec.minIntervalMs) return false;
    const t = ctx.currentTime;
    voices = voices.filter((v) => v.endsAt > t);
    const same = voices.filter((v) => v.name === name);
    if (same.length >= spec.pool) {
      stopVoice(same[0], t);
      voices = voices.filter((v) => v !== same[0]);
    }
    if (voices.length >= MAX_VOICES) {
      // The weakest (then the oldest) gives way, but only to a stronger sound.
      const weakest = voices.reduce((a, b) => (b.priority < a.priority ? b : a));
      if (weakest.priority >= spec.priority) return false;
      stopVoice(weakest, t);
      voices = voices.filter((v) => v !== weakest);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, spec.volume * volume));
    source.connect(gain);
    gain.connect(master);
    source.start(t);
    voices.push({ name, source, gain, priority: spec.priority, endsAt: t + buffer.duration / rate });
    lastAt.set(name, now);
    return true;
  }

  /** The make ladder: the k-th consecutive make (0 = first) is k semitones up, never more than 8. */
  function ladder(k) {
    const step = Math.min(Math.max(0, Math.floor(Number(k) || 0)), LADDER_MAX_STEPS);
    return play('pop', { rate: semitones(step) });
  }

  /**
   * The rolling bed's level from a gesture's speed, 0…1. Call it on every move (pointer, wheel, scroll);
   * speeding up follows in ~90 ms, slowing down glides (~120 ms); with no call for 400 ms it fades out.
   */
  function roll(intensity) {
    if (!bed || !enabled || !ctx || ctx.state !== 'running') return;
    const level = Math.max(0, Math.min(1, Number(intensity) || 0));
    const target = level <= 0 ? 0 : ROLL.maxVolume * level ** ROLL.gamma;
    const t = ctx.currentTime;
    const moved = Math.abs(target - bed.sent) >= ROLL.volumeStep || (target === 0) !== (bed.sent === 0);
    if (moved) {
      const tau = (target >= bed.sent ? ROLL.attackMs : ROLL.releaseMs) / 3000;
      bed.gain.gain.cancelScheduledValues(t);
      bed.gain.gain.setTargetAtTime(target, t, tau);
      bed.sent = target;
    }
    clearTimeout(bed.idle);
    if (target > 0) {
      bed.idle = setTimeout(() => {
        if (!ctx) return;
        const now = ctx.currentTime;
        bed.gain.gain.cancelScheduledValues(now);
        bed.gain.gain.setTargetAtTime(0, now, ROLL.releaseMs / 1000);
        bed.sent = 0;
      }, ROLL.idleMs);
    }
  }

  const api = {
    play,
    ladder,
    roll,
    toggle,
    names: SOUND_NAMES,
    /** The visitor wants sound (the toggle is on). */
    get enabled() {
      return enabled;
    },
    /** Sound can work in this browser (false: no Web Audio, or nothing decoded). */
    get available() {
      return status !== 'unavailable';
    },
    /** Decoded and running: play() will sound. */
    get ready() {
      return enabled && status === 'ready' && ctx?.state === 'running';
    },
    /** Names of the sounds decoded so far (diagnostics). */
    get decoded() {
      return [...buffers.keys()];
    },
    /** 'off' | 'locked' (on, waiting for a first tap) | 'loading' | 'ready' | 'unavailable' */
    get status() {
      return status;
    },
    get state() {
      return { enabled, available: status !== 'unavailable', ready: api.ready, status };
    },
    /** fn(state) on every change; returns an unsubscribe. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return api;
}
