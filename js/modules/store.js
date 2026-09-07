/* ==========================================================================
   CodeNotes · a VDX product — Meeting Store
   Spec §17-22, §28. Normalized Meeting + TranscriptLine + Notes models.
   Live in-memory authoring; derived data (notes/themes/participants/
   hidden-pinned) persisted via Cache. Handles grouping (date/people/app/
   theme), pinning, hiding, global search, and previous/next navigation.
   ========================================================================== */
(function () {
  'use strict';

  const storeApi = window.CN_STORE || {};
  const cache = window.CN_CACHE;

  const MeetingStore = (function () {
    // In-memory working copy (the "current session" meetings).
    // Authoritative source for transcripts; derived fields persisted separately.
    let meetings = [];
    let selectedId = null;
    let groupMode = 'date'; // date | people | app | theme
    let prefs = { theme: 'light', ai: null };
    let onSelect = null;
    let onMutate = null;

    // ---- Core ----
    function _persistMeta() {
      // Persist lightweight metadata (id/title/source/timestamps/status/pinned/hidden)
      // so session restores list without re-importing transcripts unless opt-in.
      const meta = meetings.map((m) => ({
        id: m.id, title: m.title, source: m.source,
        startedAt: m.startedAt, endedAt: m.endedAt, duration: m.duration,
        participants: m.participants, status: m.status, pinned: m.pinned, hidden: m.hidden
      }));
      cache.D.meetMeta()(meta);
    }
    function _persistTranscript(m) {
      // Transcripts are the core product asset ("never lose what happened");
      // stored under a NON-derived namespace so "Clear cached data" (derived only)
      // does NOT wipe them. Quota-guarded.
      try {
        const key = 'codenotes:transcripts:' + m.id;
        localStorage.setItem(key, JSON.stringify(m.transcript || []));
      } catch (e) { /* quota */ }
    }
    function _loadTranscript(m) {
      try {
        const raw = localStorage.getItem('codenotes:transcripts:' + m.id);
        if (raw) { const arr = JSON.parse(raw); if (Array.isArray(arr)) m.transcript = arr; }
      } catch (e) { /* corrupted -> keep in-memory */ }
    }
    function _commit() { if (onMutate) onMutate(); }

    // ---- Public API ----
    function setCallbacks(sel, mut) { onSelect = sel; onMutate = mut; }

    function all() { return meetings; }
    function get(id) { return meetings.find((m) => m.id === id) || null; }
    function count() { return meetings.length; }
    function visible() { return meetings.filter((m) => !m.hidden); }
    function countVisible() { return visible().length; }
    function hiddenCount() { return meetings.filter((m) => m.hidden).length; }

    function addRaw(meeting) {
      // Deep-ish normalize to guaranteed fields.
      const m = Object.assign({
        id: 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        title: 'Untitled meeting',
        source: 'import',
        startedAt: new Date().toISOString(),
        endedAt: null,
        duration: null,
        participants: [],
        transcript: [],
        screenContext: [],
        notes: { summary: '', keyPoints: [], actionItems: [], decisions: [], followUps: [], resources: [], related: [] },
        status: 'draft',
        pinned: false,
        hidden: false
      }, meeting);
      m.id = m.id && m.id.length > 2 ? m.id : 'm_' + Date.now().toString(36);
      if (!Array.isArray(m.transcript)) m.transcript = [];
      if (!m.notes) m.notes = { summary: '', keyPoints: [], actionItems: [], decisions: [], followUps: [], resources: [], related: [] };
      meetings.unshift(m);
      if (m.transcript && m.transcript.length) _persistTranscript(m);
      _persistMeta(); _commit();
      return m;
    }

    function update(id, patch) {
      const m = get(id); if (!m) return false;
      Object.assign(m, patch);
      if (patch.transcript !== undefined) _persistTranscript(m);
      if (typeof patch.pinned === 'boolean' || typeof patch.hidden === 'boolean' || patch.title !== undefined) {
        _persistMeta();
      }
      _commit(); return true;
    }

    function select(id) {
      if (selectedId === id) { return; } // no re-fire on already-selected → avoids recursion
      selectedId = id;
      if (onSelect) onSelect(id);
    }

    function getSelected() { return selectedId ? get(selectedId) : null; }

    function remove(id) {
      const i = meetings.findIndex((m) => m.id === id);
      if (i === -1) return false;
      meetings.splice(i, 1);
      cache.remove('notes:' + id); cache.remove('transcript_enh:' + id);
      cache.remove('theme:' + id); cache.remove('participants:' + id);
      try { localStorage.removeItem('codenotes:transcripts:' + id); } catch (e) {}
      if (selectedId === id) { selectedId = null; if (onSelect) onSelect(null); }
      _persistMeta(); _commit(); return true;
    }

    // ---- Persistence across sessions ----
    function loadFromCache() {
      const meta = cache.D.meetMeta()();
      if (Array.isArray(meta)) {
        meetings = meta.map((x) => Object.assign({
          title: 'Untitled meeting', source: 'import', startedAt: new Date().toISOString(),
          endedAt: null, duration: null, participants: [], transcript: [],
          screenContext: [], status: 'final', pinned: false, hidden: false
        }, x));
        // Restore notes & participants from derived cache + transcript from store.
        for (const m of meetings) {
          const n = cache.D.notes(m.id)();
          if (n) Object.assign(m, { notes: n });
          _loadTranscript(m);
        }
        _commit();
      }
    }

    // ---- Derived field access with lazy caching ----
    function getNotes(id) {
      const m = get(id); if (!m) return null;
      if (m.notes) return m.notes;
      return null;
    }
    function setNotes(id, notes) {
      const m = get(id); if (!m) return false;
      m.notes = notes;
      cache.D.notes(id)(notes);
      _commit(); return true;
    }
    function getEnhanced(id) { return cache.D.enhanced(id)(); }
    function setEnhanced(id, v) { return cache.D.enhanced(id)(v); }
    function getTheme(m) {
      const fromCache = m.theme ? m.theme : cache.D.theme(m.id)();
      if (fromCache) return fromCache;
      const t = window.CN_INTEL ? window.CN_INTEL.getTheme(m) : 'General';
      cache.D.theme(m.id)(t);
      if (!m.theme) m.theme = t;
      return t;
    }
    function getParticipants(m) {
      const fromCache = m.participants && m.participants.length ? m.participants : cache.D.participants(m.id)();
      if (fromCache && fromCache.length) return fromCache;
      const t = (m.transcript || []).map((l) => l.speaker).filter((s) => s && s !== 'Unknown');
      const unique = [...new Set(t)];
      cache.D.participants(m.id)(unique);
      return unique;
    }

    // ---- Notes editing helpers ----
    function setNoteArray(id, key, arr) {
      const m = get(id); if (!m) return false;
      if (!m.notes) m.notes = { summary: '', keyPoints: [], actionItems: [], decisions: [], followUps: [], resources: [], related: [] };
      m.notes[key] = arr;
      cache.D.notes(id)(m.notes);
      _commit(); return true;
    }
    function setNoteText(id, field, text) {
      const m = get(id); if (!m) return false;
      if (!m.notes) m.notes = { summary: '', keyPoints: [], actionItems: [], decisions: [], followUps: [], resources: [], related: [] };
      m.notes[field] = text;
      cache.D.notes(id)(m.notes);
      _commit(); return true;
    }

    // ---- Correction application (display-time) ----
    function applyCorrections(m) {
      // Applies word corrections to transcript and notes at render/export time.
      if (!window.CN_WORD) return m;
      const corrected = {
        ...m,
        transcript: (m.transcript || []).map((l) => ({ ...l, text: window.CN_WORD.apply(l.text) })),
        notes: m.notes ? {
          ...m.notes,
          summary: window.CN_WORD.apply(m.notes.summary || ''),
          keyPoints: (m.notes.keyPoints || []).map((x) => window.CN_WORD.apply(x)),
          decisions: (m.notes.decisions || []).map((x) => window.CN_WORD.apply(x)),
          actionItems: (m.notes.actionItems || []).map((x) => ({ ...x, task: window.CN_WORD.apply(x.task || '') })),
          followUps: (m.notes.followUps || []).map((x) => window.CN_WORD.apply(x))
        } : undefined
      };
      return corrected;
    }

    return {
      setCallbacks, all, get, count, countVisible, hiddenCount, addRaw, update,
      select, getSelected, remove, loadFromCache,
      getNotes, setNotes, getEnhanced, setEnhanced, getTheme, getParticipants,
      setNoteArray, setNoteText, applyCorrections
    };
  })();
  window.CN_STORE = MeetingStore;
})();
