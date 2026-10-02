// `dt prove` — a proof declares behaviour this package judges, the way a command-binding declares
// gates the engine evaluates. This module owns the closed vocabulary of a proof source, the one
// enumeration of the artifacts a proof may be about, the runner, the ledger and the read surfaces.
//
// Validation lives here and compile calls it (through this extension's `analyze`), because both
// directions of a mistake in a proof are silent. `about: skills/greter` names nothing, so the proof
// proves nothing and reports success. `where: { statuz: { _eq: open } }` narrows to zero rows (an
// unknown key fails closed in the engine's filter), so a `count: { _eq: 0 }` expectation passes
// forever and a `_gte: 1` one fails forever, for a reason no output names. So compile refuses a proof
// it cannot interpret, on the rule ui-view and command-binding filters follow: a value is validated
// iff it is interpreted.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dt } from './engine.js';
import { createWorktree, removeWorktree } from './sandbox.js';

export const PROOF_KINDS = ['gate', 'live'];

/**
 * The verdict of a proof, as a process exit code — a contract, so a script can branch on it without
 * parsing prose. `USAGE` is not reachable from any proof state; `exitFor` is the state → code map.
 */
export const EXIT = { PASS: 0, FAIL: 1, USAGE: 2, UNAVAILABLE: 3, NO_FIXTURE: 4, PENDING: 5, VACUOUS: 6 };

/** How many rows one proof's ledger keeps. Per proof, per machine — a ledger answers "what happened
 *  recently", and an unbounded one is a file nobody ever reads the end of. */
export const LEDGER_CAP = 50;

/**
 * The dot matters. `.dreamteamer/proofs/` is a kind folder (this package contributes it), and compile
 * wipes every kind folder on every run, so a ledger there would be destroyed by the next compile. A
 * dot-prefixed sibling is never named by that loop, is skipped by every source enumeration, and is
 * gitignored with the rest of `.dreamteamer/`.
 *
 * `rm -rf .dreamteamer` takes the ledger with it. The consequence is re-proving, not data loss: the
 * ledger is per-machine evidence, and what a proof asserts lives in the committed source.
 */
export const LEDGER_DIR = '.proofs';

/**
 * EVERY artifact reference this workspace compiles, per kind — `skills/<id>`, `commands/<id>`,
 * `command-bindings/<id>` and `<module-id>/bin/<file>`.
 *
 * One function, three callers: compile resolves `about` against it, the coverage line takes its
 * denominators from it, and `prove --missing` lists what it holds that no proof names.
 *
 * `source` is either what compile has at hand mid-run — the `entries` Map (or an object carrying
 * one) — or a Store, which is what a CLI-time caller has. The two agree by construction: a Store
 * reads the same staged bytes compile wrote, and a module record carries the same `bin` list
 * compile projected onto it.
 *
 * @param {Map|{entries: Map}|object} source   compile entries, or the engine's Store
 * @returns {{skills: string[], commands: string[], bindings: string[], scripts: string[], all: Set<string>}}
 */
export function artifactRefs(source) {
	const entries = source instanceof Map ? source : source?.entries instanceof Map ? source.entries : null;
	if (entries) return finish(fromEntries(entries));
	if (source && typeof source.readAll === 'function') return finish(fromStore(source));
	throw new Error('artifactRefs needs compile entries (a Map) or a Store');
}

const blank = () => ({ skills: [], commands: [], bindings: [], scripts: [] });

function finish(out) {
	for (const k of Object.keys(out)) out[k].sort();
	out.all = new Set([...out.skills, ...out.commands, ...out.bindings, ...out.scripts]);
	return out;
}

/** From compile's `entries` — runtime path → {sources, bytes}. */
function fromEntries(entries) {
	const out = blank();
	for (const [rt, e] of entries) {
		let m;
		// `skills/<id>/SKILL.md` only: a skill is a folder, and its `references/*.md` are entries too
		if ((m = /^skills\/([^/]+)\/SKILL\.md$/.exec(rt))) out.skills.push(`skills/${m[1]}`);
		else if ((m = /^commands\/(.+)\.command\.md$/.exec(rt))) out.commands.push(`commands/${m[1]}`);
		else if ((m = /^command-bindings\/(.+)\.command-binding\.yaml$/.exec(rt))) out.bindings.push(`command-bindings/${m[1]}`);
		else if ((m = /^modules\/(.+)\.module\.yaml$/.exec(rt))) {
			let d = {};
			try { d = dt.loadYaml(e.bytes.toString('utf8')) ?? {}; } catch { /* unparseable projection: no scripts */ }
			for (const f of d.bin ?? []) out.scripts.push(`${m[1]}/${f}`);
		}
	}
	return out;
}

/** From a Store — the same four collections, read out of the compiled runtime. */
function fromStore(store) {
	const out = blank();
	const has = (c) => store.descriptors?.has?.(c);
	for (const [collection, sink, prefix] of [['skills', out.skills, 'skills/'], ['commands', out.commands, 'commands/'], ['command-bindings', out.bindings, 'command-bindings/']]) {
		if (!has(collection)) continue;
		for (const { id } of store.readAll(collection)) sink.push(`${prefix}${id}`);
	}
	if (has('modules')) {
		for (const { id, fields } of store.readAll('modules')) {
			for (const f of fields?.bin ?? []) out.scripts.push(`${id}/${f}`);
		}
	}
	return out;
}

/** The proof file an artifact's proof would be written to, given the module root that ships it —
 *  what the nudge names, so the reader never has to derive a path from a rule. */
export function proofPathFor(artifactRef, moduleRoot) {
	const id = path.basename(artifactRef).replace(/\.[^.]+$/, '');
	// `.` is the root layout's module root (a workspace with no `workspace_module`): its sources sit
	// at the workspace root, so the path has no prefix at all
	return moduleRoot && moduleRoot !== '.' ? `${moduleRoot}/proofs/${id}.proof.yaml` : `proofs/${id}.proof.yaml`;
}

// ── validation ──────────────────────────────────────────────────────────────────────────────────

/** Filter operators whose operand is a literal value of the field, and so can be checked against a
 *  closed enum. `_contains`/`_starts_with` take a fragment, not a value; `_null`/`_empty` take a
 *  boolean; range operators on an enum field are meaningless but not a typo. */
const ENUM_CHECKED = new Set(['_eq', '_neq', '_in', '_nin']);

/** The operators `count` accepts. `_delta` exists on no filter (it is after-minus-before, which only
 *  a proof has two sides of), and the ordering operators that overlap are a strict subset of the
 *  filter set — `_contains` on a record count is nonsense. So the engine's filter walker cannot judge
 *  a count map: it would read `_delta` as a typo and `_gtee` as fine. */
const COUNT_OPERATORS = ['_eq', '_neq', '_gt', '_gte', '_lt', '_lte', '_delta'];

/** The literal values an operand stands for. `_in`/`_nin` accept a comma string — the engine's
 *  filter splits a non-array operand — so `_in: 'open,done'` is a two-value filter. Every other
 *  op takes its operand whole: a comma in an `_eq` is part of the value. */
function literalsFor(op, operand) {
	if (op !== '_in' && op !== '_nin') return [operand];
	return Array.isArray(operand) ? operand : String(operand).split(',').map((x) => x.trim());
}

/**
 * Every way a proof can be wrong, as printable lines — empty means valid.
 *
 * Called by compile (which prefixes each line with the proof's runtime path and fails) and unit-
 * tested in isolation. Ordered and short-circuiting: one mistake produces one error, so the reader
 * is sent to the right line.
 *
 * @param {object} proof                     the parsed proof source
 * @param {object} ctx
 * @param {Map} ctx.descriptors              collection name → merged descriptor
 * @param {string[]} ctx.declaredVars        the workspace's `dreamteamer.vars`
 * @param {Set<string>} ctx.moduleEnv        every key any module declares in `dreamteamer.env`
 * @param {Set<string>} ctx.artifacts        `artifactRefs(...).all`
 * @returns {string[]}
 */
export function validateProofShape(proof, ctx) {
	const errors = [];
	const p = proof ?? {};
	const descriptors = ctx?.descriptors ?? new Map();
	const artifacts = ctx?.artifacts ?? new Set();

	// ---- about: what this proof is FOR. Unresolvable = a proof about nothing.
	const about = Array.isArray(p.about) ? p.about : [];
	if (!about.length) errors.push('about is required and names at least one artifact');
	for (const ref of about) {
		if (!artifacts.has(String(ref))) {
			errors.push(`about "${ref}" names no artifact — an artifact is skills/<id>, commands/<id>, command-bindings/<id>, or <module>/bin/<file>`);
		}
	}

	// ---- kind, and the two shapes it selects. An unknown kind stops here: judging a proof against
	// the wrong shape's rules produces errors about keys the author never meant to write.
	const kind = p.kind;
	if (!PROOF_KINDS.includes(kind)) {
		errors.push('kind must be gate or live');
		pushTimeout(errors, p);
		return errors;
	}
	const steps = Array.isArray(p.steps) ? p.steps : [];
	// Where a proof may write is decided by `given.fixture` and `--here`, never by a declared key.
	if (p.mode !== undefined) errors.push('mode is not a proof key — a live proof runs in a sandbox exactly when given.fixture: true');
	if (kind === 'gate') {
		// A gate is a static check: it RUNS things and reads their exit codes. No record to pick, no
		// post-state to judge, and no `perform` — a step that asks a human is not a gate.
		if (p.given !== undefined || p.expect !== undefined || !steps.length || steps.some((s) => !s || s.run === undefined)) {
			errors.push('a gate proof has run steps only and no given or expect');
		}
	} else {
		const expect = Array.isArray(p.expect) ? p.expect : [];
		if (!steps.length || !expect.length) errors.push('a live proof needs at least one step and one expectation');
		errors.push(...givenErrors(p.given, descriptors));
		errors.push(...expectErrors(expect, p.given, descriptors, steps.length));
		errors.push(...storeExpectErrors(expect, p.given, steps));
	}

	// ---- requires.env: a key nothing declares is a proof that reports UNAVAILABLE forever.
	for (const name of p.requires?.env ?? []) {
		if ((ctx?.declaredVars ?? []).includes(String(name)) || ctx?.moduleEnv?.has?.(String(name))) continue;
		errors.push(`requires.env "${name}" is not declared — add it to dreamteamer.vars or a module's dreamteamer.env`);
	}

	// ---- unknown filter operators, from every `where` in the proof at once: one sorted line, from
	// the engine's own walker, so validator and filter agree on which operators exist. `count:` is
	// not walked — `_delta` belongs to proofs, not to filters, and the walker would call it a typo.
	const badOps = new Set();
	for (const where of everyWhere(p)) for (const op of dt.unknownOperators(where)) badOps.add(op);
	if (badOps.size) errors.push(`unknown filter operator(s) ${[...badOps].sort().join(', ')}`);

	pushTimeout(errors, p);
	return errors;
}

/**
 * A store expectation (the collection or record form) judges what the steps wrote. Outside a
 * sandbox a `run` step may not write `data/`, so such a row needs a `perform` step or a fixture —
 * otherwise it can only answer VACUOUS or FAIL.
 */
function storeExpectErrors(expect, given, steps) {
	if (!steps.length || given?.fixture === true || steps.some((s) => s?.perform !== undefined)) return [];
	const errors = [];
	for (const [i, e] of expect.entries()) {
		if (formsIn(e).length > 1) continue; // a mixed row is refused on its own
		const form = formOf(e);
		if (form === 'collection' || form === 'record') {
			errors.push(`expect[${i}] judges the store, which a run step outside a sandbox may not write — add given.fixture: true or a perform step`);
		}
	}
	return errors;
}

function pushTimeout(errors, p) {
	if (p.timeout === undefined) return;
	if (!Number.isInteger(p.timeout) || p.timeout <= 0) errors.push('timeout must be a positive integer of seconds');
}

/** Every `where` map a proof carries, plus the output matchers, which are filter maps too. */
function everyWhere(p) {
	const out = [];
	if (p.given?.where && typeof p.given.where === 'object') out.push(p.given.where);
	for (const e of Array.isArray(p.expect) ? p.expect : []) {
		if (e?.where && typeof e.where === 'object') out.push(e.where);
		if (e?.stdout && typeof e.stdout === 'object') out.push(e.stdout);
		for (const cond of Object.values(e?.stdout_json ?? {})) {
			if (cond && typeof cond === 'object') out.push(cond);
		}
	}
	return out;
}

function givenErrors(given, descriptors) {
	if (given === undefined) return []; // a live proof may judge only steps, paths and collection counts
	const errors = [];
	const collection = String(given?.collection ?? '');
	const d = descriptors.get(collection);
	if (!d) return [`given.collection "${collection}" is not a collection`];

	// exactly one source for the record — a live filter over the workspace, or a checked-in fixture.
	// Both is ambiguous; neither leaves `{record}` unbound.
	const hasWhere = given?.where !== undefined;
	const hasFixture = given?.fixture !== undefined && given.fixture !== false;
	if (hasWhere === hasFixture) errors.push('given needs exactly one of where or fixture');

	// a fixture folder holds records; `pick` names the one this proof runs against. Without it there
	// is nothing to bind, and the proof would pick arbitrarily.
	if (hasFixture && given?.pick === undefined) errors.push('a fixture needs pick: <id> naming one of its records');

	if (given?.pick === 'any') {
		errors.push('pick: any is not accepted — a proof names its record or uses a fixture');
	} else if (given?.pick === 'latest' && !orderingFieldOf(d)) {
		// `latest` means "the collection's own ordering field, descending" — with none there is no
		// ordering to take the head of, and the proof would run against an arbitrary record.
		errors.push(LATEST_NEEDS(collection));
	}

	if (hasWhere && given.where && typeof given.where === 'object') {
		// nothing substitutes in `given.where`: the given is what picks the record, so when this filter
		// runs there is no record to bind to, and a `{record}` here would answer NO-FIXTURE forever.
		// The refusal replaces the ordinary checks rather than joining them: one mistake, one error.
		if (hasSubstitutable(given.where)) errors.push('given.where cannot use {record} — the given is what PICKS the record');
		else errors.push(...whereErrors(given.where, collection, descriptors));
	}
	return errors;
}

/**
 * The one answer to "what shape is this row", exported so compile and the judge both call it. A row
 * judged as the wrong form produces zero verdict lines, and `every(ok)` over an empty list is true —
 * so the two sides must agree, and a row whose keys span two forms is refused by compile.
 *
 * `where` is not a discriminator: it belongs to two forms. `step` is optional on the output form (it
 * defaults to the last run step), so that form is recognised by what it asserts.
 *
 * @param {object} row  one entry of `expect[]`
 * @returns {'collection'|'record'|'step'|'path'|null}
 */
export function formOf(row) {
	const r = row ?? {};
	if ('collection' in r && 'where' in r && 'count' in r) return 'collection';
	if ('record' in r && 'where' in r) return 'record';
	if ('exit' in r || 'stdout' in r || 'stdout_json' in r) return 'step';
	if ('path' in r && 'exists' in r) return 'path';
	return null;
}

/** Which form each DISCRIMINATING key belongs to — `where` is deliberately absent (it belongs to
 *  two), and so is a bare `step:` index, which is meaningless without something to assert. */
const FORM_OF_KEY = {
	collection: 'collection', count: 'collection',
	record: 'record',
	exit: 'step', stdout: 'step', stdout_json: 'step',
	path: 'path', exists: 'path',
};

/** Every form this row's keys reach into — one entry for a well-formed row, two or more for a
 *  mixture compile refuses. */
function formsIn(row) {
	const out = new Set();
	for (const k of Object.keys(row ?? {})) if (FORM_OF_KEY[k]) out.add(FORM_OF_KEY[k]);
	return [...out];
}

function expectErrors(expect, given, descriptors, stepCount = 0) {
	const errors = [];
	for (const [i, e] of expect.entries()) {
		const row = e ?? {};
		// a mixture is refused before anything else is said about the row: it has no single meaning
		// to validate against
		const forms = formsIn(row);
		if (forms.length > 1) {
			errors.push(`expect[${i}] mixes two forms — a row is one of collection+where+count · record+where · step · path+exists`);
			continue;
		}
		const form = formOf(row);
		if ('collection' in row && !descriptors.has(String(row.collection))) {
			errors.push(`expect[${i}].collection "${row.collection}" is not a collection`);
		} else if (!form) {
			errors.push(`expect[${i}] needs one of: collection+where+count · record+where · step+exit/stdout/stdout_json · path+exists`);
		} else if (row.where && typeof row.where === 'object') {
			// a collection-scope where is judged against THAT collection; a `record:` where against the
			// picked record's own collection, which is `given.collection`.
			const scope = form === 'collection' ? String(row.collection) : String(given?.collection ?? '');
			if (descriptors.has(scope)) errors.push(...whereErrors(row.where, scope, descriptors));
		}
		// any `where` carrying `{record}` needs a `given` to bind it; without one `substituteWhere`
		// would throw at run time
		if (given === undefined && hasSubstitutable(row.where)) {
			errors.push('an expectation uses {record} but this proof declares no given');
		}
		// a `step:` past the end would be judged against an exit code no step produced
		if (form === 'step' && Number.isInteger(row.step) && row.step > stepCount) {
			errors.push(`expect[${i}] step ${row.step} is past the last step (${stepCount})`);
		}
		const hasRecord = form === 'record';
		// `{record}` is bound by `given`; without one the proof cannot run, so compile refuses it
		if (hasRecord && given === undefined) errors.push('a record expectation needs a given — nothing binds {record}');
		// `record:` has exactly one legal value: the judge takes the picked record off `given` and
		// never reads `e.record`, so any other value would be judged against a record it does not name
		if (hasRecord && String(row.record) !== '{record}') {
			errors.push('a record expectation targets {record} — the picked record is its only target');
		}
		// a `record:` entry must assert something: an empty `where` produces zero verdict lines, and
		// the proof would pass having measured nothing. A bare `where:` parses to null and `where: done`
		// to a string, so the guard turns on the shape. On a collection entry `count:` carries the
		// assertion, so `{collection, where: {}, count: {_delta: 1}}` stays legal.
		if (hasRecord && (row.where === null || typeof row.where !== 'object' || !Object.keys(row.where).length)) {
			errors.push(`expect[${i}] where must name at least one condition`);
		}
		// only the collection form has a count; anywhere else it is part of a refused mixture
		if (form === 'collection') errors.push(...countErrors(row.count, i));
		// `stdout` and `stdout_json` are filter maps, and the judge reads only an object — a scalar,
		// an array or a bare `stdout:` (null) would produce zero verdict lines and pass
		if (form === 'step') {
			if ('stdout' in row && !isPlainMap(row.stdout)) errors.push(`expect[${i}] stdout must be a filter object, e.g. { _contains: "…" }`);
			if ('stdout_json' in row && !isPlainMap(row.stdout_json)) errors.push(`expect[${i}] stdout_json must be a map of dotted paths to filter objects`);
			// an empty map matches everything, so it asserts nothing — the same rule `count: {}` gets
			if (isPlainMap(row.stdout) && !Object.keys(row.stdout).length) errors.push(`expect[${i}] stdout must name at least one condition`);
			if (isPlainMap(row.stdout_json) && !Object.keys(row.stdout_json).length) errors.push(`expect[${i}] stdout_json must name at least one path`);
		}
	}
	return errors;
}

/** A YAML mapping and nothing else — not null (a bare `key:`), not an array, not a scalar. The one
 *  test three separate guards need, because every one of them is a key whose VALUE is a filter. */
function isPlainMap(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

/** A count map's operators and operands. Its own closed set (see COUNT_OPERATORS), and every
 *  operand an integer: a count is a number of records, so `_gte: 'one'` and `_eq: 1.5` could never
 *  be satisfied. A bare scalar is the `_eq` it stands for. */
function countErrors(count, index) {
	const errors = [];
	const isMap = isPlainMap(count);
	// `count: {}` compares nothing, so the expectation holds for EVERY possible count — the same
	// silent green an empty `where` produces, and no reading of it asserts anything.
	if (isMap && !Object.keys(count).length) return [`expect[${index}] count must name one operator`];
	const pairs = isMap
		? Object.entries(count)
		: [['_eq', count]];
	for (const [op, operand] of pairs) {
		if (!COUNT_OPERATORS.includes(op)) { errors.push(`count operator "${op}" is not one of ${COUNT_OPERATORS.join(' ')}`); continue; }
		if (!Number.isInteger(operand)) errors.push(`count "${op}" compares "${operand}", which is not an integer`);
	}
	return errors;
}

/**
 * The field `pick: latest` orders by: the collection's manual order (its `type: position` field),
 * else the field its own list is sorted on (`display.list.sort`, the direction dropped — `latest` is
 * always the HIGHEST value). Undefined when the collection declares neither.
 */
export function orderingFieldOf(d) {
	if (!d) return undefined;
	const position = dt.positionFieldOf(d);
	if (position) return position;
	const sort = dt.displayOf(d).list?.sort;
	return typeof sort === 'string' && sort ? sort.split(',')[0].trim().replace(/^-/, '') : undefined;
}
const LATEST_NEEDS = (collection) => `pick: latest needs an ordering on ${collection} — a type: position field, or display.list.sort — or name the record (pick: <id>), or use a fixture`;

/**
 * A `where` checked against the descriptor of the collection it filters — ONE hop deep.
 *
 * A key that does not start with `_` is a one-hop reference traversal, not a field-vs-field
 * comparison. `{a: {b: …}}` means "resolve `a` as a `<collection>/<id>` ref and
 * test the target's `b`" — and when `a` is not a reference field, `matchesFilter` narrows to false
 * with no warning at all. So a nested key under a non-reference field is refused BY NAME, with what
 * a nested key actually means, rather than left to fail closed at run time.
 */
function whereErrors(where, collection, descriptors, errors = []) {
	const d = descriptors.get(collection);
	const props = d ? dt.fieldsOf(d) : {};
	for (const [key, cond] of Object.entries(where)) {
		if (key === '_and' || key === '_or') {
			for (const c of Array.isArray(cond) ? cond : []) {
				if (c && typeof c === 'object') whereErrors(c, collection, descriptors, errors);
			}
			continue;
		}
		if (key.startsWith('_')) continue; // a filter-level `_` key — `unknownOperators` owns it
		const prop = props[key];
		if (!prop) {
			errors.push(`where names "${key}", which ${collection} has no field for`);
			continue;
		}
		if (cond === null || typeof cond !== 'object' || Array.isArray(cond)) {
			enumErrors(errors, key, prop, [cond]); // `{status: 'open'}` is shorthand for `_eq`
			continue;
		}
		const nested = Object.keys(cond).filter((k) => !k.startsWith('_'));
		for (const [op, operand] of Object.entries(cond)) {
			if (ENUM_CHECKED.has(op)) enumErrors(errors, key, prop, literalsFor(op, operand));
		}
		if (!nested.length) continue;
		const targets = dt.targetsOf(prop);
		if (!targets) {
			errors.push(`where "${key}" is not a reference field — a nested key hops a reference, it does not compare two fields`);
			continue;
		}
		// one hop, and a second is refused by name: `matchesFilter` resolves one reference, and a
		// third level would narrow to false with no warning. A proof that needs two hops writes its
		// `expect` against the far collection instead.
		for (const hop of nested) {
			const sub = cond[hop];
			if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) continue;
			for (const deep of Object.keys(sub).filter((k) => !k.startsWith('_'))) {
				errors.push(`where hops more than one reference (${key}.${hop}.${deep}) — a proof filter hops at most one`);
			}
		}
		// When the reference targets a LIST of collections or '*', any field name is accepted: the
		// value decides which target it resolves to, and that is a run-time fact.
		if (targets === '*' || targets.length !== 1) continue;
		const [target] = targets;
		const targetDescriptor = descriptors.get(target);
		if (!targetDescriptor) continue; // an uninstalled peer target — `check` owns that, not this
		const targetProps = dt.fieldsOf(targetDescriptor);
		for (const hop of nested) {
			const hopProp = targetProps[hop];
			if (!hopProp) { errors.push(`where names "${hop}", which ${target} has no field for`); continue; }
			const sub = cond[hop];
			if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) { enumErrors(errors, hop, hopProp, [sub]); continue; }
			for (const [op, operand] of Object.entries(sub)) {
				if (ENUM_CHECKED.has(op)) enumErrors(errors, hop, hopProp, literalsFor(op, operand));
			}
		}
	}
	return errors;
}

/** A literal compared against a closed enum must be one of its values — otherwise the filter is
 *  well-formed and returns zero rows forever. */
function enumErrors(errors, field, prop, values) {
	// a v2 enum is a list of values, or a map of value → its decoration
	const options = Array.isArray(prop?.enum) ? prop.enum : prop?.enum && typeof prop.enum === 'object' ? Object.keys(prop.enum) : null;
	if (!options?.length) return;
	// `looseEq`, not `includes`: the filter compares as strings, so on a numeric enum `5` and `'5'`
	// are one filter at run time. The option plays the record-value role, as at run time.
	for (const v of values) {
		if (v == null || options.some((o) => dt.looseEq(o, v))) continue;
		// a `{record…}` literal is a runtime value: the judge substitutes it before evaluating
		if (isSubstitutable(v)) continue;
		errors.push(`where "${field}" compares "${v}", which is not one of ${field}'s options [${options.join(', ')}]`);
	}
}

// ── the pure core ───────────────────────────────────────────────────────────────────────────────
//
// Four functions with no fs, no store and no subprocess between them: substitution, the ledger's
// cap, the printable verdict, and the state → exit-code map.

/**
 * Render a proof's `{record}` and `{record.<field>}` braces against the picked record.
 *
 * It renders only what it owns and passes everything else through. A step is a shell string, and the
 * shell owns braces too (`awk '{print $1}'`, `sed -n '1,3{p}'`, `jq '{a: .b}'`, `mkdir -p x/{a,b}`),
 * so an unrecognised `{…}` is left alone; `stepWarnings` names an identifier-shaped one at compile.
 *
 * `${…}` is untouched — it belongs to the resolver (`${env:FILES_FOLDER}` in a `path:` expectation)
 * and to the shell (`${HOME}` in a `run:` step).
 *
 * What still THROWS is the one case where passing through would be silently wrong: `{record.<f>}`
 * naming a field the picked record does not carry would otherwise reach the shell as the string
 * "undefined", and `{record}` with no record bound has nothing to be.
 *
 * Strict mode is for the values the engine consumes rather than the shell — a `path:` expectation and
 * every string literal inside an expectation's `where` (`substituteWhere`). There a typo like
 * `{recrod}` would become a literal nobody notices, so an identifier-shaped brace nobody substitutes
 * throws. The token test is the same `BRACE_TOKEN` the warning uses, `$`-exemption included.
 *
 * `record:` is not substituted: compile accepts only the literal `{record}` there.
 *
 * @param {string} text
 * @param {{record?: {ref: string, fields: object}}} ctx
 * @param {{strict?: boolean}} [options]
 */
export function substitute(text, ctx, options) {
	if (typeof text !== 'string') return text;
	if (options?.strict) {
		for (const [, dollar, token] of text.matchAll(BRACE_TOKEN)) {
			if (dollar || token === 'record' || token.startsWith('record.')) continue;
			throw new Error(`unknown substitution "{${token}}" in a path — a proof may use {record} and {record.<field>}`);
		}
	}
	return text.replace(/(\$?)\{(record(?:\.([^{}]*))?)\}/g, (whole, dollar, name, field) => {
		if (dollar) return whole;
		const rec = ctx?.record;
		if (!rec) throw new Error(`{${name}} has nothing to bind to — this proof declares no given`);
		if (field === undefined) return String(rec.ref);
		const value = rec.fields?.[field];
		if (value === undefined) throw new Error(`{${name}} — ${rec.ref} has no field "${field}"`);
		return String(value);
	});
}

/** An identifier-shaped brace token: what a static reader can tell apart from shell syntax. `{print}`
 *  matches and `{print $1}` does not, which is the asymmetry that makes the net affordable. */
const BRACE_TOKEN = /(\$?)\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g;

/** Does this value carry a brace `substitute` will render? The validator uses it to leave a runtime
 *  value alone. It asks about `{record…}` only — every other brace is the resolver's or the shell's. */
const isSubstitutable = (v) => typeof v === 'string' && /\{record(\.[^{}]*)?\}/.test(v);

/** Does any string anywhere in this filter node carry a `{record…}` brace? `given.where` may not
 *  carry one at all, and an expectation's may only when a `given` exists to bind it. Keys are never
 *  examined: a filter's keys are field names and operators. */
function hasSubstitutable(node) {
	if (typeof node === 'string') return isSubstitutable(node);
	if (Array.isArray(node)) return node.some(hasSubstitutable);
	if (node === null || typeof node !== 'object') return false;
	return Object.values(node).some(hasSubstitutable);
}

/**
 * A filter's string literals, substituted before the filter is evaluated — so `where: { owner: { _eq:
 * '{record}' } }` ("a note owned by the person I picked") compares against the picked ref.
 *
 * A deep copy, never a mutation: the proof source is read once and judged twice (the pre-check and
 * the after-pass), and a `where` rewritten in place would carry the FIRST record's ref into the
 * second judgement.
 *
 * Strict, for the same reason a `path:` is (see `substitute`).
 *
 * `{record}` (the ref) is stable across a run; `{record.<field>}` is not. A `_delta` snapshot is
 * taken before the steps and its after-count after them, so a `{record.<field>}` inside a `_delta`
 * where is rendered from two different values of that field and the difference means nothing. Write
 * `{record}` there, or assert the field with a `record:` expectation instead.
 *
 * @param {*} where     any filter node — map, array or scalar
 * @param {{record?: {ref: string, fields: object}}} ctx
 */
export function substituteWhere(where, ctx) {
	if (typeof where === 'string') return substitute(where, ctx, { strict: true });
	if (Array.isArray(where)) return where.map((v) => substituteWhere(v, ctx));
	if (where === null || typeof where !== 'object') return where;
	const out = {};
	// keys are field names and operators — never substituted
	for (const [k, v] of Object.entries(where)) out[k] = substituteWhere(v, ctx);
	return out;
}

/**
 * Every brace in this proof's steps that NOTHING substitutes — one advisory string per token, for
 * compile to print. Empty means nothing suspicious.
 *
 * A warning, never an error: the token may be intentional shell (`awk '{print}'`), so a false
 * positive costs one line of output rather than a refused proof. It judges shape only: a
 * `$`-prefixed brace is exempt, and a token with a space in it is not flagged.
 */
export function stepWarnings(proof) {
	const out = [];
	for (const [i, step] of (Array.isArray(proof?.steps) ? proof.steps : []).entries()) {
		for (const text of [step?.run, step?.perform]) {
			if (typeof text !== 'string') continue;
			for (const [, dollar, token] of text.matchAll(BRACE_TOKEN)) {
				if (dollar || token === 'record' || token.startsWith('record.')) continue;
				out.push(`step ${i + 1} uses "{${token}}" — only {record} and {record.<field>} are substituted; the rest reaches the shell as written`);
			}
		}
	}
	return out;
}

/**
 * `rows` plus `row`, trimmed to the LAST `cap` entries — a new array, never a mutation.
 *
 * The oldest row is the one that leaves: a ledger is read for what happened recently.
 *
 * The `cap <= 0` guard is arithmetic: `slice(-0)` is `slice(0)`, the whole array.
 */
export function applyCap(rows, row, cap = LEDGER_CAP) {
	return cap <= 0 ? [] : [...rows, row].slice(-cap);
}

/** The closed glyph set. Operators with no glyph print their own name: the filter set is open
 *  enough (`_regex`, `_starts_with`, `_between`) that a glyph per member would be a second
 *  vocabulary to keep in sync with the engine's filter. */
const GLYPH = {
	_eq: '=', _neq: '≠', _gte: '≥', _gt: '>', _lte: '≤', _lt: '<',
	_in: '∈', _nin: '∉', _nempty: 'nonempty', _empty: 'empty', _contains: 'contains',
};

/** A count is a NUMBER OF RECORDS and a delta is a DIFFERENCE between two of them; `count 1 = 1`
 *  and `count +1 = +1` say different things, and only the second says which number is a difference. */
const signed = (n) => (Number(n) >= 0 ? `+${Number(n)}` : String(Number(n)));

/** The ACTUAL value: bare when it is a number, JSON-quoted otherwise — a string is where a trailing
 *  space or an empty value hides, and `status  = done` names neither. */
function shown(v) {
	if (typeof v === 'number') return String(v);
	const json = JSON.stringify(v);
	return json === undefined ? String(v) : json; // `undefined` has no JSON form
}

/** The wanted value, bare: an array renders as the list a reader would type back, and a nested
 *  condition (a one-hop reference expectation, `owner: { name: { _eq: Ada } }`) as its JSON. */
const wanted = (v) => {
	if (Array.isArray(v)) return `[${v.join(', ')}]`;
	return v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
};

/**
 * One printable line for one expectation — `count 1 ≥ 1 ✔` · `status "open" ∈ [done] ✖`.
 *
 * The actual value always sits beside the wanted one, so nobody re-runs a proof by hand to learn
 * what it actually was.
 *
 * `expectation` is a ONE-ENTRY `{ <field>: <condition> }` map: for a collection count that field is
 * literally `count`, and for a `record:` expectation it is the field the `where` names. A map of
 * `_` keys only (`{ _delta: 1 }`) is a count condition, because that is the only place one appears.
 *
 * More than one entry throws: a raw `expect` entry carries `collection`, `where` and `count`
 * together, and the caller narrows it to the one condition being judged.
 *
 * The mark comes from `matchesFilter` itself, so the judgement and the rendering can never disagree
 * about whether the line passed. `_delta` is the exception: no filter has it, so it is compared here.
 *
 * Pass `resolve` whenever the condition may hop a reference: a non-`_` key under a field is a
 * one-hop reference traversal, and `matchesFilter` narrows to false with no resolver wired.
 */
export function verdictLine(expectation, actual, resolve) {
	const entries = Object.entries(expectation ?? {});
	const bare = entries.length > 0 && entries.every(([k]) => k.startsWith('_'));
	if (!bare && entries.length !== 1) throw new Error(`verdictLine takes ONE expectation entry — got ${entries.length ? `keys ${entries.map(([k]) => k).join(', ')}` : 'none'}`);
	const [field, cond] = bare ? ['count', expectation] : entries[0];
	const ops = cond !== null && typeof cond === 'object' && !Array.isArray(cond) ? cond : { _eq: cond };
	const pass = '_delta' in ops ? Number(actual) === Number(ops._delta) : dt.matchesFilter({ [field]: actual }, { [field]: ops }, resolve ?? null);
	const mark = pass ? '✔' : '✖';
	if ('_delta' in ops) return `${field} ${signed(actual)} = ${signed(ops._delta)} ${mark}`;
	const want = Object.entries(ops).map(([op, o]) => `${GLYPH[op] ?? op} ${wanted(o)}`).join(' and ');
	return `${field} ${shown(actual)} ${want} ${mark}`;
}

/** State → exit code. Six states, six codes, and an unknown one throws rather than defaulting to a
 *  plausible number. */
export function exitFor(state) {
	const code = { PASS: EXIT.PASS, FAIL: EXIT.FAIL, UNAVAILABLE: EXIT.UNAVAILABLE, 'NO-FIXTURE': EXIT.NO_FIXTURE, PENDING: EXIT.PENDING, VACUOUS: EXIT.VACUOUS }[state];
	if (code === undefined) throw new Error(`unknown proof state "${state}" — one of PASS, FAIL, UNAVAILABLE, NO-FIXTURE, PENDING, VACUOUS`);
	return code;
}

// ── store-bound: counting, picking, and what a proof needs from the machine ─────────────────────

/**
 * How many records of `collection` a filter keeps — `readAll` + `matchesFilter`, the pattern every
 * existing caller uses (there is no `store.count`, and one directory walk with lazy parsing is what
 * `list` does). The row handed to the filter is `{ ...fields, id }`, exactly as `list` builds it, so
 * `{ id: { _eq: 'a' } }` is a filter a proof may write.
 *
 * A `_delta` after-count needs a fresh `Store`: `readAll` walks `ids()`, memoized on (git HEAD,
 * collection dir mtime), and a step that writes without committing can leave that index stale. The
 * runner constructs a new Store for the after-pass; this function cannot know which side it is on.
 *
 * `resolve` is the caller's — `recordResolver(store)` when the filter hops a reference, `null` when
 * it does not. A hop with no resolver narrows, which is the engine filter's fail-closed posture.
 */
export function countMatching(store, collection, where, resolve) {
	let n = 0;
	for (const { id, fields } of store.readAll(collection)) {
		if (where && !dt.matchesFilter({ ...fields, id }, where, resolve)) continue;
		n++;
	}
	return n;
}

/**
 * The ONE record a live proof runs against — `{ ref, fields }`, or null when there is none.
 *
 * `null` is a first-class answer, not an error: a `given` that matches nothing is NO-FIXTURE
 * (exit 4), which says the proof did not run rather than that the artifact is broken.
 *
 * `pick: latest` is the head of the matching rows ordered by the collection's own ordering field
 * (`orderingFieldOf`), descending, through the same `sortRows` every `?sort=` and `--sort` goes through — so a date-time
 * orders by instant across mixed offsets rather than by string. `pick: <id>` reads that id and
 * returns null when it is absent or does not match the `where`.
 *
 * A fixture-backed `given` needs nothing special here: the runner hands this function the SANDBOX's
 * store, where the fixture's records are the collection, and `pick: <id>` names one of them.
 *
 * `override` is `--record <collection>/<id>`, and it replaces the selection rather than filtering
 * through it: a person naming a record is saying which one to use.
 */
export function pickFixture(store, given, override) {
	const collection = String(given?.collection ?? '');
	if (override) {
		const parsed = dt.parseRef(String(override), store.namespaces);
		if (!parsed) throw new Error(`--record takes a <collection>/<id> reference and got "${override}"`);
		if (collection && parsed.collection !== collection) throw new Error(`--record ${override} is not a record of ${collection}, which is what this proof's given picks from`);
		return readOne(store, parsed.collection, parsed.id);
	}
	const where = given?.where && typeof given.where === 'object' ? given.where : null;
	const resolve = where ? dt.recordResolver(store) : null;
	if (given?.pick !== 'latest') {
		const picked = readOne(store, collection, String(given?.pick ?? ''));
		if (!picked || !where) return picked;
		return dt.matchesFilter(picked.fields, where, resolve) ? picked : null;
	}
	const field = orderingFieldOf(store.descriptor(collection));
	// compile refuses `pick: latest` on a collection with no ordering field; this guards a stale runtime
	if (!field) throw new Error(LATEST_NEEDS(collection));
	const rows = [];
	for (const { id, fields } of store.readAll(collection)) {
		const row = { ...fields, id };
		if (!where || dt.matchesFilter(row, where, resolve)) rows.push(row);
	}
	dt.sortRows(rows, `-${field}`);
	return rows.length ? { ref: `${collection}/${rows[0].id}`, fields: rows[0] } : null;
}

/** One record as `{ ref, fields }`, or null when it is not there. The id travels IN the fields, the
 *  same row shape the filter sees, so `{record.id}` and a filter on `id` cannot disagree. */
function readOne(store, collection, id) {
	try {
		const { fields } = store.read(collection, id);
		return { ref: `${collection}/${id}`, fields: { ...fields, id } };
	} catch (e) {
		// only "no such record" is NO-FIXTURE; an unknown collection or a parse failure is a real
		// error and must reach the person running the proof
		if (!String(e?.message ?? '').endsWith(': no such record')) throw e;
		return null;
	}
}

/**
 * What this proof needs from THIS machine — `{ ok, missing: [{ kind, name, fix }] }`.
 *
 * No env value is ever read, compared or printed. `.env` values are credentials; the question is
 * whether the machine has the key configured, which the key name answers. `parseEnvValues` is used for its names only, and an empty value counts as declared —
 * judging a value would mean holding one.
 *
 * `bin` walks `PATH` with `accessSync(X_OK)` rather than shelling out to `command -v`: a proof's
 * requirement check must not itself run a shell.
 *
 * `names` is a parameter because the key set belongs to the machine, not the proof: `dt prove --list`
 * reads `.env` once and passes it to every row.
 */
export function resolveRequires(ws, requires, names = envKeys(ws.root)) {
	const missing = [];
	for (const name of requires?.env ?? []) {
		if (process.env[String(name)] !== undefined || names.has(String(name))) continue;
		missing.push({ kind: 'env', name: String(name), fix: `${name} is not set — add it to .env` });
	}
	for (const name of requires?.bin ?? []) {
		if (onPath(String(name))) continue;
		missing.push({ kind: 'bin', name: String(name), fix: `${name} is not on PATH` });
	}
	return { ok: !missing.length, missing };
}

/** The key names this machine's `.env` declares. Absent file → no names, which is the ordinary state
 *  in a cloud session and not an error. Exported so a caller that asks `resolveRequires` many times
 *  in a row (`dt prove --list`) can read the file ONCE and hand the set down. */
export function envKeys(root) {
	try { return new Set(dt.parseEnvValues(fs.readFileSync(path.join(root, '.env'), 'utf8')).keys()); }
	catch { return new Set(); }
}

/** `accessSync(X_OK)` alone is not enough: on a directory the execute bit means "searchable", so a
 *  folder named `ffmpeg` on PATH must not satisfy `requires: { bin: [ffmpeg] }`. `statSync` follows
 *  symlinks, which is what most binaries on PATH are. */
function onPath(name) {
	for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
		if (!dir) continue;
		const file = path.join(dir, name);
		try {
			fs.accessSync(file, fs.constants.X_OK);
			if (fs.statSync(file).isFile()) return true;
		} catch { /* next dir */ }
	}
	return false;
}

// ── the ledger ──────────────────────────────────────────────────────────────────────────────────
//
// One append-only JSONL file per proof, capped, per machine, gitignored. It answers "when did this
// last pass, on this machine, and against which record" — and it is what makes a `perform` step
// resumable: the PENDING row is where the run stopped.

/** `<root>/.dreamteamer/.proofs/<proof-id>.jsonl` — see LEDGER_DIR for why the dot matters. */
export function ledgerPath(root, proofId) {
	return path.join(dt.runtimeDir(root), LEDGER_DIR, `${proofId}.jsonl`);
}

/**
 * Every row of one proof's ledger, oldest first. A missing file is `[]`, not an error — a proof that
 * has never run has no history, which is a fact and not a failure.
 *
 * A malformed line is skipped with a warning, never thrown on: a killed run or a hand edit can leave
 * a partial line, and refusing to read the ledger would make `prove` unrunnable.
 * The next `appendLedger` rewrites the file, so the bad line is repaired rather than accumulating.
 */
export function readLedger(root, proofId) {
	let text;
	try { text = fs.readFileSync(ledgerPath(root, proofId), 'utf8'); } catch { return []; }
	const rows = [];
	for (const [i, line] of text.split('\n').entries()) {
		if (!line.trim()) continue;
		try { rows.push(JSON.parse(line)); }
		catch { console.warn(`⚠ ${path.join(dt.RUNTIME_DIR, LEDGER_DIR, `${proofId}.jsonl`)}:${i + 1} is not a JSON row — skipped`); }
	}
	return rows;
}

/** Append one row, capped at the last LEDGER_CAP. A rewrite rather than an `appendFileSync` because
 *  the cap has to drop the oldest row, and the rewrite is what repairs a malformed line.
 *
 *  Through `atomicWrite`, the one writer every record write already goes through: a proof's steps run
 *  arbitrary commands, so a run can be killed mid-write, and a half-written ledger line is exactly
 *  the malformed row `readLedger` has to warn about. Write-to-temp + rename means the file on disk is
 *  always a whole ledger. */
export function appendLedger(root, proofId, row) {
	const file = ledgerPath(root, proofId);
	const rows = applyCap(readLedger(root, proofId), row);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	dt.atomicWrite(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
	return rows;
}

/**
 * The PENDING row this proof stopped on for `record` (null for a gate, which pends against no
 * record), or null.
 *
 * Only the last row for that record counts: once the record has a later verdict, the earlier PENDING
 * is superseded, so a resume never asks you to perform a step you already performed.
 */
export function pendingFor(root, proofId, record) {
	const want = record ?? null;
	const rows = readLedger(root, proofId).filter((r) => (r?.record ?? null) === want);
	const last = rows[rows.length - 1];
	return last?.verdict === 'PENDING' ? last : null;
}

// ── the runner ──────────────────────────────────────────────────────────────────────────────────
//
// One verb, six terminal states, and a resume protocol for the one step a machine cannot take.
//
// Every state below is terminal: the run stops there, appends exactly one ledger row, and answers
// with that state's exit code. So the runner reads top to bottom —
//
//   sandbox?/--keep → resume → pending guard → requires → fixture → snapshot → pre-check
//     → run steps (guarding data/ outside a sandbox) → the first perform → judge
//
// The order is the contract. The pre-check runs before any step (a proof whose expectations already
// hold would report PASS forever), and `requires` runs before the fixture (a machine that cannot
// answer reports UNAVAILABLE, never NO-FIXTURE, which reads as a fact about the workspace's data).
//
// Nothing here calls `process.exit`. `proveCommand` returns `{ code }` and the engine exits from it,
// so a proof can be run in-process by a test — which is what makes the exit code assertable at all.

/** Seconds a `run` step may take before it is killed. A number rather than none: a proof's step is
 *  an arbitrary shell command, and an unbounded one hangs a pre-commit hook forever. */
const DEFAULT_TIMEOUT = 120;

/** Flags of `dt prove` that take a value, so the positional scan never reads one as a target. */
const VALUE_FLAGS = new Set(['kind', 'record']);

/** The spellings of "off" a person actually types. Anything else after the `=` is on, including an
 *  empty string: `--strict=` is a fumbled command line, and reading it as OFF would silently disarm
 *  the gate it names. */
const FALSEY = new Set(['false', '0', 'no', 'off']);

/** `--flag=false` means false (see FALSEY); a bare `--flag` is true. */
export const flagValue = (v) => (typeof v === 'string' ? !FALSEY.has(v.trim().toLowerCase()) : v !== undefined && v !== false);

/**
 * Is `--<name>` on, reading the `=` form's value through `flagValue`.
 *
 * The last occurrence wins: `--strict=false --strict` is a person changing their mind at the end of
 * a line, and reading the first would answer the version they edited away.
 */
export function flagEnabled(args, name) {
	let on = false;
	for (const a of args ?? []) {
		if (!a.startsWith('--')) continue;
		const eq = a.indexOf('=');
		if ((eq > -1 ? a.slice(2, eq) : a.slice(2)) !== name) continue;
		on = eq > -1 ? flagValue(a.slice(eq + 1)) : true;
	}
	return on;
}

function parseProveArgs(rest) {
	const flags = {};
	const targets = [];
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (!a.startsWith('--')) { targets.push(a); continue; }
		const eq = a.indexOf('=');
		if (eq > -1) {
			const name = a.slice(2, eq);
			// a value flag keeps its string (`--kind=gate`); a boolean one is read through flagValue
			flags[name] = VALUE_FLAGS.has(name) ? a.slice(eq + 1) : flagValue(a.slice(eq + 1));
			continue;
		}
		const name = a.slice(2);
		flags[name] = VALUE_FLAGS.has(name) ? rest[++i] : true;
	}
	return { flags, targets };
}

/**
 * Per-form flag refusal. A verb-level allowlist could only say which flags `prove` has; it cannot
 * know that `--all` is meaningless once a proof is named. Deciding which form was typed means
 * resolving the target, so the refusal lives beside that resolution.
 */
function refuseStray(rest, form, allowed) {
	const given = [...new Set(rest.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]))];
	const stray = given.filter((f) => !allowed.includes(f));
	if (!stray.length) return;
	throw new Error(`${stray.join(' ')} ${stray.length > 1 ? 'are not flags' : 'is not a flag'} of \`${form}\` — that form takes ${allowed.join(' ')}`);
}

const ONE_FORM = ['--record', '--restart', '--json', '--keep', '--here'];
const MANY_FORM = ['--all', '--kind', '--json', '--external', '--strict'];
const LIST_FORM = ['--list', '--missing', '--kind', '--strict', '--json'];
/** Every flag any form of `dt prove` accepts — what its usage has to document. */
export const PROVE_FLAGS = [...new Set([...ONE_FORM, ...MANY_FORM, ...LIST_FORM])];

/**
 * `dt prove` — the whole verb. Four forms: three told apart by what the target NAMES, and a read.
 *
 *   `dt prove <proof>`      one proof, the resume protocol, one of six codes
 *   `dt prove <artifact>`   every proof whose `about` names it, board semantics
 *   `dt prove --all`        every proof, board semantics
 *   `dt prove --list`       runs nothing — availability and the ledger tail per proof, or the
 *                           artifacts nothing proves (`--missing`); `--strict` gates on a FAIL tail
 *
 * @returns {{code: number}} — never `process.exit`; the extension's command returns the code.
 */
export function proveCommand(ws, rest) {
	const { flags, targets } = parseProveArgs(rest);
	const store = new dt.Store(ws);
	if (!store.descriptors.has('proofs')) throw new Error('the proofs collection is not compiled in this workspace — dt compile');
	// one record at a time, so a proof that will not parse is named — and the whole verb fails closed
	// on it: a gate that skipped an unreadable proof would read its FAIL as green
	const proofs = new Map();
	// (`ids()` answers a Map of id → file at runtime; api.d.ts declares a Set — both are read by key)
	const known = store.ids('proofs');
	for (const id of [...(known instanceof Map ? known.keys() : known)].sort()) {
		try { proofs.set(id, store.read('proofs', id).fields); }
		catch (e) { throw new Error(`proofs/${id} cannot be read — ${firstLine(e.message)}`); }
	}
	const target = targets[0];
	// an unknown `--kind` would match no proof and answer a green board that ran nothing
	if ('kind' in flags && !PROOF_KINDS.includes(flags.kind)) {
		throw new Error(`--kind takes ${PROOF_KINDS.join(' or ')} — got "${flags.kind}"`);
	}

	if (flags.list) {
		refuseStray(rest, 'dt prove --list', LIST_FORM);
		if (targets.length > 1) throw new Error(`dt prove --list takes at most ONE proof or artifact — got ${targets.join(', ')}`);
		return listProofs(ws, store, proofs, target, flags);
	}
	if (!target) {
		refuseStray(rest, 'dt prove --all', MANY_FORM);
		if (!flags.all) throw new Error('dt prove needs a proof id, an artifact (skills/<id>, commands/<id>, …), or --all; dt prove --list');
		return proveMany(ws, proofs, flags, () => true);
	}
	if (proofs.has(target)) {
		refuseStray(rest, 'dt prove <proof>', ONE_FORM);
		return proveOne(ws, target, proofs.get(target), flags);
	}
	// the artifact form answers the question a reader of a skill or a command actually has — "what
	// does anybody claim about this thing, and does it hold" — which is what `about` exists for.
	if (artifactRefs(store).all.has(target)) {
		refuseStray(rest, `dt prove ${target}`, ['--kind', '--json', '--external', '--strict']);
		const about = (p) => (p.about ?? []).map(String).includes(target);
		// an artifact nothing proves is VACUOUS, not proved: a check that cannot fail is not a check.
		// `--all` keeps its zero — "this workspace declares no proofs" is a true, green answer to "run
		// everything"; "this artifact has no proof" is not a green answer to "prove this artifact".
		if (![...proofs.values()].some(about)) {
			const summary = `no proof is about ${target} — dt prove --list --missing`;
			console.log(flags.json ? JSON.stringify({ summary, proofs: [], code: EXIT.VACUOUS }, null, 2) : summary);
			return { code: EXIT.VACUOUS };
		}
		return proveMany(ws, proofs, flags, about);
	}
	throw new Error(`dt prove takes a proof id or an artifact (skills/<id>, commands/<id>, …) — got "${target}"; dt prove --list`);
}

/** The last `n` lines of a captured stream — what a step failure prints. Display only: expectations
 *  judge the whole capture. */
function lastLines(text, n = 10) {
	return String(text ?? '').replace(/\n+$/, '').split('\n').slice(-n).join('\n');
}

/**
 * A step's stdout is captured whole and judged whole, so a pretty-printed `--json` payload parses and
 * a marker on line 1 of 20 is found.
 *
 * 64 KB, and the first 64 KB rather than the last: a JSON payload starts at the beginning, and a
 * truncated one must fail loudly (`stdout is not JSON`) rather than parse to something smaller than
 * what the step actually printed. `stdout_truncated` is always present, because a key that appears
 * only sometimes is worse to read than a `false`.
 */
const STDOUT_CAP = 64 * 1024;

function captured(text) {
	const whole = String(text ?? '');
	return whole.length > STDOUT_CAP
		? { text: whole.slice(0, STDOUT_CAP), truncated: true }
		: { text: whole, truncated: false };
}

/** The first line of a thrown message — what a `failure_reason` carries. A multi-line reason inside
 *  a JSONL row is legal and unreadable, and the first line is the sentence that names the cause. */
const firstLine = (message) => String(message ?? '').split('\n')[0];

/**
 * One builder for every ledger row, used by `proveOne`'s `settle` and by `--all`'s catch, so a proof
 * that threw still gets a row of the same shape.
 */
function ledgerRow(state, started, over = {}) {
	return {
		when: new Date().toISOString(),
		record: null,
		engine: dt.engineVersion(),
		machine: os.hostname(),
		duration_ms: Date.now() - started,
		failure_reason: null,
		steps: [],
		sandbox: null,
		// `null` = no removal was attempted (no sandbox, still PENDING, or kept by `--keep`);
		// `true` = the sandbox is gone; `false` = the removal failed and the directory is still
		// there. Always present, because a key that appears only sometimes is worse to read.
		sandbox_removed: null,
		before: {},
		...over,
		verdict: state,
	};
}

/**
 * How much output one `run` step may produce. `spawnSync`'s default `maxBuffer` is 1 MB and it kills
 * the child on overflow. 16 MB because a step's stdout is judged whole and a ledger row keeps 64 KB
 * of it; anything larger belongs in a file the proof asserts with `path:`, which the message says.
 */
const MAX_OUTPUT_MB = 16;

/**
 * What a finished `run` step actually did — `{ exit, failure_reason }`, with `failure_reason: null`
 * when nothing is wrong. Pure, so each outcome is unit-tested apart from the loop.
 *
 * Order matters, and only `error.code` decides a timeout: a bare signal is also what an ENOBUFS
 * kill, the OOM killer or an external `kill` leaves, so it reports only which signal, not why.
 *
 * `index` and `want` let the whole message be assembled here, where a test can pin it.
 */
export function stepOutcome(res, timeoutSeconds, index = 1, want = 0) {
	// a killed step has a null status and a signal — reporting `exit null` would read as success
	const exit = res?.status ?? (res?.signal ? 124 : 1);
	const code = res?.error?.code ?? null;
	const reason = (text) => ({ exit, failure_reason: `step ${index} ${text}` });
	if (code === 'ETIMEDOUT') return reason(`timed out after ${timeoutSeconds}s`);
	if (code === 'ENOBUFS') return reason(`produced more than ${MAX_OUTPUT_MB} MB of output — write it to a file and assert with path:`);
	if (res?.error) return reason(`could not start: ${code ?? res.error.message}`);
	if (res?.signal) return reason(`was killed (${res.signal})`);
	return exit === want ? { exit, failure_reason: null } : reason(`exited ${exit}`);
}

const isDelta = (count) => count !== null && typeof count === 'object' && !Array.isArray(count) && '_delta' in count;

/** An expectation that can be judged against the store, and so can be pre-checked before any step
 *  runs. A `step`/`path` one cannot: there is no step result yet, and a path a step will create is
 *  supposed to be absent. */
const isStoreBased = (e) => ['collection', 'record'].includes(formOf(e));

/** The 1-based index of the last `run` step — the default a `step:` expectation resolves to, so the
 *  commonest shape ("the command I ran exited 0") needs no index at all. */
function lastRunIndex(proof) {
	const steps = Array.isArray(proof.steps) ? proof.steps : [];
	for (let i = steps.length - 1; i >= 0; i--) if (steps[i]?.run !== undefined) return i + 1;
	return 0;
}

/** The `step:` expectation aimed at step `n`, if any — what decides whether a non-zero exit is a
 *  failure or the thing being asserted. */
function stepExpect(proof, n) {
	for (const e of Array.isArray(proof.expect) ? proof.expect : []) {
		// the same form test the judge dispatches on
		if (formOf(e) !== 'step') continue;
		if ((Number.isInteger(e.step) ? e.step : lastRunIndex(proof)) === n) return e;
	}
	return null;
}

/** A dotted path into a parsed JSON value — `stdout_json: { data.count: { _gte: 1 } }`. */
function valueAt(json, dotted) {
	let v = json;
	for (const key of String(dotted).split('.')) v = v == null ? undefined : v[key];
	return v;
}

/**
 * Every expectation, as one machine-readable verdict per condition.
 *
 * One entry per line, never the raw `expect` row: the row is narrowed here to `{ count: … }` for a
 * collection form, and to one line per field for a record form.
 *
 * `ok` is read back off the rendered line's mark rather than computed a second time — `verdictLine`
 * takes its ✔/✖ from `matchesFilter` itself, and deriving `ok` from anything else would let the
 * printed line and the exit code disagree about the same condition.
 *
 * `storeOnly` is the pre-check pass: the store-based forms only, judged before any step has run.
 */
function judge(ws, store, proof, id, record, before, stepResults, storeOnly) {
	const verdicts = [];
	const resolve = dt.recordResolver(store);
	const ctx = record ? { record } : {};
	const push = (expectation, actual) => {
		const line = verdictLine(expectation, actual, resolve);
		verdicts.push({ expect: expectation, actual, ok: line.endsWith('✔'), line });
	};
	/** A ✖ that no filter produced — the two states where the question could not be asked. It carries
	 *  its own `reason`, because a `failure_reason` must not end in a glyph. */
	const fail = (expectation, actual, reason) => {
		verdicts.push({ expect: expectation, actual, ok: false, line: `${reason} ✖`, reason });
	};
	for (const [i, raw] of (Array.isArray(proof.expect) ? proof.expect : []).entries()) {
		const e = raw ?? {};
		if (storeOnly && !isStoreBased(e)) continue;
		// the same `formOf` compile reads. A row with no form cannot reach here (compile refuses it);
		// a stale runtime's one is skipped rather than judged against a shape it does not have.
		const form = formOf(e);
		if (form === 'collection') {
			// literals first: `{record}` in a filter is the picked record's reference
			const total = countMatching(store, String(e.collection), substituteWhere(e.where, ctx), resolve);
			if (!isDelta(e.count)) { push({ count: e.count }, total); continue; }
			// a missing before-count fails closed: read as zero, the delta would become the absolute
			// count, and `_delta: 1` would pass on any non-empty collection
			if (before === null || typeof before !== 'object' || !(i in before)) {
				fail({ count: e.count }, null, `no before-count in the pending row — re-run dt prove ${id} --restart`);
				continue;
			}
			push({ count: e.count }, total - Number(before[i]));
			continue;
		}
		if (form === 'record') {
			const row = record ? record.fields : {};
			// `where: { owner: { _eq: '{record.owner}' } }` and any cross-field literal are rendered
			// before the condition is judged
			for (const [field, cond] of Object.entries(substituteWhere(e.where ?? {}, ctx))) push({ [field]: cond }, row[field]);
			continue;
		}
		if (form === 'path') {
			// a `path:` expectation renders through the same `${env:…}` renderer `dt resolve` uses, so a
			// proof and the record it is about agree on where a machine's folder is. An undeclared
			// `${env:…}` throws, which is that resolver's contract.
			const rendered = dt.renderTemplate(substitute(String(e.path), ctx, { strict: true }), dt.envContext(ws));
			// resolved against the workspace, never `process.cwd()`, so the answer does not depend on
			// where the command was typed. `ws` here is the sandbox's root for a fixture proof, so a path
			// a sandboxed step created is asked about where the step wrote it. An absolute path is kept.
			push({ exists: e.exists }, fs.existsSync(path.resolve(ws.root, rendered)));
			continue;
		}
		if (form !== 'step') continue;
		const step = stepResults[(Number.isInteger(e.step) ? e.step : lastRunIndex(proof)) - 1];
		if ('exit' in e) push({ exit: e.exit }, step?.exit);
		// the full capture, not the display tail
		if (e.stdout && typeof e.stdout === 'object') push({ stdout: e.stdout }, step?.stdout ?? '');
		if (e.stdout_json && typeof e.stdout_json === 'object') {
			const text = step?.stdout ?? '';
			let parsed;
			try { parsed = JSON.parse(text); }
			catch {
				// unparseable output says so, rather than reading every dotted path as undefined. The
				// head is flattened before it is quoted, so the verdict stays one line.
				const head = text.trim().replace(/\s+/g, ' ').slice(0, 60);
				fail({ stdout_json: e.stdout_json }, head, `stdout is not JSON (${head})`);
				continue;
			}
			for (const [dotted, cond] of Object.entries(e.stdout_json)) push({ [dotted]: cond }, valueAt(parsed, dotted));
		}
	}
	return verdicts;
}

/** `commands/<id>`'s source file, when a `perform` text opens with `/<command-id>` and that command
 *  is compiled. The reader of a PERFORM block opens the command to act on it, so the path comes off
 *  the manifest, which records what was actually compiled, rather than from a rule. */
function commandSource(root, performText) {
	const m = /^\/(\S+)/.exec(String(performText ?? ''));
	if (!m) return null;
	const src = dt.readManifest(root)?.entries?.[`commands/${m[1]}.command.md`]?.sources?.[0];
	return src ? (typeof src === 'string' ? src : src.path) : null;
}

/**
 * Every non-superseded PENDING row of this proof, one per record — what makes a second run refuse.
 * `pendingFor` answers for one named record; a fresh run does not know the record yet. All of them,
 * not the last one: a proof can be pending for several records at once, and the refusal names each.
 */
function allPending(root, proofId) {
	const last = new Map();
	for (const r of readLedger(root, proofId)) last.set(r?.record ?? null, r);
	return [...last.values()].filter((r) => r?.verdict === 'PENDING');
}

// ── the sandbox ─────────────────────────────────────────────────────────────────────────────────

/**
 * Run `fn` with everything it prints captured and handed back, and everything it throws handed back
 * as a value. Two callees need it: `check` reports its findings by printing them rather than
 * returning them, and `removeWorktree` announces itself — and neither is part of a proof's report,
 * while under `--json` a single stray line makes the one object on stdout unparseable.
 *
 * It never throws, because every caller is already in the middle of deciding a verdict.
 */
function captureLog(fn) {
	const lines = [];
	const log = console.log;
	const err = console.error;
	console.log = (...a) => lines.push(a.map(String).join(' '));
	console.error = (...a) => lines.push(a.map(String).join(' '));
	try { return { value: fn(), lines }; }
	catch (e) { return { error: e, lines }; }
	finally { console.log = log; console.error = err; }
}

/** The module root that ships this proof, off the manifest — the same read `commandSource` makes,
 *  and for the same reason. */
function proofModuleRoot(root, id) {
	const src = dt.readManifest(root)?.entries?.[`proofs/${id}.proof.yaml`]?.sources?.[0];
	const p = src ? (typeof src === 'string' ? src : src.path) : null;
	return p ? path.dirname(path.dirname(p)) : null;
}

/** `modules/<m>/proofs/fixtures/<id>` — where a fixture proof's records live, absolute. */
function fixtureDir(root, moduleRoot, id) {
	return path.join(root, moduleRoot && moduleRoot !== '.' ? moduleRoot : '', 'proofs', 'fixtures', id);
}

/**
 * Why this sandbox cannot be judged against — one line — or null.
 *
 * A fixture is records nobody validated: everything else a proof reads went through the store's
 * validator, but `modules/<m>/proofs/fixtures/` is hand-authored bytes. So the engine's own `check`
 * runs against the sandbox before any step does, and the first violation is what the failure names.
 */
function sandboxUnfit(root, collections) {
	// a sandbox is cut from HEAD, so a descriptor that is not committed is not compiled inside it —
	// and `check` cannot see that: the fixture's records would be invisible rather than invalid. This
	// covers every collection the proof reads, not only `given`'s.
	const known = dt.loadDescriptors(root);
	const absent = [...new Set(collections.filter(Boolean))].find((c) => !known?.has(c));
	if (absent) {
		return `collection "${absent}" is not compiled in the sandbox — commit its descriptor, because a sandbox is cut from HEAD`;
	}
	// `check` takes `{ root }` and reads its descriptors off the compiled runtime — there is no
	// `pkg` to thread, and one passed in would be a parameter nothing reads.
	const { value, lines } = captureLog(() => dt.check({ root }));
	if (value === 0) return null;
	// `check` prints `✖ <file>` and then one indented line per finding — the first one, as ONE line
	const i = lines.findIndex((l) => l.startsWith('✖'));
	if (i === -1) return lines[0] ?? `check exited ${value}`;
	const msg = String(lines[i + 1] ?? '').trim();
	return `${lines[i].replace(/^✖\s*/, '')}${msg ? `: ${msg}` : ''}`;
}

/**
 * What `data/` looks like to git right now: the committed tree of `data/` at HEAD, then
 * `git status --porcelain data/`, one line per file, each with a hash of its bytes. The committed
 * tree is what catches a step that writes AND commits — both statuses are clean, the tree is not —
 * and the per-file hash is what catches a second edit to an already-dirty file. `null` when the
 * workspace is not a git checkout.
 */
export function dataState(root) {
	const r = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', 'data/'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
	if (r.status !== 0) return null;
	const tree = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD:data'], { cwd: root, encoding: 'utf8', timeout: 30_000 });
	const out = [`committed ${tree.status === 0 ? tree.stdout.trim() : 'none'}`];
	const entries = r.stdout.split('\0').filter(Boolean);
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry[0] === 'R' || entry[0] === 'C') i++; // a rename carries its source as the next entry
		const file = path.join(root, entry.slice(3));
		let digest = 'absent';
		try { digest = createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch {}
		out.push(`${entry} ${digest}`);
	}
	return out.join('\n');
}

/**
 * `force` is correct here: `removeWorktree` refuses by default because a worktree may hold
 * uncommitted records and unlanded commits, but a proof sandbox is disposable by design — cut from
 * HEAD, holding only the fixture and what the proof wrote, none of which may ever land.
 */
function removeSandbox(ws, dir) {
	const { error } = captureLog(() => removeWorktree(ws, dir, { force: true }));
	if (!error) return true;
	// the failure is recorded on the row, not only warned: `sandbox_removed: false` is what
	// `dt prove --list` counts
	console.warn(`⚠ sandbox ${dir} could not be removed: ${firstLine(error.message)} — remove it by hand`);
	return false;
}

/**
 * One proof, start to finish. Returns `{ code, state, row, verdicts }`.
 *
 * `flags.silent` suppresses the human output without emitting JSON — what `--all` runs each proof
 * with, so a board is a board rather than a step transcript per proof.
 */
function proveOne(ws, id, proof, flags) {
	const started = Date.now();
	const say = flags.silent || flags.json ? () => {} : (line) => console.log(line);
	const timeout = Number.isInteger(proof.timeout) ? proof.timeout : DEFAULT_TIMEOUT;

	/** The throwaway worktree this run is happening in, once there is one — `null` for every proof
	 *  without a fixture and every `--here` run, which run in the invoking checkout itself. */
	let sandbox = null;
	/** The workspace everything after `requires` runs against: the sandbox when there is one, the
	 *  invoking checkout otherwise. The ledger is the deliberate exception (see `settle`). */
	let tws = ws;
	const enter = (dir) => { sandbox = dir; tws = dir ? { ...ws, root: dir } : ws; };

	/** Append the row this state produces and answer with its code. Every terminal state goes
	 *  through here, so "exactly one row per run" is structural rather than remembered.
	 *
	 *  The ledger is always the invoking checkout's — `ws.root`, never `tws.root`. A sandbox is
	 *  deleted the moment the verdict is in, so evidence written inside one would go with it. */
	const settle = (state, over = {}, verdicts = []) => {
		// a sandbox is never left behind, except while PENDING (you are about to act inside it) or
		// under `--keep`. Removal happens before the row is built, so the row says what became of the
		// directory. `kept` is `null` while PENDING — nothing has been decided yet — the same
		// three-valued shape `sandbox_removed` uses.
		const kept = state === 'PENDING' ? (sandbox ? null : false) : !!(sandbox && flags.keep);
		let removed = null;
		if (kept) say(`kept     ${sandbox}`);
		else if (sandbox && state !== 'PENDING') removed = removeSandbox(ws, sandbox);

		const row = ledgerRow(state, started, { sandbox, sandbox_removed: removed, ...over });
		appendLedger(ws.root, id, row);
		// one object on stdout and nothing else, so a script can parse it whole. `kept` rides along
		// rather than living on the row, because under `--json` the human `kept` line is suppressed.
		if (flags.json) dt.emit(JSON.stringify({ ...row, verdicts, kept }, null, 2));
		return { code: exitFor(state), state, row, verdicts };
	};

	/**
	 * Every path that judges leaves a row, even when it throws — including a `--record` resume, so
	 * the ledger never sits at PENDING for a run that has already finished.
	 *
	 * `over` is built before the run, and its `steps` is the live array — so a throw halfway through
	 * the loop still records the steps that did complete.
	 */
	const ledgering = (over, run) => {
		try { return run(); }
		catch (e) {
			if (e.ledgered) throw e;
			settle('FAIL', { ...over, failure_reason: firstLine(e.message) });
			throw Object.assign(e, { ledgered: true });
		}
	};

	// ---- 0. where this proof is allowed to write. A fixture proof runs in a throwaway detached
	// worktree on its own records. Every other run is in this checkout and may not change `data/`,
	// unless `--here` says so.
	const sandboxed = proof.given?.fixture === true && !flags.here;
	const guarded = !sandboxed && !flags.here;
	if (flags.here) say(`⚠ --here: writing to THIS checkout's store`);
	if (flags.keep && !sandboxed) {
		throw new Error(`--keep keeps a fixture proof's sandbox — ${id} runs in the workspace, so there is nothing to keep`);
	}
	/** `data/` as it stood before the first step, when this run may not write it. */
	let dataBefore = null;
	/** Why this run fails for writing `data/`, or null when it wrote nothing it was not allowed to. */
	const wroteLive = () => {
		if (!guarded || dataBefore === null || dataState(ws.root) === dataBefore) return null;
		return 'a step changed data/ outside a sandbox — use given.fixture: true, or --here to write this store';
	};

	// ---- 1. resume — `--record` names the pending run this invocation is finishing, and nothing
	// else, so a run you are halfway through is never discarded.
	const override = typeof flags.record === 'string' ? flags.record : null;
	if (override) {
		const pend = pendingFor(ws.root, id, override);
		if (!pend) throw new Error(`no pending run of ${id} for ${override} — run dt prove ${id} first`);
		return resume(pend);
	}

	// ---- 2. the pending guard. A second fresh run while one is outstanding would re-ask for the
	// same action, with no way to tell which pending row a later verify is judged against. A pending
	// older than the proof's own timeout is stale, so it is cleared, out loud, and recorded.
	//
	// A discard attempts the removal first and the row says what happened to the directory:
	// `.worktrees/` is gitignored, so the ledger is the only record of a leaked sandbox.
	const discard = (row, reason) => {
		const removed = !row.sandbox ? null : fs.existsSync(row.sandbox) ? removeSandbox(ws, row.sandbox) : true;
		appendLedger(ws.root, id, { ...row, when: new Date().toISOString(), verdict: 'FAIL', failure_reason: reason, sandbox_removed: removed });
	};
	const live = [];
	for (const row of allPending(ws.root, id)) {
		const age = Math.round((Date.now() - Date.parse(row.when)) / 1000);
		if (age >= 0 && age <= timeout) { live.push(row); continue; }
		say(`stale pending run of ${id} for ${row.record === null ? '(no record)' : row.record} (${age}s) — cleared`);
		discard(row, 'stale');
	}
	if (live.length && flags.restart) {
		// every live pending is discarded, not just the newest — otherwise `--restart` refuses again
		// on the next one and the flag reads as broken.
		for (const row of live) discard(row, 'restarted');
	} else if (live.length === 1 && live[0].record === null) {
		// a live proof with no `given` pends against no record, so `--record` cannot name it — the
		// bare verb is the only way back, and refusing here would strand the run permanently.
		return resume(live[0]);
	} else if (live.length === 1) {
		throw new Error(`${id} is pending for ${live[0].record} since ${live[0].when} — finish it with dt prove ${id} --record ${live[0].record}, or --restart to discard it`);
	} else if (live.length) {
		throw new Error(`${id} is pending for ${live.length} records — finish each with:\n${live.map((row) => `  dt prove ${id} --record ${row.record}`).join('\n')}\nor --restart to discard them`);
	}

	// ---- 3. requires, before the fixture: a machine that cannot answer the question must not report
	// NO-FIXTURE, which reads as a fact about the workspace's data rather than about this machine.
	const need = resolveRequires(ws, proof.requires);
	if (!need.ok) {
		say(`UNAVAILABLE  ${id}`);
		for (const m of need.missing) say(`  ${m.fix}`);
		return settle('UNAVAILABLE', { failure_reason: need.missing.map((m) => m.fix).join('; ') });
	}

	// ---- 3b through 7 are all wrapped, starting above the sandbox: everything from the fixture copy
	// down can throw (an unreadable fixture, a collection the sandbox has no descriptor for), and each
	// throw still gets a ledger row and a removed sandbox.
	//
	// `over` is mutated as each phase learns its part and read at the moment of the throw, so a
	// failure halfway through records what was known by then. Teardown comes free: `ledgering`'s
	// catch goes through `settle`, and `settle` is what removes the sandbox.
	let record = null;
	let ref = null;
	let ctx = {};
	const before = {};
	const steps = [];
	const over = { record: null, steps, before };
	return ledgering(over, phases);

	function phases() {
		// ---- 3b. the sandbox, cut after `requires` (a machine that cannot answer must not pay for a
		// worktree) and before the fixture, which is picked from inside it. `temp` means detached and
		// under `.worktrees/.tmp-<rand>/` in the primary root — see `createWorktree` for why not tmpdir.
		if (sandboxed) {
			const src = fixtureDir(ws.root, proofModuleRoot(ws.root, id), id);
			// dot-entries are not stray files: a file manager writes `.DS_Store` into any directory it
			// opens, and it comes back
			const entries = fs.existsSync(src) ? fs.readdirSync(src).filter((e) => !e.startsWith('.')) : [];
			if (!entries.includes('data')) {
				// `given.fixture: true` with no records behind it: the same fact as "matched 0 records",
				// and naming the path is the difference between a fix and a hunt.
				const at = `${path.relative(ws.root, src)}/data/`;
				say(`NO-FIXTURE  ${id} — no fixture records at ${at}`);
				return settle('NO-FIXTURE', { failure_reason: `no fixture records at ${at}` });
			}
			try { enter(createWorktree(ws, { name: id, temp: true, quiet: true })); } catch (e) {
				// a sandbox that cannot be made ready is this machine failing to answer, not the artifact
				// failing: UNAVAILABLE, and the half-made sandbox goes with the verdict
				if (!e.worktree) throw e;
				enter(e.worktree);
				// the installer's own words, and a recovery that matches what `settle` does next: without
				// --keep the sandbox is removed
				const why = (e.diagnosis ?? []).join('; ') || 'the install printed nothing';
				const next = flags.keep ? `the sandbox is kept at ${e.worktree} — run \`dt install\` there` : 'the sandbox was removed — rerun with --keep to install it by hand';
				const reason = `sandbox install exited ${e.installExit}: ${why} — ${next}`;
				say(`UNAVAILABLE  ${id} — ${reason}`);
				return settle('UNAVAILABLE', { failure_reason: reason });
			}
			// only `data/` is admitted. The fixture mirrors the workspace root, so copying it whole could
			// overwrite `package.json`, a descriptor or `.dreamteamer/` — and since `sandboxUnfit` runs
			// after the copy, a fixture could bring the very schema its records are validated against.
			const stray = entries.find((e) => e !== 'data');
			if (stray) {
				say(`FAIL  ${id} — fixture may contain only data/ — found ${stray}`);
				return settle('FAIL', { failure_reason: `fixture may contain only data/ — found ${stray}` });
			}
			// and `data` has to be a directory: `cpSync(file, dir)` would write the file over the
			// sandbox's `data/`
			if (!fs.statSync(path.join(src, 'data')).isDirectory()) {
				say(`FAIL  ${id} — fixture data/ must be a directory`);
				return settle('FAIL', { failure_reason: 'fixture data/ must be a directory' });
			}
			fs.cpSync(path.join(src, 'data'), path.join(sandbox, 'data'), { recursive: true });
			const unfit = sandboxUnfit(sandbox, [proof.given?.collection, ...(proof.expect ?? []).map((e) => e?.collection)]);
			if (unfit) {
				say(`FAIL  ${id} — fixture does not validate:`);
				say(`  ${unfit}`);
				return settle('FAIL', { failure_reason: `fixture does not validate: ${unfit}` });
			}
		}

		// ---- 4. the fixture — the one record this proof runs against, or none.
		const store = new dt.Store(tws);
		record = proof.given ? pickFixture(store, proof.given, null) : null;
		ref = record ? record.ref : null;
		over.record = ref;
		// bound here: the `_delta` snapshot and the pre-check both render `{record}`, and both run
		// before the steps do
		ctx = record ? { record } : {};
		if (proof.given && !record) {
			say(`NO-FIXTURE  ${id} — given matched 0 records in ${proof.given.collection}`);
			return settle('NO-FIXTURE', { failure_reason: `given matched 0 records in ${proof.given.collection}` });
		}

		// ---- 5. the `_delta` snapshot, taken before anything runs. It is also what makes the pre-check
		// below read a delta of 0 rather than the whole collection's size. It goes through the same
		// `substituteWhere` the judge uses, so before and after count the same question.
		const resolve = dt.recordResolver(store);
		for (const [i, e] of (Array.isArray(proof.expect) ? proof.expect : []).entries()) {
			if (e && 'collection' in e && isDelta(e.count)) before[i] = countMatching(store, String(e.collection), substituteWhere(e.where, ctx), resolve);
		}

		// ---- 6. the pre-check. A proof whose expectations already hold would report PASS forever and
		// measure nothing, so it answers VACUOUS. `step`/`path` expectations are not pre-checkable and do not count toward "all", so a
		// proof judged only on those is never vacuous.
		const pre = judge(tws, store, proof, id, record, before, [], true);
		if (pre.length && pre.every((v) => v.ok)) {
			say(`VACUOUS  ${id} — every expectation already holds against ${ref ? ref : 'this workspace'}; a proof that cannot fail is not a proof`);
			return settle('VACUOUS', { record: ref, before, failure_reason: 'every expectation already holds' });
		}

		// ---- 7. the steps, in order, until one fails or one asks for an actor.
		if (guarded) dataBefore = dataState(ws.root);
		return runSteps();
	}

	/** What a FAIL row for a resumed run carries: the pending row's own record, steps and snapshot,
	 *  because those are the facts of the run being finished — this invocation only judged it. */
	function rowOf(pending) {
		return { record: pending.record ?? null, steps: pending.steps ?? [], before: pending.before ?? {}, sandbox: pending.sandbox ?? null };
	}

	/**
	 * Finish a PENDING run — in the place that run actually happened. A sandbox that is gone cannot
	 * be judged: falling back to the primary would answer about records this proof never touched.
	 */
	function resume(pend) {
		enter(pend.sandbox ?? null);
		if (sandbox && !fs.existsSync(sandbox)) {
			const gone = `sandbox ${sandbox} is gone (removed by hand?)`;
			say(`FAIL  ${id} — ${gone}`);
			enter(null); // there is nothing left to remove, and `settle` would try
			return settle('FAIL', { ...rowOf(pend), failure_reason: gone });
		}
		return ledgering(rowOf(pend), () => verify(pend));
	}

	function runSteps() {
		for (const [i, raw] of (Array.isArray(proof.steps) ? proof.steps : []).entries()) {
			const step = raw ?? {};
			const n = i + 1;
			if (step.perform !== undefined) {
				// the pending row is written before the block is printed, so a run killed between the two
				// still leaves a resumable ledger — you may already have taken the action
				const text = substitute(String(step.perform), ctx);
				const wrote = wroteLive();
				if (wrote) {
					say(`FAIL  ${id} — ${wrote}`);
					return settle('FAIL', { record: ref, steps, before, failure_reason: wrote });
				}
				const out = settle('PENDING', { record: ref, steps, before });
				// above the PERFORM, because "where am I acting" is read before "what do I do" — acting in
				// the wrong checkout writes real records this proof will not judge
				if (sandbox) say(`in       ${sandbox}   (a throwaway worktree — records written here are never landed)`);
				say(`PERFORM  ${text}`);
				const src = commandSource(ws.root, text);
				if (src) say(`source   ${src}`);
				say(`then     dt prove ${id}${record ? ` --record ${record.ref}` : ''}   (the same verb, again)`);
				return out;
			}
			const cmd = substitute(String(step.run ?? ''), ctx);
			say(`RUN ${n}  ${cmd}`);
			const t0 = Date.now();
			const res = spawnSync(cmd, { shell: true, cwd: tws.root, timeout: timeout * 1000, encoding: 'utf8', maxBuffer: MAX_OUTPUT_MB * 1024 * 1024 });
			const ms = Date.now() - t0;
			// `stepOutcome` tells apart a timeout, an output overflow, an outside kill, a step the shell
			// could not start and a plain non-zero exit — five different things to go and fix
			const want = stepExpect(proof, n)?.exit ?? 0;
			const { exit, failure_reason } = stepOutcome(res, timeout, n, want);
			const out = captured(res.stdout);
			say(`  exit ${exit} (${ms} ms)`);
			steps.push({ index: n, kind: 'run', exit, stdout: out.text, stdout_truncated: out.truncated, stdout_tail: lastLines(out.text), stderr_tail: lastLines(res.stderr) });
			if (failure_reason) {
				// nothing was judged, so the failure names the step and shows its stderr rather than a
				// verdict line. A plain non-zero exit keeps its `(want N)` form; every other cause prints
				// its own sentence.
				const plain = failure_reason === `step ${n} exited ${exit}`;
				say(`FAIL at step ${n}  ${id} — ${plain ? `exit ${exit} (want ${want})` : failure_reason.slice(`step ${n} `.length)}`);
				for (const line of lastLines(res.stderr).split('\n')) if (line) say(`  ${line}`);
				const wrote = wroteLive();
				if (wrote) say(`  ${wrote}`);
				return settle('FAIL', { record: ref, steps, before, failure_reason: wrote ? `${failure_reason}; ${wrote}` : failure_reason });
			}
		}
		const wrote = wroteLive();
		if (wrote) {
			say(`FAIL  ${id} — ${wrote}`);
			return settle('FAIL', { record: ref, steps, before, failure_reason: wrote });
		}
		return decide(record, before, steps);
	}

	/**
	 * A fresh `Store`, always: the instance that took the before-count may serve a stale index after
	 * steps that wrote without committing (see `countMatching`).
	 */
	function decide(rec, snapshot, stepResults) {
		const fresh = new dt.Store(tws);
		// the picked record is re-read so the verdict is judged on its state after the steps ran. When
		// the steps deleted or renamed it, the pre-step snapshot (`rec`) is judged instead: the run did
		// happen, so it answers with verdicts rather than NO-FIXTURE.
		const current = rec ? pickFixture(fresh, proof.given, rec.ref) ?? rec : null;
		const currentRef = current ? current.ref : null;
		const verdicts = judge(tws, fresh, proof, id, current, snapshot, stepResults, false);
		for (const v of verdicts) say(`  ${v.line}`);
		// a run that declared expectations and produced no verdict measured nothing, whatever the
		// reason, so it is VACUOUS — `every(ok)` over an empty list would otherwise be a PASS. Scoped to
		// proofs that declare expectations: a gate's assertion is its steps' exit codes.
		if (Array.isArray(proof.expect) && proof.expect.length && !verdicts.length) {
			const reason = 'no expectation produced a verdict — a proof that asserts nothing is not a proof';
			say(`VACUOUS  ${id} — ${reason}`);
			return settle('VACUOUS', { record: currentRef, steps: stepResults, before: snapshot, failure_reason: reason }, verdicts);
		}
		const failed = verdicts.find((v) => !v.ok);
		if (!failed) {
			say(`PASS  ${id} (${Date.now() - started} ms)`);
			return settle('PASS', { record: currentRef, steps: stepResults, before: snapshot }, verdicts);
		}
		say(`FAIL  ${id}`);
		// `reason` is set only by the two ✖s no filter produced (a missing before-count, an
		// unparseable stdout), whose line ends in a glyph a `failure_reason` must not carry.
		return settle('FAIL', { record: currentRef, steps: stepResults, before: snapshot, failure_reason: failed.reason ?? failed.line }, verdicts);
	}

	/** The resume half: the steps already ran (in an earlier process, and the perform by a human), so
	 *  there is nothing to do but judge — against the `before` the PENDING row carries. */
	function verify(pending) {
		const fresh = new dt.Store(tws);
		const rec = pending.record && proof.given ? pickFixture(fresh, proof.given, pending.record) : null;
		if (pending.record && proof.given && !rec) {
			say(`NO-FIXTURE  ${id} — ${pending.record} is gone`);
			return settle('NO-FIXTURE', { failure_reason: `${pending.record} is gone` });
		}
		return decide(rec, pending.before ?? {}, pending.steps ?? []);
	}
}

/**
 * `--all` and the artifact form — a board, and never a request for an actor.
 *
 * Exit 5 never comes out of here: this is what a pre-commit hook and a CI step run, and neither can
 * act on a request for a human. A proof with a `perform` step is listed rather than started, and
 * the code reflects only what actually ran.
 *
 * `external: true` is opt-in for the same reason from the other side: a proof needing the network
 * should be invisible to the default run, not red on it.
 */
function proveMany(ws, proofs, flags, select) {
	const tally = { PASS: 0, FAIL: 0, UNAVAILABLE: 0, 'NO-FIXTURE': 0, VACUOUS: 0 };
	const actors = [];
	const rows = [];
	const say = flags.json ? () => {} : (line) => console.log(line);
	for (const [id, proof] of proofs) {
		if (!select(proof, id)) continue;
		if (typeof flags.kind === 'string' && proof.kind !== flags.kind) continue;
		if (proof.external === true && !flags.external) continue;
		if ((Array.isArray(proof.steps) ? proof.steps : []).some((s) => s?.perform !== undefined)) { actors.push(id); continue; }
		const t0 = Date.now();
		let state;
		let reason;
		try {
			// every proof runs silent here: a transcript is what a single-proof run is for
			const out = proveOne(ws, id, proof, { silent: true });
			state = out.state;
			reason = out.row.failure_reason;
		} catch (e) {
			// a throw is that proof's failure, with a row. UNAVAILABLE is settled inside `proveOne` and
			// arrives as a returned verdict, so a throw always means FAIL.
			state = 'FAIL';
			reason = firstLine(e.message);
			// `ledgered` means `proveOne` already wrote the row for this throw
			if (!e.ledgered) appendLedger(ws.root, id, ledgerRow(state, t0, { failure_reason: reason }));
		}
		// one line per proof, with the reason on it
		say(`${state}  ${id}${reason ? ` — ${reason}` : ''}`);
		rows.push({ proof: id, verdict: state, failure_reason: reason ?? null });
		tally[state] = (tally[state] ?? 0) + 1;
	}
	if (actors.length) {
		say('needs an actor:');
		for (const id of actors) say(`  dt prove ${id}`);
	}
	const summary = `proofs: ${tally.PASS} passed · ${tally.FAIL} failed · ${tally.UNAVAILABLE} unavailable · ${tally['NO-FIXTURE']} no-fixture · ${tally.VACUOUS} vacuous · ${actors.length} need an actor`;
	say(summary);
	// `--strict` makes UNAVAILABLE fatal. It is a flag rather than the default because a proof needing
	// a credential is ordinarily unavailable on a cloud session.
	const code = tally.FAIL > 0 || (flags.strict && tally.UNAVAILABLE > 0) ? EXIT.FAIL : EXIT.PASS;
	if (flags.json) dt.emit(JSON.stringify({ summary, ...tally, 'need-an-actor': actors, proofs: rows, code }, null, 2));
	return { code };
}

// ── the read surface: `dt prove --list` ─────────────────────────────────────────────────────────
//
// Nothing below runs a step or writes a byte. A proof's source says what it asserts; everything else
// you ask about one — can it run here, what did it last answer, what has no proof at all, did anything
// fail on this machine — is a fact about this machine and this store, computed at read time.

/**
 * `{ availability, last }` for one proof — the two columns no record carries.
 *
 * `availability` asks `requires` of this machine first (its fix is what the column names, never an
 * env value), then, for a live proof picking from the live store, whether `given` matches anything.
 * A `fixture` proof brings its own record and a gate needs none. `last` is the tail of this machine's
 * ledger — a proof that failed and then passed is passing — or null (`never`).
 */
export function proofFacts(ws, store, id, proof, names) {
	const need = resolveRequires(ws, proof.requires, names ?? envKeys(ws.root));
	let availability = need.ok ? 'available' : `unavailable (${need.missing[0].fix})`;
	if (need.ok && proof.given !== undefined && proof.given?.fixture !== true) {
		// a probe, not a run: the only way to answer "is there a record for this" is to ask
		let picked = null;
		try { picked = pickFixture(store, proof.given, null); } catch { picked = null; }
		if (!picked) availability = 'no-fixture';
	}
	const rows = readLedger(ws.root, id);
	const t = rows[rows.length - 1];
	return { availability, last: t ? { verdict: t.verdict, when: String(t.when).slice(0, 10), record: t.record ?? null } : null };
}

/** The `last` column: `<verdict> <YYYY-MM-DD> [<record>]`, or `never`. */
const lastCell = (last) => (last ? `${last.verdict} ${last.when}${last.record ? ` [${last.record}]` : ''}` : 'never');

/** A kept or un-removable sandbox nothing will come back for: a terminal row with a sandbox whose
 *  removal failed, or was never attempted (what `--keep` leaves). `.worktrees/` is gitignored, so the
 *  ledger is the only thing that knows the directory exists; `existsSync` drops one already gone. */
function leftBehind(rows) {
	const left = new Set();
	for (const r of rows) {
		const behind = r.sandbox_removed === false || (r.verdict !== 'PENDING' && r.sandbox_removed === null);
		if (r.sandbox && behind && fs.existsSync(r.sandbox)) left.add(r.sandbox);
	}
	return left;
}

/**
 * `dt prove --list [<proof|artifact>] [--missing] [--kind gate|live] [--strict] [--json]`.
 *
 * `--missing` lists artifacts, not proofs, so it takes no target and no narrowing.
 *
 * The tally is counted as the walk goes, and the walk is not wrapped: a throw partway through (an
 * unreadable ledger, a record that will not parse) fails loudly rather than reading zero failures.
 */
function listProofs(ws, store, proofs, target, flags) {
	if (flags.missing) {
		const narrowing = ['kind', 'strict'].filter((f) => f in flags);
		if (target || narrowing.length) throw new Error(`--missing lists artifacts, not proofs — drop ${[target, ...narrowing.map((f) => `--${f}`)].filter(Boolean).join(' ')}`);
		const named = new Set();
		for (const p of proofs.values()) for (const a of p.about ?? []) named.add(String(a));
		// the same enumeration compile's coverage line counts, in its order — that line says
		// `commands 1/2`, this says which one
		const refs = artifactRefs(store);
		const missing = [...refs.commands, ...refs.skills, ...refs.scripts, ...refs.bindings].filter((r) => !named.has(r));
		if (flags.json) { dt.emit(JSON.stringify(missing, null, 2)); return { code: EXIT.PASS }; }
		for (const m of missing) console.log(m);
		if (!missing.length) console.log('(every artifact has a proof)');
		return { code: EXIT.PASS };
	}
	let select = () => true;
	if (target) {
		if (proofs.has(target)) select = (id) => id === target;
		else if (artifactRefs(store).all.has(target)) select = (id, p) => (p.about ?? []).map(String).includes(target);
		else throw new Error(`dt prove --list takes a proof id or an artifact (skills/<id>, commands/<id>, …) — got "${target}"`);
	}
	const names = envKeys(ws.root); // one .env parse for the whole listing
	const tally = { PASS: 0, FAIL: 0, UNAVAILABLE: 0 };
	let declared = 0; let never = 0; let other = 0;
	const left = new Set();
	const rows = [];
	for (const [id, proof] of [...proofs].sort(([a], [b]) => a.localeCompare(b))) {
		if (!select(id, proof)) continue;
		if (typeof flags.kind === 'string' && proof.kind !== flags.kind) continue;
		declared++;
		const facts = proofFacts(ws, store, id, proof, names);
		const v = facts.last?.verdict;
		if (!v) never++;
		else if (v in tally) tally[v]++;
		else other++;
		for (const s of leftBehind(readLedger(ws.root, id))) left.add(s);
		rows.push({ id, ...proof, ...facts });
	}
	const summary = `proofs: ${declared} declared · ${tally.PASS} passed · ${tally.FAIL} failed · ${tally.UNAVAILABLE} unavailable · ${never} never${other ? ` · ${other} other` : ''}`;
	// here `--strict` fails on a FAIL tail and says nothing about UNAVAILABLE: this reports what this
	// machine has already proved rather than running anything (on a board it means the other thing —
	// see proveMany).
	const code = flagValue(flags.strict) && tally.FAIL ? EXIT.FAIL : EXIT.PASS;
	if (flags.json) {
		dt.emit(JSON.stringify({ summary, declared, ...tally, never, other, sandboxes_left: [...left], proofs: rows, code }, null, 2));
		return { code };
	}
	for (const r of rows) console.log([r.id, r.kind, (r.about ?? []).join(','), r.availability, lastCell(r.last)].join('  '));
	if (target && !rows.length) console.log(`(no proof is about ${target} — dt prove --list --missing)`);
	console.log(summary);
	if (left.size) console.log(`  sandboxes left behind: ${left.size} — dt worktree list`);
	if (code) console.log(`✖ ${tally.FAIL} proof(s) FAILED on this machine`);
	return { code };
}

export const PROVE_USAGE = `  prove <proof> [--record <c>/<id>] [--restart] [--here] [--keep] [--json]
              run one proof and answer with an EXIT CODE: 0 pass · 1 fail · 3 unavailable
              (this machine lacks a required var or binary) · 4 no-fixture (the given matched no
              record) · 5 a \`perform\` step is owed a human/agent · 6 vacuous (every expectation
              already held, so the proof cannot fail). Evidence: .dreamteamer/.proofs/<id>.jsonl
              --record finish the pending run for that record · --restart discard pending runs ·
              --here run in THIS checkout and let the steps write its data/ · --keep keep the sandbox
  prove <artifact> [--kind gate|live] [--external] [--strict] [--json]
              every proof whose \`about\` names skills/<id>, commands/<id>, command-bindings/<id> or
              <module>/bin/<file> — a board; exit 6 when NOTHING is about it
  prove --all [--kind gate|live] [--external] [--strict] [--json]
              every proof, one line each; a \`perform\` proof is LISTED, never started (never exits 5).
              --external include external proofs · --strict make an unavailable fatal
  prove --list [<proof|artifact>] [--kind gate|live] [--strict] [--json]
              runs nothing: each proof's availability on THIS machine and its last verdict, then a
              tally. --strict exits 1 when any proof's ledger tail is a FAIL
  prove --list --missing [--json]
              the artifacts no proof is about`;
