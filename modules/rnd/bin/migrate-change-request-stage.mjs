#!/usr/bin/env node
// migrate-change-request-stage — fills `stage` on a workspace's own change requests: the gate `dt next`
// names on each (lib/cr-stage.mjs, read through the workspace's own engine), dry run first. Also the repair
// for a stage that drifted — a card dragged on the board, a lifecycle step that skipped the write.
//
//   node node_modules/@dreamteamer/rnd/bin/migrate-change-request-stage.mjs            # the plan, nothing written
//   node node_modules/@dreamteamer/rnd/bin/migrate-change-request-stage.mjs --write    # apply it
//   … [--root <workspace>] [--json]
//
// Per change request in the workspace's OWN root:
//   a gate open, stage empty or different     set stage to the gate's (through `dt set`, so the engine validates)
//   no gate open, stage empty or contradicted  reported with the stages its record allows — never guessed
// A request a record layer holds is never written: writing `stage` into a layer whose own rnd has no such
// field turns that workspace's `dt check` red. Each layer is named once, with its count and the --root that
// migrates it in its own workspace. Order: install, `dt compile`, this, `dt check`; before compile it refuses.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findWorkspace } from '../lib/workspace-root.mjs';
import { COLLECTION, compilesStage, readRequests, allowedStages, stageContradictions } from '../lib/cr-stage.mjs';

/** The workspace's own engine: its API module and its CLI, with no harness session id leaking in. */
async function engineOf(root) {
	const pkg = createRequire(path.join(root, 'package.json')).resolve('dreamteamer/package.json');
	const dir = path.dirname(pkg);
	const dt = await import(pathToFileURL(path.join(dir, 'src', 'api.js')).href);
	const bin = path.join(dir, 'bin', 'dreamteamer.js');
	const env = { ...process.env };
	delete env.CLAUDE_CODE_SESSION_ID;
	const cli = (args) => {
		const r = spawnSync(process.execPath, [bin, ...args, '--workspace', root], { cwd: root, encoding: 'utf8', env, timeout: 120_000 });
		return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
	};
	return { dt, cli };
}

export async function main(argv = process.argv.slice(2), out = console.log) {
	const flag = (n) => argv.includes(`--${n}`);
	const rootAt = argv.indexOf('--root');
	const root = rootAt >= 0 ? path.resolve(argv[rootAt + 1] ?? '') : findWorkspace();
	if (!root || !fs.existsSync(path.join(root, 'package.json'))) {
		out('no workspace here — run it from the workspace root (the folder with package.json and package-lock.json), or pass --root');
		return 1;
	}
	const write = flag('write');
	const json = flag('json');

	const { dt, cli } = await engineOf(root);
	// read THIS workspace, even when it sits in another's git_modules/ (the engine climbs out otherwise)
	globalThis[Symbol.for('dreamteamer.workspace')] = root;
	const ws = await dt.openWorkspace(root);
	const store = new dt.Store(ws);
	if (!store.descriptors?.has?.(COLLECTION)) {
		out(`no ${COLLECTION} in this workspace — nothing to migrate`);
		return 0;
	}
	if (!compilesStage(store)) {
		out(`run dt compile first: the compiled ${COLLECTION} has no stage field. nothing was written.`);
		return 1;
	}
	if (typeof dt.commandsFor !== 'function') {
		out(`this engine has no commandsFor — upgrade the engine to read the gates. nothing was written.`);
		return 1;
	}

	const report = { planned: [], set: [], cannot_tell: [], layers: {}, failed: [] };
	for (const r of readRequests(store, dt)) {
		if (r.inLayer) {
			report.layers[r.inLayer] = (report.layers[r.inLayer] ?? 0) + 1;
			continue;
		}
		const stage = r.stage || null;
		if (r.expected) {
			if (stage === r.expected) continue;
			report.planned.push({ id: r.id, stage: r.expected, was: stage });
			continue;
		}
		const allowed = allowedStages(r.fields);
		if (!stage) report.cannot_tell.push({ id: r.id, reason: `no gate open (status ${r.fields.status ?? 'empty'})`, allowed, by: 'hand' });
		else {
			const [why] = stageContradictions(r.fields, stage);
			if (why) report.cannot_tell.push({ id: r.id, reason: `stage ${stage} contradicts the record (${why})`, allowed, by: 'one' });
		}
	}

	for (const p of report.planned) {
		const ref = `${COLLECTION}/${p.id}`;
		if (!write) {
			if (!json) out(`would set ${ref} stage=${p.stage} (was ${p.was ?? 'empty'})`);
			continue;
		}
		const res = cli(['set', ref, `stage=${p.stage}`]);
		if (res.code !== 0) {
			report.failed.push(p.id);
			if (!json) out(`✖ ${ref}: ${(res.err || res.out).trim()}`);
			continue;
		}
		report.set.push(p.id);
		if (!json) out(`set ${ref} stage=${p.stage} (was ${p.was ?? 'empty'})`);
	}
	if (!json) {
		for (const c of report.cannot_tell) {
			const tail = c.by === 'hand' ? 'set stage by hand' : 'set stage to one of them';
			out(`cannot tell ${COLLECTION}/${c.id}: ${c.reason} — the record allows ${c.allowed.join(' · ') || 'no stage'}; ${tail}`);
		}
		for (const [layer, n] of Object.entries(report.layers)) {
			out(`${layer}: ${n} change request${n === 1 ? '' : 's'} held by the layer — migrate them in its own workspace (--root git_modules/${layer}) once it is on this rnd`);
		}
		if (write) out(`${report.set.length} set${report.failed.length ? `, ${report.failed.length} failed` : ''}`);
		else out(report.planned.length ? `${report.planned.length} to set — run again with --write` : 'nothing to set');
	} else out(JSON.stringify(report, null, 2));
	return report.failed.length ? 1 : 0;
}

const self = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === self) main().then((code) => { process.exitCode = code; });
