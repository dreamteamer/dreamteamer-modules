// `dt files status` and the doctor rows: what each drive looks like from this machine. No writes.
import fs from 'node:fs';
import { dt } from './engine.js';
import { filesCommand } from './cli.js';
import { resolveDrivePath, envKeysOf } from './drives.js';

/** One row per drive: resolution, existence and the index's counts. */
export function driveRows(ws, store) {
	const counts = new Map();
	for (const { fields } of store.readAll('files')) {
		const id = String(fields.drive ?? '').split('/').pop();
		const c = counts.get(id) ?? { entries: 0, missing: 0, cloudOnly: 0 };
		if (fields.status === 'missing') c.missing++; else c.entries++;
		if (fields.local === false) c.cloudOnly++;
		counts.set(id, c);
	}
	const ctx = dt.envContext(ws);
	return [...store.readAll('file-drives')].map(({ id, fields }) => {
		const where = resolveDrivePath(fields, ctx, dt.renderTemplate);
		const c = counts.get(id) ?? { entries: 0, missing: 0, cloudOnly: 0 };
		return { id, name: fields.name, template: fields.path, vars: envKeysOf(fields.path), path: where.path ?? null, skipped: where.skipped ?? null, exists: where.path ? fs.existsSync(where.path) : false, last_synced: fields.last_synced ?? null, ...c };
	});
}

const describe = (r) => r.skipped ? r.skipped : !r.exists ? `${r.path} does not exist on this machine` : `${r.entries} entries · ${r.missing} missing · ${r.cloudOnly} cloud-only · ${r.last_synced ? `synced ${r.last_synced}` : 'never synced'}`;

/** `dt files status [--json]` */
export function statusCommand(ws, pos, flags) {
	const store = new dt.Store({ root: ws.root, pkg: ws.pkg });
	if (!store.descriptors.has('file-drives')) { console.error('dt files: the file-drives collection is not compiled — run `dreamteamer compile`'); return 2; }
	const rows = driveRows(ws, store);
	if (flags.json) console.log(JSON.stringify({ drives: rows }, null, 2));
	else for (const r of rows) console.log(`${r.id} (${r.name}) — ${describe(r)}`);
	return 0;
}

/** The doctor's rows: bad when a declared drive does not resolve or exist here, warn when never synced or cloud-only entries exist, ok otherwise. */
export function doctorFiles({ root, ws, dt: api }) {
	const store = new api.Store({ root, pkg: ws.pkg });
	if (!store.descriptors.has('file-drives')) return [];
	const { declared } = api.envContext(ws);
	const fixFor = (r) => {
		if (!r.vars.length) return 'give the drive a ${env:NAME} path';
		const undeclared = r.vars.filter((k) => !declared.includes(k));
		if (undeclared.length) return `declare ${undeclared.join(', ')} in dreamteamer.vars (package.json), then set it in .env`;
		return `set ${r.vars.join(', ')} in .env, or start the sync client that mounts it`;
	};
	return driveRows(ws, store).map((r) => {
		const label = `drive ${r.id}`;
		if (r.skipped || !r.exists) return { label, state: 'bad', detail: describe(r), fix: fixFor(r) };
		if (!r.last_synced) return { label, state: 'warn', detail: describe(r), fix: `dreamteamer files sync ${r.id}` };
		if (r.cloudOnly) return { label, state: 'warn', detail: describe(r), fix: 'open the folder in the sync client and keep it available offline to hash and preview those files' };
		return { label, state: 'ok', detail: describe(r) };
	});
}

filesCommand.handlers.status = statusCommand;
