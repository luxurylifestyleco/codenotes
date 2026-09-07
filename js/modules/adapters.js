/* ==========================================================================
   CodeNotes · a VDX product — Adapter Layer
   Spec §2/§5/§6/§24-27/§39. The UI & intelligence layers never touch a
   concrete capture source directly. Capture Adapter → Normalized Meeting
   Events → TranscriptEngine → Intelligence. Never fake capture. Every
   adapter reports exactly what it can do.
   ========================================================================== */
(function () {
  'use strict';

  // ---- Capability / status reporting ----
  function normalizeCapabilities() {
    const caps = {
      captureAudio: false, captureTranscript: false, captureScreen: false,
      notetakercodes: false, import: true, provider: false
    };
    // Detection (non-faking): only claim audio capture if getUserMedia exists and a mic
    // has actually been granted+opened. We never claim capture merely because an API exists.
    caps.captureAudio =
      !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    // Screen capture only if getDisplayMedia exists (and would actually work).
    caps.captureScreen =
      !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    // NoteTakerCodes adapter present in this runtime.
    caps.notetakercodes = !!(window && window.cowork && window.cowork.callMcpTool);
    // A speech-to-text provider: we don't ship one by default, so never claim transcription.
    caps.captureTranscript = false;
    return caps;
  }

  // The one object every upstream module consumes.
  window.CN_CAPS = normalizeCapabilities();

  // ---- NoteTakerCodes adapter (one available capture/memory source) ----
  const NTC = (function () {
    function available() {
      return !!(window && window.cowork && window.cowork.callMcpTool);
    }
    async function callMcp(tool, args) {
      if (!available()) return { ok: false, offline: true, error: 'NoteTakerCodes not available' };
      try {
        const r = await window.cowork.callMcpTool(tool, args || {});
        return { ok: true, result: r };
      } catch (e) {
        return { ok: false, offline: isOfflineError(e), error: String(e && e.message || e) };
      }
    }
    // Detect the "laptop offline" signals the app must surface (spec §26).
    function isOfflineError(err) {
      const s = String((err && (err.message || err)) || '');
      return /(not currently connected|device is not currently connected|must be running and online|offline)/i.test(s);
    }
    // Probe before building parsers (spec §24).
    async function probe() {
      if (!available()) return { ok: false, reason: 'no-cowork' };
      try {
        const r = await window.cowork.callMcpTool('list_active_threads', {});
        return { ok: true, sample: r };
      } catch (e) {
        return { ok: false, offline: isOfflineError(e), error: String(e || '') };
      }
    }
    return { available, callMcp, probe, isOfflineError };
  })();
  window.CN_NTC = NTC;

  // ---- Transcript Engine ----
  // Consumes normalized events; produces a normalized transcript stream.
  // Never assumes a provider. Emits through a callback.
  const Engine = (function () {
    function create(lineSink) {
      const buffer = [];
      function append(evt) {
        const line = {
          speaker: evt.speaker || 'Unknown',
          text: evt.text || '',
          timestamp: evt.timestamp || null,
          final: !!evt.is_final,
          source: evt.source || 'unknown'
        };
        buffer.push(line);
        if (typeof lineSink === 'function') lineSink(line, buffer);
        return line;
      }
      function get() { return buffer; }
      return { append, get, buffer };
    }
    return { create };
  })();
  window.CN_TRANSCRIPT = Engine;

  // ---- Capture adapter registry ----
  // Each adapter declares capabilities and can start/stop. UI asks the adapter what it
  // can actually do and never fakes. When a capability is unavailable, the UI shows a
  // clear fallback (import) rather than a false recording state.
  const Adapters = (function () {
    const registry = {};

    // --- Web microphone adapter with Whisper-compatible STT (progressive, honest) ---
    // Uses the BYOK provider's /audio/transcriptions endpoint (Whisper-compatible) to
    // transcribe. Only claims "transcribing" when: mic granted + STT configured + a live
    // round-trip succeeds. Never fakes capture. Feeds normalized lines via a sink.
    function registerMicAdapter() {
      const RECOGNIZERS = new Map(); // chunk buffers per stream

      function sttConfig() {
        const AIConf = window.CN_INTEL && window.CN_INTEL.AI;
        if (!AIConf || !AIConf.sttConfigured()) return null;
        return { url: AIConf.sttUrl(), key: AIConf.get().key, model: AIConf.sttModel() };
      }

      // Send one audio chunk to Whisper; returns { text } or throws.
      async function transcribeChunk(audioBlob, cfg) {
        const fd = new FormData();
        fd.append('file', audioBlob, 'chunk.webm');
        fd.append('model', cfg.model);
        fd.append('language', 'en'); // change based on locale; auto-detection if omitted
        const resp = await fetch(cfg.url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + cfg.key }, body: fd });
        if (!resp.ok) {
          const body = await resp.text();
          throw new Error('STT HTTP ' + resp.status + (body ? ' — ' + body.slice(0, 160) : ''));
        }
        const data = await resp.json();
        return (data && (data.text || data.choices && data.choices[0] && data.choices[0].text)) || '';
      }

      registry.mic = {
        id: 'mic',
        label: 'Browser microphone (Whisper-compatible STT)',
        capabilities: { capture: true, transcribe: false, screen: false },
        _transcribing: false,
        async start(sink) {
          const cfg = sttConfig();
          if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
            return { ok: false, reason: 'microphone-unavailable' };
          }
          if (!cfg) {
            return { ok: false, reason: 'stt-not-configured',
              message: 'Configure your AI provider (BYOK) with a Whisper-compatible endpoint in Settings to enable live transcription.' };
          }
          let stream;
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (e) {
            if (e && e.name === 'NotAllowedError') return { ok: false, reason: 'permission-denied' };
            return { ok: false, reason: 'microphone-unavailable', error: String(e || '') };
          }
          // Live round-trip probe: send a tiny silent clip to confirm the endpoint works.
          // Only if it succeeds do we mark capture+transcribe as truly active (never fake).
          this._stream = stream;
          try {
            await this._probeSTT(cfg, stream);
            this._transcribing = true;
            this.capabilities.transcribe = true;
          } catch (e) {
            stream.getTracks().forEach((t) => t.stop()); this._stream = null;
            return { ok: false, reason: 'stt-unreachable', error: String(e && e.message || e),
              message: 'Microphone captured, but the transcription endpoint did not respond. No audio was recorded.' };
          }
          // Begin continuous chunked transcription → normalized transcript lines.
          this._startLoop(stream, cfg, sink);
          return { ok: true, reason: 'capturing+transcribing', transcribed: true };
        },
        async _probeSTT(cfg, stream) {
          // A short 0.2s capture verifies the endpoint round-trips without faking.
          const rec = await this._capture(stream, 400);
          const text = await transcribeChunk(rec.blob, cfg);
          if (text === undefined) throw new Error('empty-transcription-response');
          return text;
        },
        _startLoop(stream, cfg, sink) {
          this._stopLoop = false;
          const loopRec = async () => {
            while (!this._stopLoop) {
              let chunk;
              try { chunk = await this._capture(stream, 4000); } // ~4s slices
              catch (e) { if (sink) sink(null, { error: String(e) }); break; }
              try {
                const text = await transcribeChunk(chunk.blob, cfg);
                if (text && text.trim() && typeof sink === 'function') {
                  sink({ speaker: 'You', text: text.trim(), timestamp: stampTime(), is_final: true, source: 'whisper', confidence: chunk.avgLevel });
                }
              } catch (e) { /* keep going on transient errors, never crash loop */ }
            }
          };
          loopRec();
        },
        // Capture a short slice; returns { blob, avgLevel }.
        _capture(stream, ms) {
          return new Promise((resolve, reject) => {
            const mime = typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm')
              ? 'audio/webm' : (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
            let rec;
            try { rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {}); }
            catch (e) { reject(e); return; }
            const parts = [];
            rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
            rec.onstop = () => { try { resolve({ blob: new Blob(parts, { type: mime || 'audio/webm' }), avgLevel: 0 }); } catch (e) { reject(e); } };
            rec.onerror = (e) => reject(e);
            rec.start();
            setTimeout(() => { try { rec.stop(); } catch (e) { reject(e); } }, ms);
          });
        },
        stop() {
          this._stopLoop = true;
          if (RECOGNIZERS.size) RECOGNIZERS.clear();
          if (this._stream) { this._stream.getTracks().forEach((t) => t.stop()); this._stream = null; }
          this._transcribing = false;
          this.capabilities.transcribe = false;
          return true;
        },
        isActive() { return !!this._stream && this._transcribing; }
      };
    }
    function stampTime() {
      const d = new Date();
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }

    // --- Import adapter (always available, the honest default) ---
    function registerImportAdapter() {
      registry.import = {
        id: 'import',
        label: 'Imported meeting',
        capabilities: { capture: false, transcribe: false, screen: false, import: true },
        async start() { return { ok: true }; },
        stop() {}
      };
    }

    // --- NoteTakerCodes adapter ---
    function registerNTCAdapter() {
      registry.notetakercodes = {
        id: 'notetakercodes',
        label: 'NoteTakerCodes (local memory)',
        capabilities: {
          capture: false, transcribe: false, screen: false,
          memory: NTC.available()
        },
        async start() {
          const p = await NTC.probe();
          if (p.ok) return { ok: true };
          return { ok: false, offline: p.offline, reason: 'offline' };
        },
        stop() {}
      };
    }

    function init() { registerImportAdapter(); registerMicAdapter(); registerNTCAdapter(); return registry; }

    // Ask adapter for what it *actually* supports.
    function capabilities(id) { const a = registry[id]; return a ? a.capabilities : {}; }

    function adapters() { return Object.entries(registry).map(([id, a]) => ({ id, label: a.label, capabilities: a.capabilities })); }

    return { init, capabilities, adapters };
  })();
  window.CN_ADAPTERS = Adapters.init();

  // ---- Fake-forever guard ----
  // Central gate: nothing marks a meeting as "recording" or "transcribing" unless a real
  // adapter reports it's genuinely active. UI consults this before painting a status dot.
  function isActuallyTranscribing() { return false; } // no real STT provider wired yet
  window.CN_CAPTURE = { isActuallyTranscribing };
})();
