// The records bridge: `npx dt-prototype export [--check] [--strict]`. Reads the five rnd collections through
// `dt list --json` (records.mjs), joins them with the prototype's playback modules, and writes `<data>/journeys.js`
// and `<data>/meta.js`. The output is built from an allowlist, never by copying a row, and every string in both
// files passes through the prototype's `scrub`. `build` is pure; `run` does the reading and the writing.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig, productKey, portalValue, portalSource } from './config.mjs';
import { readRecords } from './records.mjs';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version;
export const STEP_KEYS = ['screen', 'story', 'persona', 'system', 'caption', 'scope_rows', 'open'];
export const DENY = ['content', 'source_files', 'source', 'creation_context', 'author', 'reads', 'writes'];
const DONE = new Set(['resolved', 'obsolete']);
const cut = (s, n) => (typeof s === 'string' && s.length > n ? `${s.slice(0, n - 1)}…` : s);
const idOf = (ref, collection) => (typeof ref === 'string' && ref.startsWith(`${collection}/`) ? ref.slice(collection.length + 1) : null);

/** Every string inside `v` through `fn`; object keys are left alone (build() checks identifiers separately). */
export function deepScrub(v, fn) {
	if (typeof v === 'string') return fn(v);
	if (Array.isArray(v)) return v.map((x) => deepScrub(x, fn));
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepScrub(x, fn)]));
	return v;
}

/**
 * Build both files from rows. `records` is readRecords' result; `playback` maps a journey key to its module's
 * default export (absent = no module); `rules` is the provider's `{ rules, notes }`; `store` the optional
 * `{ mutationNames(), fixtureNames() }`. Returns the two texts, the exported objects, and errors / warnings as
 * one line each.
 */
export function build(c, records, { playback = {}, rules = null, scrub = (s) => s, store = null, version = VERSION } = {}) {
	const errors = [], warnings = [];
	const S = new Map(records.screens.map((r) => [r.id, r]));
	const ST = new Map(records.stories.map((r) => [r.id, r]));
	const PE = new Map(records.personas.map((r) => [r.id, r]));
	const Q = new Map(records.questions.map((r) => [r.id, r]));
	const JR = new Map(records.journeys.map((r) => [r.id, r]));
	const productNames = new Map();

	// the scope: the config's products, each a record
	const productRefs = Object.keys(c.products);
	const products = new Set((records.products ?? []).map((p) => `rnd/products/${p.id}`));
	for (const ref of productRefs) if (!products.has(ref)) errors.push(`config: ${ref} is not an rnd/products record`);
	for (const p of records.products ?? []) productNames.set(`rnd/products/${p.id}`, p.name);

	// screens: in scope by product; portal by product key, or by a field through the map (several windows, one product)
	const screenInfo = new Map();
	for (const s of records.screens) {
		if (!c.products[s.product]) continue;
		let portal = productKey(c, s.product);
		if (c.portal.from !== 'product') {
			const v = portalValue(c, s);
			if (v == null) { portal = null; warnings.push(`rnd/screens/${s.id}: no ${portalSource(c)} — exported with no portal`); }
			else if (c.portal.map) {
				if (!(v in c.portal.map)) { errors.push(`rnd/screens/${s.id}: ${portalSource(c)} "${v}" is not in portal.map`); portal = null; }
				else portal = c.portal.map[v];
			} else portal = String(v);
		}
		screenInfo.set(s.id, { key: c.screenKey(s.key ?? s.id), portal, row: s });
	}
	const inScope = (screenId) => screenInfo.has(screenId);

	// groups: one per portal key, then cross
	const declared = [];
	const addGroup = (key, label) => { if (key && !declared.some((g) => g.key === key)) declared.push({ key, label: label ?? key }); };
	if (c.portal.from === 'product') for (const ref of productRefs) addGroup(c.products[ref].key, c.products[ref].label ?? productNames.get(ref) ?? c.products[ref].key);
	else for (const v of c.portal.map ? Object.values(c.portal.map) : [...new Set([...screenInfo.values()].map((x) => x.portal).filter(Boolean))]) addGroup(v, c.portal.labels?.[v]);
	addGroup(c.cross.key, c.cross.label);
	const order = c.groupOrder ?? [...declared.filter((g) => g.key !== c.cross.key).map((g) => g.key), c.cross.key];
	const groups = [...declared].sort((a, b) => (order.indexOf(a.key) + 1 || 1e9) - (order.indexOf(b.key) + 1 || 1e9));
	const groupKeys = new Set(groups.map((g) => g.key));

	// journeyFields: an allowlist, never a sensitive or deny-listed field
	for (const f of c.journeyFields) {
		if (DENY.includes(f)) errors.push(`config: journeyFields "${f}" is on the deny list (${DENY.join(', ')})`);
		if ((records.dropped?.journeys ?? []).includes(f)) errors.push(`config: journeyFields "${f}" is marked sensitive`);
	}

	const personaKey = (ref) => { const p = PE.get(idOf(ref, 'rnd/personas')); return p ? (p.key ?? p.id) : null; };
	const usedPersonas = new Set();
	const relevantQ = new Set();
	const blockedBy = (target) => records.questions.filter((q) => (q.blocks ?? []).includes(target)).map((q) => q.id);
	const storyUse = new Map(); // story id → [{ journey, n }]
	const journeys = [];

	for (const j of records.journeys) {
		const steps = Array.isArray(j.steps) ? j.steps : [];
		const touches = steps.some((s) => inScope(idOf(s?.screen, 'rnd/screens'))) || (j.products ?? []).some((p) => c.products[p]);
		if (!touches) continue;
		const where = `rnd/user-journeys/${j.id}`;
		if (!steps.length) { errors.push(`${where}: in scope with no steps`); continue; }
		const out = [];
		steps.forEach((s, i) => {
			const at = `${where} step ${i + 1}`;
			for (const k of Object.keys(s ?? {})) if (!STEP_KEYS.includes(k)) errors.push(`${at}: unknown key "${k}"`);
			for (const k of ['scope_rows', 'open']) if (s?.[k] != null && !Array.isArray(s[k])) errors.push(`${at}: ${k} is not a list`);
			const sid = idOf(s?.screen, 'rnd/screens');
			if (!sid || !S.has(sid)) { errors.push(`${at}: screen ${s?.screen ?? '(none)'} resolves to no record`); return; }
			let story = null;
			if (s.story != null) {
				story = ST.get(idOf(s.story, 'rnd/user-stories'));
				if (!story) { errors.push(`${at}: story ${s.story} resolves to no record`); return; }
				if (!storyUse.has(story.id)) storyUse.set(story.id, []);
				storyUse.get(story.id).push({ journey: j, n: i + 1 });
				if (story.screen && story.screen !== s.screen) warnings.push(`${at}: story ${story.key} is on ${story.screen}, the step on ${s.screen}`);
				if (!(story.journeys ?? []).includes(where)) warnings.push(`${at}: story ${story.key} does not list ${where} in its journeys`);
			}
			if (s.persona != null && !personaKey(s.persona)) { errors.push(`${at}: persona ${s.persona} resolves to no record`); return; }
			const open = Array.isArray(s.open) ? s.open : [];
			for (const o of open) { const q = idOf(o, 'rnd/open-questions'); if (!Q.has(q)) errors.push(`${at}: open ${o} resolves to no record`); else relevantQ.add(q); }
			if (s.persona) usedPersonas.add(personaKey(s.persona));
			const info = screenInfo.get(sid);
			const step = {
				n: i + 1, story: story ? story.key : null, sentence: story ? story.name : null, caption: s.caption ?? null,
				persona: s.persona ? personaKey(s.persona) : null, screen: info ? info.key : c.screenKey(S.get(sid).key ?? sid),
				portal: info ? info.portal : null, rules: Array.isArray(s.scope_rows) ? s.scope_rows : [], open: open.map((o) => idOf(o, 'rnd/open-questions')),
				system: s.system === true,
			};
			if (!info) { step.outOfScope = true; step.portal = null; warnings.push(`${at}: screen ${s.screen} is outside the prototype — exported outOfScope`); }
			out.push(step);
		});
		if (out.length !== steps.length) continue;
		for (const p of j.personas ?? []) { const k = personaKey(p); if (k) usedPersonas.add(k); }
		const jOpen = blockedBy(where);
		jOpen.forEach((q) => relevantQ.add(q));
		const jo = {
			key: j.key ?? j.id, name: j.name ?? null, description: j.description ?? null, group: null, entry: j.entry ?? null, outcome: j.outcome ?? null,
			personas: (j.personas ?? []).map(personaKey).filter(Boolean), acceptance: j.acceptance ?? [], failures: j.failures ?? [], open: jOpen,
		};
		for (const f of c.journeyFields) if (!DENY.includes(f) && !(records.dropped?.journeys ?? []).includes(f) && j[f] !== undefined) jo[f] = j[f];
		jo.steps = out;
		const portals = [...new Set(out.filter((s) => !s.outOfScope).map((s) => s.portal).filter(Boolean))];
		let g = portals.length === 1 ? portals[0] : c.cross.key;
		if (c.group) { try { g = c.group(jo); } catch (e) { errors.push(`${where}: group() threw ${e.message}`); } }
		if (!groupKeys.has(g)) errors.push(`${where}: group "${g}" is not a declared group (${[...groupKeys].join(', ')})`);
		jo.group = g;

		// the playback module: HOW, joined to the record by position
		const mod = playback[jo.key];
		if (!mod) errors.push(`${where}: no playback module ${jo.key}.js`);
		else {
			if (mod.key !== jo.key) errors.push(`${where}: playback module key "${mod.key}" is not its file name`);
			if (!Array.isArray(mod.steps) || mod.steps.length !== out.length) errors.push(`${where}: playback module has ${mod.steps?.length ?? 0} steps, the record ${out.length}`);
			else mod.steps.forEach((ms, i) => {
				if (ms.story !== undefined && ms.story !== out[i].story) errors.push(`${where} step ${i + 1}: playback story "${ms.story}" is not the record's "${out[i].story}"`);
				if (store) {
					const names = new Set(store.mutationNames?.() ?? []); const fixtures = new Set(store.fixtureNames?.() ?? []);
					for (const a of [].concat(ms.action || [])) if (a && names.size && !names.has(a.name)) errors.push(`${where} step ${i + 1}: action "${a.name}" is not a store mutation`);
					const fx = typeof ms.setup === 'string' ? ms.setup : ms.setup?.fixture;
					if (fx && fixtures.size && !fixtures.has(fx)) errors.push(`${where} step ${i + 1}: setup "${fx}" is not a store fixture`);
				}
			});
		}
		journeys.push(jo);
	}

	// stories and anchors: every story on an in-scope screen
	const stories = {}, anchors = {};
	for (const s of records.stories) {
		const sid = idOf(s.screen, 'rnd/screens');
		if (!inScope(sid)) continue;
		const key = screenInfo.get(sid).key;
		stories[s.key ?? s.id] = { name: s.name ?? null, screen: key };
		(anchors[key] ??= []).push(s.key ?? s.id);
		if (!storyUse.has(s.id)) warnings.push(`rnd/user-stories/${s.id}: in scope and on no journey's steps`);
		if (s.journey != null && s.journey !== '') {
			const use = (storyUse.get(s.id) ?? []).find((u) => (u.journey.key ?? u.journey.id) === s.journey);
			if (!use || (s.step != null && use.n !== s.step)) warnings.push(`rnd/user-stories/${s.id}: legacy journey/step (${s.journey} ${s.step ?? '—'}) disagree with steps — run migrate-journey-steps`);
		}
	}

	// questions: blocking an in-scope screen or journey, or named by a step
	for (const [sid] of screenInfo) for (const q of blockedBy(`rnd/screens/${sid}`)) {
		relevantQ.add(q);
		if (DONE.has(Q.get(q).status)) warnings.push(`rnd/open-questions/${q}: ${Q.get(q).status} but still blocks rnd/screens/${sid}`);
	}
	for (const q of relevantQ) for (const b of Q.get(q)?.blocks ?? []) {
		const s = idOf(b, 'rnd/screens'), jr = idOf(b, 'rnd/user-journeys');
		if (s != null && !S.has(s)) errors.push(`rnd/open-questions/${q}: blocks ${b}, which resolves to nothing`);
		if (jr != null && !JR.has(jr)) errors.push(`rnd/open-questions/${q}: blocks ${b}, which resolves to nothing`);
	}
	const open = {};
	for (const q of [...relevantQ].sort()) { const r = Q.get(q); open[q] = { q: cut(r.question ?? r.name ?? '', 320), s: r.status ?? 'open', l: cut(r.lean ?? '', 240) }; }

	// personas: the product roles the journeys name; a research panel is never exported
	const personas = {};
	for (const p of records.personas) {
		const k = p.key ?? p.id; if (!usedPersonas.has(k)) continue;
		if (p.kind != null && p.kind !== 'product-role') { warnings.push(`rnd/personas/${p.id}: named by a journey but kind ${p.kind}, not product-role — its name is not exported`); continue; }
		personas[k] = p.name ?? k;
	}

	// scrub: prose through the prototype's scrub; an identifier is never rewritten — the screens draw it and the files
	// join on it — so one the scrub would change is a failure naming it, and the record is renamed instead
	const flagged = new Set();
	const id = (v, what) => {
		if (typeof v === 'string' && scrub(v) !== v && !flagged.has(`${what}:${v}`)) { flagged.add(`${what}:${v}`); errors.push(`${what} "${v}" contains a scrubbed term — rename the record (identifiers are never rewritten)`); }
		return v;
	};
	const prose = (v) => deepScrub(v, scrub);
	const ID_STEP = ['story', 'persona', 'screen', 'portal'];
	const J = {
		groups: groups.map((g) => ({ key: id(g.key, 'group'), label: prose(g.label) })),
		personas: Object.fromEntries(Object.entries(personas).map(([k, v]) => [id(k, 'persona'), prose(v)])),
		journeys: journeys.map((j) => Object.fromEntries(Object.entries(j).map(([k, v]) => [k,
			k === 'key' ? id(v, 'journey') : k === 'group' ? id(v, 'group')
				: k === 'personas' ? v.map((x) => id(x, 'persona')) : k === 'open' ? v.map((x) => id(x, 'open question'))
					: k === 'steps' ? v.map((s) => Object.fromEntries(Object.entries(s).map(([sk, sv]) => [sk,
						ID_STEP.includes(sk) ? id(sv, sk) : sk === 'rules' ? sv.map((x) => id(x, 'rule')) : sk === 'open' ? sv.map((x) => id(x, 'open question')) : prose(sv)])))
						: prose(v)]))),
		stories: Object.fromEntries(Object.entries(stories).map(([k, v]) => [id(k, 'story'), { name: prose(v.name), screen: id(v.screen, 'screen') }])),
		anchors: Object.fromEntries(Object.entries(anchors).map(([k, v]) => [id(k, 'screen'), v.map((x) => id(x, 'story'))])),
	};
	const keyed = (m, what) => Object.fromEntries(Object.entries(m).map(([k, v]) => [id(k, what), prose(v)]));
	const M = { rules: keyed(rules?.rules ?? {}, 'rule'), notes: keyed(rules?.notes ?? {}, 'note'), open: keyed(open, 'open question') };
	const head = (what) => `// generated by dt-prototype export (@dreamteamer/rnd ${version}) from ${what} — do not edit\n`;
	const line = (name, v) => `export const ${name} = ${JSON.stringify(v)};\n`;
	const journeysJs = head('rnd/user-journeys · rnd/user-stories · rnd/screens · rnd/personas · rnd/open-questions')
		+ 'export const schema = 1;\n' + line('groups', J.groups) + line('personas', J.personas)
		+ `export const journeys = [\n${J.journeys.map((x) => JSON.stringify(x)).join(',\n')}\n];\n`
		+ line('stories', J.stories) + line('anchors', J.anchors) + 'export default journeys;\n';
	const metaJs = head('rnd/open-questions and the prototype\'s rules provider') + 'export const schema = 1;\n'
		+ line('rules', M.rules) + line('notes', M.notes) + line('open', M.open) + 'export default { rules, notes, open };\n';
	return { journeysJs, metaJs, journeys: J, meta: M, errors, warnings, counts: { journeys: journeys.length, steps: journeys.reduce((n, j) => n + j.steps.length, 0), stories: Object.keys(stories).length, questions: Object.keys(open).length } };
}

const importFresh = async (file) => import(`${pathToFileURL(file).href}?t=${fs.statSync(file).mtimeMs}`);

/** Load what `build` needs beyond the records: the playback modules, the rules provider, the scrubber, the store. */
export async function loadInputs(c, journeyKeys) {
	const playback = {};
	for (const key of journeyKeys) {
		const f = path.join(c.paths.playback, `${key}.js`);
		if (fs.existsSync(f)) playback[key] = (await importFresh(f)).default;
	}
	const rules = c.paths.rules ? await (await importFresh(c.paths.rules)).default() : null;
	const scrub = c.paths.scrub ? (await importFresh(c.paths.scrub)).default : (s) => s;
	const store = c.paths.store ? await importFresh(c.paths.store) : null;
	return { playback, rules, scrub, store: store && (store.mutationNames || store.fixtureNames) ? store : null };
}

/** `dt-prototype export` — exit 0 written or unchanged; 1 on a failure, a warning under --strict, or a pending change under --check. */
export async function run(dir, { check = false, strict = false, dt, log = console.log, error = console.error } = {}) {
	const c = await loadConfig(dir);
	const records = readRecords(c, dt ? { dt } : {});
	const keys = records.journeys.map((j) => j.key ?? j.id);
	const inputs = await loadInputs(c, keys);
	const r = build(c, records, inputs);
	for (const w of r.warnings) error(`warn  ${w}`);
	for (const e of r.errors) error(`fail  ${e}`);
	if (r.errors.length) { error(`${r.errors.length} failure(s) — nothing written`); return 1; }
	if (strict && r.warnings.length) { error(`${r.warnings.length} warning(s) under --strict — nothing written`); return 1; }
	const files = [[path.join(c.paths.data, 'journeys.js'), r.journeysJs], [path.join(c.paths.data, 'meta.js'), r.metaJs]];
	const stale = files.filter(([f, text]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== text);
	const summary = `${r.counts.journeys} journeys · ${r.counts.steps} steps · ${r.counts.stories} stories · ${r.counts.questions} questions`;
	if (check) {
		if (stale.length) { error(`${stale.map(([f]) => path.relative(c.dir, f)).join(', ')} would change — run dt-prototype export`); return 1; }
		log(`up to date · ${summary}`); return 0;
	}
	for (const [f, text] of stale) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); }
	log(`${stale.length ? `wrote ${stale.map(([f]) => path.relative(c.dir, f)).join(', ')}` : 'unchanged'} · ${summary}`);
	return 0;
}
