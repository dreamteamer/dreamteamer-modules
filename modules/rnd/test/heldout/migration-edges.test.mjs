// HELD-OUT (prototype-harness-heldout-migration-edges): migrate-journey-steps refuses whole on two stories
// claiming one step and on a story with no screen, writing nothing; then migrates to records `dt check` accepts,
// keeps CRLF and no-front-matter files intact, and is a no-op the second time. A real engine workspace, the
// script run as a person runs it. Written by the test stage against the built code.
import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { workspace } from '../../../../tests/helpers/fixture.mjs';
import { RND } from './lib/common.mjs';

const SCRIPT = path.join(RND, 'bin', 'migrate-journey-steps.mjs');
const STORY = (k) => `data/rnd/user-stories/2026-01-10--${k}.user-story.md`;
const AFG = 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md';
const CS = 'data/rnd/user-journeys/check-status.user-journey.md';
const PERSONA = 'rnd/personas/grant-applicant';

let ws;
const put = (rel, text) => { const f = path.join(ws.root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (rel) => fs.readFileSync(path.join(ws.root, rel), 'utf8');
const front = (rel) => yaml.load(/^---\n([\s\S]*?)\n---/.exec(read(rel).replace(/\r/g, ''))[1]);
function hashes() {
	const out = {};
	const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(ws.root, p)] = createHash('sha256').update(fs.readFileSync(p)).digest('hex'); } };
	walk(path.join(ws.root, 'data'));
	return out;
}
const migrate = (...args) => { const r = spawnSync(process.execPath, [SCRIPT, '--root', ws.root, ...args], { encoding: 'utf8', timeout: 60_000 }); return { code: r.status, stdout: r.stdout, stderr: r.stderr }; };
const planLine = (out) => out.split('\n').find((l) => /^journeys \d+ · steps \d+ · stories cleared \d+ · screens \d+$/.test(l));

function story(key, { journey, step, screen = 'rnd/screens/np-apply', persona = true, crlf = false } = {}) {
	const lines = ['---', `key: ${key}`, `name: As an applicant I ${key.replace(/-/g, ' ')}`];
	if (screen) lines.push(`screen: ${screen}`);
	if (persona) lines.push('personas:', `  - ${PERSONA}`);
	if (journey) lines.push(`journey: ${journey}`);
	if (step != null) lines.push(`step: ${step}`);
	lines.push('---', '');
	put(STORY(key), lines.join(crlf ? '\r\n' : '\n'));
}

describe('held-out: the migration at its edges', () => {
	let S0, S1, S3;
	before(() => {
		ws = workspace({ packages: ['rnd'] });
		put('data/rnd/products/northwind-portal.product.md', '---\nname: Northwind portal\n---\n');
		put('data/rnd/personas/grant-applicant.persona.md', '---\nname: Grant applicant\nkind: product-role\nkey: grant-applicant\nproducts:\n  - rnd/products/northwind-portal\n---\n');
		for (const [k, r] of [['np-apply', '/np/apply'], ['np-status', '/np/status']]) put(`data/rnd/screens/${k}.screen.md`, `---\nkey: ${k}\nname: ${k}\nroute: ${r}\nsource: scope-required\nproduct: rnd/products/northwind-portal\n---\n`);
		put(AFG, '---\nkey: apply-for-a-grant\nname: Apply for a grant\nproducts:\n  - rnd/products/northwind-portal\n---\n');
		put(CS, '---\nkey: check-status\nname: Check the status\nproducts:\n  - rnd/products/northwind-portal\nsteps:\n  - screen: rnd/screens/np-status\n---\n');
		story('fill-the-form', { journey: 'apply-for-a-grant', step: 1, crlf: true });
		story('attach-documents', { journey: 'apply-for-a-grant', step: 2 });
		story('attach-budget', { journey: 'apply-for-a-grant', step: 2 });
		story('see-the-decision', { journey: 'apply-for-a-grant', step: 3, screen: null });
		story('see-status', { journey: 'check-status', step: 1, screen: 'rnd/screens/np-status' });
		put(STORY('free-text'), 'Only a body line, no front matter.\n');
		// fixture prep, as the suite's own settle(): hand-written seed records leave generated mirrors stale
		for (const c of ['rnd/products', 'rnd/screens', 'rnd/personas', 'rnd/user-journeys', 'rnd/user-stories']) { const r = ws.dt('relations', 'rebuild', c); assert.equal(r.code, 0, r.stderr + r.stdout); }
		S0 = hashes();
	});

	test('case 1: --dry-run --json names both problems and writes nothing', () => {
		const r = migrate('--dry-run', '--json');
		assert.equal(r.code, 0, r.stderr + r.stdout);
		const j = JSON.parse(r.stdout);
		const p = j.problems.join('\n');
		assert.ok(j.problems.some((x) => /attach-documents/.test(x) && /attach-budget/.test(x) && /step 2/.test(x) && /apply-for-a-grant/.test(x)), `collision not named:\n${p}`);
		assert.ok(j.problems.some((x) => /see-the-decision/.test(x) && /no screen/.test(x)), `screenless story not named:\n${p}`);
		assert.deepEqual(hashes(), S0);
	});

	test('case 2: --write refuses whole, names both, and every byte under data/ is S0', () => {
		const r = migrate('--write');
		assert.equal(r.code, 1, r.stderr + r.stdout);
		assert.match(r.stderr, /attach-documents/); assert.match(r.stderr, /attach-budget/); assert.match(r.stderr, /see-the-decision/);
		assert.deepEqual(hashes(), S0);
	});

	test('case 3: fixed, --write migrates the journey in story order and clears the stories', () => {
		const budget = read(STORY('attach-budget'));
		put(STORY('attach-budget'), budget.replace('journey: apply-for-a-grant\n', '').replace('step: 2\n', ''));
		put(STORY('see-the-decision'), read(STORY('see-the-decision')).replace('personas:\n', 'screen: rnd/screens/np-status\npersonas:\n'));
		// fixture prep: the fix puts a story on np-status, which stales that screen's generated mirror
		{ const r = ws.dt('relations', 'rebuild', 'rnd/screens'); assert.equal(r.code, 0, r.stderr + r.stdout); }
		S1 = hashes();
		const r = migrate('--write');
		assert.equal(r.code, 0, r.stderr + r.stdout);
		const line = planLine(r.stdout);
		assert.match(line ?? '', /^journeys 1 · steps 3 · stories cleared (\d+) · screens 0$/, r.stdout);
		assert.ok(Number(/cleared (\d+)/.exec(line)[1]) >= 3);
		assert.deepEqual(front(AFG).steps, [
			{ screen: 'rnd/screens/np-apply', story: 'rnd/user-stories/2026-01-10--fill-the-form', persona: PERSONA },
			{ screen: 'rnd/screens/np-apply', story: 'rnd/user-stories/2026-01-10--attach-documents', persona: PERSONA },
			{ screen: 'rnd/screens/np-status', story: 'rnd/user-stories/2026-01-10--see-the-decision', persona: PERSONA },
		]);
		for (const k of ['fill-the-form', 'attach-documents', 'see-the-decision']) { const fm = front(STORY(k)); assert.ok(!('journey' in fm) && !('step' in fm), `${k} still carries journey/step`); }
		const now = hashes();
		assert.equal(now[CS], S1[CS], 'check-status changed');
		assert.equal(now[STORY('free-text')], S0[STORY('free-text')], 'free-text changed');
		assert.ok(read(STORY('fill-the-form')).includes('\r\n'), 'fill-the-form lost its CRLF');
		assert.doesNotThrow(() => yaml.load(/^---\n([\s\S]*?)\n---/.exec(read(STORY('fill-the-form')).replace(/\r/g, ''))[1]));
		S3 = now;
	});

	test('case 4: dt check accepts what the migration wrote', () => {
		const r = ws.dt('check');
		assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
	});

	// Not in the record: what case 4's violations are, so a failure says whether the migration or the fixture
	// caused it. The record's own fixture plants `free-text` with no front matter, which no user-story schema accepts.
	test('case 4 (diagnostic): every violation dt check reports is on the planted free-text file', () => {
		const r = ws.dt('check');
		const flagged = [...`${r.stdout}\n${r.stderr}`.matchAll(/^✖ (\S+)/gm)].map((m) => m[1]);
		assert.deepEqual(flagged.filter((f) => f !== STORY('free-text')), [], `${r.stdout}\n${r.stderr}`);
	});

	test('case 5: a second --write is a no-op', () => {
		const r = migrate('--write');
		assert.equal(r.code, 0, r.stderr + r.stdout);
		assert.equal(planLine(r.stdout), 'journeys 0 · steps 0 · stories cleared 0 · screens 0');
		assert.deepEqual(hashes(), S3);
	});
});
