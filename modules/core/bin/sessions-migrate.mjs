#!/usr/bin/env node
// sessions-migrate — core 0.9.0 keeps sessions as plain records in the workspace's own data. This moves
// a workspace from core 0.8.0, dry-run by default:
//
//   node node_modules/@dreamteamer/core/bin/sessions-migrate.mjs                 the plan, nothing written
//   node node_modules/@dreamteamer/core/bin/sessions-migrate.mjs --write         apply it
//   … --write --take <id>…                                                         also move named records it left
//
//   records      each *.session.md under SESSIONS_FOLDER that belongs to THIS workspace (the cwd its
//                transcript — or the harness's transcript of its session_id — was recorded in, or its
//                `repo` path, lies inside it) moves to data/sessions/, keeping its id; any other
//                is `left`, named, because a machine folder may be shared by two workspaces
//   fields       status, binding and heartbeat are dropped (core 0.9.0 has none of them)
//   transcripts  a transcript under ${env:FILES_FOLDER}/sessions/<rel> moves to ${env:SESSIONS_FOLDER}/<rel>
//                and the field is rewritten
//   sources      the workspace's own session-bindings/ sources are deleted (a layer's or a package's are
//                not this workspace's: compile names them as retired and ignores them)
//   hooks        core 0.8.0's Stop entry (`… dt-hook.sh" session heartbeat --hook`) leaves .claude/settings.json
//
// Nothing is staged or committed: the moved records become visible to everyone who reads the workspace,
// so the person reviews and commits them by id. Re-running prints zeros. Exit 0, or 1 on a failure.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';
import { transcriptOf } from '../src/sessions/send.js';

const HOOK = /dt-hook\.sh"?\s+session heartbeat --hook\s*$/;
const DROP = ['status', 'binding', 'heartbeat'];

function dt(ws, args) {
	const local = path.join(ws, 'node_modules', 'dreamteamer', 'bin', 'dreamteamer.js');
	return fs.existsSync(local) ? spawnSync(process.execPath, [local, ...args], { cwd: ws, encoding: 'utf8' }) : spawnSync('npx', ['--no-install', 'dreamteamer', ...args], { cwd: ws, encoding: 'utf8' });
}
/** A `${env:NAME}` rendered for this workspace, or null when unset. */
function rendered(ws, name) {
	const r = dt(ws, ['resolve', `\${env:${name}}`]);
	const v = r.status === 0 ? r.stdout.trim() : '';
	return v && !v.includes('${') ? v : null;
}
function walk(dir, suffix, out = []) {
	let entries = [];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
	for (const e of entries) { const p = path.join(dir, e.name); if (e.isDirectory()) walk(p, suffix, out); else if (e.name.endsWith(suffix)) out.push(p); }
	return out;
}
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
/** Is `p` the workspace or under it — both realpath'd, since a temp folder is reached through /var and /private/var. */
const inside = (p, root) => { const r = path.relative(real(root), real(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
/** One top-level front-matter key's raw value (first line), or null. */
const keyOf = (fm, k) => { const m = fm.match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : null; };
/** The front matter without the named top-level keys (a key's indented continuation lines go with it). */
function dropKeys(fm, keys) {
	const out = [];
	let skipping = false;
	for (const line of fm.split('\n')) {
		const top = line.match(/^([A-Za-z_][\w-]*):/);
		if (top) skipping = keys.includes(top[1]);
		else if (!/^\s/.test(line)) skipping = false;
		if (!skipping) out.push(line);
	}
	return out.join('\n');
}
/** The cwd a transcript was recorded in: the first line that names one. */
function cwdOf(file) {
	try {
		for (const line of fs.readFileSync(file, 'utf8').split('\n').slice(0, 50)) { if (!line.trim()) continue; try { const o = JSON.parse(line); if (o.cwd) return o.cwd; } catch { /* a non-json line */ } }
	} catch { /* unreadable */ }
	return null;
}
const split = (text) => { const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/); return m ? { fm: m[1], body: m[2] } : null; };

export function main(argv) {
	const write = argv.includes('--write');
	const take = new Set(argv.flatMap((a, i) => (argv[i - 1] === '--take' ? [a.replace(/^sessions\//, '')] : [])));
	const ws = findWorkspace();
	if (!ws) { console.error('no workspace: run from inside a dreamteamer workspace'); return 1; }
	const sessionsFolder = rendered(ws, 'SESSIONS_FOLDER');
	const filesFolder = rendered(ws, 'FILES_FOLDER');
	const n = { records: 0, transcripts: 0, sources: 0, hooks: 0, left: 0 };
	const say = (s) => console.log(`${write ? '' : '(dry run) '}${s}`);

	// sessions records and their transcripts
	if (sessionsFolder) {
		for (const file of walk(sessionsFolder, '.session.md')) {
			const id = path.relative(sessionsFolder, file).slice(0, -'.session.md'.length).split(path.sep).join('/');
			const parts = split(fs.readFileSync(file, 'utf8'));
			if (!parts) { n.left++; say(`left sessions/${id} — no front matter`); continue; }
			let { fm } = parts;
			const tr = keyOf(fm, 'transcript');
			const trFile = tr?.startsWith('${env:FILES_FOLDER}/') && filesFolder ? path.join(filesFolder, tr.slice('${env:FILES_FOLDER}/'.length)) : tr?.startsWith('${env:SESSIONS_FOLDER}/') ? path.join(sessionsFolder, tr.slice('${env:SESSIONS_FOLDER}/'.length)) : null;
			// a record `dt session start` wrote has no transcript field: the harness's own transcript of its
			// session_id says where it ran (CLAUDE_CONFIG_DIR, else ~/.claude)
			const sid = keyOf(fm, 'session_id');
			const harnessFile = sid ? transcriptOf(sid, process.env) : null;
			const cwd = (trFile && cwdOf(trFile)) || (harnessFile && cwdOf(harnessFile)) || null;
			const repo = keyOf(fm, 'repo');
			const ours = (cwd && inside(cwd, ws)) || (repo && path.isAbsolute(repo) && inside(repo, ws));
			if (!ours && !take.has(id)) { n.left++; say(`left sessions/${id} — ${cwd ? `recorded in ${cwd}, not this workspace` : 'no transcript or repo says whose it is'}; --take ${id} moves it`); continue; }
			fm = dropKeys(fm, DROP);
			if (tr?.startsWith('${env:FILES_FOLDER}/sessions/') && trFile && fs.existsSync(trFile)) {
				const rel = tr.slice('${env:FILES_FOLDER}/sessions/'.length);
				const to = path.join(sessionsFolder, rel);
				n.transcripts++;
				say(`transcript ${tr} → \${env:SESSIONS_FOLDER}/${rel}`);
				if (write) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(trFile, to); }
				fm = fm.replace(/^transcript:.*$/m, `transcript: \${env:SESSIONS_FOLDER}/${rel}`);
			}
			const target = path.join(ws, 'data', 'sessions', `${id}.session.md`);
			n.records++;
			say(`record sessions/${id} → data/sessions/${id}.session.md`);
			if (write) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, `---\n${fm}\n---\n${parts.body}`); fs.rmSync(file); }
		}
	} else say('SESSIONS_FOLDER is not set here: no sessions to move');

	// the workspace's own session-bindings sources
	for (const f of walk(path.join(ws, 'modules'), '.session-binding.yaml').filter((p) => p.split(path.sep).includes('session-bindings'))) {
		n.sources++;
		say(`source ${path.relative(ws, f)} deleted`);
		if (write) {
			fs.rmSync(f);
			const dir = path.dirname(f);
			if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
		}
	}
	try {
		const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
		for (const d of pkg.dreamteamer?.disable ?? []) if (String(d).startsWith('session-bindings/')) console.log(`note: package.json dreamteamer.disable names ${d} — nothing to disable any more; remove it`);
	} catch { /* no manifest */ }

	// core 0.8.0's Stop entry
	const settings = path.join(ws, '.claude', 'settings.json');
	if (fs.existsSync(settings)) {
		let s;
		try { s = JSON.parse(fs.readFileSync(settings, 'utf8')); } catch { s = null; console.log(`note: ${path.relative(ws, settings)} is not JSON — look for "session heartbeat --hook" by hand`); }
		const groups = s?.hooks?.Stop;
		if (Array.isArray(groups)) {
			let removed = 0;
			const kept = groups.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => { const hit = typeof h.command === 'string' && HOOK.test(h.command); if (hit) removed++; return !hit; }) })).filter((g) => g.hooks.length);
			if (removed) {
				n.hooks += removed;
				say(`hook ${path.relative(ws, settings)}: core 0.8.0's Stop entry (session heartbeat --hook) removed`);
				if (write) { if (kept.length) s.hooks.Stop = kept; else delete s.hooks.Stop; fs.writeFileSync(settings, `${JSON.stringify(s, null, 2)}\n`); }
			}
		}
		const rest = n.hooks && write ? s : s && { ...s, hooks: { ...s.hooks, Stop: (s.hooks?.Stop ?? []).map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !(typeof h.command === 'string' && HOOK.test(h.command))) })) } };
		if (rest && JSON.stringify(rest).includes('session heartbeat')) console.log(`note: ${path.relative(ws, settings)} mentions session heartbeat in a shape this script does not recognise — it is a no-op through core 0.9.x; remove it by hand`);
	}

	console.log(`${write ? '' : '(dry run) '}records ${n.records} · transcripts ${n.transcripts} · sources ${n.sources} · hooks ${n.hooks} · left ${n.left}`);
	if (write && n.records) console.log('next: dt compile, dt check, then commit the moved records by id (dt commit sessions/<id> …) — they are visible to everyone who reads this workspace');
	return 0;
}

const isMain = () => {
	if (!process.argv[1]) return false;
	const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
	return real(process.argv[1]) === real(fileURLToPath(import.meta.url));
};
if (isMain()) process.exit(main(process.argv.slice(2)));
