// The records the bridge reads — five `dt list <collection> --json` calls and five
// `dt get collections/<collection> --json` calls, run in the workspace. Nothing here parses a record file.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const COLLECTIONS = { screens: 'rnd/screens', journeys: 'rnd/user-journeys', stories: 'rnd/user-stories', personas: 'rnd/personas', questions: 'rnd/open-questions' };

/** The default runner: the workspace's own engine (its installed bin, else `npx --no-install`), never one
 *  fetched from the network. */
export function dtRunner(workspace) {
	const bin = path.join(workspace, 'node_modules', 'dreamteamer', 'bin', 'dreamteamer.js');
	const [cmd, pre] = fs.existsSync(bin) ? [process.execPath, [bin]] : ['npx', ['--no-install', 'dreamteamer']];
	return (args) => {
		const r = spawnSync(cmd, [...pre, ...args], { cwd: workspace, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
		if (r.status !== 0) throw new Error(`dreamteamer ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(0, 4).join(' | ')}`);
		return r.stdout;
	};
}

const parse = (args, out) => { try { return JSON.parse(out); } catch { throw new Error(`dreamteamer ${args.join(' ')} did not print JSON`); } };

/** Read the five collections and their descriptors. A collection marked sensitive is refused; every field a
 *  descriptor marks sensitive is dropped from its rows before anything else sees them. */
export function readRecords(config, { dt = dtRunner(config.workspace) } = {}) {
	const out = { descriptors: {}, dropped: {} };
	for (const [name, collection] of Object.entries(COLLECTIONS)) {
		const dargs = ['get', `collections/${collection}`, '--json'];
		const d = parse(dargs, dt(dargs));
		if (d.sensitive === true) throw new Error(`${collection} is marked sensitive — the harness exports nothing from it`);
		const sensitive = Object.entries(d.fields ?? {}).filter(([, f]) => f?.sensitive === true).map(([k]) => k);
		out.descriptors[name] = { fields: Object.keys(d.fields ?? {}), sensitive };
		out.dropped[name] = sensitive;
		const largs = ['list', collection, '--json'];
		const rows = parse(largs, dt(largs));
		out[name] = rows.map((r) => { const x = { ...r }; for (const k of sensitive) delete x[k]; return x; });
	}
	return out;
}
