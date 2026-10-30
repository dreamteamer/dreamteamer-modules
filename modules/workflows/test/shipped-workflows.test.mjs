// EVERY SHIPPED WORKFLOW RUNS ON WHAT EXISTS. A workflow is only as real as the commands it names and
// the fields its filters read: a renamed command or a misspelt field would not fail a compile — `dt
// list --where` narrows an unknown key to NOTHING, silently — so each step is checked here against the
// repo itself: the command exists, it is BOUND to the step's collection (or `dt next` has nothing to
// say about the step), and every key of its `where` is a field of that collection, one hop included.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { MODULES, moduleIds, ALL, targetsOf } from '../../../tests/helpers/descriptors.mjs';

const OPERATORS = new Set(['_eq', '_neq', '_ieq', '_nieq', '_lt', '_lte', '_gt', '_gte', '_in', '_nin', '_null', '_nnull', '_empty', '_nempty', '_contains', '_ncontains', '_icontains', '_starts_with', '_istarts_with', '_ends_with', '_iends_with', '_between', '_nbetween', '_regex']);
const TOKENS = new Set(['$today', '$now', '$from', '$to']);

/** Every shipped workflow, by module: { module, id, file, doc } — composed copies included, since core ships them too. */
const shipped = moduleIds().flatMap((m) => {
	const dir = path.join(MODULES, m, 'data', 'workflows');
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir).filter((f) => f.endsWith('.workflow.md')).map((f) => {
		const text = fs.readFileSync(path.join(dir, f), 'utf8');
		return { module: m, id: f.replace(/\.workflow\.md$/, ''), file: `${m}/data/workflows/${f}`, text, doc: yaml.load(text.split(/^---\s*$/m)[1]) };
	});
});

/** command id → the modules that ship it. */
const COMMANDS = new Map();
for (const m of moduleIds()) {
	const walk = (dir, prefix = '') => {
		if (!fs.existsSync(dir)) return;
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
			else if (e.name.endsWith('.command.md')) {
				const id = prefix + e.name.replace(/\.command\.md$/, '');
				COMMANDS.set(id, [...(COMMANDS.get(id) ?? []), m]);
			}
		}
	};
	walk(path.join(MODULES, m, 'commands'));
}

/** (command, collection) pairs some binding in the repo declares. */
const BOUND = new Set();
for (const m of moduleIds()) {
	const dir = path.join(MODULES, m, 'command-bindings');
	if (!fs.existsSync(dir)) continue;
	for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.command-binding.yaml'))) {
		const b = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
		BOUND.add(`${b.command} ${b.collection}`);
	}
}

/** collection name → every field any descriptor (base or overlay) gives it, with its spec. */
const FIELDS = new Map();
for (const { doc } of ALL) for (const [n, spec] of Object.entries(doc.fields ?? {})) {
	if (!FIELDS.has(doc.name)) FIELDS.set(doc.name, new Map());
	FIELDS.get(doc.name).set(n, spec);
}
const BASES = new Set(ALL.filter((d) => !d.doc.overlay).map((d) => d.doc.name));

/** Problems with one filter object against one collection, following a reference one hop. */
function filterProblems(where, collection, hop = 0) {
	const out = [];
	for (const [k, v] of Object.entries(where)) {
		if (k === '_and' || k === '_or') { for (const c of v) out.push(...filterProblems(c, collection, hop)); continue; }
		const spec = FIELDS.get(collection)?.get(k);
		if (!spec) { out.push(`${collection} has no field "${k}"`); continue; }
		for (const [op, val] of Object.entries(v)) {
			if (OPERATORS.has(op)) {
				for (const x of [val].flat()) if (typeof x === 'string' && x.startsWith('$') && !TOKENS.has(x)) out.push(`unknown token ${x}`);
				continue;
			}
			// not an operator: a sub-condition on the referenced record
			const targets = targetsOf(spec);
			if (!targets.length) out.push(`${collection}.${k} is not a reference, so "${op}" cannot be a field of its target`);
			else if (hop >= 1) out.push(`${collection}.${k}.${op}: a filter reaches ONE hop`);
			else for (const t of targets) out.push(...filterProblems({ [op]: val }, t, hop + 1));
		}
	}
	return out;
}

test('the scan sees both shipped workflows, and core carries customer-factory', () => {
	const at = shipped.map((w) => `${w.module}/${w.id}`).sort();
	assert.deepEqual(at, ['core/customer-factory', 'rnd/software-factory', 'workflows/customer-factory']);
});

for (const w of shipped) {
	describe(`${w.file}`, () => {
		test('is an active workflow whose body has one section per step', () => {
			assert.equal(w.doc.status, 'active');
			const sections = w.text.split('\n').filter((l) => /^## \d+\. /.test(l));
			assert.deepEqual(sections, w.doc.steps.map((s, i) => `## ${i + 1}. ${s.name}`));
		});
		w.doc.steps.forEach((s, i) => {
			const label = `step ${i + 1} (${s.name})`;
			test(`${label}: its collection exists and its command exists and is bound to it`, () => {
				const coll = s.collection.replace(/^collections\//, '');
				assert.ok(BASES.has(coll), `${coll}: no module here owns it`);
				if (!s.command) { assert.ok(s.stop, 'a step with no command is a stop for a person'); return; }
				const cmd = s.command.replace(/^commands\//, '');
				assert.ok(COMMANDS.has(cmd), `${s.command} is not a command any module ships`);
				assert.ok(BOUND.has(`${s.command} ${s.collection}`), `${s.command} is not bound to ${s.collection} — dt next says nothing about this step`);
			});
			test(`${label}: its where is one JSON filter over real fields`, () => {
				if (!s.where) return;
				let where;
				assert.doesNotThrow(() => { where = JSON.parse(s.where); }, `not JSON: ${s.where}`);
				assert.equal(typeof where, 'object');
				assert.deepEqual(filterProblems(where, s.collection.replace(/^collections\//, '')), []);
			});
		});
	});
}

test('customer-factory names only commands core ships, so core installs it alone', () => {
	for (const s of shipped.find((w) => w.module === 'workflows').doc.steps.filter((x) => x.command)) {
		assert.ok(fs.existsSync(path.join(MODULES, 'core', 'commands', `${s.command.replace(/^commands\//, '')}.command.md`)), `${s.command} is not in core`);
	}
});

test('software-factory names only commands core or rnd ship — the pair it installs into', () => {
	for (const s of shipped.find((w) => w.id === 'software-factory').doc.steps.filter((x) => x.command)) {
		const cmd = s.command.replace(/^commands\//, '');
		assert.ok(['core', 'rnd'].some((m) => fs.existsSync(path.join(MODULES, m, 'commands', `${cmd}.command.md`))), `${s.command} is in neither core nor rnd`);
	}
});

test('the filter check is not vacuous: a misspelt field, a second hop and an unknown token are each caught', () => {
	assert.deepEqual(filterProblems({ startz: { _gte: '$from' } }, 'meetings'), ['meetings has no field "startz"']);
	assert.match(filterProblems({ company: { engagements: { stage: { _eq: 'lead' } } } }, 'meetings')[0], /ONE hop/);
	assert.deepEqual(filterProblems({ starts: { _gte: '$yesterday' } }, 'meetings'), ['unknown token $yesterday']);
	assert.deepEqual(filterProblems({ company: { engagements: { _empty: true } } }, 'meetings'), []);
});
