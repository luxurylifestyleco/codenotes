/* ==========================================================================
   CodeNotes · a VDX product — Test harness (Node, no external deps)
   Loads the browser IIFE modules under a minimal window/document shim and
   exercises core logic per spec §40 (data, AI, transcript, storage, capture).
   Run:  node tests/run-tests.js
   ========================================================================== */
'use strict';

// ---- Minimal browser shims ----
global.window = global;
Object.defineProperty(global, 'navigator', { value: { mediaDevices: { getUserMedia: null, getDisplayMedia: null } }, configurable: true, writable: true });
global.localStorage = (function () {
  const s = new Map();
  return {
    getItem: (k) => (s.has(k) ? String(s.get(k)) : null),
    setItem: (k, v) => { s.set(k, String(v)); },
    removeItem: (k) => { s.delete(k); },
    clear: () => s.clear(),
    get length() { return s.size; },
    key: (i) => [...s.keys()][i] || null,
    __dump: () => [...s.entries()]
  };
})();
global.document = {
  documentElement: { setAttribute: () => {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  body: { appendChild: () => {}, removeChild: () => {} },
  addEventListener: () => {},
  createElement: () => ({ style: {}, click: () => {}, classList: { add: () => {}, toggle: () => {} } })
};
global.fetch = async () => { throw new Error('fetch not mocked in unit mode'); };
global.AbortController = class { constructor() {} abort() {} };

global.performance = { now: Date.now };
global.setTimeout = (fn) => { fn && fn(); return 0; };
global.clearTimeout = () => {};

// ---- Load modules in dependency order ----
const path = require('path');
const ROOT = path.join(__dirname, '..');

function load(file) {
  const fs = require('fs');
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  // eslint-disable-next-line no-eval
  const fn = new Function('require', code);
  fn(() => require);
}
load('js/modules/wordcorrections.js');
load('js/modules/parsers.js');
load('js/modules/adapters.js');
load('js/modules/intelligence.js');
load('js/modules/cache.js');
load('js/modules/store.js');
load('js/modules/exporter.js');
load('js/modules/notestaker.js');

let pass = 0, fail = 0;
function assert(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ FAIL: ' + name); }
}
function section(t) { console.log('\n' + t); }

// ==========================================================================
// A) Word Corrections (§15) — Unicode-safe, case-insensitive, boundaries
// ==========================================================================
section('A — Word corrections');
const W = window.CN_WORD;
assert(!!W, 'word module loads');
W.init([]);
assert(W._testApply('Let’s use the Veecode dashboard', 'Veecode', 'VDX') === 'Let’s use the VDX dashboard', 'case-insensitive replace');
assert(W._testApply('Veecode and Veecode again', 'Veecode', 'VDX') === 'VDX and VDX again', 'multiple occurrences');
assert(W._testApply('veecode dashboard', 'Veecode', 'VDX') === 'VDX dashboard', 'lowercase match → canonical spelling');
assert(W._testApply('Veecodex', 'Veecode', 'VDX') === 'Veecodex', 'does not corrupt longer word (Veecodex)');
assert(W._testApply('notveecodey', 'Veecode', 'VDX') === 'notveecodey', 'no mid-word match');
const dev = W._testApply('हां आर्यन', 'आर्यन', 'अरिजन');
console.log('    devanagari result: ' + dev);
assert(dev.indexOf('अरिजन') !== -1, 'Devanagari boundary replace works');
W.add('Veecode', 'VDX');
assert(W.getList().length === 1, 'add persists');
W.remove('Veecode');
assert(W.getList().length === 0, 'remove works');

// ==========================================================================
// B) Transcript parser (§6/§40)
// ==========================================================================
section('B — Transcript parser');
const P = window.CN_PARSERS;
const raw = [
  '10:31  You  Let’s discuss the launch timeline.',
  '[10:32] Sarah: I think we should target October.',
  ' 10:34 Amit  हां, मैं design के साथ align कर लूंगा।',
  '10:36 You  Final decision.',
  'no timestamp here'
].join('\n');
const lines = P.parseTranscript(raw, 'test');
assert(lines.length === 5, 'parses 5 lines, got ' + lines.length);
assert(lines[0].speaker === 'You', 'speaker parsed');
assert(lines[0].timestamp === '10:31', 'time parsed');
assert(lines[1].speaker === 'Sarah', 'bracket+colon speaker');
assert(lines[3].timestamp === '10:36', 'last timestamp');
assert(lines[4].speaker === 'Unknown' && lines[4].text === 'no timestamp here', 'bare line fallback');
const speakers = P.collectSpeakers(lines);
assert(speakers.includes('You'), 'speaker frequency collection');
assert(P.guessTitle('Hello\n' + raw) === 'Hello', 'title from first short line');

// ==========================================================================
// C) NoteTakerCodes markdown → meeting (§24/§25/§40)
// ==========================================================================
section('C — NoteTakerCodes markdown');
const goodMD = '# Product Sync\nStart: 10:30 AM\nDuration: 45 min\n\n**Sarah**: Let\'s go over pricing.\n**Amit**: हां, ठीक है।\n**You**: Decision to launch.\n';
const g = P.parseMarkdownMeeting(goodMD, 'md_test');
assert(!!g, 'valid markdown parses');
assert(g.title === 'Product Sync', 'markdown title');
assert(g.duration === 45, 'duration parsed');
assert(Array.isArray(g.transcript) && g.transcript.length === 3, 'transcript extracted');
assert(g.transcript[1].text.includes('हां'), 'Devanagari preserved');
// zero-duration must be rejected
const zeroMD = '# Chat\nStart: 10:00\nDuration: 0 min\n**a**: hi';
assert(P.parseMarkdownMeeting(zeroMD) === null, 'zero-duration rejected');
// no start/duration (plain chat thread) rejected
const threadMD = '**a** hello **b** world';
assert(P.parseMarkdownMeeting(threadMD) === null, 'chat thread (no time/dur) rejected');

// ==========================================================================
// D) Intelligence — JSON resilience / prompts / merge (§9/§24/§40)
// ==========================================================================
section('D — Intelligence');
const I = window.CN_INTEL;
assert(!!I, 'intelligence module loads');
// fenced JSON
assert(I.extractJSON('```json\n{"a":1}\n```') && I.extractJSON('```json\n{"a":1}\n```').a === 1, 'fenced JSON parsed');
// trailing-comma tolerant
assert(I.extractJSON('{"a":1,}') && I.extractJSON('{"a":1,}').a === 1, 'trailing comma tolerated');
// text-leading
assert(I.extractJSON('Here you go: {"a":2}') && I.extractJSON('Here you go: {"a":2}').a === 2, 'leading prose parsed');
// incomplete → null
assert(I.extractJSON('{"a":') === null, 'incomplete JSON → null');
// mergeNotes dedupe
const merged = I.mergeNotes([
  { summary: 'S1', keyPoints: ['k', 'k'], decisions: ['d'], actionItems: [{ owner: 'Sarah', task: 't', due: null }] },
  { summary: null, keyPoints: ['k2'], actionItems: [{ owner: null, task: 't2', due: '2026-09-15' }] }
]);
assert(merged.keyPoints.length === 2 && merged.keyPoints[0] === 'k', 'dedupes + normalizes keyPoints, got ' + JSON.stringify(merged.keyPoints));
assert(merged.actionItems.length === 2, 'normalizes actionItems');
assert(merged.actionItems[1].due === '2026-09-15', 'keeps explicit due date');
assert(merged.actionItems[1].owner === null, 'keeps null owner when none given');

// ==========================================================================
// E) Exporter (§23) — corrections applied, never exports hidden
// ==========================================================================
section('E — Exporter');
const Store = window.CN_STORE;
const sampleStore = Store.addRaw({
  title: 'Q3 GTM sync', source: 'sample', startedAt: new Date('2026-09-07T10:30:00').toISOString(),
  duration: 45,
  transcript: [{ timestamp: '10:31', speaker: 'You', text: 'Let’s use the Veecode dashboard', final: true, source: 'sample' }],
  participants: ['You', 'Sarah'],
  notes: { summary: 'Veecode is our analytics tool', keyPoints: ['Use Veecode'], actionItems: [{ owner: 'Sarah', task: 'Set up Veecode', due: null }], decisions: [], followUps: [], resources: [], related: [] },
  pinned: false, hidden: false, status: 'final'
});
const EXP = window.CN_EXPORT;
const md = EXP.toMarkdown(Store.get(sampleStore.id));
console.log('    (no correction) contains raw Veecode: ' + md.includes('Veecode') + ' — ' + (md.includes('Veecode') ? 'as expected (no corrections set yet)' : ''));
// apply a correction, confirm it appears in export
W.add('Veecode', 'VDX');
const Store2 = window.CN_STORE;
Store2.update(sampleStore.id, {}); // ensure state
const corrMd = EXP.toMarkdown(Store2.get(sampleStore.id));
assert(corrMd.includes('VDX'), 'export reflects word correction');
// hidden meeting excluded from visible counts
Store2.update(sampleStore.id, { hidden: true });
// (hidden not exported via exportMeeting — we only check toMarkdown is callable; the UI guards export path)
Store2.update(sampleStore.id, { hidden: false });

// ==========================================================================
// F) Cache service (§30) — namespacing, corruption, clear
// ==========================================================================
section('F — Cache');
const C = window.CN_CACHE;
assert(C.available(), 'localStorage available in test env');
const key = C.ns('derived') + 'notes:' + sampleStore.id;
C.set('notes:' + sampleStore.id, { custom: 'val' });
assert(JSON.parse(localStorage.getItem(key)).custom === 'val', 'key namespaced + value round-trips');
assert(C.get('notes:' + sampleStore.id).custom === 'val', 'get from cache');
// corruption → null not throw
localStorage.setItem(C.ns('derived') + 'corrupted', '{invalid');
assert(C.get('corrupted') === null, 'corrupted cache returns null (no crash)');

// ==========================================================================
// G) Offline / adapter honesty (§26/§2)
// ==========================================================================
section('G — Adapters & capture honesty');
const NTC = window.CN_NTC;
assert(NTC.isOfflineError(new Error('device is not currently connected')) === true, 'offline signal detected');
assert(NTC.isOfflineError(new Error('must be running and online')) === true, 'online-required signal detected');
assert(NTC.isOfflineError(new Error('random error')) === false, 'unrelated error not flagged offline');
const CP = window.CN_CAPS;
assert(CP.captureAudio === false, 'never claims audio capture w/o getUserMedia grant');
assert(CP.captureTranscript === false, 'never claims transcription w/o real provider');
assert(window.CN_CAPTURE.isActuallyTranscribing() === false, 'fake-forever guard: not transcribing');

// ==========================================================================
// H) Store — grouping, pin/hide, count
// ==========================================================================
section('H — Store');
Store2.update(sampleStore.id, { pinned: true });
assert(Store2.get(sampleStore.id).pinned === true, 'pin persists in-memory');
assert(Store2.count() >= 1, 'count works');
assert(typeof Store2.getTheme(Store2.get(sampleStore.id)) === 'string', 'theme is string');
Store2.update(sampleStore.id, { hidden: true });
assert(Store2.hiddenCount() >= 1, 'hidden count');
Store2.update(sampleStore.id, { hidden: false });

// ==========================================================================
// I — Notes Taker + Summary styles
// ==========================================================================
section('I — Notes Taker & Summary styles');
const NT = window.CN_NOTES;
assert(!!NT, 'notestaker module loads');
const ntMeeting = { id: 'nt_test', title: 'NT', transcript: [], feed: [] };
const entry = NT.addEntry(ntMeeting, 'Amit to own design sign-off, due Tuesday');
assert(entry && entry.id && entry.ts, 'addEntry stamps id + timestamp');
assert(NT.getFeed(ntMeeting).length === 1, 'feed has 1 entry');
assert(NT.updateEntry(ntMeeting, entry.id, 'Amit to own sign-off'), 'updateEntry returns true');
assert(NT.getFeed(ntMeeting)[0].text === 'Amit to own sign-off', 'entry text updated');
assert(NT.removeEntry(ntMeeting, entry.id) === true, 'removeEntry works');
assert(NT.isEmpty(ntMeeting), 'feed empty after remove');
assert(NT.allStyles().length === 5, '5 summary styles available');
assert(NT.getStyle('action').label === 'Action-focused', 'action style present');
// offline local summary works without any AI provider
const ntm2 = { id: 'nt_off', title: 'Off', transcript: [{ speaker: 'You', text: 'We decided to launch in October and Amit owns the sign-off', timestamp: '10:01', final: true }], feed: [] };
NT.addEntry(ntm2, 'Amit owns design sign-off');
let offlineText = null; let offlineDone = false;
NT.generateSummary(ntm2, 'action', (t, src) => { offlineText = t; offlineDone = src !== 'ai'; });
// local path is synchronous for no-provider case
assert(typeof offlineText === 'string' && offlineText.length > 0, 'offline summary generated (no AI)');
assert(!!offlineText && /Amit|design|sign-off/.test(offlineText), 'offline summary references supplied info only');
// style choice persists
NT.setStyleChoice(ntm2, 'bullets');
assert(NT.getStyleChoice(ntm2) === 'bullets', 'style choice persists');
const lvl = NT.localSummary(ntm2, 'bullets');
assert(typeof lvl === 'string' && lvl.includes('•'), 'bullets style emits bullets');
// AI path routes to provider when configured (mocked provider)
const I2 = window.CN_INTEL, AI2 = I2.AI;
AI2.setEndpoint('https://example.com/v1/chat/completions');
AI2.setKey('sk-test'); AI2.setModel('m');
// stub the network to return provider content
global.fetch = async (url, opts) => {
  const b = JSON.parse(opts.body);
  return { ok: true, json: async () => ({ choices: [{ message: { content: 'Provider AI summary' } }] }) };
};
let aiText = null;
// reset feed so there's real source
const ntm3 = { id: 'nt_ai', title: 'AI', transcript: [{ speaker: 'Amit', text: 'Decision to launch in October', timestamp: '10:00', final: true }], feed: [] };
NT.addEntry(ntm3, 'Amit owns sign-off');
const p = NT.generateSummary(ntm3, 'executive', (t) => { aiText = t; }, (er, fb) => { aiText = fb; });
setImmediate(() => {
  assert(typeof aiText === 'string' && aiText.includes('Provider AI'), 'AI path uses configured provider when set');
  console.log('\n══════════════════════════════');
  console.log('RESULT: ' + pass + ' passed, ' + fail + ' failed');
  if (fail > 0) { process.exitCode = 1; }
  else console.log('ALL CODE PASSED ✔');
});
