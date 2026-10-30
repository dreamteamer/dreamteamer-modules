// SESSIONS LIVE OUTSIDE THE REPO — core installed the npm way into a virgin workspace on a real engine,
// with SESSIONS_FOLDER pointing at a throwaway folder: a record `dt add sessions` writes lands under the
// rendered folder by the id's month shard, never under data/, and the engine reports the folder as
// outside every git repo. Unset, compile warns naming the collection and the var, and `add` refuses.
//
// Skipped, saying so, on an engine below core's floor (0.39 brought the env-pointed root): the
// compiles-alone suite asserts such an engine refuses core whole.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { virginWorkspace, installPacked, closure, compileAndCheck, run, cleanup, engineMeets, pkgOf, editPkg, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const LITERAL = '${env:SESSIONS_FOLDER}';

/** A folder outside the workspace, as the operator's .env would name one. */
function annex() {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-sessions-')));
	after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** The workspace's .env plus one more line. */
const setEnv = (root, line) => fs.appendFileSync(path.join(root, '.env'), `${line}\n`);
/** What a workspace does when compile says a module reads a var: declare it in its own dreamteamer.vars. */
const declareVar = (root) => editPkg(root, (pkg) => { pkg.dreamteamer.vars.push('SESSIONS_FOLDER'); });

describe('sessions records are kept under ${env:SESSIONS_FOLDER}', { skip }, () => {
	test('add lands under the rendered folder by month, not under data/; list, get, check and status read it; commit never takes it', () => {
		const dir = annex();
		const root = virginWorkspace();
		declareVar(root);
		setEnv(root, `SESSIONS_FOLDER=${dir}`);
		installPacked(root, [...closure('core')]);
		const { compiled } = compileAndCheck(root);
		assert.doesNotMatch(compiled.stderr, /SESSIONS_FOLDER/, 'the var is declared by the workspace and set: compile has nothing to say about it');

		const added = run(root, ['add', 'sessions', '--name', 'Northwind calendar sync', '--started', '2026-10-28T09:00:00Z', '--harness', 'claude-code']);
		assert.equal(added.status, 0, added.stderr + added.stdout);
		const id = '2026/10/2026-10-28--northwind-calendar-sync';
		const expected = path.join(dir, '2026', '10', '2026-10-28--northwind-calendar-sync.session.md');
		assert.ok(fs.existsSync(expected), `record missing at ${expected}\n${added.stdout}`);
		assert.ok(!fs.existsSync(path.join(root, 'data', 'sessions')), 'a data/sessions folder appeared in the workspace');
		assert.ok(!fs.existsSync(path.join(root, LITERAL)), 'a literal ${env:…} folder appeared in the workspace');

		const listed = run(root, ['list', 'sessions']);
		assert.equal(listed.status, 0, listed.stderr);
		assert.match(listed.stdout, /northwind-calendar-sync/);
		const got = run(root, ['get', `sessions/${id}`]);
		assert.equal(got.status, 0, got.stderr);
		assert.match(got.stdout, /Northwind calendar sync/);

		const status = run(root, ['status']);
		assert.equal(status.status, 0, status.stderr);
		assert.match(status.stdout, /^storage:$/m);
		const line = status.stdout.split('\n').find((l) => /^\s+sessions\s/.test(l));
		assert.ok(line, `no sessions line under storage: in\n${status.stdout}`);
		assert.ok(line.includes(dir), `rendered folder not named: ${line}`);
		assert.ok(line.includes(LITERAL), `template not shown beside it: ${line}`);

		const committed = run(root, ['commit', `sessions/${id}`]);
		assert.equal(committed.status, 0, committed.stderr);
		assert.match(committed.stdout, /sessions: .*outside every git repo here/);
		assert.ok(!fs.readdirSync(root).some((e) => e.includes('${env')), 'a literal ${env:…} entry appeared in the workspace tree');
	});

	test('with SESSIONS_FOLDER unset: compile warns naming sessions and the var, check stays green, add refuses naming both', () => {
		const root = virginWorkspace();
		declareVar(root);
		installPacked(root, [...closure('core')]);
		const compiled = run(root, ['compile']);
		assert.equal(compiled.status, 0, compiled.stderr);
		assert.match(compiled.stderr, /collection sessions: storage\.path \$\{env:SESSIONS_FOLDER\} cannot render/);
		const checked = run(root, ['check']);
		assert.equal(checked.status, 0, checked.stderr + checked.stdout);
		assert.match(checked.stdout, /collection sessions: .*SESSIONS_FOLDER.* not read on this machine/);
		const refused = run(root, ['add', 'sessions', '--name', 'nope', '--started', '2026-10-28T09:00:00Z']);
		assert.equal(refused.status, 1, refused.stdout);
		assert.match(refused.stderr, /collection "sessions"/);
		assert.match(refused.stderr, /SESSIONS_FOLDER/);
		assert.ok(!fs.existsSync(path.join(root, 'data', 'sessions')) && !fs.existsSync(path.join(root, LITERAL)), 'something was created for a refused add');
	});
});
