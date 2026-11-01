#!/usr/bin/env node
// migrate-session-bindings — rnd 0.8.0 ships no session-bindings. rnd 0.6.0–0.7.0 shipped three on
// change requests (design · build · review), and every `sessions` record started under one of them names
// it in `binding`, a reference to `session-bindings`. Once the bindings are gone that reference dangles:
// `dt check` fails once per such record, and `dt session end` refuses a running one. This script clears
// `binding` on those records and keeps the old binding in a tag, so every record stays.
//
//   node node_modules/@dreamteamer/rnd/bin/migrate-session-bindings.mjs            # the plan, nothing written
//   node node_modules/@dreamteamer/rnd/bin/migrate-session-bindings.mjs --write    # apply it
//   … [--root <workspace>] [--json]
//
// What changes, per record whose `binding` is one of the three and is not a binding this workspace still
// compiles (a workspace that declared its own under one of those ids keeps its sessions as they are):
//   binding                                   cleared
//   tags                                      the record's own, then rnd-binding:change-requests-<stage>
// Nothing else is written, though `dt set` fills a field the collection defaults (`confidence`) on a record
// that lacks it. Each write goes through `dt set`, so the engine validates it. A running session is
// reported: a fresh one with the command its holder (or a person) ends it with; a stale one as lapsing at
// the next `dt session` or `dt sessions` verb. A second run finds nothing.
//
// Order: `npm install @dreamteamer/rnd@0.8.0`, `dt compile`, this, `dt check`. Run before `dt compile`,
// it refuses: the old bindings are still compiled, and their sessions would read as still bound.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { findWorkspace } from '../lib/workspace-root.mjs';

/** The bindings rnd 0.6.0–0.7.0 shipped, as a session record names them. */
export const REMOVED = ['design', 'build', 'review'].map((s) => `session-bindings/change-requests--${s}`);
/** The tag that keeps the old binding on the record (a tag value may not carry `--`). */
export const tagFor = (binding) => `rnd-binding:change-requests-${binding.split('--').pop()}`;
/** Minutes a running session may be silent before core's next session verb abandons it — core's default,
 *  which is what applies once the binding that set it is gone. rnd's three all used it. */
export const STALE_AFTER = 30;
export const isStale = (s, now = Date.now()) => {
	const last = Date.parse(s.heartbeat ?? s.started ?? '');
	return !Number.isFinite(last) || now - last > STALE_AFTER * 60_000;
};

/** The CLI of the workspace's own engine, with no harness session id leaking in. */
function cliOf(root) {
	const pkg = createRequire(path.join(root, 'package.json')).resolve('dreamteamer/package.json');
	const bin = path.join(path.dirname(pkg), 'bin', 'dreamteamer.js');
	const env = { ...process.env };
	delete env.CLAUDE_CODE_SESSION_ID;
	return (args) => {
		const r = spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8', env, timeout: 120_000 });
		return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
	};
}

/** Which of the removed ids this workspace still compiles from a source on disk — its own binding — and
 *  which are compiled from a source that is gone: a compile that has not run since the upgrade. */
export function compiledState(root) {
	const live = new Set();
	const stale = [];
	let entries = null;
	for (const binding of REMOVED) {
		const name = `${binding}.session-binding.yaml`;
		if (!fs.existsSync(path.join(root, '.dreamteamer', name))) continue;
		entries ??= (() => {
			try { return yaml.load(fs.readFileSync(path.join(root, '.dreamteamer', 'manifest.yaml'), 'utf8'))?.entries ?? {}; } catch { return {}; }
		})();
		const sources = (entries[name]?.sources ?? []).map((s) => s.path).filter(Boolean);
		if (sources.some((p) => fs.existsSync(path.resolve(root, p)))) live.add(binding);
		else stale.push(binding);
	}
	return { live, stale };
}

export function main(argv = process.argv.slice(2), out = console.log) {
	const flag = (n) => argv.includes(`--${n}`);
	const rootAt = argv.indexOf('--root');
	const root = rootAt >= 0 ? path.resolve(argv[rootAt + 1] ?? '') : findWorkspace();
	if (!root || !fs.existsSync(path.join(root, 'package.json'))) {
		out('no workspace here — run it from the workspace root (the folder with package.json and package-lock.json), or pass --root');
		return 1;
	}
	const write = flag('write');
	const json = flag('json');

	const { live, stale } = compiledState(root);
	if (stale.length) {
		out(`run dt compile first: ${stale.join(', ')} ${stale.length === 1 ? 'is' : 'are'} still compiled from an rnd that no longer ships ${stale.length === 1 ? 'it' : 'them'}, so its sessions would read as bound. nothing was written.`);
		return 1;
	}

	const dt = cliOf(root);
	const listed = dt(['list', 'sessions', '--json']);
	if (listed.code !== 0) {
		const why = (listed.err || listed.out).trim().split('\n')[0];
		if (/SESSIONS_FOLDER|unknown collection|no collection/i.test(why)) {
			out(`no sessions to migrate: ${why}`);
			return 0;
		}
		out(`dt list sessions failed: ${why}`);
		return 1;
	}
	const parsed = JSON.parse(listed.out || '[]');
	const rows = Array.isArray(parsed) ? parsed : parsed.rows ?? [];
	const candidates = rows.filter((s) => REMOVED.includes(s.binding) && !live.has(s.binding));

	const report = { candidates: candidates.map((s) => s.id), unbound: [], running: [], stale: [], failed: [] };
	for (const s of candidates) {
		if (!write) {
			if (!json) out(`would unbind sessions/${s.id}  ${s.binding}  ${s.status ?? ''}`.trimEnd());
			continue;
		}
		const tag = tagFor(s.binding);
		const tags = [...(s.tags ?? []).filter((t) => t !== tag), tag];
		const r = dt(['set', `sessions/${s.id}`, 'binding=', ...tags.map((t) => `tags=${t}`)]);
		if (r.code !== 0) {
			report.failed.push(s.id);
			out(`✖ sessions/${s.id}: ${(r.err || r.out).trim()}`);
			continue;
		}
		report.unbound.push(s.id);
		if (!json) out(`unbound sessions/${s.id}  ${s.binding} → tag ${tag}`);
		if (s.status !== 'running') continue;
		if (isStale(s)) {
			report.stale.push(s.id);
			if (!json) out(`  stale: sessions/${s.id} (${s.worker ?? 'no worker'}, silent since ${s.heartbeat ?? s.started}) — the next dt session or dt sessions verb marks it abandoned; nothing to run`);
		} else {
			report.running.push(s.id);
			if (!json) out(`  still running: sessions/${s.id} (${s.worker ?? 'no worker'}) — its holder ends it with dt session end ${s.id}; a person frees it with dt session end ${s.id} --force`);
		}
	}
	if (json) out(JSON.stringify(report, null, 2));
	else out(write ? `${report.unbound.length} session(s) unbound${report.failed.length ? `, ${report.failed.length} failed` : ''}` : `${candidates.length} session(s) to unbind${candidates.length ? ' — run again with --write' : ''}`);
	return report.failed.length ? 1 : 0;
}

const self = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === self) process.exitCode = main();
