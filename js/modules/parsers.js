/* ==========================================================================
   CodeNotes · a VDX product — Transcript & Markdown Parsers
   Spec §24/§25 (NoteTakerCodes markdown, defensive parsing), §40 (validation).
   Produces normalized {speaker, text, timestamp, final, source} lines and
   Meeting records.
   ========================================================================== */
(function () {
  'use strict';

  // ---- Raw transcript parser ----
  // Supports:
  //   "10:31  You  Let's discuss…"
  //   "[10:31] You: Let's discuss…"
  //   "Time  Speaker  Text" lines where Time is hh:mm(:ss) or plain mm:ss.
  function parseTranscript(text, source) {
    if (!text) return [];
    const lines = [];
    const raw = String(text).split(/\r?\n/);
    // Regex: optional bracketed time, THEN a single-word speaker label (no internal
    // spaces — prevents the label from swallowing the speech text), optional colon,
    // then the rest is the spoken text. Devanagari letters allowed in the label.
    const lineRe = /^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s*(\[?[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F.'-]*\]?):?\s?(.*)$/i;
    const hourMinutes = /^\((\d{1,2})h\s*\d{2}m\)/i; // "(1h 24m)"

    for (const line of raw) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const m = trimmed.match(lineRe);
      if (!m) {
        // Fallback: if it starts with an hour like "(10:31)" then speaker defaults to unknown.
        const hm = trimmed.match(/^\((\d{1,2}):(\d{2})\)\s*(.+)/);
        if (hm) {
          lines.push({ speaker: 'Unknown', text: hm[3], timestamp: hm[1] + ':' + hm[2], final: true, source });
          continue;
        }
        // Plain line → treat whole line as speech with no timestamp.
        lines.push({ speaker: 'Unknown', text: trimmed, timestamp: null, final: true, source });
        continue;
      }
      const [, hh, mm, ss, speakerRaw, rest] = m;
      const speaker = speakerRaw.replace(/^\[|\]$/g, '').replace(/:$/, '').trim() || 'Unknown';
      const timestamp = hh.length === 2 && Number(hh) >= 0 && Number(hh) <= 23
        ? hh + ':' + mm + (ss ? ':' + ss : '')
        : mm + ':' + (ss || '00'); // treat as mm:ss when hh looks like minutes
      lines.push({ speaker, text: (rest || '').trim(), timestamp, final: true, source });
    }
    return lines;
  }

  // ---- Meeting info from raw text (title/participants heuristics) ----
  function guessTitle(text, fallback) {
    // Prefer a first non-empty line that's short and not a timestamped speech.
    for (const line of String(text || '').split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      if (/^\d{1,2}:\d{2}/.test(t)) continue;
      if (t.length < 90 && !/^(Meeting|Notes|Transcript)/i.test(t)) return t;
    }
    return fallback || 'Imported meeting';
  }

  function collectSpeakers(transcriptLines) {
    const s = new Map();
    for (const l of transcriptLines) {
      if (!l.speaker || l.speaker === 'Unknown') continue;
      const count = (s.get(l.speaker) || 0) + 1;
      s.set(l.speaker, count);
    }
    // Sort by frequency desc.
    return [...s.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }

  // ---- NoteTakerCodes markdown → Meeting record ----
  // Parses defensive markdown. Returns null if unusable. Validates start + duration.
  // Excludes plain chat threads or zero-minute recordings.
  function parseMarkdownMeeting(raw, idHint) {
    try {
      const text = String(raw || '');
      if (!text.trim()) return null;
      const lower = text.toLowerCase();

      // Heuristic exclusion: chat threads usually have no start time & no duration.
      const startRe = text.match(/(?:start|start time|time|began)\s*[:\-]?\s*([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
      const durRe = text.match(/(?:duration|length|lasted)\s*[:\-]?\s*([0-9]+(?:\.[0-9]+)?)\s*(min|m|hr|h|second|sec|s)/i);
      const hasStart = !!startRe;
      const hasDur = !!durRe;
      // Zero-duration: "0 minutes" or "00:00" style duration.
      let durationMin = null;
      if (durRe) {
        const val = parseFloat(durRe[1]);
        const unit = durRe[2];
        durationMin = unit === 'h' || unit === 'hr' ? val * 60
          : unit === 'second' || unit === 'sec' || unit === 's' ? val / 60
          : val; // minutes
      }
      // Require both start time and non-zero duration (spec §25).
      if (!hasStart || !hasDur || durationMin === null || durationMin <= 0) {
        return null;
      }

      // Title: first heading # or the first bolded line.
      let title = text.match(/^#\s+(.+)$/m) || text.match(/\*\*(.+?)\*\*/);
      title = title ? (title[1] || '').trim() : 'NoteTakerCodes meeting';

      // Speaker detection: lines like "**Name**: text" or "Name: text".
      const speakers = new Map();
      const speakerRe = /\*\*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .'-]{0,40})\*\*\s*[:：]\s*/gi;
      let sm;
      while ((sm = speakerRe.exec(text)) !== null) {
        speakers.set(sm[1], (speakers.get(sm[1]) || 0) + 1);
      }
      const participantList = [...speakers.keys()];

      // Extract transcript lines from markdown (speaker-prefixed lines).
      const lines = [];
      const bodyLines = text.split(/\r?\n/);
      for (const bl of bodyLines) {
        const t = bl.trim();
        if (!t) continue;
        const sp = t.match(/^\*\*([A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .'-]{0,40})\*\*\s*[:：]\s*(.+)$/i);
        if (sp) lines.push({ speaker: sp[1], text: sp[2], timestamp: null, final: true, source: 'notetakercodes' });
      }

      // Derive startedAt from start match (today, if no date).
      const now = new Date();
      let startedAt = null;
      if (startRe) {
        let hm = startRe[1].trim().toLowerCase();
        let hour = parseInt(hm, 10);
        const mm = parseInt(hm.split(':')[1] || '0', 10);
        if (hm.includes('pm') && hour < 12) hour += 12;
        if (hm.includes('am') && hour === 12) hour = 0;
        const d = new Date(now);
        d.setHours(hour, mm, 0, 0);
        startedAt = d.toISOString();
      }
      const endedAt = startedAt && durationMin
        ? new Date(new Date(startedAt).getTime() + durationMin * 60000).toISOString()
        : null;

      return {
        id: idHint || 'md_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        title,
        source: 'notetakercodes',
        startedAt,
        endedAt,
        duration: durationMin, // minutes
        participants: participantList,
        transcript: lines,
        screenContext: [],
        notes: { summary: '', keyPoints: [], actionItems: [], decisions: [], followUps: [], resources: [], related: [] },
        status: 'final',
        pinned: false,
        hidden: false
      };
    } catch (e) {
      return null;
    }
  }

  window.CN_PARSERS = {
    parseTranscript,
    guessTitle,
    collectSpeakers,
    parseMarkdownMeeting
  };
})();
