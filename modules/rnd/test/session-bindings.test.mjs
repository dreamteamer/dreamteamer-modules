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
import { pathToFileURL } from 'node:url';
import { virginWorkspace, installPacked, closure, cleanup, engineMeets, pkgOf, editPkg, BIN, ENGINE, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const api = await import(pathToFileURL(path.join(ENGINE, 'src', 'api.js')).href);
const hasNext = typeof api.contributedNotes === 'function';
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
const fieldsOf = (root, id) => JSON.parse(ok(dt(root, ['get', `sessions/${id}`, '--json'])).out);
/** The id `dt add <collection>` wrote, read off the path it prints — ids are the collection's to make. */
const addedId = (r, collection, suffix) => new RegExp(`data/${collection}/(\\S+)\\.${suffix}\\.md`).exec(r.out)?.[1];

/** A virgin workspace with core and rnd installed the npm way and SESSIONS_FOLDER set — not compiled. */
function coreAndRnd() {
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-rnd-sessions-')));
	after(() => fs.rmSync(folder, { recursive: true, force: true }));
	const root = virginWorkspace();
	editPkg(root, (pkg) => { pkg.dreamteamer.vars.push('SESSIONS_FOLDER'); });
	fs.appendFileSync(path.join(root, '.env'), `SESSIONS_FOLDER=${folder}\n`);
	installPacked(root, [...new Set([...closure('core'), ...closure('rnd')])]);
	return root;
}

describe('rnd ships its lifecycle as session-bindings', () => {
	// THE IGNORE ROUTE, both halves pinned. rnd reaches core's kind by listing session-bindings in
	// dreamteamer.ignore, which leans on two engine behaviours: (1) without the extension that contributes
	// the kind, an ignored folder is not a stray, so rnd compiles alone; (2) with it, compile stages a KNOWN
	// kind's folder even though the module ignores it. If an engine changes either, one of these fails.
	// The proper shape is an engine feature (rnd/features: a module may ship a folder of a kind another
	// module's extension contributes, declared as such rather than through ignore).
	test('ignore route, half 1: rnd alone compiles with its session-bindings/ folder — without core it is not a stray', () => {
		const root = virginWorkspace();
		installPacked(root, [...closure('rnd')]);
		const r = dt(root, ['compile']);
		assert.equal(r.code, 0, r.err);
		assert.doesNotMatch(r.err + r.out, /session-bindings/, 'nothing staged, nothing refused');
		assert.ok(pkgOf('rnd').files.includes('session-bindings'), 'the folder ships in the tarball');
		assert.ok(pkgOf('rnd').dreamteamer.ignore.includes('session-bindings'));
	});

	test('lifecycle: with core, the three bindings compile; one request walks design, build and review, one session per stage, each refused to a second agent while it runs', { skip }, () => {
		const root = coreAndRnd();
		const compiled = ok(dt(root, ['compile']));
		// ignore route, half 2: with core the kind is known, and rnd's ignored folder is staged anyway
		assert.ok(pkgOf('rnd').dreamteamer.ignore.includes('session-bindings'), 'rnd still lists the folder in ignore');
		assert.match(compiled.out, /3 session-bindings/);
		assert.deepEqual(fs.readdirSync(path.join(root, '.dreamteamer', 'session-bindings')).sort(), ['change-requests--build', 'change-requests--design', 'change-requests--review'].map((b) => `${b}.session-binding.yaml`), 'rnd\'s three are staged despite ignore');
		assert.match(ok(dt(root, ['check'])).out, /0 violations/);
		const block = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
		// the WHOLE line per binding: a gate that hops a reference (implementation_plans.status) reads as the
		// engine renders a command-binding's — a check of the line's start let `tatus [object Object]` ship
		const lines = block.split('\n');
		for (const line of [
			'- rnd/change-requests — agents/rnd-agent on claude-code /rnd:design (available when: status in suggested|accepted, design_docs empty, implementation_plans empty · done when: design_docs set) · one at a time',
			'- rnd/change-requests — agents/rnd-agent on claude-code /rnd:implement (available when: status=accepted, implementation_plans.status in approved|in-progress · done when: implementation_plans.status=done) · one at a time',
			'- rnd/change-requests — agents/qa-manager on claude-code /rnd:review (available when: status=accepted, verified_on empty, implementation_plans.status=done · done when: verified_on set) · one at a time',
		]) assert.ok(lines.includes(line), `orientation lacks the line\n  ${line}\nit reads:\n  ${lines.filter((l) => l.startsWith('- rnd/change-requests — ')).join('\n  ')}`);
		for (const f of ['AGENTS.md', 'GEMINI.md']) if (fs.existsSync(path.join(root, f))) assert.doesNotMatch(fs.readFileSync(path.join(root, f), 'utf8'), /\[object Object\]/, f);

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
		ok(dt(root, ['session', 'end', sessionOf(design), '--agent', 'rnd-agent', '--outcome', `design: rnd/design-docs/${doc}`]));
		assert.equal(bindingOn(), null, 'designed, unplanned: no stage opens a session');

		// BUILD — an approved plan opens the rnd-agent's build session
		const plan = addedId(ok(dt(root, ['add', 'rnd/implementation-plans', '--name', 'Claims export build', '--change_request', CR, '--status', 'approved'])), 'rnd/implementation-plans', 'implementation-plan');
		assert.equal(bindingOn(), 'session-bindings/change-requests--build');
		const build = ok(dt(root, ['session', 'start', CR]));
		assert.match(build.out, /in session by agents\/rnd-agent .*\(session-bindings\/change-requests--build\)/);
		assert.match(build.out, /start with: \/rnd:implement/);
		ok(dt(root, ['set', `rnd/implementation-plans/${plan}`, 'status=done']));
		ok(dt(root, ['session', 'end', sessionOf(build), '--agent', 'rnd-agent', '--outcome', 'build: plan done']));

		// REVIEW — a done plan, not yet verified, opens the qa-manager's
		assert.equal(bindingOn(), 'session-bindings/change-requests--review');
		const review = ok(dt(root, ['session', 'start', CR]));
		assert.match(review.out, /in session by agents\/qa-manager .*\(session-bindings\/change-requests--review\)/);
		assert.equal(dt(root, ['session', 'start', CR, '--agent', 'rnd-agent']).code, 1, 'the builder is refused while the reviewer holds it');
		ok(dt(root, ['set', CR, `verified_on=${new Date().toISOString()}`]));
		ok(dt(root, ['session', 'end', sessionOf(review), '--agent', 'qa-manager', '--outcome', 'approve']));
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

	test('a finished stage: dt next says the stage is done and names dt session end; dt sessions open lists the next stage as held by a finished one; the build starts beside it', { skip }, () => {
		const root = coreAndRnd();
		ok(dt(root, ['compile']));
		ok(dt(root, ['add', 'rnd/products', '--name', 'Harbor Mutual portal']));
		ok(dt(root, ['add', 'rnd/change-requests', '--key', 'cr-hm-2', '--name', 'Harbor Mutual: renewals', '--products', 'rnd/products/harbor-mutual-portal', '--status', 'accepted']));
		const CR = 'rnd/change-requests/cr-hm-2';
		const design = sessionOf(ok(dt(root, ['session', 'start', CR])));
		// the design lands AND an approved plan — the design binding no longer opens the record, the build's does
		const doc = addedId(ok(dt(root, ['add', 'rnd/design-docs', '--name', 'Renewals', '--status', 'draft'])), 'rnd/design-docs', 'design-doc');
		ok(dt(root, ['set', CR, `design_docs=rnd/design-docs/${doc}`]));
		ok(dt(root, ['add', 'rnd/implementation-plans', '--name', 'Renewals build', '--change_request', CR, '--status', 'approved']));
		if (hasNext) {
			const next = ok(dt(root, ['next', CR])).out;
			assert.match(next, new RegExp(`in session by agents/rnd-agent since \\S+ \\(sessions/${design}\\) — stage done: session-bindings/change-requests--design no longer opens the record; end the session: dt session end ${design}`));
		}
		const open = JSON.parse(ok(dt(root, ['sessions', 'open', '--json'])).out).find((o) => o.ref === CR);
		assert.deepEqual(open, { ref: CR, binding: 'session-bindings/change-requests--build', agent: 'agents/rnd-agent', harness: 'claude-code', command: 'commands/rnd/implement', held_by_finished: [`sessions/${design}`] });
		assert.match(ok(dt(root, ['sessions', 'open'])).out, new RegExp(`${CR}  session-bindings/change-requests--build  agents/rnd-agent  → dt session start ${CR}  \\(held by a finished stage: sessions/${design}\\)`));
		const build = ok(dt(root, ['session', 'start', CR]));
		assert.match(build.out, /\(session-bindings\/change-requests--build\)/);
		assert.match(build.out, new RegExp(`beside sessions/${design}, whose stage is done — its holder should dt session end it`));
		assert.equal(fieldsOf(root, design).status, 'running', 'never ended for its holder');
		// a stage still open does block: a second build is refused naming the first
		assert.equal(dt(root, ['session', 'start', CR, '--agent', 'qa-manager']).code, 1);
		ok(dt(root, ['session', 'end', design, '--agent', 'rnd-agent']));
		ok(dt(root, ['session', 'end', sessionOf(build), '--agent', 'rnd-agent']));
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
