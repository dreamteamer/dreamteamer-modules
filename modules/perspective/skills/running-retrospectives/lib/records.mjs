// Record files: <id>.<suffix>.md with YAML frontmatter. Written directly (the engine's bulk-write
// recipe) and proven by `dt check`; js-yaml is the engine's own dependency, resolved from node_modules.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { spawnSync } from 'node:child_process';
import { DATA } from './vault.mjs';

export const nowIso = () => new Date().toISOString();

export function recordPath(collectionBare, id, suffix, dataRoot = DATA) {
	return path.join(dataRoot, 'perspective', collectionBare, `${id}.${suffix}.md`);
}

/** Frontmatter keys are written in the order given; undefined/null/'' values are dropped. */
export function writeRecord(file, fields, body = '') {
	const clean = {};
	for (const [k, v] of Object.entries(fields)) {
		if (v === undefined || v === null || v === '') continue;
		if (Array.isArray(v) && v.length === 0) continue;
		clean[k] = v;
	}
	// ⚠ DUMPED WITH THE DEFAULT SCHEMA, deliberately, even though we LOAD with the core one. Under
	// the core schema a date-looking string needs no quotes, so dumping there would write
	// `first_seen: 2025-10-15` bare — and the next reader using a default schema (the engine's own
	// `check`, the extension) resolves that to a Date again. The default dumper quotes it, which is
	// the style already on disk and the only spelling that means "string" to everyone.
	const fm = yaml.dump(clean, { lineWidth: 120, noRefs: true, quotingType: '"' });
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `---\n${fm}---\n${body ? '\n' + body.replace(/\s+$/, '') + '\n' : ''}`);
	return file;
}

/**
 * ⚠ A YAML SCHEMA WITH NO TIMESTAMP TYPE, and it is not a preference — it is what makes a
 * read-modify-write of a record LOSSLESS.
 *
 * YAML's core schema resolves an unquoted `2025-10-15` to a Date. Dump that Date back and js-yaml
 * writes `2025-10-15T00:00:00.000Z` — so a script that only meant to add one field silently turned
 * a `format: date` field into a timestamp, and `dt check` refused the record. Measured 2026-09-08:
 * one goal record, changed by a pass that never touched its dates.
 *
 * `CORE_SCHEMA` drops the timestamp resolver, so a date READ from disk stays the string it was.
 * ⚠ The WRITE keeps the default schema — see writeRecord: under the core schema a date-looking
 * string needs no quotes, and a bare `2025-10-15` is a Date again to the next reader.
 */
const SCHEMA = yaml.CORE_SCHEMA;

export function readRecord(file) {
	const text = fs.readFileSync(file, 'utf8');
	if (!text.startsWith('---\n')) return { fields: {}, body: text };
	const end = text.indexOf('\n---', 4);
	if (end === -1) return { fields: {}, body: text };
	const fields = yaml.load(text.slice(4, end), { schema: SCHEMA }) ?? {};
	const body = text.slice(end + 4).replace(/^\n+/, '');
	return { fields, body };
}

export function listRecords(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? listRecords(p) : e.name.endsWith('.md') ? [p] : [];
	});
}

/**
 * Write a `perspective/sources` record, folding this run into its `retrospectives` LIST.
 *
 * ⚠ THE ONE COLLECTION IN THIS MODULE THAT IS MANY-TO-MANY WITH THE RUN. A source is durable — the
 * repo, the transcripts tree, the mailbox exist independently of any run and every run re-reads them
 * — so `sources.retrospective` (first) plus `last_seen_in` (most recent) lost every run in between
 * from the THIRD run onward. Both scalars retired on 2026-09-11; the run id begins with its own start
 * date, so a sorted `retrospectives` gives first, last and everything between from one field.
 *
 * Every caller still passes `retrospective` in its field literal, because that is what the reader
 * knows and it is what `tests/run-link.test.mjs` reads out of the source. This function is the ONE
 * place it becomes a list, and it APPENDS rather than replacing: a writer that overwrote the list
 * would make every earlier run invisible, which is the failure the scalar pair had by construction.
 */
export function writeSource(file, fields, body = '') {
	// `last_seen_in` is destructured out and DROPPED: it is not a field on `sources` any more, and a
	// caller spreading a record read off disk would otherwise carry the retired key back into the
	// file, where `check` reports it as an unknown field on a record nobody edited.
	const { retrospective, retrospectives, last_seen_in: _retired, ...rest } = fields;
	let prior = retrospectives;
	if (prior === undefined) {
		try { prior = readRecord(file).fields.retrospectives; } catch { /* first write */ }
	}
	const list = Array.isArray(prior) ? [...prior] : prior ? [String(prior)] : [];
	if (retrospective && !list.includes(retrospective)) list.push(retrospective);
	return writeRecord(file, { retrospectives: list, ...rest }, body);
}

/**
 * The CONTRIBUTOR a retrospective is about — the first segment of every evidence and model id.
 *
 * ⚠ NOT the run. Until 2026-09-09 every model record was keyed by the run
 * (`activities/2026-09-08--dana/…`), so a second retrospective months later wrote a parallel copy
 * of the same person's projects, topics and goals rather than updating them. Re-keying on the
 * contributor is what makes a re-run an update — and it means a script can no longer derive a
 * record directory from the ref it was handed. It reads the run record once, here.
 *
 * Throws rather than guessing: a missing contributor would silently scatter records under
 * `undefined/`, and a scatter is far more expensive to undo than a refusal.
 */
export function contributorOf(retrospectiveRef, dataRoot = DATA) {
	const base = String(retrospectiveRef).split('/').pop();
	const file = recordPath('retrospective-sessions', base, 'retrospective-session', dataRoot);
	let fields;
	try { fields = readRecord(file).fields; }
	catch { throw new Error(`no retrospective session at ${file} — every evidence and model id is keyed by its contributor, which lives on that record`); }
	const c = String(fields.contributor ?? '').trim();
	if (!c) throw new Error(`${file} carries no contributor, and every id this run writes begins with it`);
	return c;
}

/**
 * Refresh the generated mirrors on a collection after a pass wrote their OWNER as a raw file.
 *
 * ⚠ Why this exists. `x-inverse` mirrors are maintained by the engine on every `dt` write, and these
 * scripts write files directly — so a pass that sets `activities.project` leaves
 * `projects.activities` stale. The engine DETECTS that (`check` says
 * `activities: stale — run: dreamteamer relations rebuild perspective/world/projects`), which is already
 * better than the hand-maintained pairs this replaced, where nothing noticed. This closes it in the
 * same pass instead of leaving a chore.
 *
 * No-ops without a compiled runtime: under a fixture `--data-root` there is nothing to rebuild
 * against, and shelling `dt` there reaches the real workspace — the mistake `synthesize-perspective`
 * made until 2026-09-09.
 */
export function rebuildRelations(collections, dataRoot = DATA) {
	const root = path.dirname(dataRoot);
	if (!fs.existsSync(path.join(root, '.dreamteamer'))) return { skipped: true, collections: [] };
	const done = [];
	for (const c of [].concat(collections)) {
		const r = spawnSync('npx', ['dreamteamer', 'relations', 'rebuild', c], { cwd: root, encoding: 'utf8' });
		if (r.status === 0) done.push(c);
		else process.stderr.write(`  ⚠ could not rebuild ${c}: ${(r.stderr || r.stdout || '').trim().split('\n')[0]}\n`);
	}
	return { skipped: false, collections: done };
}

// ── a PEER collection's records, wherever its descriptor puts them ────────────────────────────────
// The COMPILED descriptor is the authority on where a collection keeps its files — a consumer may
// re-home a collection in an overlay, and since engine 0.32 a collection may be stored UNDER another
// (`storage.under`): a meeting with a `company` lives in that company's folder, one without stays in
// the collection's own root. These three read that block and answer "which files", "which file" and
// nothing else; a reader that walks `storage.path` alone sees only the fallback root.

/** The compiled storage block of a collection, with the parent's folder resolved when it is stored
 *  under one — or the shipped defaults for a fixture with no compiled runtime beside it. */
export function compiledStorage(workspaceRoot, collection, fallbackPath, fallbackSuffix) {
	const read = (name) => {
		const file = path.join(workspaceRoot, '.dreamteamer', 'collections', `${name}.collection.yaml`);
		if (!fs.existsSync(file)) return null;
		try { return yaml.load(fs.readFileSync(file, 'utf8'))?.storage ?? null; } catch { return null; }
	};
	const own = read(collection);
	const dir = path.join(workspaceRoot, String(own?.path || fallbackPath));
	const suffix = String(own?.suffix || fallbackSuffix);
	const under = own?.under && own.under.field && own.under.path && own.under.collection ? own.under : null;
	const parent = under ? read(under.collection) : null;
	return {
		dir, suffix, compiled: Boolean(own?.path),
		under: under && parent?.path ? { ...under, parentDir: path.join(workspaceRoot, String(parent.path)) } : null,
	};
}

/** Every record file of a collection as `{ file, root, id }` — its own root, then each parent record's
 *  child folder. The id is the path inside WHICHEVER root the file sits in, which is what makes it
 *  independent of placement. */
export function recordFilesOf(storage) {
	const tail = `.${storage.suffix}.md`;
	const roots = [storage.dir];
	if (storage.under && fs.existsSync(storage.under.parentDir)) {
		for (const e of fs.readdirSync(storage.under.parentDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (e.isDirectory() && !e.name.startsWith('.')) roots.push(path.join(storage.under.parentDir, e.name, storage.under.path));
		}
	}
	const out = [];
	for (const root of roots) {
		for (const file of listRecords(root)) {
			if (!file.endsWith(tail)) continue;
			out.push({ file, root, id: path.relative(root, file).slice(0, -tail.length) });
		}
	}
	return out;
}

/** The file one record id names, or null — a direct probe of the own root and of every parent's child
 *  folder, never a walk. */
export function recordFileFor(storage, id) {
	const name = `${id}.${storage.suffix}.md`;
	const own = path.join(storage.dir, name);
	if (fs.existsSync(own)) return own;
	if (!storage.under || !fs.existsSync(storage.under.parentDir)) return null;
	for (const e of fs.readdirSync(storage.under.parentDir, { withFileTypes: true })) {
		if (!e.isDirectory() || e.name.startsWith('.')) continue;
		const f = path.join(storage.under.parentDir, e.name, storage.under.path, name);
		if (fs.existsSync(f)) return f;
	}
	return null;
}
