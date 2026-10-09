// library · the app's trick search (src/features/search/model.ts searchTricks), over assets/data/library.json.
// Name starts with the query → name contains it → an alias or stance name starts with it → contains it; ties by
// segment, difficulty, line order, order. Case, diacritics, spaces and hyphens are ignored; an empty query matches
// nothing. No DOM: scripts/site tests run it in node.

const COMBINING = /[̀-ͯ]/g;
const SEPARATOR = /[\s\-‐-―_'’`".,:;()/\\·&+!?]/;

export function fold(source) {
  let out = '';
  for (const c of source) {
    const base = c.normalize('NFD').replace(COMBINING, '').toLowerCase();
    for (const ch of base) if (!SEPARATOR.test(ch)) out += ch;
  }
  return out;
}

// tricks[i] = [name, lineCode, lit, segment, state, difficulty, lineOrder, order, aliases, stanceLabels, id, slots]
export function createSearch(tricks) {
  const index = tricks.map((t, i) => ({
    i,
    t,
    cands: [
      { rankBase: 0, f: fold(t[0]), stance: 'normal' },
      ...t[8].map((a) => ({ rankBase: 2, f: fold(a), stance: 'normal' })),
      ...t[9].map((a) => {
        const at = a.indexOf(':');
        return { rankBase: 2, f: fold(a.slice(at + 1)), stance: a.slice(0, at) };
      }),
    ],
  }));
  const cmp = (a, b) => a.t[3] - b.t[3] || a.t[5] - b.t[5] || a.t[6] - b.t[6] || a.t[7] - b.t[7];
  /** → [{ i, stance }] best first: i indexes `tricks`; stance is the slot the query named ('normal' for a name). */
  return function search(query) {
    const q = fold(query);
    if (!q) return [];
    const found = [];
    for (const e of index) {
      let best = 9;
      let stance = 'normal';
      for (const c of e.cands) {
        const at = c.f.indexOf(q);
        if (at < 0) continue;
        const rank = c.rankBase + (at === 0 ? 0 : 1);
        if (rank < best) {
          best = rank;
          stance = c.stance;
        }
      }
      if (best < 9) found.push({ e, rank: best, stance });
    }
    found.sort((a, b) => a.rank - b.rank || cmp(a.e, b.e));
    return found.map((f) => ({ i: f.e.i, stance: f.stance }));
  };
}
