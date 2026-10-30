// The records bridge. What a fixture pins: the objects journeys.js and meta.js export (imported back, not
// grepped), each failure by its message, each warning and its --strict exit, the scrubber over both files, and
// --check writing nothing. The rows are what `dt list --json` returns; the prototype folder is real.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, run, deepScrub, DENY } from '../lib/prototype/node/export.mjs';
import { normalize } from '../lib/prototype/node/config.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const rows = () => ({
	products: [{ id: 'grantee-portal', name: 'Grantee portal' }, { id: 'back-office', name: 'Back office' }, { id: 'finance-desk', name: 'Finance desk' }],
	screens: [
		{ id: 'gp-home', key: 'gp-home', product: 'rnd/products/grantee-portal', route: '/gp/home' },
		{ id: 'gp-apply', key: 'gp-apply', product: 'rnd/products/grantee-portal', route: '/gp/apply', scope_rows: ['GRT-R-001'] },
		{ id: 'bo-review', key: 'bo-review', product: 'rnd/products/back-office', route: '/bo/review' },
		{ id: 'fd-pay', key: 'fd-pay', product: 'rnd/products/finance-desk', route: '/fd/pay' },
	],
	personas: [{ id: 'applicant', key: 'applicant', name: 'Applicant', kind: 'product-role' }, { id: 'grant-officer', key: 'grant-officer', name: 'Grant officer', kind: 'product-role' }],
	stories: [
		{ id: '2026-01-10--open-the-portal', key: 'open-the-portal', name: 'As an applicant I open the portal', screen: 'rnd/screens/gp-home', journeys: ['rnd/user-journeys/apply-for-a-grant'] },
		{ id: '2026-01-10--submit-an-application', key: 'submit-an-application', name: 'As an applicant I submit an application at Contoso', screen: 'rnd/screens/gp-apply', journeys: ['rnd/user-journeys/apply-for-a-grant'] },
		{ id: '2026-01-10--review-the-application', key: 'review-the-application', name: 'As an officer I review it', screen: 'rnd/screens/bo-review', journeys: ['rnd/user-journeys/apply-for-a-grant'] },
	],
	journeys: [
		{ id: 'apply-for-a-grant', key: 'apply-for-a-grant', name: 'Apply for a grant', description: 'From first visit to review', products: ['rnd/products/grantee-portal', 'rnd/products/back-office'],
			personas: ['rnd/personas/applicant'], acceptance: ['GRT-R-001'], failures: ['The deadline passed'], process: 'P-01', budget: 'internal', author: 'agents/x',
			steps: [
				{ screen: 'rnd/screens/gp-home', story: 'rnd/user-stories/2026-01-10--open-the-portal', persona: 'rnd/personas/applicant', caption: 'The portal opens' },
				{ screen: 'rnd/screens/gp-apply', story: 'rnd/user-stories/2026-01-10--submit-an-application', persona: 'rnd/personas/applicant', scope_rows: ['GRT-R-001'], open: ['rnd/open-questions/deadline-rule'] },
				{ screen: 'rnd/screens/bo-review', system: true, caption: 'Contoso routes it' },
			] },
		{ id: 'see-the-home', key: 'see-the-home', name: 'See the home', products: ['rnd/products/grantee-portal'], steps: [{ screen: 'rnd/screens/gp-home', story: 'rnd/user-stories/2026-01-10--open-the-portal' }] },
	],
	questions: [
		{ id: 'deadline-rule', name: 'Deadline rule', question: 'Is the deadline a hard stop?', status: 'open', lean: 'Yes, with an override', blocks: ['rnd/screens/gp-apply', 'rnd/user-journeys/apply-for-a-grant'] },
		{ id: 'old-question', name: 'Old', question: 'Was it decided?', status: 'resolved', blocks: ['rnd/screens/gp-home'] },
	],
	dropped: { journeys: ['budget'] },
});
const PB = {
	'apply-for-a-grant': { key: 'apply-for-a-grant', steps: [{ story: 'open-the-portal' }, { action: { name: 'submit' } }, {}] },
	'see-the-home': { key: 'see-the-home', steps: [{}] },
};
function config(extra = {}) {
	const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-export-')); made.push(ws);
	fs.writeFileSync(path.join(ws, 'package.json'), '{}'); fs.writeFileSync(path.join(ws, 'package-lock.json'), '{}');
	const dir = path.join(ws, 'proto'); fs.mkdirSync(dir);
	return normalize({ products: { 'rnd/products/grantee-portal': { key: 'gp' }, 'rnd/products/back-office': { key: 'bo', label: 'Back Office' } }, app: '__nw', registry: 'r.js', ...extra }, dir);
}
const ok = (r) => { assert.deepEqual(r.errors, []); return r; };

describe('what journeys.js exports', () => {
	test('groups, personas, journeys with steps, stories and anchors — from the allowlist only', () => {
		const r = ok(build(config({ journeyFields: ['process'] }), rows(), { playback: PB }));
		assert.deepEqual(r.journeys.groups, [{ key: 'gp', label: 'Grantee portal' }, { key: 'bo', label: 'Back Office' }, { key: 'x', label: 'Cross-portal' }]);
		const j = r.journeys.journeys.find((x) => x.key === 'apply-for-a-grant');
		assert.equal(j.group, 'x', 'two portals: the cross group');
		assert.equal(j.process, 'P-01');
		assert.equal(j.budget, undefined); assert.equal(j.author, undefined);
		assert.deepEqual(j.open, ['deadline-rule']);
		assert.deepEqual(j.steps[1], { n: 2, story: 'submit-an-application', sentence: 'As an applicant I submit an application at Contoso', caption: null, persona: 'applicant', screen: 'gp-apply', portal: 'gp', rules: ['GRT-R-001'], open: ['deadline-rule'], system: false });
		assert.deepEqual(j.steps[2], { n: 3, story: null, sentence: null, caption: 'Contoso routes it', persona: null, screen: 'bo-review', portal: 'bo', rules: [], open: [], system: true });
		assert.equal(r.journeys.journeys.find((x) => x.key === 'see-the-home').group, 'gp');
		assert.deepEqual(r.journeys.personas, { applicant: 'Applicant' });
		assert.deepEqual(r.journeys.anchors, { 'gp-home': ['open-the-portal'], 'gp-apply': ['submit-an-application'], 'bo-review': ['review-the-application'] });
		assert.deepEqual(r.journeys.stories['review-the-application'], { name: 'As an officer I review it', screen: 'bo-review' });
	});
	test('the files import back as the objects, schema 1 and the package version in the header', async () => {
		const r = ok(build(config(), rows(), { playback: PB, version: '9.9.9' }));
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-import-')); made.push(dir);
		fs.writeFileSync(path.join(dir, 'journeys.js'), r.journeysJs); fs.writeFileSync(path.join(dir, 'meta.js'), r.metaJs);
		const J = await import(pathToFileURL(path.join(dir, 'journeys.js')).href);
		const M = await import(pathToFileURL(path.join(dir, 'meta.js')).href);
		assert.equal(J.schema, 1); assert.equal(M.schema, 1);
		assert.deepEqual(J.journeys, r.journeys.journeys); assert.equal(J.default, J.journeys);
		assert.deepEqual(M.open['deadline-rule'], { q: 'Is the deadline a hard stop?', s: 'open', l: 'Yes, with an override' });
		assert.match(r.journeysJs, /^\/\/ generated by dt-prototype export \(@dreamteamer\/rnd 9\.9\.9\)/);
	});
	test('group(): the prototype\'s override, validated against the declared groups', () => {
		const r = build(config({ group: (j) => (j.key.startsWith('apply') ? 'gp' : 'nowhere') }), rows(), { playback: PB });
		assert.equal(r.journeys.journeys[0].group, 'gp');
		assert.deepEqual(r.errors, ['rnd/user-journeys/see-the-home: group "nowhere" is not a declared group (gp, bo, x)']);
	});
	test('scrub runs over every string of both files, the rules provider\'s output included', () => {
		const scrub = (s) => s.replace(/Contoso/g, 'a partner');
		const r = ok(build(config(), rows(), { playback: PB, scrub, rules: { rules: { 'GRT-R-001': { t: 'Contoso deadline', b: 'Set by Contoso' } }, notes: { 'N-1': { q: 'Contoso?', s: 'open', l: '' } } } }));
		assert.doesNotMatch(r.journeysJs + r.metaJs, /Contoso/);
		assert.equal(r.meta.rules['GRT-R-001'].t, 'a partner deadline');
		assert.deepEqual(deepScrub({ Contoso: 'Contoso' }, scrub), { Contoso: 'a partner' }, 'keys are left alone');
	});
	test('screenKey maps record keys to registry keys, and the portal escape hatch reads a field through a map', () => {
		const data = rows();
		for (const s of data.screens) { s.key = `un-${s.key}`; s.product = 'rnd/products/grantee-portal'; s.window = s.id.startsWith('bo') ? 'office' : 'applicant'; }
		const c = config({ products: { 'rnd/products/grantee-portal': { key: 'all' } }, screenKey: (k) => k.replace(/^un-/, ''), portal: { from: 'field', field: 'window', map: { office: 'bo', applicant: 'gp' } } });
		const r = build(c, data, { playback: PB });
		const j = r.journeys.journeys.find((x) => x.key === 'apply-for-a-grant');
		assert.deepEqual(j.steps.map((s) => [s.screen, s.portal]), [['gp-home', 'gp'], ['gp-apply', 'gp'], ['bo-review', 'bo']]);
		assert.deepEqual(r.errors, []);
		data.screens[0].window = 'producer';
		assert.ok(build(c, data, { playback: PB }).errors.includes('rnd/screens/gp-home: window "producer" is not in portal.map'));
	});
});

describe('the portal read from a tag', () => {
	test('portal: { from: \'tag\', prefix } reads `portal:<value>` from tags through the map; no such tag warns', () => {
		const data = rows();
		for (const s of data.screens) { s.key = `un-${s.key}`; s.product = 'rnd/products/grantee-portal'; s.tags = ['area:grants', `portal:${s.id.startsWith('bo') ? 'office' : 'applicant'}`]; }
		delete data.screens[3].tags;
		const c = config({ products: { 'rnd/products/grantee-portal': { key: 'all' } }, screenKey: (k) => k.replace(/^un-/, ''), portal: { from: 'tag', prefix: 'portal:', map: { office: 'bo', applicant: 'gp' } } });
		const r = build(c, data, { playback: PB });
		assert.deepEqual(r.errors, []);
		assert.deepEqual(r.journeys.journeys.find((x) => x.key === 'apply-for-a-grant').steps.map((s) => s.portal), ['gp', 'gp', 'bo']);
		assert.ok(r.warnings.includes('rnd/screens/fd-pay: no portal:… tag — exported with no portal'));
		assert.throws(() => config({ portal: { from: 'tag' } }), /needs a prefix/);
	});
});

describe('the failures — nothing written', () => {
	const fails = (mutate, pattern, opts = {}) => {
		const data = rows(); mutate(data);
		const r = build(config(opts.config), data, { playback: opts.playback ?? PB, store: opts.store });
		assert.ok(r.errors.some((e) => pattern.test(e)), `expected ${pattern} in:\n${r.errors.join('\n')}`);
	};
	test('a journey in scope with no steps', () => fails((d) => { delete d.journeys[1].steps; }, /see-the-home: in scope with no steps/));
	test('a step whose screen, story or persona resolves to nothing', () => {
		fails((d) => { d.journeys[1].steps[0].screen = 'rnd/screens/nowhere'; }, /screen rnd\/screens\/nowhere resolves to no record/);
		fails((d) => { d.journeys[1].steps[0].story = 'rnd/user-stories/nope'; }, /story rnd\/user-stories\/nope resolves to no record/);
		fails((d) => { d.journeys[1].steps[0].persona = 'rnd/personas/nope'; }, /persona rnd\/personas\/nope resolves to no record/);
	});
	test('an unknown key inside a step, and a scope_rows that is not a list (what dt check lets through)', () => {
		fails((d) => { d.journeys[1].steps[0].anchor = 'x'; }, /step 1: unknown key "anchor"/);
		fails((d) => { d.journeys[1].steps[0].scope_rows = 'GRT-R-001'; }, /step 1: scope_rows is not a list/);
	});
	test('no playback module, a module keyed wrong, a step count that differs, a story echo that differs', () => {
		fails(() => {}, /see-the-home: no playback module see-the-home\.js/, { playback: { 'apply-for-a-grant': PB['apply-for-a-grant'] } });
		fails(() => {}, /playback module key "other" is not its file name/, { playback: { ...PB, 'see-the-home': { key: 'other', steps: [{}] } } });
		fails(() => {}, /playback module has 2 steps, the record 1/, { playback: { ...PB, 'see-the-home': { key: 'see-the-home', steps: [{}, {}] } } });
		fails(() => {}, /playback story "submit" is not the record's "open-the-portal"/, { playback: { ...PB, 'see-the-home': { key: 'see-the-home', steps: [{ story: 'submit' }] } } });
	});
	test('an action or a setup the store does not know, when a store is configured', () => {
		const store = { mutationNames: () => ['approve'], fixtureNames: () => ['default'] };
		fails(() => {}, /action "submit" is not a store mutation/, { store });
		fails(() => {}, /setup "late" is not a store fixture/, { store, playback: { ...PB, 'see-the-home': { key: 'see-the-home', steps: [{ setup: 'late' }] } } });
	});
	test('a blocks target that resolves to nothing, a config product that is no record, a deny-listed or sensitive journeyField', () => {
		fails((d) => { d.questions[0].blocks.push('rnd/screens/gone'); }, /deadline-rule: blocks rnd\/screens\/gone, which resolves to nothing/);
		fails(() => {}, /config: rnd\/products\/nope is not an rnd\/products record/, { config: { products: { 'rnd/products/nope': { key: 'n' } } } });
		fails(() => {}, /journeyFields "author" is on the deny list/, { config: { journeyFields: ['author'] } });
		fails(() => {}, /journeyFields "budget" is marked sensitive/, { config: { journeyFields: ['budget'] } });
		assert.ok(DENY.includes('content') && DENY.includes('source_files'));
	});
});

describe('the warnings', () => {
	const warns = (mutate, pattern) => {
		const data = rows(); mutate(data);
		const r = build(config(), data, { playback: PB });
		assert.deepEqual(r.errors, []);
		assert.ok(r.warnings.some((w) => pattern.test(w)), `expected ${pattern} in:\n${r.warnings.join('\n')}`);
	};
	test('a step on a screen outside the prototype is exported outOfScope, with no portal', () => {
		const data = rows(); data.journeys[0].steps.push({ screen: 'rnd/screens/fd-pay', system: true }); data.journeys[0].products.push('rnd/products/finance-desk');
		const r = build(config(), data, { playback: { ...PB, 'apply-for-a-grant': { key: 'apply-for-a-grant', steps: [{}, {}, {}, {}] } } });
		assert.deepEqual(r.errors, []);
		const last = r.journeys.journeys[0].steps[3];
		assert.equal(last.outOfScope, true); assert.equal(last.portal, null);
		assert.ok(r.warnings.some((w) => /fd-pay is outside the prototype/.test(w)));
	});
	test('a story in scope on no journey\'s steps', () => warns((d) => { d.stories.push({ id: '2026-01-11--print-a-receipt', key: 'print-a-receipt', name: 'Print', screen: 'rnd/screens/gp-home' }); }, /print-a-receipt: in scope and on no journey's steps/));
	test('a step whose story sits on another screen, and a story not listing its journey', () => {
		warns((d) => { d.stories[0].screen = 'rnd/screens/gp-apply'; }, /story open-the-portal is on rnd\/screens\/gp-apply, the step on rnd\/screens\/gp-home/);
		warns((d) => { d.stories[1].journeys = []; }, /story submit-an-application does not list rnd\/user-journeys\/apply-for-a-grant/);
	});
	test('a resolved question still blocking a screen, and legacy journey/step that disagree with steps', () => {
		warns(() => {}, /old-question: resolved but still blocks rnd\/screens\/gp-home/);
		warns((d) => { d.stories[1].journey = 'apply-for-a-grant'; d.stories[1].step = 5; }, /legacy journey\/step \(apply-for-a-grant 5\) disagree with steps/);
	});
});

describe('run — the files on disk', () => {
	function proto() {
		const c = config();
		const dir = c.dir;
		fs.writeFileSync(path.join(dir, 'harness.config.mjs'), `export default { products: { 'rnd/products/grantee-portal': { key: 'gp' }, 'rnd/products/back-office': { key: 'bo' } }, app: '__nw', registry: 'r.js', workspace: '..' };\n`);
		const pb = path.join(dir, 'public/app/demo/journeys'); fs.mkdirSync(pb, { recursive: true });
		for (const [k, m] of Object.entries(PB)) fs.writeFileSync(path.join(pb, `${k}.js`), `export default ${JSON.stringify(m)};\n`);
		return dir;
	}
	const dtOf = (data) => (args) => {
		const map = { 'rnd/screens': 'screens', 'rnd/user-journeys': 'journeys', 'rnd/user-stories': 'stories', 'rnd/personas': 'personas', 'rnd/open-questions': 'questions', 'rnd/products': 'products' };
		if (args[0] === 'get') return JSON.stringify(args[1] === 'collections/rnd/user-journeys' ? { fields: { budget: { sensitive: true } } } : { fields: {} });
		return JSON.stringify(data[map[args[1]]]);
	};
	const quiet = () => { const out = []; return { out, log: (l) => out.push(l), error: (l) => out.push(l) }; };
	test('writes both files, leaves an unchanged file alone, and --check exits 1 only when a file would change', async () => {
		const dir = proto(); const q = quiet();
		assert.equal(await run(dir, { dt: dtOf(rows()), ...q }), 0, q.out.join('\n'));
		const f = path.join(dir, 'public/app/data/journeys.js');
		const mtime = fs.statSync(f).mtimeMs;
		assert.equal(await run(dir, { dt: dtOf(rows()), ...quiet() }), 0);
		assert.equal(fs.statSync(f).mtimeMs, mtime, 'an unchanged file is not rewritten');
		assert.equal(await run(dir, { dt: dtOf(rows()), check: true, ...quiet() }), 0);
		const changed = rows(); changed.journeys[1].name = 'See the home page';
		const c = quiet();
		assert.equal(await run(dir, { dt: dtOf(changed), check: true, ...c }), 1);
		assert.match(c.out.join('\n'), /journeys\.js would change/);
		assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /See the home page/);
	});
	test('a failure writes nothing and exits 1; a warning exits 1 only under --strict', async () => {
		const dir = proto();
		const bad = rows(); bad.journeys[1].steps[0].screen = 'rnd/screens/nowhere';
		assert.equal(await run(dir, { dt: dtOf(bad), ...quiet() }), 1);
		assert.equal(fs.existsSync(path.join(dir, 'public/app/data/journeys.js')), false);
		const warn = rows(); warn.stories[1].journeys = [];
		assert.equal(await run(dir, { dt: dtOf(warn), strict: true, ...quiet() }), 1);
		assert.equal(await run(dir, { dt: dtOf(warn), ...quiet() }), 0);
	});
});
