#!/usr/bin/env node
// inventory — what evidence this machine can offer, as sources records. Read-only except for the
// records it writes and the `repos` records it registers. Absent is a record, not an error.
//   node inventory.mjs --retrospective perspective/retrospective-sessions/<id> [--repos-root d] [--home d] [--data-root d] [--workspace-root d] [--no-register] [--dry-run]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WORKSPACE_ROOT, DATA, dt, readEnv, templatize, slug } from '../lib/workspace.mjs';
import { recordPath, writeRecord, listRecords, contributorOf, readRecord, nowIso, rebuildRelations, writeSource, compiledStorage, recordFilesOf } from '../lib/records.mjs';
import { claudeHomes, walkJsonl } from '../lib/claude-trees.mjs';
import { readDescriptor } from '../lib/descriptors.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const retrospectiveRef = opt('retrospective');
if (!retrospectiveRef.startsWith('perspective/retrospective-sessions/')) { console.error('usage: --retrospective perspective/retrospective-sessions/<id> is required'); process.exit(2); }
const sessionBase = retrospectiveRef.split('/').pop();
const dataRoot = opt('data-root', DATA);
// Every evidence and model id is keyed by the CONTRIBUTOR, not by the run — a re-run must update
// this person's records rather than write a parallel set beside them. Resolved LAZILY, on first
// use, so a script that should exit 2 on a bad argument still does.
let _who = null;
const who = () => (_who ??= contributorOf(retrospectiveRef, dataRoot));
const home = opt('home', os.homedir());
const env = readEnv();
const reposRoot = opt('repos-root', (process.env.REPOS_FOLDER ?? env.REPOS_FOLDER ?? '').replace(/^~(?=\/|$)/, os.homedir()));
const AUTHOR = 'scripts/inventory@1';
const sources = [];
const add = (kind, label, reach, extra = {}) => sources.push({ retrospective: retrospectiveRef, contributor: who(), kind, label, reach, author: AUTHOR, ...extra });

// git checkouts under the repos root, depth ≤ 3, plus this workspace
const checkouts = [];
if (reposRoot && fs.existsSync(reposRoot)) {
	const walk = (d, depth) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue; const p = path.join(d, e.name); if (fs.existsSync(path.join(p, '.git'))) checkouts.push(p); else if (depth < 3) walk(p, depth + 1); } };
	walk(reposRoot, 1);
} else add('git-repo', 'repos-folder', 'unavailable', { content: 'REPOS_FOLDER is unset or the folder does not exist on this machine.' });
if (fs.existsSync(path.join(WORKSPACE_ROOT, '.git'))) checkouts.push(WORKSPACE_ROOT);
let registered = 0;
const known = flag('no-register') ? [] : JSON.parse(dt(['list', 'repos', '--json']));
for (const p of checkouts) {
	const name = path.basename(p);
	let remote = ''; try { remote = /url\s*=\s*(\S+)/.exec(fs.readFileSync(path.join(p, '.git', 'config'), 'utf8'))?.[1] ?? ''; } catch { /* no remote */ }
	const location = templatize(p);
	let repoRef;
	if (!flag('no-register')) {
		const hit = known.find((r) => r.path === location || r.name === name);
		if (hit) repoRef = `repos/${hit.id}`;
		else if (!flag('dry-run')) { const out = dt(['add', 'repos', '--name', name, '--url', remote || 'local', '--path', location, '--description', `Registered by perspective inventory from ${location}`]); repoRef = `repos/${slug(name)}`; registered++; void out; }
	}
	add('git-repo', name, 'available', { location, repo: repoRef, counts: { remote: remote ? 'yes' : 'no' } });
}
// coding-agent transcript trees. `--home` IS the userHome for this run (a test passes a tmp tree),
// so a path under it templatizes to ${userHome} — templatize() only knows the REAL home.
const homeTpl = (abs) => (abs === home || abs.startsWith(home + path.sep) ? '${userHome}' + abs.slice(home.length) : templatize(abs));
const homes = claudeHomes(home);
for (const h of homes) { const files = walkJsonl(h.projects).length; add('claude-transcripts', h.account, files ? 'available' : 'unavailable', { location: homeTpl(h.projects), counts: { files } }); }
if (!homes.length) add('claude-transcripts', 'default', 'unavailable', { location: homeTpl(path.join(home, '.claude', 'projects')) });
const codex = path.join(home, '.codex', 'sessions');
add('codex-transcripts', 'codex', fs.existsSync(codex) ? 'available' : 'unavailable', { location: homeTpl(codex), counts: fs.existsSync(codex) ? { files: walkJsonl(codex).length } : undefined });
const gemini = path.join(home, '.gemini', 'tmp');
add('gemini-cli-transcripts', 'gemini-cli', fs.existsSync(gemini) ? 'available' : 'unavailable', { location: homeTpl(gemini) });
// the workspace's own records (use case 2)
const workspaceRoot = path.resolve(opt('workspace-root', WORKSPACE_ROOT));
const dataDir = path.join(workspaceRoot, 'data');
const nRecords = fs.existsSync(dataDir) ? listRecords(dataDir).length : 0;
add('workspace-records', 'this-workspace', nRecords ? 'available' : 'unavailable', { location: '${workspaceFolder}/data', counts: { records: nRecords } });

// ── the calendar ────────────────────────────────────────────────────────────────────────────────
// The `meetings` collection of a consuming workspace, if it has one. It is a PEER of this module, so
// its presence is a fact about the workspace and not about this package: `available` when a compiled
// descriptor is there AND it holds records, `unavailable` otherwise — and the two unavailable cases
// say which, because "the module is not installed" and "installed but nothing synced" are different
// problems with different fixes. A `sources` record either way; absent is a record, not an error.
{
	// an unreadable descriptor reads as absent
	const meetings = readDescriptor(workspaceRoot, 'meetings');
	const storage = meetings?.compiled ? meetings.storage : null;
	if (!storage) {
		add('meetings', 'this-workspace', 'unavailable', {
			location: '${workspaceFolder}',
			content: 'No compiled `meetings` descriptor in this workspace. The meetings module is a declared PEER of this one: without it there is no calendar evidence at all, which is a fact about the workspace rather than about the contributor.\n',
		});
	} else {
		// every root the collection's records sit in — a meeting may live inside its company's folder
		const records = recordFilesOf(compiledStorage(workspaceRoot, 'meetings', storage.path, storage.suffix)).length;
		add('meetings', 'this-workspace', records ? 'available' : 'unavailable', {
			location: `\${workspaceFolder}/${String(storage.path)}`,
			counts: { records },
			content: records ? '' : 'The `meetings` collection is installed and empty — nothing has been synced into it yet. Run the meetings module\'s own fetch before reading this source.\n',
		});
	}
}

let available = 0, unavailable = 0;
for (const s of sources) {
	s.reach === 'available' ? available++ : unavailable++;
	// `content` is the collection's x-body field — it is the record BODY, never a frontmatter key.
	const { content = '', ...fields } = s;
	if (!flag('dry-run')) writeSource(recordPath('sources', `${who()}/${s.kind}--${slug(s.label)}`, 'source', dataRoot), fields, content);
}
// ── the session says what it saw ───────────────────────────────────────────────────────────────
// THIS IS THE POINT OF THE STAGE: a reader of the run must be able to answer "what did this see",
// and what it could NOT see.
//
// The LIST itself is not written here. `sources.retrospectives` carries the inverse, so the session's
// `sources[]` is a generated mirror the engine owns; this pass writes files directly, so it asks the
// engine to refresh it rather than keeping a second hand-maintained copy.
//
// The run LOG is still ours: it is prose about this pass, not a relation.
if (!flag('dry-run')) {
	const sessionFile = recordPath('retrospective-sessions', retrospectiveRef.split('/').pop(), 'retrospective-session', dataRoot);
	const { fields: prior, body: priorBody } = readRecord(sessionFile);
	const line = `- **inventoried** ${nowIso()} — ${sources.length} source${sources.length === 1 ? '' : 's'}`
		+ ` (${available} available, ${unavailable} unavailable), ${registered} repo${registered === 1 ? '' : 's'} registered`;
	// REPLACE this stage's own line rather than appending a second: a stage is re-runnable, and an
	// appending log turns a resumable run into a growing file that hides which pass wrote what.
	const kept = priorBody.split('\n').filter((l) => !/^- \*\*inventoried\*\* /.test(l));
	while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();
	writeRecord(sessionFile, prior, [...kept, line].join('\n') + '\n');
	rebuildRelations('perspective/retrospective-sessions', dataRoot);
}

process.stdout.write(`✔ sources ${sources.length} · available ${available} · unavailable ${unavailable} · repos registered ${registered}${flag('dry-run') ? ' · DRY RUN' : ''}\n`);
