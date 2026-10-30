// `npx dt-prototype check [--json] [--apply] [--strict]` — the prototype's screen registry against
// `rnd/screens` in scope, and the vendored browser half against its stamps. `--apply` sets each matched
// screen's `build_status` (built, or in-progress for a stub) and `prototype` through `dt set`, printing every
// command: never `verified`, never a commit, always the RECORD id the registry key was matched to.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, productKey } from './config.mjs';
import { readRecords, dtRunner } from './records.mjs';
import { vendorStatus } from './vendor.mjs';
import { VERSION } from './export.mjs';

const DONE = new Set(['resolved', 'obsolete']);
const same = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

/** the registry's screens: `export const screens`, or a default export that is the list */
export async function loadRegistry(file) {
	const m = await import(`${pathToFileURL(file).href}?t=${fs.statSync(file).mtimeMs}`);
	const list = m.screens ?? (Array.isArray(m.default) ? m.default : m.default?.screens);
	if (!Array.isArray(list)) throw new Error(`${file}: exports no screens list`);
	return list;
}

/** compare (pure) → { mismatches: [{ kind, key, detail }], matched: [{ id, key, stub }] } */
export function compare(c, records, registry) {
	const mismatches = []; const matched = [];
	const add = (kind, key, detail) => mismatches.push({ kind, key, detail });
	const portalOf = (s) => {
		if (c.portal.from === 'product') return productKey(c, s.product);
		const v = s[c.portal.field];
		return v == null ? null : c.portal.map ? c.portal.map[v] ?? null : String(v);
	};
	const portals = new Set(c.portal.from === 'product' ? Object.values(c.products).map((p) => p.key) : c.portal.map ? Object.values(c.portal.map) : records.screens.map(portalOf).filter(Boolean));
	const recs = new Map();
	for (const s of records.screens) if (c.products[s.product]) recs.set(c.screenKey(s.key ?? s.id), s);
	const mods = registry.filter((m) => portals.has(m.portal));
	const seenKey = new Map(), seenRoute = new Map();
	for (const m of mods) {
		if (seenKey.has(m.key)) add('duplicate key', m.key, `registered twice`); else seenKey.set(m.key, m);
		if (m.route && seenRoute.has(m.route)) add('duplicate route', m.key, `${m.route} is also ${seenRoute.get(m.route).key}`); else if (m.route) seenRoute.set(m.route, m);
	}
	const blocking = (id) => records.questions.filter((q) => !DONE.has(q.status) && (q.blocks ?? []).includes(`rnd/screens/${id}`)).map((q) => q.id);
	for (const [key, s] of recs) {
		const m = seenKey.get(key);
		if (!m) { add('no module', key, `rnd/screens/${s.id} has no registered screen module`); continue; }
		matched.push({ id: s.id, key, stub: !!m.stub, build_status: s.build_status ?? null, prototype: s.prototype ?? null });
		if (s.route && m.route && s.route !== m.route) add('route', key, `record ${s.route} · module ${m.route}`);
		if (s.kind && m.kind && s.kind !== m.kind) add('kind', key, `record ${s.kind} · module ${m.kind}`);
		const p = portalOf(s); if (p && m.portal !== p) add('portal', key, `record ${p} · module ${m.portal}`);
		const missingRows = (s.scope_rows ?? []).filter((r) => !(m.prd ?? []).includes(r));
		if (missingRows.length) add('rules', key, `scope_rows not in the module's prd: ${missingRows.join(', ')}`);
		const missingOpen = blocking(s.id).filter((q) => !(m.open ?? []).includes(q));
		if (missingOpen.length) add('open', key, `blocking questions not in the module's open: ${missingOpen.join(', ')}`);
		if (Array.isArray(m.stories)) {
			const recStories = records.stories.filter((x) => x.screen === `rnd/screens/${s.id}`).map((x) => x.key ?? x.id);
			if (!same(recStories, m.stories)) add('stories', key, `records ${recStories.join(', ') || '—'} · module ${m.stories.join(', ') || '—'}`);
		}
	}
	for (const m of mods) if (!recs.has(m.key)) add('no record', m.key, `registered module with no rnd/screens record in scope`);
	return { mismatches, matched };
}

export async function run(dir, { json = false, apply = false, strict = false, dt, log = console.log, error = console.error } = {}) {
	const c = await loadConfig(dir);
	if (apply && !c.prototype) { error('check --apply needs "prototype" in harness.config.mjs (rnd/prototypes/<id>)'); return 2; }
	const run = dt ?? dtRunner(c.workspace);
	const records = readRecords(c, { dt: run });
	const registry = await loadRegistry(c.paths.registry);
	const { mismatches, matched } = compare(c, records, registry);
	const vendored = vendorStatus(c.paths.harness);
	const edited = vendored.filter((v) => v.state === 'edited' || v.state === 'unstamped');
	const stale = vendored.filter((v) => v.state === 'stale' || v.state === 'missing');
	const applied = [];
	if (apply && !mismatches.length) {
		for (const m of matched) {
			if (m.build_status === 'verified') continue;
			const want = m.stub ? 'in-progress' : 'built';
			if (m.build_status === want && m.prototype === c.prototype) continue;
			const args = ['set', `rnd/screens/${m.id}`, `build_status=${want}`, `prototype=${c.prototype}`];
			log(`dreamteamer ${args.join(' ')}`);
			run(args);
			applied.push(m.id);
		}
	}
	if (json) log(JSON.stringify({ version: VERSION, mismatches, matched: matched.length, vendored, applied }, null, 2));
	else {
		for (const x of mismatches) error(`fail  ${x.kind.padEnd(15)} ${x.key}  ${x.detail}`);
		for (const v of edited) error(`fail  vendored        ${v.file}  ${v.state === 'edited' ? 'body no longer matches its stamp — a local edit' : 'not a vendored file'}`);
		for (const v of stale) error(`warn  vendored        ${v.file}  ${v.state === 'missing' ? 'missing — run dt-prototype vendor' : `stamped ${v.version}, the package is ${VERSION} — run dt-prototype vendor`}`);
		log(`${matched.length} screens matched · ${mismatches.length} mismatch(es) · vendored ${vendored.filter((v) => v.state === 'ok').length}/${vendored.length} current${apply ? ` · ${applied.length} record(s) set, nothing committed` : ''}`);
	}
	if (apply && mismatches.length) error('--apply wrote nothing: fix the mismatches first');
	return mismatches.length || edited.length || (strict && stale.length) ? 1 : 0;
}
