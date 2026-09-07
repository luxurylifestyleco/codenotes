/* ==========================================================================
   CodeNotes · a VDX product — Meeting Intelligence Engine
   Spec §8/§9/§10/§11/§29. Batched & debounced live AI. Per-meeting generation
   counters so stale responses from a switched-away meeting can never overwrite
   the current one (async-race safety). Incremental, replaceable, failure-safe.
   Strict no-hallucination prompt enforcement. BYOK provider.
   ========================================================================== */
(function () {
  'use strict';

  const storeApi = window.CN_STORE || {};

  // ---- Provider config (BYOK, local-only) ----
  const AI = (function () {
    let cfg = {
      endpoint: 'https://api.openai.com/v1/chat/completions',
      key: '',
      model: 'gpt-4o-mini',
      sttEndpoint: '',   // optional Whisper-compatible /v1/audio/transcriptions URL
      sttModel: ''       // optional STT model (default whisper-1)
    };

    function load(saved) {
      if (saved && typeof saved === 'object') {
        if (saved.endpoint) cfg.endpoint = saved.endpoint;
        if (typeof saved.key === 'string') cfg.key = saved.key;
        if (saved.model) cfg.model = saved.model;
        if (saved.sttEndpoint) cfg.sttEndpoint = saved.sttEndpoint;
        if (saved.sttModel) cfg.sttModel = saved.sttModel;
      }
    }
    function get() { return cfg; }
    function setEndpoint(v) { cfg.endpoint = v; persist(); }
    function setKey(v) { cfg.key = v; persist(); }
    function setModel(v) { cfg.model = v; persist(); }
    function setSttEndpoint(v) { cfg.sttEndpoint = v; persist(); }
    function setSttModel(v) { cfg.sttModel = v; persist(); }
    function persist() {
      try {
        const ns = (window.CN_CACHE && window.CN_CACHE.ns) ? window.CN_CACHE.ns('derived') : 'codenotes:derived:';
        localStorage.setItem(ns + 'ai_cfg', JSON.stringify({ endpoint: cfg.endpoint, model: cfg.model, key: cfg.key, sttEndpoint: cfg.sttEndpoint, sttModel: cfg.sttModel }));
      } catch (e) { /* non-fatal */ }
    }
    function configured() { return !!(cfg.endpoint && cfg.key && cfg.model); }
    function sttConfigured() {
      // Whisper can run with just an endpoint + key (model optional — server supplies default).
      return !!(cfg.sttEndpoint && cfg.key) || !!(cfg.endpoint && cfg.key);
    }

    // Resolve the actual /audio/transcriptions URL from config.
    function sttUrl() {
      if (cfg.sttEndpoint) return cfg.sttEndpoint;
      if (/\/chat\/completions/i.test(cfg.endpoint)) {
        return cfg.endpoint.replace(/\/chat\/completions/i, '/audio/transcriptions');
      }
      // Fall back to same host with audio path appended.
      return cfg.endpoint.replace(/\/+$/, '') + '/v1/audio/transcriptions';
    }
    function sttModel() { return cfg.sttModel || 'whisper-1'; }

    // Raw chat completion exposed for the transcript-enhance path (same policy).
    async function __chatRaw(messages, opts) { return chat(messages, opts || {}); }

    return {
      load, get, setEndpoint, setKey, setModel, configured, sttConfigured, sttUrl, sttModel,
      setSttEndpoint, setSttModel, __chatRaw
    };
  })();

  // ---- Strict prompt wrapper — hallucination policy (spec §9) ----
  function buildSystemPrompt(role) {
    const base = [
      'You are the CodeNotes meeting intelligence engine (a VDX product).',
      '',
      'STRICT FACTUAL POLICY — you must OBEY ALL of these:',
      '- Use ONLY the supplied meeting information.',
      '- If information is missing or ambiguous, OMIT it. Never invent names, companies, numbers, dates, deadlines, URLs, decisions, action-item owners, participants, relationships, or commitments.',
      '- Do not infer a participant simply because the conversation makes it seem likely.',
      '- Do not manufacture a URL.',
      '- Do not turn speculation into fact. When uncertain, preserve uncertainty or omit the item.',
      '- Never add a due date unless it is EXPLICITLY stated or reliably available in the transcript.',
      '- Never attach a fact to a speaker who did not say it.'
    ];
    base.push('');
    base.push(role);
    return base.join('\n');
  }

  // Structured extraction prompt (notes). Returns strict JSON.
  const NOTES_PROMPT = buildSystemPrompt(
    'Analyze the meeting transcript. Return ONLY a JSON object with this exact shape (no markdown fences, no commentary):\n' +
    '{"summary":"short executive overview (2-4 sentences)","keyPoints":["..."],"decisions":["..."],"actionItems":[{"owner":"person or null","task":"...","due":"ISO date or null"}],"followUps":["..."],"openQuestions":["..."]}\n' +
    'Respect the factual policy above. Empty arrays when nothing applies.'
  );

  const ASK_PROMPT = buildSystemPrompt(
    'You are answering a question about a specific meeting. Use ONLY that meeting\'s transcript and notes as evidence. ' +
    'Answer the user\'s question directly and concisely. Where your answer rests on a specific transcript moment, ' +
    'cite it inline using the timestamp token [TS=hh:mm] exactly once per cited moment (only if a timestamp exists ' +
    'in the source line — never invent one). If the transcript does not contain an answer, say so plainly. ' +
    'Never use unrelated historical meetings.'
  );

  // ---- JSON resilience ----
  // Tolerates fenced JSON, leading text, trailing commas (spec §24, §40).
  function extractJSON(text) {
    if (!text) return null;
    let s = String(text).trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/i, '');
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    s = s.slice(start, end + 1);
    try { return JSON.parse(s); }
    catch (e) {
      try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } // trailing commas
      catch (e2) { return null; }
    }
  }

  // ---- Chat completion (OpenAI-compatible) ----
  async function chat(messages, { timeoutMs = 30000 } = {}) {
    if (!AI.configured()) {
      throw new Error('AI_NOT_CONFIGURED');
    }
    const c = AI.get();
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    try {
      const res = await fetch(c.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + c.key
        },
        body: JSON.stringify({
          model: c.model,
          messages: [{ role: 'system', content: messages.system }, { role: 'user', content: messages.user }],
          temperature: 0.2,
          response_format: { type: 'json_object' }
        }),
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error('HTTP ' + res.status + (body ? ' — ' + body.slice(0, 200) : ''));
      }
      const data = await res.json();
      const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('EMPTY_RESPONSE');
      return content;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---- Per-meeting generation registry (async-race safety, spec §29) ----
  // Each meeting id owns a counter. Any AI result carries the counter it started with;
  // the store only commits it if the counter still matches (i.e. no newer generation for
  // that meeting has started). Switching meetings never lets a stale finish clobber the
  // currently viewed meeting.
  const Generation = (function () {
    const counters = {};
    function next(id) { counters[id] = (counters[id] || 0) + 1; return counters[id]; }
    function current(id) { return counters[id] || 0; }
    return { next, current };
  })();

  // ---- Transcript-aware chunking (spec §14, ~6000 chars, line boundaries) ----
  function chunkTranscript(transcript, maxChars) {
    const cap = maxChars || 6000;
    const chunks = [];
    let cur = [];
    let curLen = 0;
    for (const line of transcript) {
      const text = (line.speaker ? line.speaker + ': ' : '') + (line.text || '') + '\n';
      if (curLen + text.length > cap && cur.length) {
        chunks.push(cur); cur = []; curLen = 0;
      }
      cur.push(line); curLen += text.length;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  function transcriptText(lines) {
    return lines.map((l) => trimTimestamp(l)).join('\n');
  }
  function trimTimestamp(l) {
    const ts = l.timestamp ? l.timestamp.match(/\d{1,2}:\d{2}/) : null;
    return (ts ? '[' + ts[0] + '] ' : '') + (l.speaker || 'Unknown') + ': ' + (l.text || '');
  }

  // ---- Merge multiple chunk analyses into one stable notes object ----
  function mergeNotes(objs) {
    const acc = { summary: '', keyPoints: [], decisions: [], actionItems: [], followUps: [], openQuestions: [] };
    for (const o of objs) {
      if (!o || typeof o !== 'object') continue;
      if (typeof o.summary === 'string') acc.summary = (acc.summary ? acc.summary + ' ' : '') + o.summary;
      safePush(acc.keyPoints, o.keyPoints);
      safePush(acc.decisions, o.decisions);
      safePush(acc.followUps, o.followUps);
      safePush(acc.openQuestions, o.openQuestions);
      if (Array.isArray(o.actionItems)) {
        for (const ai of o.actionItems) {
          if (!ai || typeof ai !== 'object') continue;
          acc.actionItems.push({
            owner: typeof ai.owner === 'string' && ai.owner !== 'null' ? ai.owner : null,
            task: typeof ai.task === 'string' ? ai.task : '',
            due: typeof ai.due === 'string' && /^\d{4}-\d{2}-\d{2}/.test(ai.due) ? ai.due.slice(0,10) : null
          });
        }
      }
    }
    // dedupe simple string arrays
    for (const k of ['keyPoints', 'decisions', 'followUps', 'openQuestions']) {
      acc[k] = [...new Set(acc[k].filter(Boolean))];
    }
    return acc;
  }
  function safePush(arr, src) {
    if (Array.isArray(src)) for (const x of src) if (typeof x === 'string' && x.trim()) arr.push(x.trim());
  }

  // ---- Live / post intelligence (per meeting) ----
  // onUpdate(notes) fires with validated notes; onError(errStr) on failure.
  async function analyzeMeeting(meeting, onUpdate, onError) {
    const id = meeting.id;
    if (!meeting.transcript || !meeting.transcript.length) { if (onError) onError('NO_TRANSCRIPT'); return; }
    if (!AI.configured()) { if (onError) onError('AI_NOT_CONFIGURED'); return; }

    const gen = Generation.next(id); // this generation owns 'gen'
    const chunks = chunkTranscript(meeting.transcript);
    const results = [];

    try {
      if (chunks.length === 1) {
        const content = await chat({ system: NOTES_PROMPT, user: transcriptText(chunks[0]) });
        const parsed = extractJSON(content);
        if (!parsed || !parsed.keyPoints) throw new Error('INVALID_JSON');
        results.push(parsed);
      } else {
        for (let i = 0; i < chunks.length; i++) {
          const content = await chat({ system: NOTES_PROMPT, user: 'Chunk ' + (i + 1) + '/' + chunks.length + ':\n' + transcriptText(chunks[i]) });
          const parsed = extractJSON(content);
          if (parsed && parsed.keyPoints) results.push(parsed);
        }
      }
      // Commit only if this is still the latest generation for the meeting.
      const merged = mergeNotes(results);
      if (Generation.current(id) === gen) {
        if (onUpdate) onUpdate(merged, id);
      }
    } catch (e) {
      if (Generation.current(id) === gen && onError) onError(String(e && e.message || e));
    }
  }

  // ---- Ask the meeting (per meeting, race-safe) ----
  async function askMeeting(meeting, question, onAnswer, onError) {
    const id = meeting.id;
    if (!AI.configured()) { if (onError) onError('AI_NOT_CONFIGURED'); return; }
    const gen = Generation.next(id); // any new ask or analyze invalidates prior pending
    const context = transcriptText(meeting.transcript || []).slice(0, 24000);
    try {
      const content = await chat({ system: ASK_PROMPT, user: 'Meeting title: ' + (meeting.title || '') + '\n\nTranscript:\n' + context + '\n\nQuestion: ' + question }, { timeoutMs: 45000 });
      if (Generation.current(id) === gen && onAnswer) onAnswer(content);
    } catch (e) {
      if (Generation.current(id) === gen && onError) onError(String(e && e.message || e));
    }
  }

  // ---- Theme suggestion (lazy, cached; spec §18) ----
  // Uses simple lexical heuristics so no AI call is needed; cached per meeting.
  function suggestTheme(meeting) {
    const text = ((meeting.title || '') + ' ' + (meeting.notes && meeting.notes.summary || '') + ' ' +
      (meeting.notes && meeting.notes.keyPoints || []).join(' ')).toLowerCase();
    const map = [
      [/pricing|price|quota|billing/i, 'Pricing'],
      [/design/i, 'Design'],
      [/engineering|code|build|launch|ship/i, 'Engineering'],
      [/roadmap|quarter|q[1-4]|plan/i, 'Planning'],
      [/sales|deal|client|account/i, 'Sales'],
      [/support|bug|issue|fix/i, 'Support'],
      [/hiring|recruit|interview|talent/i, 'People'],
    ];
    for (const [re, label] of map) if (re.test(text)) return label;
    return 'General';
  }
  const themeCache = new Map();
  function getTheme(meeting) {
    if (themeCache.has(meeting.id)) return themeCache.get(meeting.id);
    const t = suggestTheme(meeting);
    themeCache.set(meeting.id, t);
    return t;
  }

  window.CN_INTEL = {
    AI,
    analyzeMeeting,
    askMeeting,
    getTheme,
    extractJSON,
    mergeNotes,
    chunkTranscript,
    transcriptText
  };
})();
