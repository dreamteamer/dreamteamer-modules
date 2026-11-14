// THE FIVE FORMER CORE COLLECTIONS SHIP ALONE (cr-dt-008, task 1; rnd/tests dreamteamer-modules/five-packages-alone).
//
// core 0.11 authored five collections no small module had: sessions, metrics, roles, responsibilities and
// artifacts. From core 0.12 core is a preset of small modules, so each became a package of its own. Each one
// compiles and checks with only its declared closure, on both channels; its compiled storage path and id
// shape equal what core 0.11 compiled (frozen in tests/fixtures/core-0.11-own.json), so a workspace that
// moves from core to the package finds every record where it was; and the sessions verbs work in a
// workspace that holds sessions and users and nothing of core.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import yaml from 'js-yaml';
import { ROOT, BIN, CHANNELS, closure, pkgOf, virginWorkspace, installPacked, compileAndCheck, compiledDescriptor, cleanup, engineMeets, ENGINE_VERSION } from './helpers/workspace.mjs';

after(cleanup);
const FIVE = ['sessions', 'metrics', 'roles', 'responsibilities', 'artifacts'];
const OWN = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'core-0.11-own.json'), 'utf8'));
const skipOf = (m) => fs.existsSync(path.join(ROOT, 'modules', m, 'package.json')) && [...closure(m)].some((x) => !engineMeets(x)) && `needs engine ${pkgOf(m).dreamteamer.engine}; testing ${ENGINE_VERSION}`;

for (const [channel, install] of Object.entries(CHANNELS)) {
	describe(`the five packages compile alone — ${channel}`, () => {
		for (const m of FIVE) {
			test(`${m}: compiles and checks with its closure; storage and ids are core 0.11's`, { skip: skipOf(m) }, () => {
				const root = virginWorkspace();
				install(root, [...closure(m)]);
				compileAndCheck(root);
				const d = yaml.load(compiledDescriptor(root, m) ?? 'null');
				assert.ok(d, `${m} did not compile into the workspace`);
				assert.deepEqual({ storage: d.storage, ids: d.ids }, OWN[m]);
				assert.equal(d.storage.path, `data/${m}`);
			});
		}
	});
}

describe('the sessions verbs without core', () => {
	test('a workspace holding only sessions and users: dt session bind exits 0 and writes data/sessions/', { skip: skipOf('sessions') }, () => {
		const root = virginWorkspace();
		installPacked(root, [...closure('sessions')]);
		assert.deepEqual([...closure('sessions')].sort(), ['sessions', 'users']);
		const env = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' };
		delete env.CLAUDE_CODE_SESSION_ID;
		delete env.SESSIONS_FOLDER;
		const dt = (args) => spawnSync(process.execPath, [BIN, ...args], { cwd: root, encoding: 'utf8', env, timeout: 60_000 });
		const compiled = dt(['compile']);
		assert.equal(compiled.status, 0, compiled.stderr + compiled.stdout);
		assert.ok(!fs.existsSync(path.join(root, 'node_modules', '@dreamteamer', 'core')), 'core is installed');
		const added = dt(['add', 'users', '--name', 'Dana Oren']);
		assert.equal(added.status, 0, added.stderr + added.stdout);
		const sid = '3e880550-0000-4000-8000-0000000000f5';
		const bound = dt(['session', 'bind', 'users/dana-oren', '--session', sid]);
		assert.equal(bound.status, 0, bound.stderr + bound.stdout);
		const file = path.join(root, 'data', 'sessions', `${sid}.session.md`);
		assert.ok(fs.existsSync(file), `no record at ${file}`);
		assert.match(fs.readFileSync(file, 'utf8'), /users\/dana-oren/);
	});
});
