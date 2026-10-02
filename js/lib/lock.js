// Page lock for overlays: while something takes the whole screen (the LANDED! celebration, a sheet), the page
// under it neither scrolls nor takes focus, and when it is released the visitor is exactly where they were.
//
//   const unlock = lock.lock({ keep: overlayEl, scrollable: overlayEl.querySelector('.sheet') });
//   …
//   unlock();                       // or lock.unlock() for the most recent one
//
// What it does (iOS Safari and Telegram's in-app browser included):
// - remembers scrollY and puts it back on release if anything moved it (an iOS URL-bar resize, a focus jump);
// - <html> gets overflow: hidden with scrollbar-gutter: stable (no layout shift where scrollbars take room),
//   and the previous inline values are restored exactly;
// - everything in <body> that is not (and does not contain) a `keep` element becomes inert: not focusable,
//   not clickable, hidden from assistive tech. Elements that were inert already are left as they were;
// - touchmove and wheel are cancelled unless they happen inside a `scrollable` element that can scroll (give
//   it overscroll-behavior: contain, so it never hands the gesture to the page) — older iOS ignores overflow on
//   <html>, this guard holds it there.
// Locks nest: each lock() returns its own unlock; the page is released when the last one is.

export function createPageLock() {
  const html = document.documentElement;
  const stack = [];
  let saved = null;
  let inerted = [];
  const listeners = new Set();

  const list = (v) => (v ? (Array.isArray(v) || v instanceof NodeList ? [...v] : [v]) : []).filter((el) => el instanceof Element);
  const canScroll = (el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1;

  function guard(event) {
    const top = stack[stack.length - 1];
    if (!top) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target && top.scrollable.some((box) => box.contains(target) && canScroll(box))) return;
    if (event.cancelable) event.preventDefault();
  }

  function releaseInert() {
    for (const el of inerted) el.inert = false;
    inerted = [];
  }

  /** Inerts every branch of <body> that holds none of `keep` (siblings all the way down to each kept element). */
  function applyInert(keep) {
    releaseInert();
    const visit = (parent) => {
      for (const child of parent.children) {
        if (/^(SCRIPT|STYLE|TEMPLATE|LINK|META)$/.test(child.tagName)) continue;
        if (keep.includes(child)) continue;
        if (keep.some((el) => child.contains(el))) {
          visit(child);
          continue;
        }
        if (child.inert) continue;
        child.inert = true;
        inerted.push(child);
      }
    };
    visit(document.body);
  }

  function apply() {
    const top = stack[stack.length - 1];
    applyInert(top.keep);
  }

  function engage() {
    saved = {
      y: window.scrollY,
      x: window.scrollX,
      overflow: [html.style.getPropertyValue('overflow'), html.style.getPropertyPriority('overflow')],
      gutter: [html.style.getPropertyValue('scrollbar-gutter'), html.style.getPropertyPriority('scrollbar-gutter')],
    };
    html.style.setProperty('scrollbar-gutter', 'stable');
    html.style.setProperty('overflow', 'hidden');
    html.classList.add('page-locked');
    document.addEventListener('touchmove', guard, { passive: false });
    document.addEventListener('wheel', guard, { passive: false });
  }

  function disengage() {
    document.removeEventListener('touchmove', guard);
    document.removeEventListener('wheel', guard);
    releaseInert();
    const restore = (prop, [value, priority]) => {
      if (value) html.style.setProperty(prop, value, priority);
      else html.style.removeProperty(prop);
    };
    restore('overflow', saved.overflow);
    restore('scrollbar-gutter', saved.gutter);
    html.classList.remove('page-locked');
    if (Math.abs(window.scrollY - saved.y) > 0.5 || Math.abs(window.scrollX - saved.x) > 0.5) window.scrollTo(saved.x, saved.y);
    saved = null;
  }

  const notify = () => listeners.forEach((fn) => fn(stack.length > 0));

  /**
   * Locks the page. `keep`: the element(s) that stay live (the overlay; it may sit anywhere in the page).
   * `scrollable`: element(s) inside them that may still scroll by touch or wheel. Returns this lock's unlock.
   */
  function lock({ keep = [], scrollable = [] } = {}) {
    const entry = { keep: list(keep), scrollable: list(scrollable) };
    const first = stack.length === 0;
    stack.push(entry);
    if (first) engage();
    apply();
    if (first) notify();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      release(entry);
    };
  }

  function release(entry) {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    if (stack.length) {
      apply();
      return;
    }
    disengage();
    notify();
  }

  return {
    lock,
    /** Releases the most recent lock (no-op when the page is not locked). */
    unlock() {
      if (stack.length) release(stack[stack.length - 1]);
    },
    /** True while any lock holds the page. */
    get locked() {
      return stack.length > 0;
    },
    /** The scroll position the page will be put back to (null when not locked). */
    get lockedAt() {
      return saved ? saved.y : null;
    },
    /** fn(locked) when the page locks or is released; returns an unsubscribe. */
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
