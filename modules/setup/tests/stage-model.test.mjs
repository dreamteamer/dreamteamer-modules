// The stage model, asserted across the three places that describe it.
//
// Until this release they disagreed three ways: the `stage` enum carried 16 values, the SKILL table
// had 13 numbered rows plus one unnumbered `—`, and the module description named 12. One row set TWO
// values (`condensed`, then `pasted-back`). And `goals` — a collection that exists, is advertised in
// the module blurb and has an inference rule in references/inference-model.md — was written by NO
// stage at all, which no test could see because nothing checked.
//
// ⚠ This does NOT assert one writing stage per collection. `concepts` and `decisions` are genuinely
// created twice: once from the workspace's own vocabulary and once from the evidence. Demanding a
// single writer would be a false invariant that damaged a working design. What it asserts is that
// no collection is orphaned — which is the defect that actually shipped.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MOD = path.join(ROOT, 'modules', 'perspective');
const COLS = path.join(MOD, 'collections', 'perspective');

const WORKING = ['installed', 'inventoried', 'read', 'clustered', 'projected', 'extracted',
	'inferred', 'found', 'interviewed', 'proposed', 'synthesised', 'materialised', 'seeded'];
const TERMINAL = ['done', 'abandoned'];
const STAGES = [...WORKING, ...TERMINAL];

const run = yaml.load(fs.readFileSync(path.join(COLS, 'retrospective-sessions.collection.yaml'), 'utf8'));
const skill = fs.readFileSync(path.join(MOD, 'skills', 'running-retrospectives', 'SKILL.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(MOD, 'package.json'), 'utf8'));

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
	assert.deepEqual(run.schema.properties.stage.enum, STAGES);
});

test('no retired value survives anywhere', () => {
	for (const dead of ['initialised', 'condensed', 'pasted-back']) {
		assert.ok(!run.schema.properties.stage.enum.includes(dead), `enum still carries ${dead}`);
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

test('the module description names every working stage', () => {
	for (const s of WORKING) {
		assert.match(pkg.dreamteamer.description, new RegExp(`\`${s}\``), `the description never names \`${s}\``);
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
 *  `world/users.collection.yaml` is `world/users`. ⚠ RECURSIVE: a flat readdir stopped seeing the
 *  five `world/*` collections the moment they moved into the namespace, and the orphan gate below
 *  went quiet about exactly the collections this release added. */
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

test('world/goals is written by the inferred stage, and by that stage alone', () => {
	const inferred = rows.find((r) => r.stage === 'inferred');
	assert.ok(inferred, 'no `inferred` row');
	assert.match(inferred.writes, /`world\/goals`/);
	const others = rows.filter((r) => r.stage !== 'inferred' && /`world\/goals`/.test(r.writes));
	assert.deepEqual(others.map((r) => r.stage), [], 'goals is inferred from evidence, nowhere else');
});

test('the inference stage has a script to run', () => {
	assert.ok(fs.existsSync(path.join(MOD, 'skills', 'running-retrospectives', 'bin', 'infer-goals.mjs')),
		'the `inferred` row promises a script that does not exist');
});
