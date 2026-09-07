/* ==========================================================================
   CodeNotes · a VDX product — Word Correction Engine
   Spec §15: case-insensitive, Unicode-safe, Devanagari-aware word boundaries.
   Corrections apply at display/export/AI-input time. Never to typed questions
   or URLs. Never corrupt longer words accidentally.
   ========================================================================== */
(function () {
  'use strict';

  // Persistent list of {from, to} pairs. Injected by cache.loadCorrections().
  const CORRECTIONS_KEY = 'corrections';
  const storeApi = window.CN_STORE || {};

  let list = [];

  function init(saved) {
    list = Array.isArray(saved) ? saved.filter(isValidPair) : [];
  }

  function isValidPair(p) {
    return p && typeof p === 'object'
      && typeof p.from === 'string' && p.from.trim() !== ''
      && typeof p.to === 'string' && p.to.trim() !== '';
  }

  // Word boundary regex, Unicode-safe and Devanagari-aware.
  // Word = sequences of Unicode letters/numbers + Devanagari letters; boundaries are
  // non-word characters OR a Devanagari/letter transition edge. Using lookarounds so
  // matches don't consume the boundary and never merge across an actual word break.
  function boundaryWord(word) {
    const esc = escapeRegExp(word);
    return `(?<![\\p{L}\\p{N}\\u0900-\\u097F])(${esc})(?![\\p{L}\\p{N}\\u0900-\\u097F])`;
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Apply all corrections to text at display time. Preserves case-insensitive matching,
  // preserving the original case of the replacement where feasible.
  function apply(text) {
    if (!text || !list.length) return text;
    let out = text;
    for (const p of list) {
      const re = new RegExp(boundaryWord(p.from), 'giu');
      out = out.replace(re, (match) => {
        // Preserve uppercase-first if the source match was capitalized.
        if (/^[A-Z]/.test(match) && /^[a-z]/.test(p.to)) {
          return p.to.charAt(0).toUpperCase() + p.to.slice(1);
        }
        return p.to;
      });
    }
    return out;
  }

  // Apply corrections while protecting things we must never modify: URLs, code, typed questions.
  function applyProtected(text, protectedRegexes) {
    if (!text || !list.length) return text;
    const protect = protectedRegexes || [];
    const protectors = [];
    let working = text;
    for (const re of protect) {
      // eslint-disable-next-line no-loop-func
      working = working.replace(re, (m) => {
        protectors.push(m);
        return `\u0000${protectors.length - 1}\u0000`;
      });
    }
    working = apply(working);
    working = working.replace(/\u0000(\d+)\u0000/g, (_, idx) => protectors[Number(idx)]);
    return working;
  }

  function add(from, to) {
    if (!isValidPair({ from, to })) return false;
    // Case-insensitive replace of existing same-src pair.
    const i = list.findIndex((p) => p.from.toLowerCase() === from.toLowerCase());
    if (i >= 0) list[i] = { from, to };
    else list.push({ from, to });
    persist();
    return true;
  }

  function remove(from) {
    const before = list.length;
    list = list.filter((p) => p.from.toLowerCase() !== from.toLowerCase());
    if (list.length !== before) { persist(); return true; }
    return false;
  }

  function persist() {
    try { localStorage.setItem(storeApi.ns('derived') + CORRECTIONS_KEY, JSON.stringify(list)); }
    catch (e) { /* quota ignored; non-fatal */ }
  }

  function getList() { return list.slice(); }

  // ---- Devanagari word-boundary correctness test helpers (used by tests) ----
  function _testApply(text, from, to) {
    const prev = list.slice();
    const idx = list.findIndex((p) => p.from.toLowerCase() === from.toLowerCase());
    if (idx >= 0) list[idx] = { from, to }; else list.push({ from, to });
    const result = apply(text);
    list = prev;
    return result;
  }

  window.CN_WORD = { init, add, remove, getList, apply, applyProtected, _testApply };
})();
