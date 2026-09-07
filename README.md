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

## What is CodeNotes, and how do you run it?

CodeNotes is a **web app that runs entirely in the Chrome browser**. There is nothing to install, no compiler, and no LLM to run: every feature — capture → live transcript → notes taker → summaries → search → export — is client-side JavaScript that computes in the browser. It works offline and stores everything locally.

### Start it (one click)

On Windows, double-click **`CodeNotes.bat`**:
- it starts the local web server and opens **<http://localhost:8741>** in your default browser,
- if the optional live-voice helper is installed, it starts that too.

Alternatively run the two commands:
```bash
python -m http.server 8741           # serve the app, then open http://localhost:8741
python local_stt_server.py           # optional: local Whisper for live voice on :8010
```

### The two optional "AI" pieces — bring your own, nothing to install on their side

1. **Notes / Ask / summaries AI** — the user pastes an **OpenAI-compatible endpoint + key + model** into Settings once. The browser calls *their* endpoint directly. No account, no separate app. Without it, summaries still work via the honest offline local extractor.
2. **Live voice transcription** — the user points Settings → STT endpoint at the local Whisper helper (`http://localhost:8010/v1/audio/transcriptions`). Without it, meetings still work end-to-end via imported transcripts.

There is **no LM to execute** for the person using CodeNotes. The AI they see is either their own BYOK endpoint or the local offline engine.

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
