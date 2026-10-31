// THE LIFECYCLE IN SESSIONS (cr-core-001 line 4) — rnd ships three session-bindings on a change request
// (design · build · review), a kind @dreamteamer/core's extension contributes. Without core the folder
// is in rnd's `ignore`, so rnd still compiles alone; with core all three are staged and validated, and
// one request walked through the stages carries one session per stage — the rnd-agent's design and
// build, the qa-manager's review — each refused to a second agent while it runs, each ended with its
// stage. Core and rnd installed the npm way into a virgin workspace on a real engine.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { virginWorkspace, installPacked, closure, cleanup, engineMeets, pkgOf, editPkg, BIN, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;

/** The CLI with no harness session id leaking in from whatever runs the suite. */
function dt(root, args) {
	const env = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' };
	delete env.CLAUDE_CODE_SESSION_ID;
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env, timeout: 60_000 });
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r; };
const sessionOf = (r) => /✔ sessions\/(\S+)/.exec(r.out)?.[1];
/** The id `dt add <collection>` wrote, read off the path it prints — ids are the collection's to make. */
const addedId = (r, collection, suffix) => new RegExp(`data/${collection}/(\\S+)\\.${suffix}\\.md`).exec(r.out)?.[1];

describe('rnd ships its lifecycle as session-bindings', () => {
	test('rnd alone compiles with its session-bindings/ folder — the kind is core\'s, and rnd ignores it without core', () => {
		const root = virginWorkspace();
		installPacked(root, [...closure('rnd')]);
		const r = dt(root, ['compile']);
		assert.equal(r.code, 0, r.err);
		assert.doesNotMatch(r.err + r.out, /session-bindings/, 'nothing staged, nothing refused');
		assert.ok(pkgOf('rnd').files.includes('session-bindings'), 'the folder ships in the tarball');
		assert.ok(pkgOf('rnd').dreamteamer.ignore.includes('session-bindings'));
	});

	test('lifecycle: with core, the three bindings compile; one request walks design, build and review, one session per stage, each refused to a second agent while it runs', { skip }, () => {
		const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-rnd-sessions-')));
		after(() => fs.rmSync(folder, { recursive: true, force: true }));
		const root = virginWorkspace();
		editPkg(root, (pkg) => { pkg.dreamteamer.vars.push('SESSIONS_FOLDER'); });
		fs.appendFileSync(path.join(root, '.env'), `SESSIONS_FOLDER=${folder}\n`);
		installPacked(root, [...new Set([...closure('core'), ...closure('rnd')])]);
		const compiled = ok(dt(root, ['compile']));
		assert.match(compiled.out, /3 session-bindings/);
		assert.match(ok(dt(root, ['check'])).out, /0 violations/);
		const block = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
		for (const line of ['agents/rnd-agent on claude-code /rnd:design', 'agents/rnd-agent on claude-code /rnd:implement', 'agents/qa-manager on claude-code /rnd:review']) assert.ok(block.includes(line), `orientation lacks ${line}`);

		ok(dt(root, ['add', 'rnd/products', '--name', 'Harbor Mutual portal']));
		ok(dt(root, ['add', 'rnd/change-requests', '--key', 'cr-hm-1', '--name', 'Harbor Mutual: export claims', '--products', 'rnd/products/harbor-mutual-portal', '--status', 'accepted']));
		const CR = 'rnd/change-requests/cr-hm-1';
		const bindingOn = () => JSON.parse(ok(dt(root, ['sessions', 'open', '--json'])).out).find((o) => o.ref === CR)?.binding ?? null;

		// DESIGN — the rnd-agent; the qa-manager is refused while it runs
		assert.equal(bindingOn(), 'session-bindings/change-requests--design');
		const design = ok(dt(root, ['session', 'start', CR]));
		assert.match(design.out, /in session by agents\/rnd-agent .*\(session-bindings\/change-requests--design\)/);
		assert.match(design.out, /start with: \/rnd:design rnd\/change-requests\/cr-hm-1/);
		assert.equal(dt(root, ['session', 'start', CR, '--agent', 'qa-manager']).code, 1);
		const doc = addedId(ok(dt(root, ['add', 'rnd/design-docs', '--name', 'Claims export', '--status', 'draft'])), 'rnd/design-docs', 'design-doc');
		ok(dt(root, ['set', CR, `design_docs=rnd/design-docs/${doc}`]));
		ok(dt(root, ['session', 'end', sessionOf(design), '--outcome', `design: rnd/design-docs/${doc}`]));
		assert.equal(bindingOn(), null, 'designed, unplanned: no stage opens a session');

		// BUILD — an approved plan opens the rnd-agent's build session
		const plan = addedId(ok(dt(root, ['add', 'rnd/implementation-plans', '--name', 'Claims export build', '--change_request', CR, '--status', 'approved'])), 'rnd/implementation-plans', 'implementation-plan');
		assert.equal(bindingOn(), 'session-bindings/change-requests--build');
		const build = ok(dt(root, ['session', 'start', CR]));
		assert.match(build.out, /in session by agents\/rnd-agent .*\(session-bindings\/change-requests--build\)/);
		assert.match(build.out, /start with: \/rnd:implement/);
		ok(dt(root, ['set', `rnd/implementation-plans/${plan}`, 'status=done']));
		ok(dt(root, ['session', 'end', sessionOf(build), '--outcome', 'build: plan done']));

		// REVIEW — a done plan, not yet verified, opens the qa-manager's
		assert.equal(bindingOn(), 'session-bindings/change-requests--review');
		const review = ok(dt(root, ['session', 'start', CR]));
		assert.match(review.out, /in session by agents\/qa-manager .*\(session-bindings\/change-requests--review\)/);
		assert.equal(dt(root, ['session', 'start', CR, '--agent', 'rnd-agent']).code, 1, 'the builder is refused while the reviewer holds it');
		ok(dt(root, ['set', CR, `verified_on=${new Date().toISOString()}`]));
		ok(dt(root, ['session', 'end', sessionOf(review), '--outcome', 'approve']));
		assert.equal(bindingOn(), null, 'verified: no stage opens a session');

		// the request's sessions — one per stage, each ended (two may start within one second, so by binding, not by time)
		const mine = JSON.parse(ok(dt(root, ['list', 'sessions', '--where', JSON.stringify({ records: { _contains: CR } }), '--json'])).out);
		const stage = (b) => ['design', 'build', 'review'].indexOf(b.split('--').pop());
		assert.deepEqual(mine.map((s) => [s.binding, s.worker, s.status]).sort((a, b) => stage(a[0]) - stage(b[0])), [
			['session-bindings/change-requests--design', 'agents/rnd-agent', 'ended'],
			['session-bindings/change-requests--build', 'agents/rnd-agent', 'ended'],
			['session-bindings/change-requests--review', 'agents/qa-manager', 'ended'],
		]);
	});

	test('the two agents say how they start and end their sessions', () => {
		for (const [agent, binding] of [['rnd-agent', 'change-requests--design'], ['qa-manager', 'change-requests--review']]) {
			const text = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'agents', `${agent}.agent.md`), 'utf8');
			assert.match(text, new RegExp(`dt session start rnd/change-requests/<id> --agent ${agent}`));
			assert.match(text, /dt session end <session> --outcome/);
			assert.ok(text.includes(binding), `${agent} names ${binding}`);
		}
	});
});
