// migrate-personas — what a fixture can pin: the plan over a synthetic workspace, the write, the no-op
// second run, the refusal on a collision, and the plan line's shape. The workspace is invented whole:
// two product roles, one panel, one probe, a story and a journey that point at them.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { plan, apply, stampKind, main } from '../bin/migrate-personas.mjs';

const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'migrate-personas.mjs');
const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const front = (root, rel) => yaml.load(/^---\n([\s\S]*?)\n---/.exec(read(root, rel))[1]);

/** A workspace in the pre-0.3.0 shape. */
function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-personas-'));
	made.push(root);
	put(root, 'package.json', '{"name":"northwind-workspace","private":true}\n');
	put(root, 'package-lock.json', '{}\n');
	put(root, 'data/rnd/products/northwind-portal.product.md', '---\nname: Northwind portal\n---\n');
	put(root, 'data/rnd/product-user-personas/grant-officer.product-user-persona.md',
		'---\nkey: grant-officer\nname: Grant officer\nproducts:\n  - rnd/products/northwind-portal\ngoals:\n  - approve a grant\n---\n\nThe officer who signs off.\n');
	put(root, 'data/rnd/product-user-personas/portal-admin.product-user-persona.md',
		'---\nkey: portal-admin\nname: Portal admin\nproducts:\n  - rnd/products/northwind-portal\n---\n');
	put(root, 'data/rnd/personas/the-careful-reviewer.persona.md',
		'---\nname: The careful reviewer\nsegment_rule: reviews grants for a living\nmembers:\n  - person: contacts/dana-oren\n    role: reviewer\n---\n\nA panel of two.\n');
	put(root, 'data/rnd/personas/the-already-stamped.persona.md',
		'---\nname: The already stamped\nkind: panel\nsegment_rule: anyone\nmembers: []\n---\n');
	put(root, 'data/rnd/persona-probes/2026-01-05--would-you-switch.persona-probe.md',
		'---\nname: Would you switch\nquestion: Would you switch?\nreal_answer: No.\nasked: 2026-01-05\n---\n');
	put(root, 'data/rnd/user-stories/2026-01-10--see-the-grant-status.user-story.md',
		'---\nkey: see-the-grant-status\nname: See the grant status\npersonas:\n  - rnd/product-user-personas/grant-officer\n  - rnd/product-user-personas/portal-admin\n---\n\nScored against rnd/persona-probes/2026-01-05--would-you-switch once.\n');
	put(root, 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md',
		'---\nkey: apply-for-a-grant\nname: Apply for a grant\npersonas:\n  - rnd/product-user-personas/grant-officer\n---\n');
	return root;
}

const run = (root, ...args) => spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });

describe('stampKind', () => {
	test('adds kind as the first frontmatter key, once', () => {
		const once = stampKind('---\nname: x\n---\nbody\n', 'panel');
		assert.equal(once.changed, true);
		assert.equal(once.text, '---\nkind: panel\nname: x\n---\nbody\n');
		assert.deepEqual(stampKind(once.text, 'panel'), { text: once.text, changed: false });
	});
	test('a nested kind does not count as the record\'s own', () => {
		assert.equal(stampKind('---\nname: x\nmeta:\n  kind: nested\n---\n', 'panel').changed, true);
	});
	test('a record with no frontmatter gets one', () => {
		assert.equal(stampKind('just a body\n', 'product-role').text, '---\nkind: product-role\n---\njust a body\n');
	});
});

describe('the plan', () => {
	test('counts the moved and the stamped as records, the rewritten strings as refs, and touches nothing', () => {
		const root = fixture();
		const before = run(root, '--json').stdout;
		const p = plan(root);
		assert.equal(p.records, 3, 'two roles moved, one panel stamped — the stamped one is left alone');
		assert.equal(p.refs, 3, 'two refs in the story, one in the journey');
		assert.deepEqual(p.probes, ['data/rnd/persona-probes/2026-01-05--would-you-switch.persona-probe.md']);
		assert.deepEqual(p.probeRefs, ['data/rnd/user-stories/2026-01-10--see-the-grant-status.user-story.md:9']);
		assert.deepEqual(p.collisions, []);
		const moved = p.files.filter((f) => f.to !== f.from);
		assert.deepEqual(moved.map((f) => path.relative(root, f.to)), ['data/rnd/personas/grant-officer.persona.md', 'data/rnd/personas/portal-admin.persona.md']);
		assert.ok(moved.every((f) => f.kind === 'product-role'));
		assert.deepEqual(p.files.filter((f) => f.kind === 'panel').map((f) => path.basename(f.from)), ['the-careful-reviewer.persona.md']);
		assert.equal(run(root, '--json').stdout, before, 'a plan is a read');
		assert.ok(fs.existsSync(path.join(root, 'data/rnd/persona-probes')));
	});
	test('--dry-run prints the plan line in the shape `records N · refs M` and writes nothing', () => {
		const root = fixture();
		const r = run(root, '--dry-run');
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /^records 3 · refs 3$/m);
		assert.match(r.stdout, /nothing written/);
		assert.equal(r.stdout.split('\n')[0], `workspace ${fs.realpathSync(root)}`, 'the workspace acted on is the first line');
		assert.match(r.stdout, /! data\/rnd\/user-stories\/2026-01-10--see-the-grant-status\.user-story\.md:9/);
		assert.ok(fs.existsSync(path.join(root, 'data/rnd/product-user-personas/grant-officer.product-user-persona.md')));
		assert.ok(!fs.existsSync(path.join(root, 'data/rnd/personas/grant-officer.persona.md')));
	});
	test('no flag is a dry run; both flags are refused with usage', () => {
		const root = fixture();
		assert.equal(run(root).status, 0);
		const both = run(root, '--dry-run', '--write');
		assert.equal(both.status, 2);
		assert.match(both.stderr, /usage:/);
		assert.equal(run(root, '--bogus').status, 2);
	});
});

describe('the write', () => {
	test('moves the roles under kind: product-role, stamps the panel, rewrites the refs, deletes the probes, reports the probe ref', () => {
		const root = fixture();
		const r = run(root, '--write');
		assert.equal(r.status, 0, r.stderr);
		assert.match(r.stdout, /^records 3 · refs 3$/m);
		assert.match(r.stdout, /^written$/m);
		const officer = front(root, 'data/rnd/personas/grant-officer.persona.md');
		assert.equal(officer.kind, 'product-role');
		assert.equal(officer.key, 'grant-officer');
		assert.deepEqual(officer.products, ['rnd/products/northwind-portal']);
		assert.match(read(root, 'data/rnd/personas/grant-officer.persona.md'), /The officer who signs off\./, 'the body travels');
		assert.equal(front(root, 'data/rnd/personas/portal-admin.persona.md').kind, 'product-role');
		assert.equal(front(root, 'data/rnd/personas/the-careful-reviewer.persona.md').kind, 'panel');
		assert.equal(front(root, 'data/rnd/personas/the-careful-reviewer.persona.md').segment_rule, 'reviews grants for a living');
		assert.equal(read(root, 'data/rnd/personas/the-already-stamped.persona.md').match(/kind:/g).length, 1, 'a stamped record is not stamped twice');
		assert.ok(!fs.existsSync(path.join(root, 'data/rnd/product-user-personas')), 'the emptied folder goes');
		assert.ok(!fs.existsSync(path.join(root, 'data/rnd/persona-probes')), 'the probes go');
		assert.deepEqual(front(root, 'data/rnd/user-stories/2026-01-10--see-the-grant-status.user-story.md').personas, ['rnd/personas/grant-officer', 'rnd/personas/portal-admin']);
		assert.deepEqual(front(root, 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md').personas, ['rnd/personas/grant-officer']);
		assert.match(read(root, 'data/rnd/user-stories/2026-01-10--see-the-grant-status.user-story.md'), /rnd\/persona-probes\/2026-01-05--would-you-switch/, 'a probe ref is reported, never rewritten');
		assert.match(r.stdout, /! data\/rnd\/user-stories\/.*:9/);
		// and the untouched record is untouched
		assert.equal(read(root, 'data/rnd/products/northwind-portal.product.md'), '---\nname: Northwind portal\n---\n');
	});
	test('a second run is a no-op', () => {
		const root = fixture();
		assert.equal(run(root, '--write').status, 0);
		const again = run(root, '--write');
		assert.equal(again.status, 0, again.stderr);
		assert.match(again.stdout, /^records 0 · refs 0$/m);
		const p = plan(root);
		assert.deepEqual([p.records, p.refs, p.probes, p.collisions], [0, 0, [], []]);
	});
	test('a role whose id an existing persona holds is a collision: named in the plan, and --write refuses whole', () => {
		const root = fixture();
		put(root, 'data/rnd/personas/grant-officer.persona.md', '---\nname: Grant officer\nkind: panel\n---\n');
		const p = plan(root);
		assert.deepEqual(p.collisions, [{ id: 'grant-officer', role: 'data/rnd/product-user-personas/grant-officer.product-user-persona.md', persona: 'data/rnd/personas/grant-officer.persona.md' }]);
		assert.throws(() => apply(p), /refusing to write/);
		const r = run(root, '--write');
		assert.equal(r.status, 1);
		assert.match(r.stderr, /grant-officer.*would land on/);
		assert.ok(fs.existsSync(path.join(root, 'data/rnd/product-user-personas/portal-admin.product-user-persona.md')), 'nothing moved');
		assert.ok(fs.existsSync(path.join(root, 'data/rnd/persona-probes')), 'nothing deleted');
		assert.equal(front(root, 'data/rnd/personas/the-careful-reviewer.persona.md').kind, undefined, 'nothing stamped');
	});
	test('a workspace with no persona folders at all is `records 0 · refs 0`', () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-personas-empty-'));
		made.push(root);
		put(root, 'package.json', '{}\n'); put(root, 'package-lock.json', '{}\n');
		const logs = [];
		assert.equal(main(['--dry-run'], { cwd: root, log: (l) => logs.push(l) }), 0);
		assert.match(logs.join('\n'), /^records 0 · refs 0$/m);
	});
	test('--root names the workspace from anywhere', () => {
		const root = fixture();
		const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-personas-elsewhere-'));
		made.push(elsewhere);
		const logs = [];
		assert.equal(main(['--dry-run', '--root', root], { cwd: elsewhere, log: (l) => logs.push(l) }), 0);
		assert.match(logs.join('\n'), /^records 3 · refs 3$/m);
	});
});
