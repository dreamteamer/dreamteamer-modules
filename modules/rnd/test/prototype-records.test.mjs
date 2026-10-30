// The prototype's config and the records read. What a fixture pins: defaults, each refusal by name, the
// sensitive guarantee with an injected runner, and one real-engine read of the five collections.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, loadConfig } from '../lib/prototype/node/config.mjs';
import { readRecords, COLLECTIONS } from '../lib/prototype/node/records.mjs';
import { rndWorkspace, seedNorthwind, settle, put, cleanupAll } from './helpers/rnd-workspace.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); cleanupAll(); });
function proto() {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-cfg-')); made.push(ws);
	fs.writeFileSync(path.join(ws, 'package.json'), '{}'); fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	const dir = path.join(ws, 'prototypes', 'northwind'); fs.mkdirSync(dir, { recursive: true });
	return { ws: fs.realpathSync(ws), dir: fs.realpathSync(dir) };
}
const MIN = { products: { 'rnd/products/grantee-portal': { key: 'gp' } }, app: '__northwind', registry: 'public/app/screens/index.js' };

describe('the config', () => {
	test('fills the defaults and finds the workspace above the prototype', () => {
		const { ws, dir } = proto();
		const c = normalize(MIN, dir);
		assert.deepEqual(c.portal, { from: 'product' });
		assert.deepEqual(c.cross, { key: 'x', label: 'Cross-portal' });
		assert.equal(c.screenKey('un-home'), 'un-home');
		assert.equal(c.paths.data, path.join(dir, 'public/app/data'));
		assert.equal(c.paths.harness, path.join(dir, 'public/harness'));
		assert.equal(c.workspace, ws);
		assert.equal(normalize({ ...MIN, prototype: 'northwind-proto' }, dir).prototype, 'rnd/prototypes/northwind-proto');
	});
	test('refuses a missing required key, an unknown key and a collections map, by name', () => {
		const { dir } = proto();
		for (const k of ['products', 'app', 'registry']) { const r = { ...MIN }; delete r[k]; assert.throws(() => normalize(r, dir), new RegExp(`"${k}" is required`)); }
		assert.throws(() => normalize({ ...MIN, colour: 'red' }, dir), /unknown key "colour"/);
		assert.throws(() => normalize({ ...MIN, collections: { screens: 'x' } }, dir), /unknown key "collections" — the harness reads the rnd collection names only/);
	});
	test('refuses a non-function screenKey or group, a bad product reference and a bad portal', () => {
		const { dir } = proto();
		assert.throws(() => normalize({ ...MIN, screenKey: 'strip' }, dir), /"screenKey" must be a function/);
		assert.throws(() => normalize({ ...MIN, group: 3 }, dir), /"group" must be a function/);
		assert.throws(() => normalize({ ...MIN, products: { 'grantee-portal': { key: 'gp' } } }, dir), /not an rnd\/products\/<id> reference/);
		assert.throws(() => normalize({ ...MIN, portal: { from: 'field' } }, dir), /needs a field name/);
	});
	test('loadConfig reads harness.config.mjs and says how to make one when it is missing', async () => {
		const { dir } = proto();
		await assert.rejects(loadConfig(dir), /run `npx dt-prototype init`/);
		fs.writeFileSync(path.join(dir, 'harness.config.mjs'), `export default ${JSON.stringify(MIN)};\n`);
		assert.equal((await loadConfig(dir)).app, '__northwind');
	});
});

describe('the records read', () => {
	const fake = (descriptors, rows) => (args) => {
		const [verb, target] = args;
		if (verb === 'get') return JSON.stringify(descriptors[target.replace('collections/', '')] ?? { fields: {} });
		return JSON.stringify(rows[target] ?? []);
	};
	test('one list and one descriptor per collection, products included; a field marked sensitive never leaves the read', () => {
		const calls = [];
		const dt = (args) => { calls.push(args.join(' ')); return fake({ 'rnd/user-journeys': { fields: { key: {}, budget_note: { sensitive: true } } } }, { 'rnd/user-journeys': [{ key: 'j', budget_note: 'secret' }] })(args); };
		const r = readRecords({ workspace: '/nowhere' }, { dt });
		assert.equal(calls.length, 12);
		assert.deepEqual(r.journeys, [{ key: 'j' }]);
		assert.deepEqual(r.dropped.journeys, ['budget_note']);
		for (const c of Object.values(COLLECTIONS)) assert.ok(calls.includes(`list ${c} --json`));
	});
	test('a collection marked sensitive is refused whole', () => {
		const dt = fake({ 'rnd/open-questions': { sensitive: true, fields: {} } }, {});
		assert.throws(() => readRecords({ workspace: '/nowhere' }, { dt }), /rnd\/open-questions is marked sensitive/);
	});
	test('on a real engine the five collections come back as rows', () => {
		const ws = rndWorkspace(); seedNorthwind(ws); settle(ws);
		const r = readRecords({ workspace: ws });
		assert.equal(r.screens.length, 4);
		assert.equal(r.stories.length, 3);
		assert.equal(r.personas.length, 2);
		assert.ok(r.descriptors.journeys.fields.includes('steps'));
	});
});
