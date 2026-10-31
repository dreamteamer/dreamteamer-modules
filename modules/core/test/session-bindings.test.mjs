// LIVE SESSIONS (cr-core-001) — a session starts on a record, claims it, and other agents see it. Core
// and rnd installed the npm way into a virgin workspace on a real engine, a session-binding written in
// the workspace's own module, SESSIONS_FOLDER pointing at a throwaway folder. Every assertion runs the
// real CLI: compile refuses a bad binding by name; two agents on one change request — the second is
// refused naming the first, then joins; `dt sessions open` is the queue; a short `stale_after` abandons
// a silent session and frees the claim; the Stop hook heartbeats by the harness session id.
//
// The claim line in `dt next` needs an engine with the `next` contribution (`contributedNotes`); on an
// older one that assertion is skipped, saying so — every verb still works. DT_ENGINE_DIR picks the engine.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { virginWorkspace, installPacked, closure, cleanup, engineMeets, pkgOf, editPkg, ENGINE, BIN, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const api = await import(pathToFileURL(path.join(ENGINE, 'src', 'api.js')).href);
const noSeam = typeof api.contributedNotes !== 'function' && `engine ${ENGINE_VERSION} has no \`next\` contribution — point DT_ENGINE_DIR at one that does`;

/** The CLI with a controlled environment: no harness session id leaks in from the session running the suite. */
function dt(root, args, { input, env = {} } = {}) {
	const base = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' };
	delete base.CLAUDE_CODE_SESSION_ID;
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env: { ...base, ...env }, input, timeout: 60_000 });
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r; };

const BINDING = (extra = '') => `collection: collections/rnd/change-requests
available_when:
  status: accepted
done_when:
  verified_on:
    _nnull: true
harness: claude-code
agent: agents/rnd-agent
command: commands/rnd/design
concurrency: one
description: the lifecycle on one accepted change request, one agent at a time
${extra}`;

const bindingFile = (root, name = 'change-requests') => path.join(root, 'modules', 'default', 'session-bindings', `${name}.session-binding.yaml`);
function writeBinding(root, text, name) {
	const f = bindingFile(root, name);
	fs.mkdirSync(path.dirname(f), { recursive: true });
	fs.writeFileSync(f, text);
	return f;
}

/** core + rnd, the binding, a product and three change requests: two accepted, one suggested. */
function fixture(binding = BINDING()) {
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-live-sessions-')));
	after(() => fs.rmSync(folder, { recursive: true, force: true }));
	const root = virginWorkspace();
	editPkg(root, (pkg) => { pkg.dreamteamer.vars.push('SESSIONS_FOLDER'); });
	fs.appendFileSync(path.join(root, '.env'), `SESSIONS_FOLDER=${folder}\n`);
	installPacked(root, [...new Set([...closure('core'), ...closure('rnd')])]);
	writeBinding(root, binding);
	ok(dt(root, ['compile']));
	ok(dt(root, ['add', 'rnd/products', '--name', 'Northwind portal']));
	for (const [key, status] of [['cr-nw-1', 'accepted'], ['cr-nw-2', 'accepted'], ['cr-nw-3', 'suggested']]) {
		ok(dt(root, ['add', 'rnd/change-requests', '--key', key, '--name', `Northwind ${key}`, '--products', 'rnd/products/northwind-portal', '--status', status]));
	}
	return { root, folder };
}
const CR = 'rnd/change-requests/cr-nw-1';
const sessionOf = (r) => /✔ sessions\/(\S+)/.exec(r.out)?.[1];
const fieldsOf = (root, id) => JSON.parse(ok(dt(root, ['get', `sessions/${id}`, '--json'])).out);

describe('session-bindings compile like command-bindings', { skip }, () => {
	test('compile: a good binding compiles, dt list reads it, the orientation block names it; a bad one is refused by name', () => {
		const { root } = fixture();
		const listed = ok(dt(root, ['list', 'session-bindings']));
		assert.match(listed.out, /change-requests/);
		const block = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
		assert.match(block, /SESSIONS BOUND TO COLLECTIONS/);
		assert.match(block, /- rnd\/change-requests — agents\/rnd-agent on claude-code \/rnd:design \(available when: status=accepted · done when: verified_on set\) · one at a time/);
		assert.match(ok(dt(root, ['check'])).out, /0 violations/);

		const base = yaml.load(BINDING());
		const bad = [
			[{ agent: 'agents/nobody' }, /session-bindings\/bad\.session-binding\.yaml: references unknown agent "agents\/nobody"/],
			[{ collection: 'collections/rnd/nothing' }, /session-bindings\/bad\.session-binding\.yaml: references unknown collection "collections\/rnd\/nothing"/],
			[{ command: 'commands/rnd/nothing' }, /session-bindings\/bad\.session-binding\.yaml: references unknown command "commands\/rnd\/nothing"/],
			[{ concurrency: 'always' }, /session-bindings\/bad\.session-binding\.yaml: `concurrency` is one · many/],
			[{ available_when: { statuz: 'accepted' } }, /session-bindings\/bad\.session-binding\.yaml: available_when names "statuz", which is not a field of rnd\/change-requests/],
			[{ done_when: { verified_on: { _soon: true } } }, /session-bindings\/bad\.session-binding\.yaml: done_when has unknown filter operator\(s\) _soon/],
			[{ stale_after: 'never' }, /session-bindings\/bad\.session-binding\.yaml: `stale_after` is a positive number/],
			[{ owner: 'users/dana-oren' }, /session-bindings\/bad\.session-binding\.yaml: unknown key `owner`/],
		];
		for (const [over, why] of bad) {
			const f = writeBinding(root, yaml.dump({ ...base, ...over }), 'bad');
			const r = dt(root, ['compile']);
			fs.rmSync(f);
			assert.notEqual(r.code, 0, `compile accepted ${JSON.stringify(over)}`);
			assert.match(r.err + r.out, why);
		}
		ok(dt(root, ['compile']));
	});

	test('the Stop hook that heartbeats is rendered by dt install --print-adapters', () => {
		const { root } = fixture();
		const r = ok(dt(root, ['install', '--print-adapters']));
		const hooks = JSON.parse(r.out).hooks;
		assert.match(hooks.Stop[0].hooks[0].command, /dt-hook\.sh" session heartbeat --hook$/);
	});
});

describe('two agents on one change request', { skip }, () => {
	test('two agents: the first claims it, the second is refused naming the first, then joins; dt sessions open is the queue; end frees it', () => {
		const { root, folder } = fixture();
		const before = JSON.parse(ok(dt(root, ['sessions', 'open', '--json'])).out);
		assert.deepEqual(before.map((o) => o.ref), [CR, 'rnd/change-requests/cr-nw-2'], 'accepted and free: cr-nw-1 and cr-nw-2; cr-nw-3 is only suggested');
		assert.equal(before[0].binding, 'session-bindings/change-requests');

		const a = ok(dt(root, ['session', 'start', CR, '--session-id', 'harness-a']));
		const aId = sessionOf(a);
		assert.ok(aId, a.out);
		assert.match(a.out, /rnd\/change-requests\/cr-nw-1 in session by agents\/rnd-agent since /);
		assert.match(a.out, /start with: \/rnd:design rnd\/change-requests\/cr-nw-1/);
		const s = fieldsOf(root, aId);
		assert.equal(s.status, 'running');
		assert.deepEqual(s.records, [CR]);
		assert.equal(s.binding, 'session-bindings/change-requests');
		assert.equal(s.worker, 'agents/rnd-agent');
		assert.equal(s.harness, 'claude-code');
		assert.equal(s.host, os.hostname());
		assert.equal(s.session_id, 'harness-a');
		assert.ok(s.heartbeat && s.started);
		assert.ok(fs.readdirSync(folder, { recursive: true }).some((f) => String(f).endsWith('.session.md')), 'the session lives in SESSIONS_FOLDER');

		const b = dt(root, ['session', 'start', CR, '--agent', 'qa-manager', '--session-id', 'harness-b']);
		assert.equal(b.code, 1, b.out + b.err);
		assert.match(b.err, new RegExp(`rnd/change-requests/cr-nw-1 is in session by agents/rnd-agent since \\S+ \\(sessions/${aId.replace(/\//g, '\\/')}\\)`));
		assert.match(b.err, /dt session start rnd\/change-requests\/cr-nw-1 --join/);

		const j = ok(dt(root, ['session', 'start', CR, '--agent', 'qa-manager', '--session-id', 'harness-b', '--join']));
		const jId = sessionOf(j);
		assert.notEqual(jId, aId, 'a join is the joiner\'s own session');
		assert.match(j.out, new RegExp(`joined sessions/${aId}`));
		assert.equal(fieldsOf(root, jId).worker, 'agents/qa-manager');

		const open = JSON.parse(ok(dt(root, ['sessions', 'open', '--json'])).out);
		assert.deepEqual(open.map((o) => o.ref), ['rnd/change-requests/cr-nw-2'], 'the claimed record is no longer open');

		// the Stop hook: the payload's session_id refreshes that harness session's records, and garbage is a no-op at exit 0
		const hb = fieldsOf(root, aId).heartbeat;
		spawnSync('sleep', ['1.1']);
		ok(dt(root, ['session', 'heartbeat', '--hook'], { input: JSON.stringify({ session_id: 'harness-a', hook_event_name: 'Stop' }) }));
		assert.notEqual(fieldsOf(root, aId).heartbeat, hb, 'the hook refreshed the heartbeat');
		ok(dt(root, ['session', 'heartbeat', '--hook'], { input: 'not json' }));

		const e = ok(dt(root, ['session', 'end', aId, '--outcome', 'designed and handed to review']));
		assert.match(e.out, /ended/);
		assert.match(e.out, new RegExp(`rnd/change-requests/cr-nw-1 is still in session by agents/qa-manager since \\S+ \\(sessions/${jId}\\)`), 'the joiner still holds it');
		assert.doesNotMatch(e.out, /cr-nw-1 free/, 'not free while the joiner runs');
		const ended = fieldsOf(root, aId);
		assert.equal(ended.status, 'ended');
		assert.ok(ended.ended);
		assert.match(ended.outcome, /designed and handed to review/);
		assert.notEqual(dt(root, ['session', 'end', aId]).code, 0, 'an ended session cannot end again');
		assert.match(ok(dt(root, ['session', 'end', jId])).out, /cr-nw-1 free/);
		assert.deepEqual(JSON.parse(ok(dt(root, ['sessions', 'open', '--json'])).out).map((o) => o.ref), [CR, 'rnd/change-requests/cr-nw-2'], 'ended, the record is open again');
		assert.match(ok(dt(root, ['list', 'sessions', '--filter', 'status=ended'])).out, /cr-nw-1/);
	});

	test('next: dt next <ref> says in session by <agent> since <time> for both holders; after end it says nothing', { skip: noSeam }, () => {
		const { root } = fixture();
		const aId = sessionOf(ok(dt(root, ['session', 'start', CR])));
		const jId = sessionOf(ok(dt(root, ['session', 'start', CR, '--agent', 'qa-manager', '--join'])));
		const next = ok(dt(root, ['next', CR]));
		assert.match(next.out, new RegExp(`● ${CR} — in session by agents/rnd-agent since \\S+ \\(sessions/${aId}\\) \\(@dreamteamer/core\\)`));
		assert.match(next.out, new RegExp(`in session by agents/qa-manager since \\S+ \\(sessions/${jId}\\)`));
		const notes = JSON.parse(ok(dt(root, ['next', CR, '--json'])).out).notes;
		assert.equal(notes.length, 2);
		assert.doesNotMatch(ok(dt(root, ['next', 'rnd/change-requests/cr-nw-2'])).out, /in session/);
		ok(dt(root, ['session', 'end', aId]));
		ok(dt(root, ['session', 'end', jId]));
		assert.doesNotMatch(ok(dt(root, ['next', CR])).out, /in session/);
	});

	test('a start is refused on a record its binding does not make available, and on a collection nothing binds', () => {
		const { root } = fixture();
		const r = dt(root, ['session', 'start', 'rnd/change-requests/cr-nw-3']);
		assert.equal(r.code, 1);
		assert.match(r.err, /cr-nw-3 is not open for a session under session-bindings\/change-requests: its available_when does not/);
		const p = dt(root, ['session', 'start', 'rnd/products/northwind-portal']);
		assert.equal(p.code, 1);
		assert.match(p.err, /no session-binding names rnd\/products/);
		assert.equal(JSON.parse(ok(dt(root, ['list', 'sessions', '--json'])).out).length ?? 0, 0, 'nothing was written');
	});
});

describe('a stale heartbeat abandons the session and frees the claim', { skip }, () => {
	test('stale: with stale_after 0.05 (3 s) and 4 s of silence, the session is abandoned, the ref is open again, a heartbeat refuses, a new start needs no --join', () => {
		const { root } = fixture(BINDING('stale_after: 0.05\n'));
		const aId = sessionOf(ok(dt(root, ['session', 'start', CR, '--session-id', 'harness-a'])));
		assert.equal(dt(root, ['session', 'start', CR]).code, 1, 'fresh: held');
		spawnSync('sleep', ['4']);
		if (!noSeam) assert.match(ok(dt(root, ['next', CR])).out, /no heartbeat since \S+, so the claim has lapsed/);
		const open = JSON.parse(ok(dt(root, ['sessions', 'open', '--json'])).out);
		assert.ok(open.some((o) => o.ref === CR), 'the record is open again');
		const s = fieldsOf(root, aId);
		assert.equal(s.status, 'abandoned');
		assert.equal(s.ended, s.heartbeat, 'ended at its last sign of life');
		const hb = dt(root, ['session', 'heartbeat', aId]);
		assert.equal(hb.code, 1);
		assert.match(hb.err, /abandoned — its claim lapsed/);
		ok(dt(root, ['session', 'start', CR, '--agent', 'qa-manager']));
	});
});
