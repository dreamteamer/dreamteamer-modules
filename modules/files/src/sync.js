// `dt files sync`: walk each drive and bring `data/files` level with it. The plan is pure (planDrive,
// diffDerived); the apply half writes through the running engine's Store, so every record is
// validated the way `dt add` validates it, and nothing is written when nothing changed.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dt } from './engine.js';
import { filesCommand } from './cli.js';
import { resolveDrivePath, parseScope } from './drives.js';
import { walkDrive, isoLocal } from './walk.js';
import { previewOf, previewable } from './preview.js';
import { referencedBy, pointersOf } from './references.js';

/** The fields sync owns. Everything else on a record is authored and never read or written here. */
export const DERIVED = ['drive', 'path', 'name', 'kind', 'ext', 'mime', 'bytes', 'modified', 'local', 'status', 'hash', 'preview', 'referenced_by'];
export const DEFAULT_HASH_MAX = 64 * 1024 * 1024;

export function sha256(abs) {
	return new Promise((resolve, reject) => {
		const h = createHash('sha256');
		fs.createReadStream(abs).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
	});
}

/** The derived fields a walked entry contributes — never hash, preview or referenced_by, which the plan and apply decide. */
export function derivedOf(driveId, e) {
	const f = { drive: `file-drives/${driveId}`, path: e.path, name: e.name, kind: e.kind, status: 'present' };
	if (e.kind === 'file') Object.assign(f, { ext: e.ext, mime: e.mime, bytes: e.bytes, modified: e.modified, local: e.local });
	return f;
}

/** Did the bytes change since the record was written? A folder never does. */
export const bytesChanged = (prev, e) => e.kind === 'file' && (prev.bytes !== e.bytes || prev.modified !== e.modified);

const norm = (v) => (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) ? null : v);
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

/** The `set` changes that take `prev` to `next` over the derived fields, or null when there are none. '' clears a key. */
export function diffDerived(prev, next) {
	const changes = {};
	for (const k of DERIVED) if (!same(prev[k], next[k])) changes[k] = norm(next[k]) === null ? '' : next[k];
	return Object.keys(changes).length ? changes : null;
}

/**
 * Pure. `existing`: Map<id, fields> of this drive's records in scope. `walked`: the entries on disk.
 * `hashes`: Map<relpath, sha256> for the files that were hashed this run (new or changed ones).
 * Returns { adds, updates, moves, missing }; an update carries `changed` (bytes differ) and `next`.
 */
export function planDrive({ driveId, existing, walked, hashes = new Map() }) {
	const adds = [], updates = [], moves = [], missing = [];
	const seen = new Set();
	const fresh = [];
	for (const e of walked) {
		const id = `${driveId}/${e.path}`;
		seen.add(id);
		const prev = existing.get(id);
		const next = derivedOf(driveId, e);
		if (!prev) { fresh.push({ id, e, next }); continue; }
		const changed = bytesChanged(prev, e);
		if (changed) { next.hash = hashes.get(e.path) ?? ''; next.preview = undefined; }
		else { next.hash = hashes.get(e.path) ?? prev.hash; next.preview = prev.preview; }
		updates.push({ id, e, prev, next, changed });
	}
	const gone = [...existing].filter(([id]) => !seen.has(id)).map(([id, prev]) => ({ id, prev }));
	const byHash = new Map(gone.filter((g) => g.prev.hash).map((g) => [g.prev.hash, g]));
	for (const f of fresh) {
		const h = hashes.get(f.e.path);
		const from = h ? byHash.get(h) : undefined;
		if (from) { byHash.delete(h); moves.push({ from: from.id, to: f.id, e: f.e, prev: from.prev, next: { ...f.next, hash: h } }); }
		else adds.push(h ? { ...f, next: { ...f.next, hash: h } } : f);
	}
	const movedFrom = new Set(moves.map((m) => m.from));
	for (const g of gone) if (!movedFrom.has(g.id) && g.prev.status !== 'missing') missing.push(g);
	return { adds, updates, moves, missing };
}

const inScope = (relpath, subfolder) => !subfolder || relpath === subfolder || relpath.startsWith(`${subfolder}/`);
const hasAuthored = (f) => Boolean((f.description && String(f.description).trim()) || (Array.isArray(f.tags) && f.tags.length) || (f.notes && String(f.notes).trim()));

/** Every record of every stored, non-runtime collection except `files`, for the pointer scan. */
function* otherRecords(store) {
	for (const d of store.descriptors.values()) {
		// storageOf, not d.storage: `runtime` lives in the compiled block, not under the authored storage key
		const storage = dt.storageOf(d);
		if (d.name === 'files' || storage.runtime || storage.format === 'binary') continue;
		for (const { id, fields } of store.readAll(d.name)) yield { collection: d.name, id, fields };
	}
}

/** One drive. Returns the summary row; writes unless `dryRun`. */
export async function syncDrive(store, ws, driveId, drive, { subfolder = null, hash = false, rehash = false, prune = false, dryRun = false, log = console.error } = {}) {
	const row = { id: driveId, walked: 0, added: 0, updated: 0, moved: 0, missing: 0, pruned: 0, unchanged: 0 };
	const where = resolveDrivePath(drive, dt.envContext(ws), dt.renderTemplate);
	if (where.skipped) { row.skipped = where.skipped; log(`  (skipping drive ${driveId} — ${where.skipped})`); return row; }
	if (!fs.existsSync(where.path)) { row.skipped = `${where.path} does not exist on this machine`; log(`  (skipping drive ${driveId} — ${row.skipped})`); return row; }

	const walked = walkDrive(where.path, { include: drive.include ?? [], exclude: drive.exclude ?? [], subfolder });
	row.walked = walked.length;
	const existing = new Map();
	for (const { id, fields } of store.readAll('files')) {
		if (fields.drive === `file-drives/${driveId}` && inScope(fields.path, subfolder)) existing.set(id, fields);
	}

	// hashes: new or changed local files under the cap; --hash adds the unhashed; --rehash takes all
	const cap = Number(drive.hash_max_bytes ?? DEFAULT_HASH_MAX);
	const hashes = new Map();
	for (const e of walked) {
		if (e.kind !== 'file' || !e.local || e.bytes > cap) continue;
		const prev = existing.get(`${driveId}/${e.path}`);
		const want = rehash || !prev || bytesChanged(prev, e) || (hash && !prev.hash);
		if (want) hashes.set(e.path, await sha256(e.abs));
	}
	const plan = planDrive({ driveId, existing, walked, hashes });

	// referenced_by for every entry in scope, in one pass over the other collections
	const entries = new Map();
	for (const x of [...plan.adds, ...plan.updates]) entries.set(x.id, { pointers: pointersOf(drive, driveId, x.e.path) });
	// A move also counts the typed reference to its OLD id: the rename below rewrites those to the new
	// one, and the scan reads the records as they stand before it. The old path's string form is not
	// rewritten, so it does not count.
	for (const m of plan.moves) entries.set(m.to, { pointers: [...pointersOf(drive, driveId, m.e.path), `files/${m.from}`] });
	const refs = referencedBy(otherRecords(store), entries);
	const previewFor = (e) => (drive.preview !== false && e.kind === 'file' && e.local && previewable(e.ext) ? previewOf(e.abs, e.ext) ?? undefined : undefined);

	for (const a of plan.adds) {
		const fields = { ...a.next, referenced_by: refs.get(a.id) };
		const p = previewFor(a.e); if (p) fields.preview = p;
		for (const k of Object.keys(fields)) if (norm(fields[k]) === null) delete fields[k];
		if (!dryRun) store.add('files', fields, { id: a.id });
		row.added++;
	}
	for (const m of plan.moves) {
		const next = { ...m.next, referenced_by: refs.get(m.to) };
		const p = previewFor(m.e); next.preview = p ?? m.prev.preview;
		if (!dryRun) { store.rename('files', m.from, m.to); const ch = diffDerived(m.prev, next); if (ch) store.set('files', m.to, ch); }
		row.moved++;
	}
	for (const u of plan.updates) {
		const next = { ...u.next, referenced_by: refs.get(u.id) };
		if (u.changed) next.preview = previewFor(u.e);
		const ch = diffDerived(u.prev, next);
		if (!ch) { row.unchanged++; continue; }
		if (!dryRun) store.set('files', u.id, ch);
		row.updated++;
	}
	for (const g of plan.missing) { if (!dryRun) store.set('files', g.id, { status: 'missing' }); row.missing++; }
	if (prune) {
		for (const [id, f] of existing) {
			const nowMissing = f.status === 'missing' || plan.missing.some((g) => g.id === id);
			if (!nowMissing || hasAuthored(f) || store.findInboundRefs(`files/${id}`).length) continue;
			if (!dryRun) store.rm('files', id, { force: true });
			row.pruned++;
		}
	}
	// The drive is stamped only when this run wrote an entry, or on its first sync: a run that changed
	// nothing leaves the drive record as it was too, so an unchanged tree leaves the repo clean.
	const wrote = row.added || row.updated || row.moved || row.missing || row.pruned;
	if (!dryRun) {
		let present = 0;
		for (const { fields } of store.readAll('files')) if (fields.drive === `file-drives/${driveId}` && fields.status !== 'missing') present++;
		if (wrote || !drive.last_synced || Number(drive.entries) !== present) {
			store.set('file-drives', driveId, { last_synced: isoLocal(new Date()), entries: present });
		}
	}
	return row;
}

export const summaryLine = (r) => r.skipped
	? `drive ${r.id} — skipped: ${r.skipped}`
	: `drive ${r.id} — walked ${r.walked} · added ${r.added} · updated ${r.updated} · moved ${r.moved} · missing ${r.missing} · unchanged ${r.unchanged}${r.pruned ? ` · pruned ${r.pruned}` : ''}`;

/** `dt files sync [<drive>[/<subfolder>]] [--hash] [--rehash] [--prune] [--dry-run] [--json]` */
export async function syncCommand(ws, pos, flags) {
	dt.warnIfStale(ws.root);
	const store = new dt.Store({ root: ws.root, pkg: ws.pkg });
	if (!store.descriptors.has('file-drives') || !store.descriptors.has('files')) { console.error('dt files: the file-drives and files collections are not compiled — run `dreamteamer compile`'); return 2; }
	const scope = parseScope(pos[0]);
	const drives = [...store.readAll('file-drives')];
	const chosen = scope ? drives.filter((d) => d.id === scope.drive) : drives;
	if (scope && !chosen.length) { console.error(`dt files: no drive "${scope.drive}" — dt list file-drives`); return 2; }
	if (!chosen.length) { console.error('dt files: no drives — dt add file-drives "<name>" --path \'${env:NAME}\''); return 2; }
	const opts = { subfolder: scope?.subfolder ?? null, hash: !!flags.hash, rehash: !!flags.rehash, prune: !!flags.prune, dryRun: !!flags['dry-run'] };
	const rows = [];
	for (const d of chosen) rows.push(await syncDrive(store, ws, d.id, d.fields, opts));
	if (flags.json) console.log(JSON.stringify({ dryRun: opts.dryRun, drives: rows }, null, 2));
	else {
		for (const r of rows) console.log((opts.dryRun ? '(dry run) ' : '') + summaryLine(r));
		if (!opts.dryRun && rows.some((r) => !r.skipped && (r.added || r.updated || r.moved || r.missing || r.pruned))) console.log('pending — `dreamteamer commit files file-drives` publishes (scope it to the records you mean)');
	}
	return 0;
}

filesCommand.handlers.sync = syncCommand;
