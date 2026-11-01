// RND SHIPS NO SESSION BINDINGS (0.8.0) — the three bindings rnd 0.6.0–0.7.0 shipped on a change request
// (design · build · review) are gone, and nothing replaces them: a workspace that wants a claim on a record
// declares its own binding through core. Each assertion below fails on rnd 0.7.0's tree:
//   line 1     the folder, the manifest entries and the packed tarball
//   lines 2-3  core + rnd compiled: no binding staged, no SESSIONS BOUND block in any harness file, and
//              `dt sessions open` never lists a change request, at any stage of the lifecycle
//   line 4     `dt next` says nothing about a session holding a request, lists the same command bindings,
//              and `dt session start` on a request is refused
//   goal 3     rnd's agents no longer tell a session to claim a request
//   goal 5     the migration (bin/migrate-session-bindings.mjs) unbinds the session records the removed
//              bindings opened, keeps every one, and `dt check` is green after it
// Core and rnd installed the npm way into a virgin workspace on a real engine; the migration is run from
// the PACKED path, so the tarball's bin is what is tested.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { virginWorkspace, installPacked, closure, cleanup, engineMeets, pkgOf, packedFiles, editPkg, BIN, MODULES, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const RND = path.join(MODULES, 'rnd');

/** The environment every child runs in: no harness session id leaking in from whatever runs the suite. */
const ENV = (() => {
	const env = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' };
	delete env.CLAUDE_CODE_SESSION_ID;
	return env;
})();
function dt(root, args) {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env: ENV, timeout: 60_000 });
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const ok = (r) => { assert.equal(r.code, 0, r.err + r.out); return r; };
const json = (root, args) => JSON.parse(ok(dt(root, [...args, '--json'])).out);
/** The ref `dt add <collection>` wrote. */
const added = (root, collection, args) => `${collection}/${json(root, ['add', collection, ...args]).id}`;

/** A virgin workspace with core and rnd installed the npm way, SESSIONS_FOLDER set and a lockfile, compiled. */
function coreAndRnd() {
	const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-rnd-sessions-')));
	after(() => fs.rmSync(folder, { recursive: true, force: true }));
	const root = virginWorkspace();
	editPkg(root, (pkg) => { pkg.dreamteamer.vars.push('SESSIONS_FOLDER'); });
	fs.appendFileSync(path.join(root, '.env'), `SESSIONS_FOLDER=${folder}\n`);
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
	installPacked(root, [...new Set([...closure('core'), ...closure('rnd')])]);
	return { root, folder, compiled: ok(dt(root, ['compile'])) };
}

/** A session record written as a file, the way an earlier rnd's `dt session start` left it. */
function sessionFile(folder, id, fields) {
	const f = path.join(folder, `${id}.session.md`);
	fs.mkdirSync(path.dirname(f), { recursive: true });
	const front = { name: id.split('/').pop(), started: '2026-01-12T09:00:00+02:00', records: ['rnd/change-requests/cr-nw-1'], worker: 'agents/rnd-agent', harness: 'claude-code', ...fields };
	fs.writeFileSync(f, `---\n${yaml.dump(front, { lineWidth: -1 })}---\n`);
	return f;
}
const fieldsIn = (f) => yaml.load(/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(f, 'utf8'))[1]);
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/** The bindings `dt next` lists as AVAILABLE for one record, read as review-gates.test.mjs reads them. */
function available(root, ref) {
	const id = ref.split('/').pop();
	return json(root, ['next', ref]).commands.filter((c) => c.states?.[id] === 'available').map((c) => c.binding.replace(/^command-bindings\//, ''));
}

/** The migration, from the packed module in the workspace. */
function migrate(root, ...args) {
	const script = path.join(root, 'node_modules', '@dreamteamer', 'rnd', 'bin', 'migrate-session-bindings.mjs');
	const r = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: ENV, timeout: 120_000 });
	return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

describe('rnd ships no session bindings', () => {
	test('line 1: rnd ships no session-bindings folder, names it in neither files nor ignore, and its tarball has none', () => {
		assert.equal(fs.existsSync(path.join(RND, 'session-bindings')), false, 'modules/rnd/session-bindings/ is gone');
		const pkg = pkgOf('rnd');
		assert.ok(!pkg.files.includes('session-bindings'), 'files does not list session-bindings');
		assert.ok(!(pkg.dreamteamer.ignore ?? []).includes('session-bindings'), 'dreamteamer.ignore does not list session-bindings');
		assert.deepEqual(packedFiles('rnd').filter((f) => f.startsWith('session-bindings/') || f.endsWith('.session-binding.yaml')), [], 'the tarball carries no binding');
	});

	test('lines 2-3: core and rnd compiled — no session binding, no SESSIONS BOUND block in any harness file', { skip }, () => {
		const { root, compiled } = coreAndRnd();
		assert.doesNotMatch(compiled.out + compiled.err, /session-binding/, 'compile stages and mentions no binding');
		assert.deepEqual(json(root, ['list', 'session-bindings']), []);
		for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
			const file = path.join(root, f);
			assert.ok(fs.existsSync(file), `${f} is written — the default harnesses compile it`);
			assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /SESSIONS BOUND TO COLLECTIONS/, f);
		}
		assert.match(ok(dt(root, ['check'])).out, /0 violations/);
	});

	test('line 4: a change request walked through the stages rnd bound — sessions open never lists it, dt next never says in session by, its command bindings are unchanged, session start is refused', { skip }, () => {
		const { root, folder } = coreAndRnd();
		ok(dt(root, ['add', 'rnd/products', '--name', 'Northwind portal']));
		ok(dt(root, ['add', 'rnd/change-requests', '--key', 'cr-nw-1', '--name', 'Northwind: export grants', '--products', 'rnd/products/northwind-portal']));
		const CR = 'rnd/change-requests/cr-nw-1';
		const stage = (label, expected) => {
			// line 3 FIRST, before anything holds the request: on 0.7.0 each of these states lists it
			const open = json(root, ['sessions', 'open']);
			assert.deepEqual(open.filter((o) => o.ref === CR), [], `${label}: dt sessions open lists ${CR}`);
			// then a running session that holds it: on 0.7.0 dt next names its holder, because a binding names the collection
			const seed = sessionFile(folder, `2026/01/2026-01-12--seed-${label}`, { status: 'running', heartbeat: new Date().toISOString(), session_id: `seed-${label}` });
			assert.doesNotMatch(ok(dt(root, ['next', CR])).out, /in session by/, `${label}: dt next names a holder`);
			assert.deepEqual(available(root, CR), expected, `${label}: the command bindings dt next lists`);
			const start = dt(root, ['session', 'start', CR]);
			assert.equal(start.code, 1, `${label}: dt session start ${CR} was not refused`);
			assert.match(start.out + start.err, /no session-binding names rnd\/change-requests/);
			fs.rmSync(seed);
		};
		stage('design', ['rnd--design--change-requests']);
		const dd = added(root, 'rnd/design-docs', ['--name', 'Grants export', '--product', 'rnd/products/northwind-portal', '--status', 'active']);
		ok(dt(root, ['set', CR, `design_docs=${dd}`, 'status=accepted', 'accepted_by=users/dana-oren', 'accepted_on=2026-01-12T10:00:00+02:00']));
		const plan = added(root, 'rnd/implementation-plans', ['--name', 'Grants export', '--spec', dd, '--change_request', CR, '--status', 'approved', '--execution', 'native']);
		stage('build', ['rnd--implement--change-requests']);
		ok(dt(root, ['set', plan, 'status=done']));
		stage('review', ['rnd--review--change-requests--code']);
	});

	test('goal 3: neither agent tells a session to claim a change request', () => {
		for (const agent of ['rnd-agent', 'qa-manager']) {
			const text = fs.readFileSync(path.join(RND, 'agents', `${agent}.agent.md`), 'utf8');
			assert.ok(!text.includes('dt session start'), `${agent} says dt session start`);
			assert.ok(!text.includes('session-binding'), `${agent} names a session-binding`);
		}
	});
});

describe('the migration unbinds the sessions rnd 0.7.0\'s bindings opened', { skip }, () => {
	const OWN = `collection: collections/rnd/products
available_when:
  name:
    _nempty: true
done_when:
  description:
    _nempty: true
harness: claude-code
agent: agents/rnd-agent
command: commands/rnd/design
concurrency: many
description: the workspace's own binding, on products
`;

	test('goal 5: the migration unbinds the sessions rnd\'s removed bindings opened, keeps every record, and dt check goes green', () => {
		const { root, folder } = coreAndRnd();
		fs.mkdirSync(path.join(root, 'modules', 'default', 'session-bindings'), { recursive: true });
		fs.writeFileSync(path.join(root, 'modules', 'default', 'session-bindings', 'northwind-own.session-binding.yaml'), OWN);
		ok(dt(root, ['compile']));
		ok(dt(root, ['add', 'rnd/products', '--name', 'Northwind portal']));
		ok(dt(root, ['add', 'rnd/change-requests', '--key', 'cr-nw-1', '--name', 'Northwind: export grants', '--products', 'rnd/products/northwind-portal']));
		const A = sessionFile(folder, '2026/01/2026-01-12--a', { status: 'ended', ended: '2026-01-12T10:00:00+02:00', binding: 'session-bindings/change-requests--design', tags: ['northwind'] });
		const B = sessionFile(folder, '2026/01/2026-01-12--b', { status: 'running', heartbeat: new Date().toISOString(), session_id: 'probe-1', binding: 'session-bindings/change-requests--review' });
		const D = sessionFile(folder, '2026/01/2026-01-12--d', { status: 'running', heartbeat: minutesAgo(48 * 60), binding: 'session-bindings/change-requests--build' });
		const C = sessionFile(folder, '2026/01/2026-01-12--c', { status: 'ended', ended: '2026-01-12T10:00:00+02:00', binding: 'session-bindings/northwind-own', records: ['rnd/products/northwind-portal'] });
		const bytes = () => [A, B, C, D].map((f) => fs.readFileSync(f, 'utf8'));

		// before: one dangling reference per session record the removed bindings opened, none for the workspace's own
		const red = dt(root, ['check']);
		assert.equal(red.code, 1, red.out);
		for (const id of ['a', 'b', 'd']) assert.match(red.out + red.err, new RegExp(`2026-01-12--${id}\\.session\\.md\\s+binding: dangling reference "session-bindings/change-requests--`));
		assert.doesNotMatch(red.out + red.err, /2026-01-12--c\.session\.md/);

		// the dry run lists the three and writes nothing
		const before = bytes();
		const dry = migrate(root);
		assert.equal(dry.code, 0, dry.out);
		for (const [id, b] of [['a', 'design'], ['b', 'review'], ['d', 'build']]) assert.match(dry.out, new RegExp(`would unbind sessions/2026/01/2026-01-12--${id}\\b.*change-requests--${b}`));
		assert.doesNotMatch(dry.out, /2026-01-12--c\b/);
		assert.match(dry.out, /3 session\(s\) to unbind/);
		assert.deepEqual(bytes(), before, 'a dry run writes nothing');

		// --write: binding cleared, the old one named in a tag, everything kept
		const w = migrate(root, '--write');
		assert.equal(w.code, 0, w.out);
		assert.match(w.out, /3 session\(s\) unbound/);
		ok(dt(root, ['check']));
		const a = fieldsIn(A), b = fieldsIn(B), d = fieldsIn(D);
		assert.equal(a.binding, undefined); assert.deepEqual(a.tags, ['northwind', 'rnd-binding:change-requests-design']); assert.equal(a.status, 'ended');
		assert.equal(b.binding, undefined); assert.deepEqual(b.tags, ['rnd-binding:change-requests-review']); assert.equal(b.status, 'running');
		assert.equal(d.binding, undefined); assert.deepEqual(d.tags, ['rnd-binding:change-requests-build']);
		assert.equal(fs.readFileSync(C, 'utf8'), before[2], 'the workspace\'s own binding\'s session is untouched');

		// what it told the person works as printed: the fresh running one is ended by its holder; the stale
		// one is reported as lapsing at the next session verb, with nothing to run
		const bLine = w.out.split('\n').find((l) => l.includes('sessions/2026/01/2026-01-12--b') && l.includes('still running'));
		assert.ok(bLine && /dt session end 2026\/01\/2026-01-12--b\b/.test(bLine) && /--force/.test(bLine), `the running line for b:\n${w.out}`);
		const dLine = w.out.split('\n').find((l) => l.includes('sessions/2026/01/2026-01-12--d') && /stale/.test(l));
		assert.ok(dLine && !/dt session end/.test(dLine) && /nothing to run/.test(dLine), `the stale line for d:\n${w.out}`);
		ok(dt(root, ['session', 'end', '2026/01/2026-01-12--b', '--session-id', 'probe-1']));
		ok(dt(root, ['sessions', 'open']));
		assert.equal(fieldsIn(D).status, 'abandoned', 'the stale one lapsed at the next session verb, as the migration said');

		// idempotent
		const again = migrate(root, '--write');
		assert.equal(again.code, 0, again.out);
		assert.match(again.out, /0 session\(s\) unbound/);
	});

	test('goal 5: the migration refuses on a stale compile — installed 0.8.0, not yet compiled', () => {
		const { root, folder } = coreAndRnd();
		// the state after `npm install` of 0.8.0 and before `dt compile`: 0.7.0's binding still compiled,
		// its source no longer on disk
		const name = 'change-requests--design.session-binding.yaml';
		fs.mkdirSync(path.join(root, '.dreamteamer', 'session-bindings'), { recursive: true });
		fs.writeFileSync(path.join(root, '.dreamteamer', 'session-bindings', name), 'collection: collections/rnd/change-requests\navailable_when:\n  design_docs:\n    _empty: true\ndone_when:\n  design_docs:\n    _nempty: true\nharness: claude-code\nagent: agents/rnd-agent\ncommand: commands/rnd/design\nconcurrency: one\nstale_after: 30\ndescription: the rnd-agent designs the request\n');
		const mf = path.join(root, '.dreamteamer', 'manifest.yaml');
		const manifest = yaml.load(fs.readFileSync(mf, 'utf8'));
		manifest.entries[`session-bindings/${name}`] = { sources: [{ path: `node_modules/@dreamteamer/rnd/session-bindings/${name}`, hash: 'sha256:0' }], hash: 'sha256:0' };
		fs.writeFileSync(mf, yaml.dump(manifest, { lineWidth: -1 }));
		const A = sessionFile(folder, '2026/01/2026-01-12--a', { status: 'ended', ended: '2026-01-12T10:00:00+02:00', binding: 'session-bindings/change-requests--design' });
		const r = migrate(root, '--write');
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /dt compile/);
		assert.equal(fieldsIn(A).binding, 'session-bindings/change-requests--design', 'nothing was written');
	});
});
