// Every script reaches a `perspective/*` folder through the helpers in lib/records.mjs, and every
// collection name it hands them is one this module ships. A name no descriptor carries is a folder no
// collection owns: the records written there are invisible to `dt check` and to every other script.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { collectionDir, collectionStorage, recordPath, recordId, shippedCollections } from '../skills/running-retrospectives/lib/records.mjs';

const MODULE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLS = path.join(MODULE, 'collections', 'perspective');
const SKILL = path.join(MODULE, 'skills', 'running-retrospectives');

const shipped = new Map(fs.readdirSync(COLS).filter((f) => f.endsWith('.collection.yaml')).map((f) => {
	const d = yaml.load(fs.readFileSync(path.join(COLS, f), 'utf8'));
	return [f.replace('.collection.yaml', ''), d.storage];
}));

/** Every script that reads or writes perspective records. The migrate scripts are excluded: they
 *  move records between the old layouts and name those layouts on purpose. */
const SCRIPTS = [
	...fs.readdirSync(path.join(SKILL, 'bin')).map((f) => path.join(SKILL, 'bin', f)),
	...fs.readdirSync(path.join(SKILL, 'lib')).map((f) => path.join(SKILL, 'lib', f)),
	path.join(MODULE, 'bin', 'check-records.mjs'),
].filter((f) => f.endsWith('.mjs'));

/** `[file, collection name]` for every literal collection argument handed to a path helper, or to a
 *  script's own thin wrapper around one. */
function helperArguments() {
	const out = [];
	const first = /\b(?:collectionDir|collectionStorage|recordPath|recordId|underRun|refsUnderRun|existingRefs)\(\s*'([^']+)'/g;
	const loadArg = /\bload\(\s*'([^']+)'\s*\)/g;           // infer-goals' wrapper
	const refOfArg = /\brefOf\(\s*\w+\s*,\s*'([^']+)'\s*\)/g;  // derive-collaborators' wrapper
	for (const file of SCRIPTS) {
		const src = fs.readFileSync(file, 'utf8');
		for (const re of [first, loadArg, refOfArg]) for (const m of src.matchAll(re)) out.push([path.relative(MODULE, file), m[1]]);
	}
	return out;
}

test('the module ships the flat observed collections and none of the deleted ones', () => {
	assert.deepEqual(shippedCollections(), [...shipped.keys()].sort());
	for (const c of ['activities', 'decisions', 'deliverables', 'goals', 'projects', 'users']) assert.ok(shipped.has(c), c);
	for (const c of ['phases', 'activity-lanes', 'tasks']) assert.ok(!shipped.has(c), `${c} is deleted`);
	assert.ok(!fs.existsSync(path.join(COLS, 'world')));
	assert.ok(!fs.existsSync(path.join(SKILL, 'bin', 'derive-tasks.mjs')));
});

test('every helper argument names a collection this module ships', () => {
	const args = helperArguments();
	assert.ok(args.length >= 60, `found only ${args.length} helper calls — the scan is not looking where it thinks it is`);
	const unknown = args.filter(([, c]) => !shipped.has(c)).map(([f, c]) => `${f}: '${c}'`);
	assert.deepEqual(unknown, [], `names no shipped collection:\n  ${unknown.join('\n  ')}`);
});

test('every literal suffix handed to recordPath is the one its descriptor declares', () => {
	const re = /\brecordPath\(\s*'([^']+)',.*?,\s*'([a-z-]+)',\s*(?:dataRoot|root|data)\b/g;
	const wrong = [];
	let seen = 0;
	for (const file of SCRIPTS) {
		for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) {
			seen += 1;
			const want = shipped.get(m[1])?.suffix;
			if (want !== m[2]) wrong.push(`${path.relative(MODULE, file)}: recordPath('${m[1]}', …, '${m[2]}') — the descriptor says '${want}'`);
		}
	}
	assert.ok(seen >= 30, `found only ${seen} recordPath calls`);
	assert.deepEqual(wrong, []);
});

test('no script joins a perspective data path by hand', () => {
	const handBuilt = /path\.join\([^)]*(?:'data',\s*'perspective'|dataRoot,\s*'perspective'|'perspective',\s*'world')/;
	const offenders = SCRIPTS.filter((f) => !f.endsWith('records.mjs') && handBuilt.test(fs.readFileSync(f, 'utf8')))
		.map((f) => path.relative(MODULE, f));
	assert.deepEqual(offenders, []);
});

test('the helpers resolve the shipped storage path, and refuse a name no descriptor carries', () => {
	const dataRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-paths-')), 'data');
	const ws = path.dirname(dataRoot);
	for (const [c, storage] of shipped) {
		assert.equal(collectionDir(c, dataRoot), path.join(ws, storage.path), c);
		assert.equal(collectionStorage(c, dataRoot).suffix, storage.suffix, c);
	}
	const file = recordPath('decisions', 'fx/2026-09-01--a-call', 'decision', dataRoot);
	assert.equal(file, path.join(ws, 'data', 'perspective', 'decisions', 'fx', '2026-09-01--a-call.decision.md'));
	assert.equal(recordId('decisions', file, dataRoot), 'fx/2026-09-01--a-call');
	assert.throws(() => recordPath('decisions', 'fx/x', 'deliverable', dataRoot), /carry \.decision\.md/);
	for (const gone of ['world/decisions', 'phases', 'activity-lanes', 'tasks']) {
		assert.throws(() => collectionDir(gone, dataRoot), /not a collection this module ships/, gone);
	}
	fs.rmSync(ws, { recursive: true, force: true });
});

test('a workspace overlay that re-homes a collection is honoured over the shipped descriptor', () => {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-overlay-'));
	const compiled = path.join(ws, '.dreamteamer', 'collections', 'perspective', 'decisions.collection.yaml');
	fs.mkdirSync(path.dirname(compiled), { recursive: true });
	fs.writeFileSync(compiled, 'name: perspective/decisions\nstorage: { path: data/elsewhere/decisions, codec: md, shape: file, suffix: decision }\n');
	assert.equal(collectionDir('decisions', path.join(ws, 'data')), path.join(ws, 'data', 'elsewhere', 'decisions'));
	fs.rmSync(ws, { recursive: true, force: true });
});
