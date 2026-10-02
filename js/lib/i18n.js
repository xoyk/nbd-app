// Strings for scripts. The page's own text is rendered at build time from site/_src/i18n/<ns>.json; what a
// script needs at run time sits under each namespace's "js" object and arrives as window.NBD_I18N
// ({ <ns>: { …js strings } }). A section reads its own namespace with ctx.t(key, vars).
//
//   const i18n = createI18n('ru', window.NBD_I18N);
//   i18n.t('site.soundOn')                       → «Звук: вкл»
//   i18n.t('session.inARow', { n: 4 })           → interpolates {n}; a plural object picks its form by n
//   i18n.plural(5, { one: 'трюк', few: 'трюка', many: 'трюков' })   → 'трюков'
//   i18n.format(7415)                            → '7 415' (no-break space, as in the app)

import { formatNumber } from './dom.js';

export { formatNumber };

/**
 * CLDR cardinal category, by hand (the app's src/i18n/plural.ts): en one/other; ru one/few/many,
 * fractions take "other".
 */
export function pluralCategory(n, lang) {
  const abs = Math.abs(Number(n));
  if (lang !== 'ru') return abs === 1 ? 'one' : 'other';
  if (!Number.isInteger(abs)) return 'other';
  const m10 = abs % 10;
  const m100 = abs % 100;
  if (m10 === 1 && m100 !== 11) return 'one';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few';
  return 'many';
}

/**
 * Picks a plural form. `forms` is { one, few, many, other } (any subset) or an array [one, few, many]
 * (ru) / [one, other] (en). Russian fractions use "few" (1,5 трюка), as the app does.
 */
export function plural(n, forms, lang = 'en') {
  if (Array.isArray(forms)) {
    forms = lang === 'ru' ? { one: forms[0], few: forms[1], many: forms[2] } : { one: forms[0], other: forms[1] };
  }
  const cat = pluralCategory(n, lang);
  if (lang === 'ru' && cat === 'other') return forms.few ?? forms.other ?? forms.many ?? '';
  return forms[cat] ?? forms.other ?? forms.many ?? forms.one ?? '';
}

/** Replaces {name} with vars.name; numbers are grouped with formatNumber. Unknown names stay as written. */
export function interpolate(text, vars) {
  if (!vars) return text;
  return String(text).replace(/\{(\w+)\}/g, (match, key) => {
    if (!(key in vars)) return match;
    const v = vars[key];
    return typeof v === 'number' && Number.isInteger(v) ? formatNumber(v) : String(v);
  });
}

const isPluralObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && ('one' in v || 'other' in v || 'many' in v);

function lookup(dict, path) {
  let node = dict;
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

/**
 * A translator over `dict` (a namespace's js object, or the whole NBD_I18N keyed by namespace).
 * t(key, vars): dotted key; a plural object picks its form by vars.n (or vars.count); an array is returned
 * as is (for lists); a missing key warns once and returns the key, so it shows up in QA.
 */
export function createI18n(lang, dict = {}, label = 'i18n') {
  const warned = new Set();
  function t(key, vars) {
    const value = lookup(dict, key);
    if (value === undefined) {
      if (!warned.has(key)) {
        warned.add(key);
        console.warn(`[${label}] no "${key}" string for ${lang}`);
      }
      return key;
    }
    if (Array.isArray(value)) return value;
    if (isPluralObject(value)) {
      const n = vars?.n ?? vars?.count ?? 0;
      return interpolate(plural(n, value, lang), vars);
    }
    return typeof value === 'string' ? interpolate(value, vars) : value;
  }
  return {
    lang,
    t,
    has: (key) => lookup(dict, key) !== undefined,
    plural: (n, forms) => plural(n, forms, lang),
    format: formatNumber,
    interpolate,
  };
}
