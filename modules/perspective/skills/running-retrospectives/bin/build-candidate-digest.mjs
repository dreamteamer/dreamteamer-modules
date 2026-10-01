#!/usr/bin/env node
// build-candidate-digest — the naming pass's input. `cluster-activities` emits candidates as JSONL
// full of record refs and SHAs; this turns them into something a model can read in one pass, so the
// clustering agent never opens a transcript, a commit or a record.
//
//   node build-candidate-digest.mjs <vault> <retrospective-base> <out.md>
//
// ⚠ THIS IS WHERE NAMING QUALITY IS DECIDED. A candidate rendered as "repo=poly, 18 commits" gets
// named "worked on poly"; the same candidate rendered with its commit subjects and its session
// titles gets named "ship the property-layer-post schema slice". Everything here is a judgement
// about which 200 characters of a candidate carry its identity.
// Ticket bodies are included since read-asana@2: a board's own comments are routinely the only place
// the reasoning survives ("Added a Draft PR, still testing… based on the feature/white-labeling
// branch"), and a naming pass reading titles alone names activities after the TICKET, not the work.
import fs from 'node:fs';
import path from 'node:path';
import { collectionDir, recordId } from '../lib/records.mjs';

const [vault, base, out] = process.argv.slice(2);
const dataRoot = path.join(vault, 'data');
const convDir = collectionDir('conversations', dataRoot);
const ticketDir = collectionDir('tickets', dataRoot);
const read = (f) => fs.readFileSync(f, 'utf8');
const fm = (f) => { const t = read(f); const m = /^---\n([\s\S]*?)\n---/.exec(t); return m ? m[1] : ''; };
const field = (t, k) => (new RegExp(`^${k}: (.*)$`, 'm').exec(t)?.[1] ?? '').replace(/^["']|["']$/g, '');

const convTitle = new Map();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.conversation.md')) {
  const id = recordId('conversations', p, dataRoot);
  const t = fm(p);
  convTitle.set(`perspective/conversations/${id}`, { title: field(t, 'title'), turns: +field(t, 'turns_user') || 0, min: +field(t, 'active_minutes') || 0, repo: field(t, 'repo_name') });
} } };
if (fs.existsSync(convDir)) walk(convDir);

// A ticket is no longer just a title. Since read-asana@2 it carries a description, the human comments
// and the whole story trail — 933 of them here, median 1,032 characters. The naming pass was reading
// titles alone and producing activities named after the ticket rather than after the WORK, so the
// digest now carries the first stretch of the body too. Trimmed hard: the trail is repetitive by
// nature and the first lines of it are the ones that say what the task actually was.
const ticketTitle = new Map();
if (fs.existsSync(ticketDir)) {
  const tw = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) tw(p); else if (e.name.endsWith('.ticket.md')) {
    const id = recordId('tickets', p, dataRoot);
    const raw = read(p);
    const t = fm(p);
    const body = (/^---\n[\s\S]*?\n---\n?([\s\S]*)$/.exec(raw)?.[1] ?? '');
    const desc = body.split(/\n## /)[0].trim().replace(/\s+/g, ' ').slice(0, 260);
    const comments = (body.split(/\n## comments\n/)[1] ?? '').split(/\n## /)[0].trim().replace(/\s+/g, ' ').slice(0, 300);
    const line = [`${field(t, 'title')} [${field(t, 'project')} · ${field(t, 'section')} · ${field(t, 'status')}]`];
    if (desc && !desc.startsWith('_No description')) line.push(`      desc: ${desc}`);
    if (comments) line.push(`      said: ${comments}`);
    ticketTitle.set(`perspective/tickets/${id}`, line.join('\n'));
  } } };
  tw(ticketDir);
}

const subj = new Map();
const cdir = path.join(vault, '.perspective', 'commits', base);
if (fs.existsSync(cdir)) for (const f of fs.readdirSync(cdir)) for (const l of read(path.join(cdir, f)).split('\n')) {
  if (!l.trim()) continue; try { const c = JSON.parse(l); subj.set(c.sha, c.subject ?? ''); } catch { /* skip */ }
}

const lines = [];
let i = 0;
for (const l of read(path.join(vault, '.perspective', 'activity-candidates', `${base}.jsonl`)).split('\n')) {
  if (!l.trim()) continue;
  const c = JSON.parse(l);
  i++;
  const titles = (c.sessions ?? []).map((s) => convTitle.get(s)).filter(Boolean);
  const tot = titles.reduce((a, t) => ({ turns: a.turns + t.turns, min: a.min + t.min }), { turns: 0, min: 0 });
  const blk = [`### candidate ${i} · key=${c.key} · repo=${c.repo} · ${c.started}→${c.ended} · sessions=${c.sessions.length} commits=${c.commit_count} tickets=${(c.tickets ?? []).length} · turns=${tot.turns} active_min=${Math.round(tot.min)}${c.singleton ? ' · SINGLETON' : ''}`];
  if (c.label_seed?.length) blk.push(`seed: ${c.label_seed.join(' ')}`);
  if (c.branches?.length) blk.push(`branches: ${c.branches.slice(0, 6).join(' ')}`);
  if (c.handles?.length) blk.push(`handles: ${c.handles.slice(0, 8).join(' ')}`);
  const st = [...new Set(titles.map((t) => t.title))].slice(0, 10);
  if (st.length) blk.push('session titles:\n' + st.map((t) => `  - ${t}`).join('\n'));
  const cs = [...new Set((c.commits ?? []).map((s) => subj.get(s)).filter(Boolean))].slice(0, 12);
  if (cs.length) blk.push('commit subjects:\n' + cs.map((t) => `  - ${t.slice(0, 150)}`).join('\n'));
  const tt = [...new Set((c.tickets ?? []).map((t) => ticketTitle.get(t)).filter(Boolean))].slice(0, 12);
  if (tt.length) blk.push('tickets:\n' + tt.map((t) => `  - ${t}`).join('\n'));
  lines.push(blk.join('\n'));
}
fs.writeFileSync(out, lines.join('\n\n') + '\n');
process.stdout.write(`✔ ${i} candidates → ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)\n`);
