/* ==========================================================================
   CodeNotes · a VDX product — UI Renderer
   Spec §4-§7, §16, §21-§22, §31-§32, §35-§36. Renders sidebar + workspace,
   wires interactions, keyboard navigation, live meeting flow, empty states.
   ========================================================================== */
(function () {
  'use strict';

  const store = window.CN_STORE;
  const cache = window.CN_CACHE;
  const intel = window.CN_INTEL;
  const caps = window.CN_CAPS;
  const parsers = window.CN_PARSERS;
  const exportApi = window.CN_EXPORT;

  // ---- Element refs ----
  let el = {};
  function q(s) { return document.querySelector(s); }

  function initRefs() {
    el = {
      meetingList: q('#meetingList'),
      hiddenFooter: q('#hiddenFooter'),
      hiddenCountLabel: q('#hiddenCountLabel'),
      showHiddenBtn: q('#showHiddenBtn'),
      mainScroll: q('#mainScroll'),
      statusPill: q('#statusPill'),
      statusText: q('#statusText'),
      themeToggle: q('#themeToggle'),
      themeSelect: q('#themeSelect'),
      settingsBtn: q('#settingsBtn'),
      settingsModal: q('#settingsModal'),
      settingsDoneBtn: q('#settingsDoneBtn'),
      aiEndpoint: q('#aiEndpoint'),
      aiKey: q('#aiKey'),
      aiModel: q('#aiModel'),
      aiSttEndpoint: q('#aiSttEndpoint'),
      aiSttModel: q('#aiSttModel'),
      aiProviderState: q('#aiProviderState'),
      aiProviderStateText: q('#aiProviderStateText'),
      clearCacheBtn: q('#clearCacheBtn'),
      resetBtn: q('#resetBtn'),
      globalSearchInput: q('#globalSearchInput'),
      searchResults: q('#searchResults'),
      importModal: q('#importModal'),
      newMeetingBtn: q('#newMeetingBtn'),
      importZone: q('#importZone'),
      importPaste: q('#importPaste'),
      importTitleInput: q('#importTitleInput'),
      importFeedback: q('#importFeedback'),
      cancelImportBtn: q('#cancelImportBtn'),
      confirmImportBtn: q('#confirmImportBtn'),
      loadSampleBtn: q('#loadSampleBtn'),
      revealModal: q('#revealModal'),
      revealList: q('#revealList'),
      revealAllHidden: q('#revealAllHidden'),
      toastWrap: q('#toastWrap'),
      groupTabs: [...document.querySelectorAll('.group-tab')],
      fileInput: null
    };
  }

  // ---- Toast ----
  function toast(message, type) {
    const n = document.createElement('div');
    n.className = 'toast' + (type ? ' ' + type : '');
    n.innerHTML = `<span class="t-ico">${type === 'error' ? '✕' : type === 'ok' ? '✓' : '•'}</span><span>${escapeHtml(message)}</span>`;
    el.toastWrap.appendChild(n);
    setTimeout(() => n.remove(), 3200);
  }

  // ---- Escape HTML (security §33) ----
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  window.__cnEscape = escapeHtml;

  // ---- Inline SVG icons (category 4: SVG, not emoji) ----
  const ICONS = {
    pin: '<svg class="pi" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.5 1.5 14.5 6.5 12 7 9 11 6 8 2 11 5 8 2 5 6 4z" transform="rotate(45 8 8)"/></svg>',
    edit: '<svg class="ico-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M11 2.5 13.5 5 5.5 13H3v-2.5z"/></svg>',
    generate: '<svg class="ico-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 2 9.2 6.8 14 8 9.2 9.2 8 14 6.8 9.2 2 8 6.8 6.8z"/></svg>',
    enhance: '<svg class="ico-svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M6 2.5 7 5.5 10 6.5 7 7.5 6 10.5 5 7.5 2 6.5 5 5.5z"/></svg>'
  };
  function ic(name) { return ICONS[name] || ''; }

  // ---- Theme ----
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('codenotes:pref:theme', theme);
    if (el.themeSelect) el.themeSelect.value = theme;
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    applyTheme(cur === 'dark' ? 'light' : 'dark');
  }

  // ---- Status pill (spec §31) ----
  function setStatus(state, text) {
    if (!el.statusPill) return;
    el.statusPill.className = 'status-pill ' + (state || 'idle');
    el.statusText.textContent = text || 'Ready';
  }

  // ---- Sidebar rendering ----
  function renderSidebar() {
    const mt = el.meetingList;
    const all = store.all().filter((m) => !m.hidden);
    const visible = all;
    const hidden = store.hiddenCount();
    el.hiddenFooter.style.display = hidden > 0 ? 'block' : 'none';
    if (hidden > 0) el.hiddenCountLabel.textContent = String(hidden);
    if (el.showHiddenBtn) el.showHiddenBtn.textContent = hidden + ' hidden';
    if (el.showHiddenBtn) el.showHiddenBtn.onclick = openRevealModal;

    if (!all.length) {
      mt.innerHTML = `<div class="sidebar-empty"><div class="big">No meetings yet</div>
        <p>Import a transcript or start a new meeting to begin.<br>Your first CodeNotes workspace awaits.</p></div>`;
      return;
    }

    const groups = buildGroups(all);
    let html = '';
    for (const [label, items] of groups) {
      html += `<div class="list-group"><div class="list-group-label">${escapeHtml(label)}</div>`;
      for (const m of items) {
        const active = m.id === (store.getSelected() && store.getSelected().id);
        const pin = m.pinned ? '<svg class="pi" viewBox="0 0 24 24" fill="currentColor"><path d="M16 3l5 5-6 2-3 7-3-3-7 3 3-7 4-3z" opacity=".9"/></svg>' : '';
        const date = m.startedAt ? new Date(m.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
        const who = (m.participants && m.participants.length ? m.participants.slice(0, 2).join(', ') : '');
        html += `<div class="meeting-item${active ? ' active' : ''}${m.pinned ? ' pinned' : ''}" data-id="${escapeHtml(m.id)}">
          <div class="mi-title">${pin}${escapeHtml(m.title || 'Untitled')}</div>
          <div class="mi-meta">${date}${who ? '<span class="mi-dot"></span>' + escapeHtml(who) : ''}</div>
        </div>`;
      }
      html += '</div>';
    }
    mt.innerHTML = html;
    // wire click
    mt.querySelectorAll('.meeting-item').forEach((item) => {
      item.addEventListener('click', () => selectMeeting(item.dataset.id));
    });
  }

  function buildGroups(items) {
    const mode = store._groupMode; // exposed setter below
    const groups = [];
    const map = new Map();
    if (mode === 'date') {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const yesterday = today - 86400000;
      for (const m of items) {
        const d = m.startedAt ? new Date(m.startedAt) : now;
        const ts = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        let key = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        if (ts === today) key = 'Today';
        else if (ts === yesterday) key = 'Yesterday';
        if (!map.has(key)) { map.set(key, []); groups.push([key, map.get(key)]); }
        map.get(key).push(m);
      }
    } else if (mode === 'people') {
      for (const m of items) {
        const people = (m.participants && m.participants.length) ? m.participants.join(', ') : 'No people';
        if (!map.has(people)) { map.set(people, []); groups.push([people, map.get(people)]); }
        map.get(people).push(m);
      }
    } else if (mode === 'app') {
      for (const m of items) {
        const app = m.source || 'Unknown';
        if (!map.has(app)) { map.set(app, []); groups.push([app, map.get(app)]); }
        map.get(app).push(m);
      }
    } else if (mode === 'theme') {
      for (const m of items) {
        const t = store.getTheme(m);
        if (!map.has(t)) { map.set(t, []); groups.push([t, map.get(t)]); }
        map.get(t).push(m);
      }
    }
    // Pinned first within any view.
    for (const [, arr] of map) arr.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    return groups;
  }

  // ---- Workspace rendering ----
  function renderWorkspace() {
    const sel = store.getSelected();
    if (!sel) { renderEmptyWorkspace(); return; }
    renderMeeting(sel);
  }

  function renderEmptyWorkspace() {
    el.mainScroll.innerHTML = `
      <div class="empty" style="min-height:60vh">
        <div class="e-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v12M12 3L8 7M12 3l4 4"/></svg>
        </div>
        <h3>No meeting selected</h3>
        <p>Choose a meeting from the list, import a new one, or start a fresh meeting to see your AI workspace here.</p>
        <div class="e-cta"><button class="btn primary" id="emptyNewBtn">Start a meeting</button></div>
      </div>`;
    const b = q('#emptyNewBtn'); if (b) b.onclick = () => newMeeting();
  }

  function renderMeeting(m) {
    const status = m.status === 'live' ? '<span class="live-dot"></span>' : '';
    const who = (m.participants && m.participants.length) ? m.participants.join(' · ') : 'No participants';
    const date = m.startedAt ? new Date(m.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const duration = m.duration ? m.duration + ' min' : (m.endedAt && m.startedAt ? Math.round((new Date(m.endedAt) - new Date(m.startedAt)) / 60000) + ' min' : 'In progress');
    const elapsed = m.startedAt && m.status === 'live' ? elapsedSince(m.startedAt) : duration;

    const html = `
      <div class="meeting-head">
        <div class="meeting-head-row">
          <div style="flex:1">
            <div class="mh-title"><input id="meetingTitleInput" value="${escapeHtml(m.title || '')}" aria-label="Meeting title" spellcheck="false"/>${m.pinned ? `<span class="pin-badge">${ic('pin')}</span>` : ''}</div>
            <div class="mh-meta">With: ${escapeHtml(who)} <span class="sep">·</span> ${escapeHtml(date)} ${status}</div>
            <div class="timeline"><span>${escapeHtml(elapsed)}</span><span class="sep">·</span><span>${escapeHtml(m.source)}{${caps.notetakercodes ? '' : ''}}</span></div>
          </div>
        </div>
        ${m.status === 'live' ? renderLiveBar(m) : ''}
      </div>
      <div class="tabs" role="tablist">
        <button class="tab active" data-tab="notes">Notes</button>
        <button class="tab" data-tab="transcript">Transcript<span class="count">${(m.transcript || []).length}</span></button>
        <button class="tab" data-tab="ask">Ask</button>
        <button class="spacer" style="flex:1;border:none;background:transparent"></button>
        <div style="display:flex;gap:6px;padding-bottom:6px">
          <button class="btn sm" data-action="pin">${m.pinned ? 'Unpin' : 'Pin'}</button>
          <button class="btn sm" data-action="hide">Hide</button>
          <button class="btn sm" data-action="export" id="exportBtn">Export ▾</button>
        </div>
      </div>
      <div class="panel" id="tabPanel"></div>
    `;
    el.mainScroll.innerHTML = html;
    wireWorkspaceEvents(m);
    if (m.status === 'live') wireLiveBar();
    renderTab('notes', m);

    // title edit
    const titleInput = q('#meetingTitleInput');
    if (titleInput) {
      titleInput.addEventListener('change', (e) => { store.update(m.id, { title: e.target.value }); renderSidebar(); renderMeetingTitle(m); });
      titleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') titleInput.blur(); });
    }
  }

  function renderMeetingTitle(m) {
    const t = q('#meetingTitleInput'); if (t) t.value = m.title || '';
  }

  function elapsedSince(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return '0:00';
    const total = Math.floor(diff / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function renderLiveBar(m) {
    return `
      <div class="live-bar">
        <div class="live-state"><span class="rec-dot"></span> <b>Live</b></div>
        <div class="capture-src">${caps.captureAudio ? '<span class="cv">Mic: available</span>' : '<span class="cv">Mic: not available in this browser</span>'}</div>
        <div class="capture-src">${caps.captureScreen ? 'Screen ctx: available' : 'Screen ctx: unavailable'}</div>
        <div class="capture-src" id="trStatus">Transcription: provider required</div>
        <div class="grow"></div>
        <button class="btn sm danger" data-action="stop-live">Pause / Stop</button>
      </div>`;
  }

  // ---- Tab renderers ----
  function renderTab(name, m) {
    const panel = q('#tabPanel');
    if (!panel) return;
    const modeTab = m;
    if (name === 'notes') renderNotesTab(panel, m);
    else if (name === 'transcript') renderTranscriptTab(panel, m);
    else if (name === 'ask') renderAskTab(panel, m);
    // bind tabs
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('active', t.dataset.tab === name);
      t.onclick = (e) => { document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.tab === e.target.dataset.tab)); renderTab(e.target.dataset.tab, store.getSelected()); };
    });
  }

  function renderNotesTab(panel, m) {
    const n = m.notes || { summary: '', keyPoints: [], actionItems: [], decisions: [], followUps: [], resources: [] };
    const nt = window.CN_NOTES;
    nt.loadFeed(m);
    const feed = nt.getFeed(m);
    const styleId = nt.getStyleChoice(m);
    const style = nt.getStyle(styleId);
    const feedHtml = feed.length
      ? feed.map((e) => nt.feedEntryHtml(e)).join('')
      : `<div class="sidebar-empty" style="text-align:left;padding:var(--sp-2)"><div class="big">No notes yet</div><p>Jot a line below as the meeting runs. Each note is time-stamped, in order.</p></div>`;
    panel.innerHTML = `
      <div class="notes-editor">
        <div class="note-block">
          <div class="nb-label"><span class="ico">${ic('edit')}</span> Notes Taker</div>
          <div class="nt-feed" id="ntFeed">${feedHtml}</div>
          <div class="nt-input-row">
            <input id="ntInput" placeholder="Type a note and press Enter… (e.g. 'Amit to own design sign-off, due Tue')"/>
            <button class="btn primary sm" id="ntAdd">Add</button>
          </div>
        </div>

        <div class="note-block">
          <div class="nb-label"><span class="ico">↳</span> Summary</div>
          <div class="style-bar">
            <span class="style-label">Style</span>
            <select id="styleSelect">
              ${nt.allStyles().map((s) => `<option value="${s.id}" ${s.id === styleId ? 'selected' : ''}>${escapeHtml(s.label)}</option>`).join('')}
            </select>
            <span class="spacer"></span>
            <button class="btn sm primary gen-btn" id="sumGenBtn">${ic('generate')} Generate</button>
          </div>
          <div class="style-desc" id="styleDesc">${escapeHtml(style.desc)}</div>
          <div class="summary-output ${n.summary ? '' : 'empty'}" id="summaryOut" contenteditable="true" data-source="${n._sumSource || (n.summary ? 'ai' : 'none')}">${escapeHtml(n.summary || 'No summary yet — click Generate, or use the notes taker above.')}</div>
          <div class="style-desc" id="sumHint"></div>
        </div>

        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div class="note-block">
              <div class="nb-label"><span class="ico">◆</span> Key Points</div>
              <div class="notes-editor-list" data-nk="keyPoints">${renderStringList(n.keyPoints, 'keyPoints')}</div>
              <button class="btn sm ghost addNoteBtn" data-nk="keyPoints">+ Add point</button>
            </div>
          </div>
          <div style="flex:1;min-width:240px">
            <div class="note-block">
              <div class="nb-label"><span class="ico">✓</span> Decisions</div>
              <div class="notes-editor-list" data-nk="decisions">${renderStringList(n.decisions, 'decisions')}</div>
              <button class="btn sm ghost addNoteBtn" data-nk="decisions">+ Add decision</button>
            </div>
          </div>
        </div>
        <div class="note-block">
          <div class="nb-label"><span class="ico">→</span> Action Items</div>
          <div class="notes-editor-list" data-nk="actionItems">${renderActionList(n.actionItems, m)}</div>
          <button class="btn sm ghost addNoteBtn" data-nk="actionItems">+ Add action</button>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div class="note-block"><div class="nb-label"><span class="ico">↝</span> Follow-ups</div>
              <div class="notes-editor-list" data-nk="followUps">${renderStringList(n.followUps, 'followUps')}</div>
              <button class="btn sm ghost addNoteBtn" data-nk="followUps">+ Add follow-up</button></div>
          </div>
          <div style="flex:1;min-width:240px">
            <div class="note-block"><div class="nb-label"><span class="ico">◉</span> Resources</div>
              <div class="notes-editor-list" data-nk="resources">${renderStringList(n.resources || [], 'resources')}</div>
              <button class="btn sm ghost addNoteBtn" data-nk="resources">+ Add resource</button></div>
          </div>
        </div>
        <div class="hidden-state-flag" style="display:none">Notes are stored locally.</div>
      </div>`;
    // ---- Notes Taker wiring ----
    const ntInput = q('#ntInput');
    const ntAdd = q('#ntAdd');
    function commitNote() {
      const val = ntInput.value.trim();
      if (!val) return;
      nt.addEntry(m, val);
      ntInput.value = '';
      renderFeed(m);
    }
    function renderFeed(ml) {
      const feedEl = q('#ntFeed');
      if (!feedEl) return;
      const f = nt.getFeed(ml);
      feedEl.innerHTML = f.length
        ? f.map((e) => nt.feedEntryHtml(e)).join('')
        : `<div class="sidebar-empty" style="text-align:left;padding:var(--sp-2)"><div class="big">No notes yet</div><p>Jot a line below as the meeting runs. Each note is time-stamped, in order.</p></div>`;
      // entry edit/delete — inline editing keeps the feed serialized & editable
      feedEl.querySelectorAll('.nt-entry').forEach((entry) => {
        const holder = entry.querySelector('.nt-text-holder');
        const del = entry.querySelector('.nt-del');
        if (del) del.addEventListener('click', () => { nt.removeEntry(m, entry.dataset.nid); renderFeed(m); });
        if (holder) holder.addEventListener('dblclick', () => startInlineEdit(entry, holder, m, renderFeed));
      });
    }
    if (ntInput && ntAdd) {
      ntInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') commitNote(); });
      ntAdd.addEventListener('click', commitNote);
    }

    // ---- Summary style + generate wiring (self-contained; no provider needed) ----
    const styleSelect = q('#styleSelect');
    const styleDesc = q('#styleDesc');
    const sumHint = q('#sumHint');
    const sumBtn = q('#sumGenBtn');
    const summaryOut = q('#summaryOut');
    if (styleSelect) {
      styleSelect.addEventListener('change', () => {
        nt.setStyleChoice(m, styleSelect.value);
        styleDesc.textContent = nt.getStyle(styleSelect.value).desc;
        // Re-render existing summary through the newly chosen style (local, offline).
        if (n.summary && n.summary.trim()) {
          runSummaryGeneration(true);
        }
      });
    }
    function runSummaryGeneration(silentRerender) {
      if (sumBtn) sumBtn.innerHTML = '<span class="spin"></span> Generating…';
      if (sumHint) sumHint.textContent = 'Generating summary…';
      const restoreLabel = `<span>${ic('generate')} Generate</span>`;
      nt.generateSummary(m, styleSelect ? styleSelect.value : 'executive', (text, src) => {
        writeSummary(text, src || 'local');
        if (sumBtn) sumBtn.innerHTML = restoreLabel;
        if (sumHint) sumHint.textContent = !intel.AI.configured()
          ? 'Using offline local summary (no AI configured). A future enhancer can slot in here.'
          : 'Summary generated from meeting notes + transcript.';
      }, (errMsg, fallback) => {
        writeSummary(fallback, 'local');
        if (sumBtn) sumBtn.innerHTML = restoreLabel;
        if (sumHint) sumHint.textContent = 'AI unavailable (' + errMsg + '). Shown: offline local summary. This gap is ready for an enhancer.';
      });
    }
    function writeSummary(text, source) {
      if (!summaryOut) return;
      summaryOut.textContent = text;
      summaryOut.classList.remove('empty');
      summaryOut.dataset.source = source;
      n._sumSource = source; n.summary = text;
      store.setNoteText(m.id, 'summary', text);
    }
    if (sumBtn) sumBtn.addEventListener('click', () => runSummaryGeneration(false));
    // summary output is manually editable (user/AI enhancer gap).
    if (summaryOut) {
      summaryOut.addEventListener('blur', () => {
        const t = summaryOut.innerText.trim();
        if (t !== n.summary) { n.summary = t; store.setNoteText(m.id, 'summary', t); }
      });
    }
    // ---- End Notes Taker & Summary wiring ----
    panel.querySelectorAll('.addNoteBtn').forEach((b) => b.onclick = () => addNoteItem(m, b.dataset.nk));
    panel.querySelectorAll('.notes-editor-list input').forEach((inp) => {
      inp.addEventListener('change', () => commitStringEdit(m, inp.dataset.nk, inp.dataset.idx, inp.value));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); });
    });
    if (m.status === 'live') wireLiveSim(m);
  }

  function renderStringList(items, key) {
    return (items || []).map((s, i) =>
      `<div class="nb-item"><span class="bullet">•</span><input style="flex:1;border:none;background:transparent;border-bottom:1px dashed var(--border-strong);padding:2px" data-nk="${key}" data-idx="${i}" value="${escapeHtml(s)}"/><button class="icon-btn" data-del="${key}" data-idx="${i}" title="Remove" aria-label="Remove" style="width:22px;height:22px">×</button></div>`
    ).join('');
  }

  function renderActionList(items, m) {
    return (items || []).map((a, i) => {
      const owner = a.owner || '';
      const due = a.due || '';
      return `<div class="nb-item" data-ai="${i}">
        <span class="bullet">→</span>
        <input style="flex:2;min-width:120px;border:none;background:transparent;border-bottom:1px dashed var(--border-strong);padding:2px" data-nk="actionItems" data-field="task" data-idx="${i}" value="${escapeHtml(a.task || '')}" placeholder="Action task"/>
        <input style="flex:1;min-width:90px;border:none;background:transparent;border-bottom:1px dashed var(--border-strong);padding:2px" data-nk="actionItems" data-field="owner" data-idx="${i}" value="${escapeHtml(owner)}" placeholder="Owner"/>
        <input type="date" data-nk="actionItems" data-field="due" data-idx="${i}" value="${escapeHtml(due)}" title="Due date (only set if explicit)"/>
        <button class="icon-btn" data-del="actionItems" data-idx="${i}" title="Remove" aria-label="Remove" style="width:22px;height:22px">×</button>
      </div>`;
    }).join('');
  }

  // Inline-edit a serialized note entry (double-click holder → editable input).
  function startInlineEdit(entry, holder, m, rerender) {
    if (entry.querySelector('.nt-edit-input') || !holder || !holder.textContent) return;
    const original = holder.textContent;
    holder.outerHTML = `<input class="nt-edit-input" value="${escapeHtml(original)}" />`;
    const inp = entry.querySelector('.nt-edit-input');
    if (!inp) return;
    inp.focus(); inp.select();
    const done = () => {
      const nt = window.CN_NOTES;
      nt.updateEntry(m, entry.dataset.nid, inp.value);
      rerender(m);
    };
    inp.addEventListener('blur', done);
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      else if (e.key === 'Escape') { inp.value = original; inp.blur(); }
    });
  }

  function addNoteItem(m, key) {
    const arr = (m.notes && m.notes[key]) || [];
    if (key === 'actionItems') arr.push({ owner: '', task: '', due: null });
    else arr.push('');
    store.setNoteArray(m.id, key, arr);
    renderTab('notes', store.getSelected());
  }

  function commitStringEdit(m, key, idx, value) {
    const arr = (m.notes && m.notes[key]) || [];
    if (idx < arr.length) arr[idx] = value;
    store.setNoteArray(m.id, key, arr);
  }

  function commitActionEdit(m, idx, field, value) {
    const arr = (m.notes && m.notes.actionItems) || [];
    if (idx < arr.length) { arr[idx][field] = value; store.setNoteArray(m.id, 'actionItems', arr); }
  }

  function renderTranscriptTab(panel, m) {
    const lines = m.transcript || [];
    const enhanced = store.getEnhanced(m.id) || lines;
    panel.innerHTML = `
      <div class="transcript-top">
        <div class="mode-tabs">
          <button class="mode-tab active" data-mode="raw">Raw</button>
          <button class="mode-tab" data-mode="enhanced">Enhanced</button>
        </div>
        <button class="btn sm ghost" id="enhanceBtn" title="Send to AI for punctuation/word fixes">${ic('enhance')} Enhance</button>
        <span class="spacer"></span>
        <span class="capture-src" id="enhFeedback"></span>
      </div>
      <div class="transcript" id="transcriptPane">${renderTranscriptLines(lines, 'raw')}</div>`;
    panel.querySelectorAll('.mode-tab').forEach((b) => b.onclick = () => {
      const mode = b.dataset.mode;
      const pane = q('#transcriptPane');
      pane.innerHTML = renderTranscriptLines(mode === 'enhanced' ? enhanced : lines, mode);
      document.querySelectorAll('.mode-tab').forEach((x) => x.classList.toggle('active', x.dataset.mode === mode));
    });
    const enhBtn = q('#enhanceBtn');
    if (enhBtn) {
      enhBtn.onclick = () => runEnhance(m);
    }
    wireTranscriptSearch(m);
  }

  function renderTranscriptLines(lines, mode) {
    if (!lines || !lines.length) {
      return `<div class="empty"><div class="e-ico"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16M4 12h16M4 18h10"/></svg></div>
        <h3>No transcript yet</h3><p>This meeting has no transcript lines. Import a file, paste text, or start a live meeting.</p></div>`;
    }
    return lines.map((l, i) => {
      const ts = l.timestamp ? String(l.timestamp).match(/\d{1,2}:\d{2}/) : null;
      const speaker = l.speaker || 'Unknown';
      const avClass = speaker === 'You' ? 'y' : speaker === 'Sarah' || speaker === 'Amit' ? 'sar' : '';
      const interim = l.final === false ? '<span class="interim"> (listening…)</span>' : '';
      const id = mode === 'enhanced' ? '' : ` data-tr="${i}"`;
      return `<div class="tr-line"${id}>
        <div class="tr-time">${ts ? ts[0] : ''}</div>
        <div class="tr-speaker"><span class="av ${avClass}">${escapeHtml(speaker[0] || '?')}</span> <span>${escapeHtml(speaker)}</span></div>
        <div class="tr-text">${escapeHtml(l.text)}${interim}</div>
      </div>`;
    }).join('');
  }

  function wireTranscriptSearch(m) {
    document.querySelectorAll('#transcriptPane .tr-line[data-tr]').forEach((line) => {
      line.addEventListener('click', () => { scrollToTranscript(line.dataset.tr); });
    });
  }
  function scrollToTranscript(idx) {
    const line = document.querySelector(`#transcriptPane .tr-line[data-tr="${idx}"]`);
    if (line) {
      line.classList.add('highlight');
      setTimeout(() => line.classList.remove('highlight'), 1800);
      line.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function runEnhance(m) {
    // Enhanced transcript via AI: fixes punctuation, misheard words, merges echoes,
    // never summarizes, never invents. Chunked on line boundaries (~6000 chars).
    // Spec §14/§15. Failure never destroys a prior valid enhanced transcript.
    if (!m.transcript || !m.transcript.length) { toast('No transcript to enhance.', 'error'); return; }
    if (!intel.AI.configured()) {
      toast('Configure an AI provider in Settings first.', 'error');
      el.settingsModal.style.display = 'grid';
      return;
    }
    const fb = q('#enhFeedback');
    if (fb) fb.textContent = 'Enhancing…';
    const chunks = intel.chunkTranscript(m.transcript, 6000);
    const ENHANCE_SYS = [
      'You are CodeNotes transcript enhancement (a VDX product).',
      'Rewrite the supplied transcript lines into clean, readable lines.',
      'Rules: fix punctuation; correct obvious misheard words; merge echoed duplicate lines;',
      'attribute sentences to the actual speaker; PRESERVE Hindi as Hindi (transcribe Devanagari as-is).',
      'NEVER summarize. NEVER invent speakers, words, names, numbers, URLs, or timestamps.',
      'Keep the same line count. Return a JSON array of objects: {"speaker":"","text":"","timestamp":""}',
      'using ONLY the timestamps given. If a timestamp is absent, keep it empty string.'
    ].join('\n');
    let done = 0;
    const parts = [];
    Promise.all(chunks.map((chunk, ci) => intel.AI.__chatRaw({
      system: ENHANCE_SYS,
      user: 'Chunk ' + (ci + 1) + '/' + chunks.length + ':\n' +
        chunk.map((l) => (l.timestamp ? '[' + l.timestamp + '] ' : '') + (l.speaker || 'Unknown') + ': ' + (l.text || '')).join('\n')
    }, { timeoutMs: 40000 }).then((content) => {
      const arr = parseEnhanced(content);
      if (!arr) throw new Error('INVALID_ENHANCED');
      parts[ci] = arr;
      done++;
      if (fb) fb.textContent = 'Chunk ' + done + '/' + chunks.length;
    }).catch((err) => { throw err; })))
      .then(() => {
        const merged = parts.flat().filter(Boolean);
        if (!merged.length) throw new Error('EMPTY_ENHANCED');
        // Preserve timestamps/speaker if AI dropped them.
        const safe = merged.map((l, i) => ({
          speaker: l.speaker || (m.transcript[i] && m.transcript[i].speaker) || 'Unknown',
          text: l.text || (m.transcript[i] && m.transcript[i].text) || '',
          timestamp: l.timestamp || (m.transcript[i] && m.transcript[i].timestamp) || null,
          final: true, source: 'enhanced'
        }));
        store.setEnhanced(m.id, safe);
        if (fb) fb.textContent = 'Enhanced ✓';
        // re-render onto Enhanced mode
        const pane = q('#transcriptPane');
        if (pane) {
          document.querySelectorAll('.mode-tab').forEach((x) => x.classList.toggle('active', x.dataset.mode === 'enhanced'));
          pane.innerHTML = renderTranscriptLines(safe, 'enhanced');
          wireTranscriptSearch(m);
        }
        toast('Enhanced transcript ready.', 'ok');
      })
      .catch((err) => {
        const msg = String(err && err.message || err);
        if (fb) fb.textContent = 'Enhance failed: ' + msg;
        toast('Enhancement failed. Existing transcript preserved.', 'error');
      });
  }

  function parseEnhanced(content) {
    const c = intel.extractJSON(content);
    if (Array.isArray(c)) return c;
    if (c && Array.isArray(c.lines)) return c.lines;
    return null;
  }

  function renderAskTab(panel, m) {
    panel.innerHTML = `
      <div class="ask-box">
        <input id="askInput" placeholder="Ask anything about this meeting… e.g. What did Sarah disagree with?" aria-label="Ask the meeting"/>
        <button class="btn primary" id="askBtn">Ask</button>
      </div>
      <div class="ask-history" id="askHistory"></div>`;
    const askBtn = q('#askBtn');
    const askInput = q('#askInput');
    const hist = q('#askHistory');
    const ask = () => {
      const question = askInput.value.trim();
      if (!question || !intel.AI.configured()) {
        toast('Configure an AI provider in Settings first.', 'error');
        return;
      }
      const history = store.getNotes(m.id) ? (m._askHist || []) : [];
      const entry = { q: question, a: '', loading: true };
      if (!m._askHist) m._askHist = [];
      m._askHist.push(entry);
      hist.appendChild(renderAskEntry(entry));
      askInput.value = '';
      intel.askMeeting(m, question, (answer) => {
        entry.a = answer; entry.loading = false;
        renderAskHistory(m, hist);
        cache.set(cache.ns('derived') + 'ask:' + m.id, m._askHist);
      }, (err) => {
        entry.a = (err === 'AI_NOT_CONFIGURED') ? 'AI provider not configured. Open Settings to add one.' : 'AI request failed: ' + err;
        entry.loading = false;
        renderAskHistory(m, hist);
      });
    };
    askBtn.onclick = ask;
    askInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
    // load existing
    const saved = cache.get(cache.ns('derived') + 'ask:' + m.id);
    if (Array.isArray(saved)) { m._askHist = saved; renderAskHistory(m, hist); }
  }

  function renderAskEntry(entry) {
    return `<div class="ask-q">
      <div class="who">You</div>
      <div class="qbody">
        <div class="qtext">${escapeHtml(entry.q)}</div>
        <div class="ask-a">${entry.loading ? '<span class="ask-loading"><span class="spin"></span> Thinking…</span>' : renderAnswer(entry.a)}</div>
      </div>
    </div>`;
  }
  function renderAskHistory(m, hist) {
    hist.innerHTML = (m._askHist || []).map(renderAskEntry).join('');
    hist.querySelectorAll('.ask-a .cite').forEach((c) => {
      c.addEventListener('click', () => { openTimelineCitation(m, c.textContent); });
    });
  }
  function renderAnswer(text) {
    // escape and convert [TS=hh:mm] → clickable cite.
    return escapeHtml(text || '').replace(/\[TS=(\d{1,2}:\d{2}(?::\d{2})?)\]/g, '<span class="cite">$1</span>');
  }
  function openTimelineCitation(m, tsToken) {
    const idx = (m.transcript || []).findIndex((l) => l.timestamp && String(l.timestamp).startsWith(tsToken));
    if (idx >= 0) { renderTab('transcript', store.getSelected()); setTimeout(() => scrollToTranscript(idx), 50); }
  }

  // ---- Wire workspace events (pin/hide/export/tabs/live) ----
  function wireWorkspaceEvents(m) {
    // tab clicks
    document.querySelectorAll('.tab[data-tab]').forEach((t) => {
      t.onclick = (e) => { renderTab(e.target.dataset.tab, store.getSelected()); };
    });
    // action buttons
    const pin = document.querySelector('[data-action="pin"]');
    if (pin) pin.onclick = () => { store.update(m.id, { pinned: !m.pinned }); renderMeeting(m); renderSidebar(); };
    const hide = document.querySelector('[data-action="hide"]');
    if (hide) hide.onclick = () => { store.update(m.id, { hidden: true }); renderSidebar(); renderWorkspace(); };
    const ex = document.querySelector('[data-action="export"]');
    if (ex) ex.onclick = () => exportMenu(m);
  }

  function exportMenu(m) {
    if (el._expMenu) el._expMenu.remove();
    const btn = q('#exportBtn');
    const rect = btn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.style.cssText = `position:absolute;top:${rect.bottom + 4}px;right:${window.innerWidth - rect.right}px;z-index:50;background:var(--bg-raise);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-md);min-width:140px`;
    ['Markdown', 'Plain text', 'JSON'].forEach((fmt, i) => {
      const item = document.createElement('button');
      item.textContent = fmt;
      item.style.cssText = 'display:block;width:100%;text-align:left;padding:8px 14px;border:none;background:transparent;color:var(--text);font-size:var(--fs-sm)';
      item.onmouseover = () => item.style.background = 'var(--bg-hover)';
      item.onmouseout = () => item.style.background = 'transparent';
      item.onclick = () => { exportApi.exportMeeting(m, ['md', 'txt', 'json'][i]); toast('Exported as ' + fmt + '.', 'ok'); menu.remove(); };
      menu.appendChild(item);
    });
    el._expMenu = menu;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }

  // ---- Live simulation (progressive, per spec §6) ----
  // Since a real STT provider is not wired, a live meeting streams imported/interim
  // lines to exercise the live UX honestly (never claiming transcription).
  function wireLiveSim(m) {
    // The live bar already shows "Transcription: provider required". Real-time streaming
    // happens when a provider is configured; for now the sample can append lines via the
    // import path. This is the honest "capture adapter evolves separately" boundary.
  }

  // ---- Selection ----
  function selectMeeting(id) {
    store.select(id);
    renderSidebar();
    renderWorkspace();
  }

  // ---- New meeting flow ----
  function newMeeting() {
    const m = store.addRaw({ title: 'New meeting — ' + new Date().toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), status: 'live', startedAt: new Date().toISOString() });
    selectMeeting(m.id);
    toast('Meeting started. Add audio capture via settings when available.', 'ok');
  }

  // ---- Debounce ----
  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  // ---- Search ----
  let searchState = { results: [], idx: 0 };
  function bindGlobalSearch() {
    const input = el.globalSearchInput;
    input.addEventListener('input', debounce(() => {
      const qText = input.value.trim().toLowerCase();
      if (!qText) { el.searchResults.style.display = 'none'; searchState = { results: [], idx: 0 }; return; }
      const results = searchMeetings(qText);
      searchState = { results, idx: 0 };
      renderSearchResults(results);
    }, 200));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); moveSearch(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearch(-1); }
      else if (e.key === 'Enter' && searchState.results.length) { openSearch(searchState.results[searchState.idx]); }
      else if (e.key === 'Escape') { el.searchResults.style.display = 'none'; input.blur(); }
    });
  }

  function searchMeetings(qText) {
    const results = [];
    for (const m of store.all()) {
      if (m.hidden) continue;
      const haystack = [m.title, m.source, (m.participants || []).join(' '), (m.notes && m.notes.summary) || '',
        ...(m.notes && m.notes.keyPoints || []), ...(m.notes && m.notes.decisions || []),
        ...(m.notes && m.notes.actionItems || []).map((a) => a.task),
        ...(m.notes && m.notes.followUps || []),
        ...(m.transcript || []).map((l) => l.text)
      ].join(' ').toLowerCase();
      if (haystack.includes(qText)) {
        results.push({ id: m.id, title: m.title, date: m.startedAt ? new Date(m.startedAt).toLocaleDateString() : '' });
      }
    }
    return results;
  }

  function renderSearchResults(results) {
    if (!results.length) {
      el.searchResults.innerHTML = '<div class="sr-empty">No meetings match your search. Try a different term, or clear the search to see all meetings.</div>';
      el.searchResults.style.display = 'block';
      return;
    }
    el.searchResults.innerHTML = results.map((r, i) =>
      `<div class="sr-item ${i === searchState.idx ? 'active' : ''}" data-id="${escapeHtml(r.id)}"><div class="sr-title">${escapeHtml(r.title)}</div><div class="sr-detail">${escapeHtml(r.date)}</div></div>`
    ).join('') + `<div class="sr-empty" style="border-top:1px solid var(--border)">${results.length} match${results.length > 1 ? 'es' : ''} — Enter to open, ↑/↓ to navigate</div>`;
    el.searchResults.style.display = 'block';
    el.searchResults.querySelectorAll('.sr-item').forEach((item) => {
      item.addEventListener('click', () => { openSearch({ id: item.dataset.id }); });
    });
  }
  function moveSearch(delta) {
    if (!searchState.results.length) return;
    searchState.idx = (searchState.idx + delta + searchState.results.length) % searchState.results.length;
    renderSearchResults(searchState.results);
  }
  function openSearch(r) {
    selectMeeting(r.id);
    el.searchResults.style.display = 'none';
    el.globalSearchInput.value = '';
    el.globalSearchInput.blur();
  }

  // ---- Keyboard nav ----
  function bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
      if (e.key === '/') {
        e.preventDefault(); el.globalSearchInput.focus();
      } else if (e.key === 'Escape') {
        closeModals();
      } else if (e.key === 'ArrowDown' || e.key.toLowerCase() === 'j') {
        e.preventDefault(); navMeeting(1);
      } else if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'k') {
        e.preventDefault(); navMeeting(-1);
      } else if (e.key.toLowerCase() === 't') {
        toggleTheme();
      }
    });
  }
  function navMeeting(dir) {
    const visible = store.all().filter((m) => !m.hidden);
    if (!visible.length) return;
    const cur = store.getSelected();
    const idx = cur ? visible.findIndex((m) => m.id === cur.id) : -1;
    const next = (idx === -1) ? (dir > 0 ? 0 : visible.length - 1) : (idx + dir + visible.length) % visible.length;
    selectMeeting(visible[next].id);
  }

  function closeModals() { [el.settingsModal, el.importModal, el.revealModal].forEach((m) => { if (m) m.style.display = 'none'; }); el.searchResults.style.display = 'none'; }

  // Reveal hidden meetings (spec §21). "All hidden" state handled distinctly.
  function openRevealModal() {
    const hidden = store.all().filter((m) => m.hidden);
    el.revealAllHidden.style.display = hidden.length ? 'none' : 'block';
    el.revealList.innerHTML = hidden.length
      ? hidden.map((m) => `
        <div class="reveal-item">
          <div><div class="ri-title">${escapeHtml(m.title || 'Untitled')}</div>
          <div class="ri-date">${m.startedAt ? new Date(m.startedAt).toLocaleString() : ''}</div></div>
          <button class="btn sm" data-unhide="${escapeHtml(m.id)}">Unhide</button>
        </div>`).join('')
      : '';
    el.revealList.querySelectorAll('[data-unhide]').forEach((b) =>
      b.addEventListener('click', () => { store.update(b.dataset.unhide, { hidden: false }); openRevealModal(); renderSidebar(); if (!store.getSelected()) selectMeeting(b.dataset.unhide); }));
    el.revealModal.style.display = 'grid';
  }

  // ---- Modal helpers ----
  function closeBtnBinding() { document.querySelectorAll('.closeBtn').forEach((b) => b.addEventListener('click', closeModals)); }

  function bindSettings() {
    el.settingsBtn.addEventListener('click', () => {
      const cfg = intel.AI.get();
      el.aiEndpoint.value = cfg.endpoint; el.aiKey.value = cfg.key; el.aiModel.value = cfg.model;
      el.aiSttEndpoint.value = cfg.sttEndpoint || ''; el.aiSttModel.value = cfg.sttModel || '';
      renderAISettingsState();
      el.settingsModal.style.display = 'grid';
    });
    el.settingsDoneBtn.addEventListener('click', () => { saveAISettings(); closeModals(); });
    el.clearCacheBtn.addEventListener('click', () => { if (confirm('Clear all local derived data (notes, themes, corrections, UI state)? Transcripts stay.')) { cache.clearDerived(); store.loadFromCache(); renderSidebar(); renderWorkspace(); toast('Cache cleared.', 'ok'); } else toast('Cancelled.'); });
    el.resetBtn.addEventListener('click', () => { if (confirm('Reset CodeNotes completely? This removes ALL meetings and settings.')) { cache.resetAll(); location.reload(); } });
  }
  function saveAISettings() {
    intel.AI.setEndpoint(el.aiEndpoint.value.trim());
    intel.AI.setKey(el.aiKey.value.trim());
    intel.AI.setModel(el.aiModel.value.trim());
    intel.AI.setSttEndpoint(el.aiSttEndpoint.value.trim());
    intel.AI.setSttModel(el.aiSttModel.value.trim());
    renderAISettingsState();
    toast('AI provider saved.', 'ok');
  }
  function renderAISettingsState() {
    const cfg = intel.AI.get();
    const isCfg = !!cfg.endpoint && !!cfg.key && !!cfg.model;
    el.aiProviderState.className = 'prov-state ' + (isCfg ? 'ok' : 'warn');
    el.aiProviderState.innerHTML = `<span class="dot"></span><span class="name">${isCfg ? 'Config ready · ' + escapeHtml(cfg.model) : 'No AI configured yet'}</span>`;
  }

  function bindImport() {
    el.newMeetingBtn.addEventListener('click', () => { e_newMeeting(); });

    // File drop
    el.importZone.addEventListener('dragover', (e) => { e.preventDefault(); el.importZone.classList.add('dragover'); });
    el.importZone.addEventListener('dragleave', () => el.importZone.classList.remove('dragover'));
    el.importZone.addEventListener('drop', (e) => { e.preventDefault(); el.importZone.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if (f) readImportFile(f); });
    el.importZone.addEventListener('click', () => { if (!el.fileInput) { el.fileInput = document.createElement('input'); el.fileInput.type = 'file'; el.fileInput.accept = '.txt,.md,.json'; el.fileInput.addEventListener('change', (e) => { const f = e.target.files[0]; if (f) readImportFile(f); }); } el.fileInput.click(); });

    // import tabs
    document.querySelectorAll('.import-tabs .group-tab').forEach((t) => {
      t.addEventListener('click', () => {
        document.querySelectorAll('.import-tabs .group-tab').forEach((x) => x.classList.toggle('active', x === t));
        const pane = t.dataset.import;
        q('#importPaneFile').style.display = pane === 'file' ? 'block' : 'none';
        q('#importPanePaste').style.display = pane === 'paste' ? 'block' : 'none';
        q('#importPaneSample').style.display = pane === 'sample' ? 'block' : 'none';
        el.confirmImportBtn.style.display = pane === 'paste' ? 'inline-flex' : 'none';
      });
    });
    el.confirmImportBtn.addEventListener('click', () => {
      const title = el.importTitleInput.value.trim() || 'Imported meeting';
      const text = el.importPaste.value.trim();
      if (!text) { toast('Paste some transcript text first.', 'error'); return; }
      const lines = parsers.parseTranscript(text, 'paste');
      const m = store.addRaw({ title, source: 'paste', startedAt: new Date().toISOString(), transcript: lines, status: 'final', participants: parsers.collectSpeakers(lines) });
      autoResolveParticipants(m);
      closeModals();
      selectMeeting(m.id);
      toast('Imported ' + lines.length + ' transcript lines.', 'ok');
    });
    el.loadSampleBtn.addEventListener('click', loadSampleMeeting);
    el.cancelImportBtn.addEventListener('click', closeModals);

    // open import modal
    // (New Meeting button opens live meeting; Import accessible via workspace empty state too.)
  }

  function e_newMeeting() {
    // Show a small chooser: Start live / Import.
    openChooser();
  }

  function openChooser() {
    if (el._chooser) el._chooser.remove();
    const b = el.newMeetingBtn;
    const rect = b.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.style.cssText = `position:absolute;top:${rect.bottom + 4}px;left:${rect.left}px;z-index:50;background:var(--bg-raise);border:1px solid var(--border);border-radius:8px;box-shadow:var(--shadow-md);min-width:200px`;
    [['Start live meeting', newMeeting], ['Import transcript', openImportFromChooser]].forEach(([label, fn]) => {
      const it = document.createElement('button');
      it.textContent = label; it.style.cssText = 'display:block;width:100%;text-align:left;padding:9px 14px;border:none;background:transparent;color:var(--text);font-size:var(--fs-sm)';
      it.onmouseover = () => it.style.background = 'var(--bg-hover)'; it.onmouseout = () => it.style.background = 'transparent';
      it.onclick = () => { menu.remove(); fn(); };
      menu.appendChild(it);
    });
    el._chooser = menu;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
  }
  function openImportFromChooser() { el.importModal.style.display = 'grid'; }

  function readImportFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => { openImportFromChooser(); el.importPaste.value = e.target.result; activatePastePane(); };
    reader.readAsText(file);
  }
  function activatePastePane() {
    document.querySelectorAll('.import-tabs .group-tab').forEach((x) => x.classList.toggle('active', x.dataset.import === 'paste'));
    q('#importPaneFile').style.display = 'none'; q('#importPanePaste').style.display = 'block'; q('#importPaneSample').style.display = 'none';
    el.confirmImportBtn.style.display = 'inline-flex';
    if (el.importTitleInput.value === '') { const g = parsers.guessTitle(el.importPaste.value, 'Imported meeting'); el.importTitleInput.value = g; }
  }

  // ---- Sample meeting (realistic, Hindi+English, decision, action, misheard name) ----
  function loadSampleMeeting() {
    const now = new Date();
    const lines = [
      { timestamp: '10:31', speaker: 'You', text: "Let's discuss the launch timeline. What do we think about targeting the first week of October? I'll take notes.", final: true, source: 'sample' },
      { timestamp: '10:34', speaker: 'Sarah', text: "I think we should target the first ten days of October, but we need the design polish done first. Can we get a hard date from the design team?", final: true, source: 'sample' },
      { timestamp: '10:36', speaker: 'Amit', text: "हां, मैं design के साथ align कर लूंगा। मगर एक चीज़ और है — हमें VDX analytics dashboard का उपयोग करना चाहिए इस quarter में।", final: true, source: 'sample' },
      { timestamp: '10:38', speaker: 'Sarah', text: "Wait — did you say Veedex or VDX? I keep hearing two different names. I want to make sure we use the right one in the deck.", final: true, source: 'sample' },
      { timestamp: '10:40', speaker: 'Amit', text: "It's VDX. V-D-X. Not Veedex. I'll send you the link after this call.", final: true, source: 'sample' },
      { timestamp: '10:42', speaker: 'You', text: "Perfect. So decision: we target a beta launch in the first ten days of October, contingent on the design polish being signed off by the 26th of this month.", final: true, source: 'sample' },
      { timestamp: '10:44', speaker: 'Amit', text: "Agreed. I'll own the design sign-off coordination and send the VDX Analytics invite for Tuesday.", final: true, source: 'sample' },
      { timestamp: '10:45', speaker: 'Sarah', text: "I'll take the launch announcement draft and the pricing page update. Do we have a final price?", final: true, source: 'sample' },
      { timestamp: '10:47', speaker: 'Amit', text: "Pricing is still open — we haven't decided between 19 and 29 per month. Let's not commit to a number until Monday.", final: true, source: 'sample' },
      { timestamp: '10:48', speaker: 'You', text: "Understood — keep pricing open, revisit Monday. Anything else? I think we're aligned on the timeline and owners.", final: true, source: 'sample' }
    ];
    const m = store.addRaw({
      title: 'Launch Timeline Sync — ' + now.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      source: 'sample',
      startedAt: now.toISOString(),
      endedAt: new Date(now.getTime() + 8 * 60000).toISOString(),
      duration: 8,
      transcript: lines,
      participants: ['You', 'Sarah', 'Amit'],
      status: 'final',
      notes: {
        summary: "We aligned on a beta launch during the first ten days of October, contingent on design polish sign-off by the 26th. Pricing remains open until Monday. Amit and Sarah own follow-up actions around design coordination and launch assets.",
        keyPoints: ['Target beta launch in first ten days of October.', 'Design polish sign-off needed before 26th.', 'Pricing (19 vs 29) left open until Monday.'],
        decisions: ['Beta launch window: first ten days of October, contingent on design sign-off by 26th.'],
        actionItems: [
          { owner: 'Amit', task: 'Align with design team on sign-off and coordinate the VDX Analytics dashboard invite for Tuesday', due: null },
          { owner: 'Sarah', task: 'Draft launch announcement and update pricing page', due: null },
          { owner: 'You', task: 'Revisit pricing decision (19 vs 29) on Monday', due: null }
        ],
        followUps: ['Get design sign-off confirmed', 'Send VDX Analytics link to the team'],
        resources: [],
        related: []
      },
      pinned: false,
      hidden: false
    });
    cache.D.notes(m.id)(m.notes);
    cache.D.participants(m.id)(['You', 'Sarah', 'Amit']);
    closeModals();
    selectMeeting(m.id);
    toast('Sample meeting loaded. Try Ask or export it.', 'ok');
  }

  // ---- Participant resolution (spec §16) ----
  function autoResolveParticipants(m) {
    // Use transcript speakers as a base; optionally check opening greeting lines for
    // better display names. Keep simple + honest: only flag when evidence is real.
    const speakers = parsers.collectSpeakers(m.transcript);
    const withSignal = (m.title || '').match(/\bwith\b\s*(.+)/i)?.[1];
    let names = speakers;
    if (withSignal) {
      const extra = withSignal.split(/[,&]/).map((s) => s.trim()).filter(Boolean);
      names = [...new Set([...names, ...extra])];
    }
    store.update(m.id, { participants: names });
  }

  // ---- Wire live bar (mic capture via Whisper-compatible STT) ----
  function wireLiveBar() {
    const m = store.getSelected();
    const stopBtn = document.querySelector('[data-action="stop-live"]');
    if (stopBtn) stopBtn.onclick = () => endLiveMeeting(m);
    // Start transcription on mount if a mic adapter is available & configured.
    const adapters = window.CN_ADAPTERS;
    const mic = adapters && adapters.mic;
    if (!mic || !m || m._sttRunning) return;
    mic.start((lineEvt) => {
      // sink from the STT loop — append normalized transcript line to the live meeting.
      if (!lineEvt) return;
      if (lineEvt.error) {
        setStatus('offline', 'Transcription error: ' + lineEvt.error + ' — showing cached');
        return;
      }
      m.transcript = m.transcript || [];
      m.transcript.push({
        speaker: lineEvt.speaker || 'You',
        text: lineEvt.text,
        timestamp: lineEvt.timestamp,
        final: lineEvt.is_final !== false,
        source: lineEvt.source || 'whisper'
      });
      store.update(m.id, { transcript: m.transcript });
      if (m.status === 'live' && intel.AI.configured()) {
        // Debounced live intelligence: regenerate notes incrementally as speech arrives.
        debounceLiveIntel(m);
      }
      // live-update transcript tab if it's open
      const trStatus = document.querySelector('#trStatus');
      if (trStatus) trStatus.textContent = 'Transcribing via local Whisper…';
    }).then((res) => {
      if (res && res.ok) {
        m._sttRunning = true;
        setStatus('transcribing', 'Live — capturing + transcribing');
        const trStatus = document.querySelector('#trStatus');
        if (trStatus) trStatus.textContent = 'Transcribing via local Whisper…';
      } else if (res && res.reason !== 'stt-not-configured') {
        // Honest: never fake. Show why capture is off.
        const trStatus = document.querySelector('#trStatus');
        setStatus('idle', res.reason === 'permission-denied' ? 'Microphone permission denied' : 'Capture unavailable');
        if (trStatus) trStatus.textContent = res.message || (res.reason === 'permission-denied' ? 'Microphone denied — import instead.' : 'STT not reachable — see Settings.');
      } else {
        // STT not configured — keep meeting useful with import, never claim recording.
        setStatus('cached', 'STT not configured — import a transcript instead');
      }
    });
  }

  function debounceLiveIntel(m) {
    clearTimeout(window.__liveIntelTimer);
    window.__liveIntelTimer = setTimeout(() => {
      intel.analyzeMeeting(m, (notes) => {
        // Merge incrementally: only update fields AI actually filled.
        if (notes && (notes.summary || (notes.keyPoints && notes.keyPoints.length))) {
          const existing = m.notes || {};
          m.notes = {
            summary: notes.summary || existing.summary,
            keyPoints: notes.keyPoints && notes.keyPoints.length ? notes.keyPoints : (existing.keyPoints || []),
            decisions: notes.decisions && notes.decisions.length ? notes.decisions : (existing.decisions || []),
            actionItems: notes.actionItems && notes.actionItems.length ? notes.actionItems : (existing.actionItems || []),
            followUps: notes.followUps && notes.followUps.length ? notes.followUps : (existing.followUps || []),
          };
          store.setNotes(m.id, m.notes);
          if (store.getSelected() && store.getSelected().id === m.id) renderTab('notes', store.getSelected());
        }
      }, (err) => { if (err === 'AI_NOT_CONFIGURED') setStatus('cached', 'Notes need AI config — transcript captured'); });
    }, 2500); // batching window (spec §8: don't regenerate after every line)
  }

  function endLiveMeeting(m) {
    // Stop the STT loop cleanly.
    const adapters = window.CN_ADAPTERS;
    if (adapters && adapters.mic && m._sttRunning) {
      adapters.mic.stop();
      m._sttRunning = false;
    }
    store.update(m.id, { status: 'final', endedAt: new Date().toISOString() });
    renderMeeting(m);
    renderSidebar();
    setStatus('idle', 'Meeting finalized — ' + store.countVisible() + ' meetings loaded');
    toast('Meeting finalized. Post-meeting processing runs locally.', 'ok');
  }

  // ---- Public render ----
  function fullRender() {
    renderSidebar();
    renderWorkspace();
  }

  function init() {
    initRefs();
    const savedTheme = localStorage.getItem('codenotes:pref:theme');
    applyTheme(savedTheme === 'dark' ? 'dark' : savedTheme === 'light' ? 'light' : 'light');
    // wire listeners
    el.themeToggle.addEventListener('click', toggleTheme);
    if (el.themeSelect) el.themeSelect.addEventListener('change', (e) => applyTheme(e.target.value));
    bindGlobalSearch();
    bindKeyboard();
    bindSettings();
    bindImport();
    closeBtnBinding();
    // group tabs
    el.groupTabs.forEach((t) => t.addEventListener('click', () => {
      store._groupMode = t.dataset.group;
      el.groupTabs.forEach((x) => x.classList.toggle('active', x === t));
      renderSidebar();
    }));
    store._groupMode = 'date';

    // Store callbacks
    store.setCallbacks(selectMeeting, () => {}); // selection handled; mutate re-render
    // Load persisted metadata
    store.loadFromCache();
    // load corrections + ai config
    const savedCorr = cache.get(cache.ns('derived') + 'corrections');
    if (window.CN_WORD) window.CN_WORD.init(savedCorr);
    const aiCfg = cache.get(cache.ns('derived') + 'ai_cfg');
    if (aiCfg && intel) intel.AI.load(aiCfg);

    // Post-load: pick first visible meeting.
    const first = store.all().find((m) => !m.hidden);
    if (first) selectMeeting(first.id); else renderEmptyWorkspace();

    setStatus('idle', 'Ready — ' + store.countVisible() + ' meetings loaded');
  }

  // Export the namespace for app.js / tests
  window.CN_UI = { init, fullRender, renderSidebar, renderWorkspace, renderTab, newMeeting, selectMeeting, toast, escapeHtml, setStatus, debounce };
})();
