// HELD-OUT (prototype-harness-heldout-bridge-leak): nothing sensitive, deny-listed or out of scope reaches
// journeys.js or meta.js, and every exported string passes through the prototype's scrub. Written by the test
// stage against the built code; the builder never read it.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from '../../lib/prototype/node/export.mjs';
import { protoDir, put, js, fakeDt, quiet, exitOf, cleanup } from './lib/common.mjs';

after(cleanup);

const J = 'np-apply-for-a-grant';
const LEAKY_JOURNEY = { internal_notes: 'LEAK-JOURNEY-FIELD', content: 'LEAK-BODY', source: 'LEAK-SOURCE', creation_context: 'LEAK-CONTEXT', author: 'agents/LEAK-AUTHOR', reads: ['LEAK-READS'], writes: ['LEAK-WRITES'], source_files: ['LEAK-FILES'] };
const FORBIDDEN_KEYS = ['internal_notes', 'content', 'source', 'source_files', 'creation_context', 'author', 'reads', 'writes'];

function rows({ vendor = false } = {}) {
	return {
		'rnd/products': [{ id: 'northwind-portal', name: 'Northwind portal' }],
		'rnd/screens': [
			{ id: 'np-apply', key: 'np-apply', name: 'Apply', route: '/np/apply', kind: 'page', product: 'rnd/products/northwind-portal', vendor_contact: 'LEAK-SCREEN-FIELD' },
			{ id: 'np-status', key: 'np-status', name: 'Status', route: '/np/status', kind: 'page', product: 'rnd/products/northwind-portal', vendor_contact: 'LEAK-SCREEN-FIELD' },
		],
		'rnd/user-journeys': [{
			id: J, key: J, name: 'Apply for a grant', products: ['rnd/products/northwind-portal'],
			steps: [
				{ screen: 'rnd/screens/np-apply', story: 'rnd/user-stories/2026-01-10--fill-the-form', persona: 'rnd/personas/grant-applicant' },
				{ screen: 'rnd/screens/np-status', system: true, caption: vendor ? 'the status page for Harbor Mutual' : 'the status page' },
			],
			failures: [vendor ? 'the upload to Harbor Mutual fails' : 'the upload fails'],
			...LEAKY_JOURNEY,
		}],
		'rnd/user-stories': [{ id: '2026-01-10--fill-the-form', key: 'fill-the-form', name: 'As an applicant I fill the form', screen: 'rnd/screens/np-apply', journeys: [`rnd/user-journeys/${J}`] }],
		'rnd/personas': [{ id: 'grant-applicant', key: 'grant-applicant', name: 'Grant applicant', kind: 'product-role' }],
		'rnd/open-questions': [
			{ id: 'harbor-dashboard-scope', name: 'Out of scope', question: 'LEAK-OUT-OF-SCOPE-QUESTION', status: 'open', blocks: ['rnd/screens/harbor-dashboard'] },
			...(vendor ? [{ id: 'status-wording', name: 'Status wording', question: 'Which wording?', status: 'open', lean: 'as Harbor Mutual says it', blocks: ['rnd/screens/np-status'] }] : []),
		],
	};
}
const DESCRIPTORS = {
	'rnd/screens': { name: 'rnd/screens', fields: { key: {}, name: {}, route: {}, product: {}, vendor_contact: { type: 'string', sensitive: true } } },
	'rnd/user-journeys': { name: 'rnd/user-journeys', fields: { key: {}, name: {}, steps: {}, failures: {}, internal_notes: { type: 'string', sensitive: true } } },
};

function prototype(extra = {}) {
	const { dir } = protoDir('northwind-proto');
	const cfg = { products: { 'rnd/products/northwind-portal': { key: 'np' } }, app: '__np', registry: 'public/app/screens/index.js', ...extra };
	put(dir, 'harness.config.mjs', `export default ${js(cfg)};\n`);
	put(dir, 'public/app/screens/index.js', `export const screens = ${js([{ key: 'np-apply', portal: 'np', route: '/np/apply', kind: 'page' }, { key: 'np-status', portal: 'np', route: '/np/status', kind: 'page' }])};\n`);
	put(dir, `public/app/demo/journeys/${J}.js`, `export default { key: '${J}', steps: [{}, {}] };\n`);
	const data = { journeys: path.join(dir, 'public/app/data/journeys.js'), meta: path.join(dir, 'public/app/data/meta.js') };
	put(dir, 'public/app/data/journeys.js', '// sentinel\n'); put(dir, 'public/app/data/meta.js', '// sentinel\n');
	const sentinels = { journeys: fs.readFileSync(data.journeys), meta: fs.readFileSync(data.meta) };
	return { dir, data, sentinels };
}
const untouched = (p) => {
	assert.ok(fs.readFileSync(p.data.journeys).equals(p.sentinels.journeys), 'journeys.js was written');
	assert.ok(fs.readFileSync(p.data.meta).equals(p.sentinels.meta), 'meta.js was written');
};
async function exportWith(p, dt) { const io = quiet(); const code = await exitOf(() => run(p.dir, { dt, log: io.log, error: io.error }), io); return { code, text: io.text() }; }

describe('held-out: the bridge leaks nothing', () => {
	test('case 1: a sensitive field asked for in journeyFields fails by name, nothing written', async () => {
		const p = prototype({ journeyFields: ['internal_notes'] });
		const r = await exportWith(p, fakeDt(rows(), DESCRIPTORS));
		assert.equal(r.code, 1, r.text);
		assert.match(r.text, /internal_notes/); assert.match(r.text, /sensitive/);
		untouched(p);
	});

	for (const f of ['content', 'source_files', 'source', 'creation_context', 'author', 'reads', 'writes']) {
		test(`case 2: deny-listed journeyFields "${f}" fails by name, nothing written`, async () => {
			const p = prototype({ journeyFields: [f] });
			const r = await exportWith(p, fakeDt(rows(), DESCRIPTORS));
			assert.equal(r.code, 1, r.text);
			assert.match(r.text, new RegExp(`"${f}"`));
			untouched(p);
		});
	}

	test('case 3: a default export carries no LEAK- string and the journey none of the denied keys', async () => {
		const p = prototype();
		const r = await exportWith(p, fakeDt(rows(), DESCRIPTORS));
		assert.equal(r.code, 0, r.text);
		const text = fs.readFileSync(p.data.journeys, 'utf8') + fs.readFileSync(p.data.meta, 'utf8');
		assert.deepEqual(text.match(/LEAK-[A-Z-]*/g) ?? [], [], 'no LEAK- substring in journeys.js + meta.js');
		const J1 = await import(`${pathToFileURL(p.data.journeys).href}?case3`);
		await import(`${pathToFileURL(p.data.meta).href}?case3`);
		assert.equal(J1.journeys.length, 1);
		for (const k of FORBIDDEN_KEYS) assert.ok(!(k in J1.journeys[0]), `journeys[0] has key ${k}`);
	});

	for (const c of ['rnd/open-questions', 'rnd/personas']) {
		test(`case 4: a collection marked sensitive (${c}) fails by name, nothing written`, async () => {
			const p = prototype();
			const r = await exportWith(p, fakeDt(rows(), { ...DESCRIPTORS, [c]: { name: c, sensitive: true, fields: {} } }));
			assert.equal(r.code, 1, r.text);
			assert.match(r.text, new RegExp(c.replace('/', '\\/')));
			untouched(p);
		});
	}

	test('case 5: scrub reaches captions, failures, open-question leans, rule titles and bodies, and notes', async () => {
		const p = prototype({ scrub: 'tools/scrub.mjs', rules: 'tools/rules.mjs' });
		put(p.dir, 'tools/scrub.mjs', "export default (t) => t.replaceAll('Harbor Mutual', 'the vendor');\n");
		put(p.dir, 'tools/rules.mjs', "export default () => ({ rules: { 'NW-R-001': { t: 'Harbor Mutual rule', b: 'per Harbor Mutual' } }, notes: { 'NW-N-01': { q: 'Harbor Mutual asks', s: 'open', l: 'Harbor Mutual lean' } } });\n");
		const r = await exportWith(p, fakeDt(rows({ vendor: true }), DESCRIPTORS));
		assert.equal(r.code, 0, r.text);
		const text = fs.readFileSync(p.data.journeys, 'utf8') + fs.readFileSync(p.data.meta, 'utf8');
		assert.equal((text.match(/Harbor Mutual/g) ?? []).length, 0, 'Harbor Mutual survives the scrub');
		const J1 = await import(`${pathToFileURL(p.data.journeys).href}?case5`);
		const M = await import(`${pathToFileURL(p.data.meta).href}?case5`);
		assert.match(J1.journeys[0].steps[1].caption, /the vendor/);
		assert.match(J1.journeys[0].failures[0], /the vendor/);
		assert.ok(M.open['status-wording'], 'the in-scope question is exported');
		assert.match(M.open['status-wording'].l, /the vendor/);
		assert.match(M.rules['NW-R-001'].t, /the vendor/);
		assert.match(M.rules['NW-R-001'].b, /the vendor/);
		assert.match(M.notes['NW-N-01'].q, /the vendor/);
	});
});
