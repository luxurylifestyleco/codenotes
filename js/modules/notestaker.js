/* ==========================================================================
   CodeNotes · a VDX product — Serialized Notes Taker + Summary Styles
   A serialized (sequential, timestamped) note feed where the user jots lines
   as the meeting runs — each entry is stamped and ordered. The feed replaces
   the bare summary textarea. A user can later regenerate a structured summary
   of the meeting in a chosen style.

   Styles: executive overview · bullet highlights · action-focused ·
           concise paragraph · detailed breakdown.

   Summary generation uses the configured AI provider when available, otherwise
   a deterministic, honest local extractor (never hallucinates) so the feature
   always works offline. Summary style + feed persist locally.
   ========================================================================== */
(function () {
  'use strict';

  const store = window.CN_STORE;
  const intel = window.CN_INTEL;
  const cache = window.CN_CACHE;

  // ---- Style registry ----
  const STYLES = {
    executive: {
      id: 'executive',
      label: 'Executive overview',
      desc: 'A tight 2–4 sentence executive summary.',
      system: buildStyleSystem('Produce a concise executive overview (2–4 sentences): the purpose, the one-line outcome, and the single most important next action. Do not invent facts.')
    },
    bullets: {
      id: 'bullets',
      label: 'Bullet highlights',
      desc: 'Short bulleted highlights, one idea per line.',
      system: buildStyleSystem('Produce a list of short bullet highlights (each one a compact bullet). Do not invent facts.')
    },
    action: {
      id: 'action',
      label: 'Action-focused',
      desc: 'Prioritize owners, commitments, and deadlines.',
      system: buildStyleSystem('Produce an action-focused summary: what was decided, what must happen next, who owns it, and any explicitly stated deadlines. Omit any deadline not stated in the transcript. Do not invent facts.')
    },
    concise: {
      id: 'concise',
      label: 'Concise paragraph',
      desc: 'A single clear paragraph.',
      system: buildStyleSystem('Produce one concise paragraph summarizing the meeting. No bullets, no headers. Do not invent facts.')
    },
    detailed: {
      id: 'detailed',
      label: 'Detailed breakdown',
      desc: 'A structured multi-section breakdown.',
      system: buildStyleSystem('Produce a detailed structured breakdown with short sections (Context, Discussion, Decisions, Next Actions). Be thorough but stick strictly to the supplied material. Do not invent facts.')
    }
  };
  function buildStyleSystem(rule) {
    return [
      'You are CodeNotes summary generation (a VDX product).',
      'STRICT FACTUAL POLICY — you MUST obey all of these:',
      '- Use ONLY the supplied meeting information.',
      '- If information is missing or ambiguous, OMIT it. Never invent names, companies, numbers, dates, deadlines, URLs, or commitments.',
      '- Never add a due date unless it is EXPLICITLY stated in the transcript.',
      '- Do not turn speculation into fact.',
      rule
    ].join('\n');
  }

  function getStyle(id) { return STYLES[id] || STYLES.executive; }
  function allStyles() { return Object.values(STYLES); }

  // ---- Serialized note feed ----
  // Entries: { id, ts (ISO), text, final:true }. Ordered newest-append; each stamped.
  function nowTs() { return new Date().toISOString(); }
  function formatClock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function newId() { return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6); }

  function getFeed(meeting) {
    if (meeting && Array.isArray(meeting.feed)) return meeting.feed;
    if (meeting) return [];
    return [];
  }

  function addEntry(meeting, text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    if (!meeting.feed) meeting.feed = [];
    const entry = { id: newId(), ts: nowTs(), text: trimmed, final: true };
    meeting.feed.push(entry);
    persistFeed(meeting);
    return entry;
  }

  function updateEntry(meeting, id, text) {
    const e = (meeting.feed || []).find((x) => x.id === id);
    if (!e) return false;
    e.text = String(text || '');
    persistFeed(meeting);
    return true;
  }

  function removeEntry(meeting, id) {
    const before = (meeting.feed || []).length;
    meeting.feed = (meeting.feed || []).filter((x) => x.id !== id);
    persistFeed(meeting);
    return meeting.feed.length !== before;
  }

  function clearFeed(meeting) { meeting.feed = []; persistFeed(meeting); }
  function isEmpty(meeting) { return !(meeting.feed && meeting.feed.length); }

  function persistFeed(meeting) {
    try { if (cache && cache.set) cache.set('feed:' + meeting.id, meeting.feed || []); } catch (e) {}
  }
  function loadFeed(meeting) {
    try {
      const f = cache.get('feed:' + meeting.id);
      if (Array.isArray(f)) meeting.feed = f;
    } catch (e) { /* non-fatal */ }
  }

  // ---- Summary style persistence ----
  function getStyleChoice(meeting) {
    if (meeting && meeting.summaryStyle) return meeting.summaryStyle;
    if (meeting) {
      try { const s = cache.get('summaryStyle:' + meeting.id); if (s) { meeting.summaryStyle = s; return s; } } catch (e) {}
    }
    return 'executive';
  }
  function setStyleChoice(meeting, styleId) {
    if (!STYLES[styleId]) return;
    meeting.summaryStyle = styleId;
    try { cache.set('summaryStyle:' + meeting.id, styleId); } catch (e) {}
  }

  // ---- Local deterministic summary (offline; never hallucinates) ----
  // Builds an honest summary from the serialized notes + transcript highlights.
  // No AI, no invented facts.
  function localSummary(meeting, styleId) {
    const style = getStyle(styleId);
    const feed = (meeting.feed || []).map((e) => e.text).filter(Boolean);
    const transcript = (meeting.transcript || [])
      .map((l) => (l.speaker ? l.speaker + ': ' : '') + (l.text || ''))
      .filter((t) => t.trim());

    // Gather candidate lines (notes first, then transcript, non-trivial length).
    const candidates = [];
    for (const t of feed) { const s = t.trim(); if (s.length >= 6) candidates.push({ src: 'note', text: s }); }
    for (const t of transcript) { const s = t.trim(); if (s.length >= 16) candidates.push({ src: 'transcript', text: s }); }
    const seen = new Set(); const uniq = candidates.filter((c) => { if (seen.has(c.text)) return false; seen.add(c.text); return true; });

    if (!uniq.length) return 'No notes yet. Add a line to the notes taker or generate from the transcript.';
    const noteLines = uniq.filter((c) => c.src === 'note').slice(0, 10).map((c) => '• ' + c.text);
    const transLines = uniq.filter((c) => c.src === 'transcript').slice(0, 12).map((c) => '• ' + c.text);

    switch (styleId) {
      case 'bullets':
        return noteLines.concat(transLines).slice(0, 14).join('\n') || 'No notes yet.';
      case 'action': {
        // Heuristic action detection (own/commit/take/follow up/send/decide + owners).
        const actions = uniq.map((c) => c.text).filter((t) =>
          /\b(we (will|should|need to|'\u00a0)?|will (own|take|send|follow)|let's |decide|commit|next step|follow up|i'll|I'll|i will|assigned)\b/i.test(t) || /^(amit|sarah|you|james?|you):/i.test(t)
        ).slice(0, 8);
        const base = (noteLines.length ? 'Notes:\n' + noteLines.join('\n') : noteLines.join('\n'));
        const act = actions.length ? 'Actions:\n' + actions.map((a) => '• ' + a).join('\n') : '';
        return [base, act].filter(Boolean).join('\n\n') || 'No action items were clearly expressed.';
      }
      case 'concise': {
        const top = uniq.slice(0, 5).map((c) => c.text);
        return top.join(' ') || 'No notes yet.';
      }
      case 'detailed': {
        const heads = noteLines.length ? 'NOTES\n' + noteLines.join('\n') : '';
        const transSec = transLines.length ? 'HIGHLIGHTS\n' + transLines.join('\n') : '';
        return [heads, transSec].filter(Boolean).join('\n\n') || 'No notes yet.';
      }
      case 'executive':
      default: {
        const top = uniq.slice(0, 3).map((c) => c.text);
        return top.join(' ') || 'No notes yet.';
      }
    }
  }

  // ---- AI summary generation (with offline fallback) ----
  // onDone(summaryText) / onFail(errMsg, fallbackSummary). Never throws.
  async function generateSummary(meeting, styleId, onDone, onFail) {
    const style = getStyle(styleId);
    const feed = (meeting.feed || []).map((e) => e.text).filter(Boolean);
    const transcript = (meeting.transcript || [])
      .map((l) => (l.timestamp ? '[' + (l.timestamp.match(/\d{1,2}:\d{2}/)?.[0] || '') + '] ' : '') + (l.speaker || 'Unknown') + ': ' + (l.text || ''))
      .join('\n').slice(0, 24000);
    const source = [
      'Meeting title: ' + (meeting.title || 'Untitled'),
      feed.length ? 'USER NOTES (in chronological order):\n' + feed.map((t) => '• ' + t).join('\n') : '',
      transcript.trim() ? 'TRANSCRIPT:\n' + transcript : ''
    ].filter(Boolean).join('\n\n');

    // Fallback if no AI / no content.
    const fallback = localSummary(meeting, styleId);
    if (!source.trim() || !source.includes('USER NOTES') && !source.includes('TRANSCRIPT')) {
      if (onDone) onDone(fallback);
      return;
    }

    if (!intel || !intel.AI || !intel.AI.configured()) {
      // No provider → deterministic local summary (never fakes AI).
      if (onDone) onDone(fallback);
      return;
    }

    try {
      const content = await intel.AI.__chatRaw({
        system: style.system,
        user: source + '\n\nProduce the summary now in the requested style.'
      }, { timeoutMs: 45000 });
      const cleaned = cleanSummary(content);
      if (cleaned && cleaned.trim()) { if (onDone) onDone(cleaned); return; }
      if (onFail) onFail('AI returned an unusable response.', fallback);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (onFail) onFail(msg, fallback);
    }
  }

  function cleanSummary(text) {
    if (!text) return '';
    let s = String(text).trim();
    s = s.replace(/^```/i, '').replace(/^```(?:text|markdown)?/i, '').replace(/```$/i, '');
    // JSON fence protection
    s = s.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
    return s;
  }

  // Render a serialized feed entry for the UI.
  function feedEntryHtml(entry) {
    return `<div class="nt-entry" data-nid="${entry.id}">
      <span class="nt-clock">${escapeHtml(formatClock(entry.ts))}</span>
      <span class="nt-bullet">•</span>
      <span class="nt-text-holder">${escapeHtml(entry.text)}</span>
      <button class="icon-btn nt-del" data-nid="${entry.id}" title="Delete note" style="width:22px;height:22px">×</button>
    </div>`;
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.CN_NOTES = {
    STYLES, allStyles, getStyle, getStyleChoice, setStyleChoice,
    getFeed, addEntry, updateEntry, removeEntry, clearFeed, isEmpty,
    loadFeed, persistFeed, generateSummary, localSummary, feedEntryHtml,
    formatClock, newId
  };
})();
