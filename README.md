# CodeNotes · a VDX product

Platform-agnostic AI meeting workspace.

**Meet → Capture → Transcribe → Understand → Assist → Remember**

CodeNotes is not a meeting-history browser. It is a meeting workspace: start or connect to a meeting, capture and transcribe it, watch AI notes evolve live, ask questions about it, capture decisions and action items, and walk away with a clean, searchable record — never losing what happened, never taking notes while you're in the meeting.

## Highlights

- **Adapter-based capture architecture.** The UI and intelligence layers never couple to a single meeting source. The same workspace runs on a browser microphone, imported transcript, uploaded recording, a future desktop/extension adapter, or any Whisper-compatible STT host. Capture is never faked — the app shows exactly what is and isn't available.
- **Notes-first workspace.** Live, timestamped notes taker plus a summary you can render in five styles (Executive overview · Bullet highlights · Action-focused · Concise paragraph · Detailed breakdown).
- **Trustworthy AI.** Every prompt enforces a strict no-hallucination policy: use only supplied meeting information, omit anything ambiguous. Never invents names, dates, deadlines, owners, or URLs.
- **BYOK AI provider.** Bring your own OpenAI-compatible endpoint/key. When none is configured, summary generation falls back to an honest deterministic local extractor — no errors, no fabrication.
- **Local Whisper STT.** A lightweight OpenAI-compatible server (`local_stt_server.py`) serves a local faster-whisper model for live transcription. No system ffmpeg required (PyAV decodes audio).
- **Works offline-first.** Versioned local cache, derived-data persistence, manual corrections, pin/hide/reveal, and global search — all local, private by default.
- **Light + dark themes**, VDX branding throughout, responsive desktop layout.

## Run it

```bash
# 1. Start the local Whisper STT server (optional; for live voice transcription)
python local_stt_server.py            # serves on http://localhost:8010

# 2. Serve the app
python -m http.server 8741            # then open http://localhost:8741
```

In **Settings**, set:
- an **AI provider** (OpenAI-compatible endpoint + key + model) to power notes generation and Ask,
- the **STT endpoint** (point at `http://localhost:8010/v1/audio/transcriptions` or any OpenAI-compatible transcription host) for live voice capture.

No provider is required to explore: import a transcript or load the sample meeting and use the offline summary fallback.

## Tests

```bash
node tests/run-tests.js
```

## Project layout

```
index.html               # app shell
css/                     # design system + components (light/dark tokens)
js/modules/
  adapters.js            # capture adapter registry (mic / import / NoteTakerCodes)
  parsers.js             # raw transcript + markdown → normalized meeting
  transcript engine      # normalized events (UI never depends on a provider)
  intelligence.js        # batched live AI, per-meeting race safety, BYOK
  notestaker.js          # timestamped notes feed + summary styles
  wordcorrections.js     # Unicode-safe, case-insensitive, Devanagari-aware
  cache.js               # versioned namespaced local storage
  store.js               # meeting model, grouping, pin/hide, search
  exporter.js            # Markdown / plain text / JSON
  ui.js                  # renderer, keyboard nav, empty states, flows
local_stt_server.py      # OpenAI-compatible Whisper transcription server
tests/                   # node test harness
```

## Privacy

Meeting data is sensitive. CodeNotes keeps everything local by default: transcripts and derived notes live in your browser's storage, the AI provider is one you own, and capture is never silently transmitted anywhere. No analytics. No background uploads.

## License

Private — © Vedaxi FZ-LLC (a VDX product).
