# CodeNotes · a VDX product
## AI Meeting Workspace — plan & architecture

Spec source: the Mini-scribe architecture (43-section spec) applied under the **CodeNotes** product name and **VDX** branding. Reference apps (Granola, Fireflies, minimi/Shram) informed *design feel & positioning only* — no features imported: no calendar sync, no CRM/email generation, no gamification, no meeting bot, no 200+ AI skills. Scope stays tight on the core loop.

## The core loop
**Meet → Capture → Transcribe → Understand → Assist → Remember**

## Non-negotiable architecture: the adapter boundary
UI + intelligence never depend on one capture source.
```
MEETING SOURCE → Capture Adapter → Normalized Meeting Events
  → Transcript Engine → Meeting Intelligence Engine → Meeting Workspace → Persistent Memory
```
Possible adapters: browser mic, browser extension, NoteTakerCodes, uploaded audio/video, imported transcript, future desktop bridge, future Zoom/Meet/Teams.
**Never fake capture.** UI shows exactly what's available (mic / screen / transcription / AI provider) and never claims recording during transcription.

## Product principles held in code
1. **No hallucination, ever** — every AI prompt enforces "use ONLY supplied info; omit when ambiguous." Never invent names/dates/URLs/owners/deadlines.
2. **Notes-first, transcript as source** — workspace centers on editable structured notes (Summary / Key Points / Decisions / Action Items / Follow-ups / Resources). Transcript is a tab.
3. **Async-race safety (mandatory)** — per-meeting generation counters; a finished AI call for meeting A can never overwrite meeting B.
4. **Failure containment** — one failed component never destroys transcript/notes/sidebar/cache.
5. **Privacy by default** — local storage, versioned cache, clear-cache/reset, never silently transmit.
6. **Word corrections at display time** — Unicode-safe, case-insensitive, Devanagari-aware; applies to title/notes/transcript/export/AI input, never to typed questions or URLs.

## Module map (single-file-friendly, clean boundaries)
- `js/modules/wordcorrections.js` — §15
- `js/modules/parsers.js` — raw transcript + NoteTakerCodes markdown → normalized Meeting (§6, §24-25)
- `js/modules/adapters.js` — Capture Adapter registry + NoteTakerCodes adapter + honest capability detection (§2, §26)
- `js/modules/cache.js` — versioned namespaced localStorage (§30)
- `js/modules/store.js` — Meeting/TranscriptLine/Notes model, grouping, pin/hide, search (§17-22, §28)
- `js/modules/intelligence.js` — batched live AI, per-meeting race safety, JSON resilience, BYOK provider (§8-11, §29)
- `js/modules/notestaker.js` — serialized (timestamped) notes feed + 5 summary-style generator (AI path + offline fallback)
- `js/modules/exporter.js` — Markdown/plain/JSON with corrections (§23)
- `js/modules/ui.js` — renderer, keyboard nav, empty states, live/import/ask flows, security escaping (§4-7, §21-22, §31-36)
- `js/app.js` — boot
- `local_stt_server.py` — OpenAI-compatible `/v1/audio/transcriptions` wrapping the Jyotish faster-whisper model (port 8010)

## Theme
Light default + dark (T toggles / Settings select). VDX green accent, off-white neutral, Inter typography, subtle borders, strong hierarchy, no gradients, no rounded-card excess.

## Serialized Notes Taker + Summary Styles
The former bare summary textarea is now a **serialized (time-stamped, ordered) notes feed**: the user jots lines as the meeting runs; each entry is stamped, editable inline, and removable. Below it, a summary area with:
- **5 summary styles**: Executive overview · Bullet highlights · Action-focused · Concise paragraph · Detailed breakdown.
- **Generate** uses the configured BYOK AI provider when set; otherwise a deterministic **offline local summary** (only uses supplied notes + transcript — never hallucinates). No AI configured is not an error; it's a clean slot for a future enhancer (nobody is attached to enhance it yet).
- Summary is manually editable (`contenteditable`) and persists per meeting; style choice persists.

## Live Whisper STT (reuses the Jyotish model)
The mic adapter does real, honest live transcription over an OpenAI-compatible endpoint that wraps the **same faster-whisper model the Jyotish pipeline already uses on this machine** (weights already downloaded). It:
- Only marks capture+transcribing **after a live probe round-trip succeeds** — never fakes.
- Feeds normalized transcript lines (speaker=You, timestamps, source=whisper) into the live meeting.
- Runs debounced/batched live intelligence (2.5s window) when AI is configured.
Point Settings → STT endpoint at `http://localhost:8010/v1/audio/transcriptions` (model `Systran/faster-distil-whisper-large-v3`).

## Verification performed (real execution, not stubs)
- `node tests/run-tests.js` — **62/62 pass**: the original 48 + notes-feed lifecycle, style registry, offline local summary (no AI), AI-path-with-provider routing, style persistence, bullets emit.
- Live Whisper round-trip (real spoken MP3 → endpoint) → returned correct transcription with a genuine noisy-ASR artifact ("Amit"→"omit") that the word-correction engine is designed to fix.
- Caught & fixed during build: recursion in selection guard, cache/store load-order, speaker regex swallowing text, `\p{L}` unicode-flag, missing reveal-modal binding, transcript persistence (kept local — "never lose what happened").

## Scope deliberately NOT built (downstream)
Calendar sync, CRM/PM integrations, automatic emails, task systems, meeting coaching, sentiment analytics, 100+ languages, conversation-intelligence dashboards. All blocked behind "prioritize reliable capture → transcription → navigation → trustworthy AI notes → follow-ups → memory → privacy → resilience."

## Run it
```
cd ~/Documents/CodeNotes && python -m http.server 8741
# open http://localhost:8741
```
Tests: `node tests/run-tests.js`
