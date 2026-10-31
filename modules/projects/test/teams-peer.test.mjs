// `teams` IS A PEER OF PROJECTS — projects overlays a collection it no longer ships (`teams.projects`,
// the far side of `projects.teams`), and the engine applies such an overlay only while the collection
// is installed when the module names it in peer_collections. The install-alone gate cannot see the
// difference: there projects is always beside the users it is released with, which ships teams. What
// it changes is a workspace that upgrades projects (0.4.0) and not users (0.1.x, no teams): with the
// peer it compiles and check names the missing collection; without it compile refuses outright.
// Measured on 2026-10-31 by removing the peer: `every source declares overlay: true — no base found`.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { MODULES, virginWorkspace, run, editPkg, cleanup, compiledDescriptor, packedFiles, pkgOf } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-users-before-teams-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** users as it was before teams moved in: no teams descriptor, no teams or led_teams mirror. */
function usersWithoutTeams() {
	const dir = path.join(tmp, 'users');
	fs.cpSync(path.join(MODULES, 'users'), dir, { recursive: true, filter: (s) => !s.includes(`${path.sep}test`) });
	fs.rmSync(path.join(dir, 'collections', 'teams.collection.yaml'));
	const f = path.join(dir, 'collections', 'users.collection.yaml');
	const d = yaml.load(fs.readFileSync(f, 'utf8'));
	delete d.fields.teams; delete d.fields.led_teams;
	fs.writeFileSync(f, yaml.dump(d));
	return dir;
}

/** Install a module folder the npm way: under node_modules, declared as a direct dependency. */
function put(root, id, from) {
	fs.cpSync(from, path.join(root, 'node_modules', '@dreamteamer', id), { recursive: true });
	editPkg(root, (p) => { p.dependencies[`@dreamteamer/${id}`] = '*'; });
}

describe('projects beside a users that ships no teams', () => {
	test('the declared peer lets it compile; teams is simply absent, and check says so by name', () => {
		const root = virginWorkspace();
		put(root, 'users', usersWithoutTeams());
		put(root, 'projects', path.join(MODULES, 'projects'));
		const compiled = run(root, ['compile']);
		assert.equal(compiled.status, 0, compiled.stderr + compiled.stdout);
		assert.equal(compiledDescriptor(root, 'teams'), null, 'no module provides teams here');
		const added = run(root, ['add', 'projects', '--name', 'Harbor rollout', '--teams', 'teams/northwind-delivery']);
		assert.equal(added.status, 0, 'a reference into an absent peer is kept as written');
		const checked = run(root, ['check']);
		assert.match(checked.stdout + checked.stderr, /peer collection "teams" is declared but not installed/);
	});
});

describe('the move is a release a workspace is told about', () => {
	test('projects 0.4.0 ships an UPDATING.md whose newest section says it now needs users 0.2.0 for teams', () => {
		assert.equal(pkgOf('projects').version, '0.4.0');
		assert.ok(packedFiles('projects').includes('UPDATING.md'), 'UPDATING.md is in the tarball');
		const newest = fs.readFileSync(path.join(MODULES, 'projects', 'UPDATING.md'), 'utf8').split(/^## /m)[1];
		assert.match(newest, /^0\.4\.0 — teams moved to @dreamteamer\/users/);
		assert.match(newest, /You now need users 0\.2\.0 for teams/);
		assert.match(newest, /peer collection "teams" is declared but not installed/);
	});
});
