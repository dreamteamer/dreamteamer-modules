// The browser tools end to end: a real engine workspace with Northwind records, the synthetic prototype copied
// beside them, vendor → export → check → play → walk → shoot. Then three broken copies: an anchor no screen draws,
// an action the store refuses that the step does not expect, and a forbidden word in the copy. Needs a Chromium:
// without one the suite says so and skips — a skipped run never counts as this test passing.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { rndWorkspace, seedNorthwind, settle, put, run, cleanupAll } from './helpers/rnd-workspace.mjs';
import { run as vendor } from '../lib/prototype/node/vendor.mjs';
import { run as exportRun } from '../lib/prototype/node/export.mjs';
import { run as check } from '../lib/prototype/node/check.mjs';
import { run as play } from '../lib/prototype/node/play.mjs';
import { run as walk } from '../lib/prototype/node/walk.mjs';
import { run as shoot } from '../lib/prototype/node/shoot.mjs';
import { chromium } from '../lib/prototype/node/devdep.mjs';

const FIXTURE = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'prototype-northwind');
let skip = false;
try { await chromium(); } catch (e) { skip = e.message; console.log(`# prototype-play skipped: ${e.message}`); }
after(cleanupAll);
const quiet = () => { const lines = []; return { lines, log: (l) => lines.push(l), error: (l) => lines.push(l) }; };

/** a workspace with the Northwind records (two journeys) and the prototype under prototypes/northwind */
function setup() {
	const ws = rndWorkspace(); seedNorthwind(ws);
	put(ws, 'data/rnd/user-journeys/apply-for-a-grant.user-journey.md', `---
key: apply-for-a-grant
name: Apply for a grant
products:
  - rnd/products/grantee-portal
  - rnd/products/back-office
personas:
  - rnd/personas/applicant
steps:
  - screen: rnd/screens/gp-home
    story: rnd/user-stories/2026-01-10--open-the-portal
    persona: rnd/personas/applicant
    caption: The applicant sees their grants
  - screen: rnd/screens/gp-apply
    story: rnd/user-stories/2026-01-10--submit-an-application
    persona: rnd/personas/applicant
    scope_rows:
      - GRT-R-001
  - screen: rnd/screens/bo-review
    story: rnd/user-stories/2026-01-10--review-the-application
    persona: rnd/personas/grant-officer
  - screen: rnd/screens/bo-review
    system: true
    caption: Approving twice is refused
failures:
  - The application is approved twice
---
`);
	put(ws, 'data/rnd/user-journeys/see-the-home.user-journey.md', `---
key: see-the-home
name: See both homes
products:
  - rnd/products/grantee-portal
  - rnd/products/back-office
steps:
  - screen: rnd/screens/gp-home
    story: rnd/user-stories/2026-01-10--open-the-portal
    persona: rnd/personas/applicant
  - screen: rnd/screens/bo-home
    system: true
    caption: The back office is not built yet
---
`);
	for (const k of ['open-the-portal', 'submit-an-application', 'review-the-application']) {
		const f = path.join(ws, `data/rnd/user-stories/2026-01-10--${k}.user-story.md`);
		const extra = k === 'open-the-portal' ? '  - rnd/user-journeys/see-the-home\n' : '';
		fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/\n---\n$/, `\njourneys:\n  - rnd/user-journeys/apply-for-a-grant\n${extra}---\n`));
	}
	settle(ws);
	const c = run(ws, ['check']); assert.equal(c.status, 0, c.stdout + c.stderr);
	const dir = path.join(ws, 'prototypes', 'northwind');
	fs.cpSync(FIXTURE, dir, { recursive: true });
	return dir;
}

describe('the browser tools on a synthetic prototype', { skip }, () => {
	let dir;
	before(async () => {
		dir = setup();
		const v = quiet(); assert.equal(await vendor(dir, v), 0, v.lines.join('\n'));
		const e = quiet(); assert.equal(await exportRun(dir, e), 0, e.lines.join('\n'));
		assert.match(e.lines.join('\n'), /2 journeys · 6 steps · 3 stories/);
	});
	test('check: the registry agrees with rnd/screens and every stamp is current', async () => {
		const q = quiet(); assert.equal(await check(dir, q), 0, q.lines.join('\n'));
		assert.match(q.lines.join('\n'), /4 screens matched · 0 mismatch\(es\) · vendored 6\/6 current/);
	});
	test('play: every journey plays end to end, the refusal it expects included, and stop restores the store', async () => {
		const q = quiet(); const code = await play(dir, { jobs: 2, ...q });
		assert.equal(code, 0, q.lines.join('\n'));
		const cov = JSON.parse(fs.readFileSync(path.join(dir, 'tools/out/coverage.json'), 'utf8'));
		assert.deepEqual(cov.totals, { journeys: 2, passing: 2, steps: 6, stepsOk: 6, built: 5, stub: 1 });
		assert.ok(cov.journeys.every((j) => j.restoreOk === true));
	});
	test('walk: every screen with the layer off, clean', async () => {
		const q = quiet(); assert.equal(await walk(dir, q), 0, q.lines.join('\n'));
		assert.match(q.lines.join('\n'), /4 screens walked with the layer off · 2 forbidden pattern\(s\) · 0 failure\(s\)/);
	});
	test('shoot: one png per registered screen of the portals', async () => {
		const q = quiet(); assert.equal(await shoot(dir, { out: 'shots', ...q }), 0, q.lines.join('\n'));
		const pngs = ['gp/gp-home', 'gp/gp-apply', 'bo/bo-review', 'bo/bo-home'].map((p) => path.join(dir, 'shots', `${p}.png`));
		for (const p of pngs) assert.ok(fs.existsSync(p) && fs.statSync(p).size > 1000, p);
	});
	test('play fails honestly: an anchor no screen draws, and a refusal the step does not expect — each named', async () => {
		const f = path.join(dir, 'public/app/demo/journeys/apply-for-a-grant.js');
		const orig = fs.readFileSync(f, 'utf8');
		fs.writeFileSync(f, orig.replace("{ story: 'open-the-portal' }", "{ story: 'open-the-portal', anchor: 'nowhere' }").replace(', expectRefusal: true', ''));
		try {
			const q = quiet(); assert.equal(await play(dir, { only: ['apply-for-a-grant'], ...q }), 1);
			const text = q.lines.join('\n');
			assert.match(text, /apply-for-a-grant#1 gp-home \[anchor missing\] \[data-demo~="nowhere"\] not on gp-home/);
			assert.match(text, /apply-for-a-grant#4 bo-review \[action refused\] approve refused \(GRT-R-010\)/);
		} finally { fs.writeFileSync(f, orig); }
	});
	test('walk fails on a forbidden word in the product copy', async () => {
		const f = path.join(dir, 'public/app/screens/index.js');
		const orig = fs.readFileSync(f, 'utf8');
		fs.writeFileSync(f, orig.replace("['Your grants']", "['Your grants TODO']"));
		try {
			const q = quiet(); assert.equal(await walk(dir, { only: ['gp-home'], ...q }), 1);
			assert.match(q.lines.join('\n'), /FAIL gp-home \[forbidden\] «Your grants TODO» matches/);
		} finally { fs.writeFileSync(f, orig); }
	});
	test('play refuses a prototype whose vendored file was edited — a fork', async () => {
		const f = path.join(dir, 'public/harness/player.js');
		const orig = fs.readFileSync(f, 'utf8');
		fs.writeFileSync(f, `${orig}\n// patched here\n`);
		try {
			const q = quiet(); assert.equal(await play(dir, q), 1);
			assert.match(q.lines.join('\n'), /fail {2}vendored player\.js: edited/);
		} finally { fs.writeFileSync(f, orig); }
	});
});
