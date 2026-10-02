// The stage model, asserted across the three places that describe it: the `stage` enum, the skill's
// stage table, and the skill's trigger description. Every collection is written by some stage.
//
// This does NOT assert one writing stage per collection. `concepts` and `decisions` are genuinely
// created twice: once from the workspace's own vocabulary and once from the evidence. Demanding a
// single writer would be a false invariant that damaged a working design. What it asserts is that
// no collection is orphaned — which is the defect that actually shipped.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { enumValues } from '../skills/running-retrospectives/lib/descriptors.mjs';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const MOD = path.join(ROOT, 'modules', 'perspective');
const COLS = path.join(MOD, 'collections', 'perspective');

const WORKING = ['installed', 'inventoried', 'read', 'clustered', 'projected', 'extracted',
	'inferred', 'found', 'interviewed', 'proposed', 'synthesised', 'materialised', 'seeded'];
const TERMINAL = ['done', 'abandoned'];
const STAGES = [...WORKING, ...TERMINAL];

const run = yaml.load(fs.readFileSync(path.join(COLS, 'retrospective-sessions.collection.yaml'), 'utf8'));
const skill = fs.readFileSync(path.join(MOD, 'skills', 'running-retrospectives', 'SKILL.md'), 'utf8');

/** the stage table's rows: `| 3 | **read** → `read` | … | writes |` */
// ⚠ Cells carry ESCAPED pipes (`anecdote\|pattern`), so a naive split on | shreds three rows and the
// gate reads the wrong column. Split on unescaped pipes only.
const rows = skill.split('\n')
	.filter((l) => /^\| *\d+ *\| *\*\*/.test(l))
	.map((l) => {
		const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
		const [num, stage, runCol, writes] = cells;
		return { n: Number(num), stage: (stage.match(/→ `([a-z-]+)`/) ?? [])[1], run: runCol ?? '', writes: writes ?? '' };
	});

test('the enum is the list, in order, with the terminal values last', () => {
	assert.deepEqual(enumValues(run.fields.stage.enum), STAGES);
});

test('no retired value survives anywhere', () => {
	for (const dead of ['initialised', 'condensed', 'pasted-back']) {
		assert.ok(!enumValues(run.fields.stage.enum).includes(dead), `enum still carries ${dead}`);
		assert.ok(!new RegExp(`\`${dead}\``).test(skill), `SKILL.md still names \`${dead}\``);
	}
});

test('the skill table numbers every working stage once, in the enum order', () => {
	assert.deepEqual(rows.map((r) => r.stage), WORKING, 'table stages must match the enum, in order');
	assert.deepEqual(rows.map((r) => r.n), WORKING.map((_, i) => i + 1), 'no gap, no duplicate, no unnumbered row');
});

test('one row sets exactly one stage', () => {
	for (const r of rows) {
		const set = [...r.run.matchAll(/→ `([a-z-]+)`/g)];
		assert.equal(set.length, 0, `row ${r.n} sets a second stage in its run column: ${set.map((m) => m[1]).join(', ')}`);
	}
});

test('the skill description names every working stage, so a resume at any stage triggers it', () => {
	const description = (/^description: (.*)$/m.exec(skill) ?? [])[1] ?? '';
	for (const s of WORKING) {
		assert.match(description, new RegExp(`\\b${s}\\b`), `the skill description never names ${s}`);
	}
});

// `gates` is written at EVERY stage boundary rather than by one stage, so listing it in a single
// row's writes column would be a lie. The skill states it once, above the table.
const EVERY_BOUNDARY = ['gates'];

test('a collection written at every boundary is stated as such in the skill', () => {
	for (const c of EVERY_BOUNDARY) {
		assert.match(skill, new RegExp(`\\\`${c}\\\`[^\\n]*every stage boundary|every stage boundary[^\\n]*\\\`${c}\\\``),
			`${c} is written at every boundary and the skill never says so`);
	}
});

/** Every descriptor under `collections/perspective/`, by its name RELATIVE to that folder — so
 *  `users.collection.yaml` is `users`. Recursive, so a descriptor in a subfolder is never skipped. */
function descriptorNames(dir, prefix = '') {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? descriptorNames(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [`${prefix}${e.name.replace('.collection.yaml', '')}`] : []);
}

test('no collection is orphaned — every one is written by some stage', () => {
	const collections = descriptorNames(COLS)
		.filter((c) => c !== 'retrospective-sessions' && !EVERY_BOUNDARY.includes(c));   // the run is written by /run-retrospective itself
	const written = rows.map((r) => r.writes).join(' ');
	const orphans = collections.filter((c) => !new RegExp(`\`${c}\``).test(written));
	assert.deepEqual(orphans, [], `written by no stage: ${orphans.join(', ')}`);
});

test('goals is written by the inferred stage, and by that stage alone', () => {
	const inferred = rows.find((r) => r.stage === 'inferred');
	assert.ok(inferred, 'no `inferred` row');
	assert.match(inferred.writes, /`goals`/);
	const others = rows.filter((r) => r.stage !== 'inferred' && /`goals`/.test(r.writes));
	assert.deepEqual(others.map((r) => r.stage), [], 'goals is inferred from evidence, nowhere else');
});

test('the inference stage has a script to run', () => {
	assert.ok(fs.existsSync(path.join(MOD, 'skills', 'running-retrospectives', 'bin', 'infer-goals.mjs')),
		'the `inferred` row promises a script that does not exist');
});
