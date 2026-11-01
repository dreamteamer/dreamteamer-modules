// TEAMS IN CORE COME FROM USERS — since cr-modules-002 (2026-10-31) the `teams` collection is authored in
// @dreamteamer/users, and projects adds only the far side of its own `projects.teams`. A workspace on
// core must not notice: the composed teams carries the same fields it did when projects shipped it,
// the people still read their teams, and a team staffed to a project is clean under check. What
// changes is provenance — compose.json names users as the origin.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { CORE } from '../../../scripts/compose-core.mjs';
import { virginWorkspace, installPacked, closure, run, compileAndCheck, compiledDescriptor, cleanup, engineMeets, pkgOf, packedFiles, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const spec = JSON.parse(fs.readFileSync(path.join(CORE, 'compose.json'), 'utf8'));
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;

// The fields teams had when projects shipped it (projects 0.3.1, core 0.6.0) — the set a core
// workspace's records were written against, and the set it must still compile to.
const TEAM_FIELDS = ['name', 'description', 'members', 'lead', 'company', 'status', 'tags', 'projects', 'notes', 'author', 'creation_context', 'source', 'confidence'];

const dt = (root, ...args) => {
	const r = run(root, args);
	assert.equal(r.status, 0, `dt ${args.join(' ')} → ${r.status}\n${r.stderr}${r.stdout}`);
	return r.stdout;
};

describe('compose.json names users as the origin of teams', () => {
	test('the base descriptor is a copy of users\', and projects contributes an overlay with one field', () => {
		assert.equal(spec.files['collections/users/teams.collection.yaml']?.from, 'users/collections/teams.collection.yaml');
		const fromProjects = yaml.load(fs.readFileSync(path.join(CORE, 'collections/projects/teams.collection.yaml'), 'utf8'));
		assert.equal(fromProjects.overlay, true, 'projects ships no teams base any more');
		assert.deepEqual(Object.keys(fromProjects.fields), ['projects']);
	});
	test('the users mirrors of teams are users\' own, not projects\' overlay', () => {
		const users = yaml.load(fs.readFileSync(path.join(CORE, 'collections/users/users.collection.yaml'), 'utf8'));
		assert.equal(users.fields.teams?.mirror_of, 'members');
		assert.equal(users.fields.led_teams?.mirror_of, 'lead');
		const overlay = yaml.load(fs.readFileSync(path.join(CORE, 'collections/projects/users.collection.yaml'), 'utf8'));
		assert.ok(!overlay.fields.teams && !overlay.fields.led_teams);
	});
});

describe('a workspace on core sees no change', { skip }, () => {
	let root;
	before(() => {
		root = virginWorkspace();
		installPacked(root, [...closure('core')]);
		compileAndCheck(root);
		dt(root, 'add', 'users', '--name', 'Dana Oren');
		dt(root, 'add', 'users', '--name', 'Sam Diaz');
		dt(root, 'add', 'teams', '--name', 'Northwind delivery', '--members', 'users/dana-oren', '--members', 'users/sam-diaz', '--lead', 'users/dana-oren');
		dt(root, 'add', 'projects', '--name', 'Harbor rollout', '--teams', 'teams/northwind-delivery');
	});
	test('the compiled teams has exactly the fields it had when projects shipped it', () => {
		// in ORDER too: the engine places the overlay's `projects` where the base had it, ahead of the body
		// and the provenance fields, so a form or a list reads the same as before the move
		assert.deepEqual(Object.keys(yaml.load(compiledDescriptor(root, 'teams')).fields), TEAM_FIELDS);
	});
	test('the people read their team, the team reads its project, and check is clean', () => {
		assert.match(dt(root, 'get', 'users/sam-diaz'), /teams:\n\s+- teams\/northwind-delivery/);
		assert.match(dt(root, 'get', 'users/dana-oren'), /led_teams:\n\s+- teams\/northwind-delivery/);
		assert.match(dt(root, 'get', 'teams/northwind-delivery'), /projects:\n\s+- projects\/harbor-rollout/);
		assert.match(dt(root, 'check'), /0 violations/);
	});
});

describe('the recomposition is a release a workspace is told about', () => {
	// pinned to the 0.7.0 SECTION, not to the newest one: a later release adds its own above it
	test('core ships an UPDATING.md (compose adds it to files) whose 0.7.0 section says nothing changes but provenance', () => {
		assert.ok(pkgOf('core').files.includes('UPDATING.md'));
		assert.ok(packedFiles('core').includes('UPDATING.md'), 'UPDATING.md is in the tarball');
		const sections = fs.readFileSync(path.join(CORE, 'UPDATING.md'), 'utf8').split(/^## /m);
		assert.ok(sections[1].startsWith(pkgOf('core').version), `the newest section is ${pkgOf('core').version}, the version core ships`);
		const newest = sections.find((x) => x.startsWith('0.7.0'));
		assert.match(newest, /^0\.7\.0 — teams comes from users \(users 0\.2\.0, projects 0\.4\.0\)/);
		assert.match(newest, /Nothing to do but compile/);
		assert.match(newest, /provenance/);
	});
});
