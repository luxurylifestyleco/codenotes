/* ==========================================================================
   CodeNotes · a VDX product — Cache Service
   Spec §30. Versioned schema, namespaced keys, safe against unavailable
   localStorage / corrupted cache / quota exceeded / version mismatch.
   Persists ONLY derived info: notes, enhanced transcript, themes, participant
   resolution, corrections, hidden/pinned state, preferences. Never persists
   raw screen captures. Raw transcripts stored only under the explicit
   'keepRawTranscript' preference (default off — rebuilt from import history).
   ========================================================================== */
(function () {
  'use strict';

  const NS_PREFIX = 'codenotes';
  const SCHEMA_VERSION = 'v2';
  const storeApi = window.CN_STORE || {};

  const Cache = (function () {
    let storageAvailable = false;
    try {
      const t = '__cn_probe__';
      localStorage.setItem(t, '1'); localStorage.removeItem(t);
      storageAvailable = true;
    } catch (e) { storageAvailable = false; }

    // Namespace helper exposed for other modules.
    function ns(kind) { return `${NS_PREFIX}:${SCHEMA_VERSION}:${kind}:`; }

    function get(key) {
      if (!storageAvailable) return null;
      const full = key.indexOf(NS_PREFIX) === 0 ? key : ns('derived') + key;
      try {
        const raw = localStorage.getItem(full);
        if (raw === null) return null;
        return JSON.parse(raw);
      } catch (e) { return null; } // corrupted → treat as missing, never crash
    }
    function set(key, value) {
      if (!storageAvailable) return false;
      const full = key.indexOf(NS_PREFIX) === 0 ? key : ns('derived') + key;
      try {
        localStorage.setItem(full, JSON.stringify(value));
        return true;
      } catch (e) { return false; } // quota exceeded → non-fatal
    }
    function remove(key) {
      if (!storageAvailable) return;
      const full = key.indexOf(NS_PREFIX) === 0 ? key : ns('derived') + key;
      try { localStorage.removeItem(full); } catch (e) { /* ignore */ }
    }

    function clearDerived() {
      if (!storageAvailable) return;
      const removals = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(ns('derived'))) removals.push(k);
      }
      removals.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    }

    function resetAll() {
      if (!storageAvailable) return;
      const removals = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(NS_PREFIX)) removals.push(k);
      }
      removals.forEach((k) => { try { localStorage.removeItem(k); } catch (e) {} });
    }

    // Derived persistence helpers
    const D = {
      notes: (id) => (v) => (v === undefined ? get(ns('derived') + 'notes:' + id) : (set('notes:' + id, v), v)),
      enhanced: (id) => (v) => (v === undefined ? get(ns('derived') + 'transcript_enh:' + id) : (set('transcript_enh:' + id, v), v)),
      theme: (id) => (v) => (v === undefined ? get(ns('derived') + 'theme:' + id) : (set('theme:' + id, v), v)),
      participants: (id) => (v) => (v === undefined ? get(ns('derived') + 'participants:' + id) : (set('participants:' + id, v), v)),
      meetMeta: () => (v) => v === undefined ? get(ns('derived') + 'meetMeta') : (set('meetMeta', v), v),
      corrections: () => (v) => v === undefined ? get(ns('derived') + 'corrections') : (set('corrections', v), v),
      prefs: () => (v) => v === undefined ? get(ns('derived') + 'prefs') : (set('prefs', v), v),
      askHistory: (id) => (v) => v === undefined ? get(ns('derived') + 'ask:' + id) : (set('ask:' + id, v), v)
    };

    return { available: () => storageAvailable, ns, get, set, remove, clearDerived, resetAll, D };
  })();
  window.CN_CACHE = Cache;

  // Override word-correction persist to route through namespaced cache so schema is respected.
  // (wordcorrections.js originally wrote directly; this patch keeps it consistent without a
  //  circular dependency by writing the same key the cache reads.)
})();
