/* ==========================================================================
   CodeNotes · a VDX product — Exporter
   Spec §23. Markdown / plain text / JSON export of a meeting, with current
   word corrections applied. Never exports hidden/unrelated meetings.
   ========================================================================== */
(function () {
  'use strict';

  const storeApi = window.CN_STORE || {};

  function fmtDate(iso, withTime) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const dt = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    if (!withTime) return dt;
    const tm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return dt + (withTime ? ' · ' + tm : '');
  }

  function transcriptToText(lines) {
    return (lines || []).map((l) => {
      const ts = l.timestamp ? l.timestamp.match(/\d{1,2}:\d{2}(?::\d{2})?/)?.[0] : null;
      return (ts ? '[' + ts + '] ' : '') + (l.speaker || 'Unknown') + ': ' + (l.text || '');
    }).join('\n');
  }

  // Build a fully populated meeting object (corrected) for export.
  function finalize(meeting) {
    const c = window.CN_WORD ? window.CN_WORD.apply : (s) => s;
    const corrected = storeApi.applyCorrections ? storeApi.applyCorrections(meeting) : meeting;
    const n = corrected.notes || {};
    return {
      title: c(corrected.title || 'Untitled'),
      date: fmtDate(corrected.startedAt, true),
      duration: corrected.duration ? corrected.duration + ' min' : (corrected.endedAt && corrected.startedAt ? Math.round((new Date(corrected.endedAt) - new Date(corrected.startedAt)) / 60000) + ' min' : ''),
      participants: (corrected.participants && corrected.participants.length) ? corrected.participants.join(', ') : '—',
      source: corrected.source || 'import',
      summary: c(n.summary || ''),
      keyPoints: (n.keyPoints || []).map(c),
      decisions: (n.decisions || []).map(c),
      actionItems: (n.actionItems || []).map((a) => ({ ...a, task: c(a.task || '') })),
      followUps: (n.followUps || []).map(c),
      resources: (n.resources || []).map(c),
      transcript: corrected.transcript || []
    };
  }

  function toMarkdown(meeting) {
    const f = finalize(meeting);
    let md = `# ${f.title}\n\n`;
    md += `- **Date:** ${f.date}\n`;
    md += `- **Participants:** ${f.participants}\n`;
    md += `- **Duration:** ${f.duration}\n`;
    md += `- **Source:** ${f.source}\n\n`;
    md += `## Summary\n${f.summary}\n\n`;
    if (f.keyPoints.length) { md += `## Key Points\n`; f.keyPoints.forEach((k) => md += `- ${k}\n`); md += '\n'; }
    if (f.decisions.length) { md += `## Decisions\n`; f.decisions.forEach((d) => md += `- ${d}\n`); md += '\n'; }
    if (f.actionItems.length) { md += `## Action Items\n`; f.actionItems.forEach((a) => md += `- [O: ${a.owner || '?'}] ${a.task}${a.due ? ` (Due: ${a.due})` : ''}\n`); md += '\n'; }
    if (f.followUps.length) { md += `## Follow-ups\n`; f.followUps.forEach((x) => md += `- ${x}\n`); md += '\n'; }
    if (f.resources.length) { md += `## Resources\n`; f.resources.forEach((r) => md += `- ${r}\n`); md += '\n'; }
    md += `## Transcript\n\n`;
    md += transcriptToText(f.transcript);
    md += '\n';
    return md;
  }

  function toPlain(meeting) {
    const f = finalize(meeting);
    let txt = `${f.title}\n`;
    txt += '='.repeat(f.title.length) + '\n\n';
    txt += `Date: ${f.date}\nParticipants: ${f.participants}\nDuration: ${f.duration}\nSource: ${f.source}\n\n`;
    txt += `SUMMARY\n${f.summary}\n\n`;
    if (f.keyPoints.length) { txt += 'KEY POINTS\n'; f.keyPoints.forEach((k) => txt += `- ${k}\n`); txt += '\n'; }
    if (f.decisions.length) { txt += 'DECISIONS\n'; f.decisions.forEach((d) => txt += `- ${d}\n`); txt += '\n'; }
    if (f.actionItems.length) { txt += 'ACTION ITEMS\n'; f.actionItems.forEach((a) => txt += `- ${a.owner ? a.owner + ': ' : ''}${a.task}${a.due ? ` (${a.due})` : ''}\n`); txt += '\n'; }
    if (f.followUps.length) { txt += 'FOLLOW-UPS\n'; f.followUps.forEach((x) => txt += `- ${x}\n`); txt += '\n'; }
    txt += 'TRANSCRIPT\n' + transcriptToText(f.transcript) + '\n';
    return txt;
  }

  function toJSON(meeting) {
    const f = finalize(meeting);
    return JSON.stringify({
      title: f.title, date: f.date, participants: f.participants, duration: f.duration,
      source: f.source, summary: f.summary, keyPoints: f.keyPoints, decisions: f.decisions,
      actionItems: f.actionItems.map((a) => ({ owner: a.owner, task: a.task, due: a.due })),
      followUps: f.followUps, resources: f.resources,
      transcript: f.transcript.map((l) => ({ timestamp: l.timestamp, speaker: l.speaker, text: l.text, final: l.final }))
    }, null, 2);
  }

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 50);
  }

  function exportMeeting(meeting, format) {
    if (!meeting) return;
    const name = (meeting.title || 'meeting').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
    const date = meeting.startedAt ? new Date(meeting.startedAt).toISOString().slice(0, 10) : 'date';
    if (format === 'json') {
      download(`${name}_${date}.md`, toJSON(meeting), 'application/json');
      return { ext: '.json', label: 'JSON' };
    } else if (format === 'md') {
      download(`${name}_${date}.md`, toMarkdown(meeting), 'text/markdown');
      return { ext: '.md', label: 'Markdown' };
    } else {
      download(`${name}_${date}.txt`, toPlain(meeting), 'text/plain');
      return { ext: '.txt', label: 'Plain text' };
    }
  }

  window.CN_EXPORT = { toMarkdown, toPlain, toJSON, exportMeeting, transcriptToText };
})();
