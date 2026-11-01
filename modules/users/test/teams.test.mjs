// TEAMS SHIP WITH USERS — a group of people needs only the people. Installed from its packed tarball
// into a virgin workspace with nothing else, users carries `teams`, and the two mirrors a team stamps
// onto its people (`teams` from `members`, `led_teams` from `lead`) are users' own fields, not an
// overlay some other module has to bring. The one field a team gains from the plan, `projects`
// (generated from `projects.teams`), is declared by projects and exists only when projects does.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { MODULES, virginWorkspace, installPacked, closure, run, compileAndCheck, compiledDescriptor, cleanup, packedFiles, pkgOf } from '../../../tests/helpers/workspace.mjs';

after(cleanup);

const dt = (root, ...args) => {
	const r = run(root, args);
	assert.equal(r.status, 0, `dt ${args.join(' ')} → ${r.status}\n${r.stderr}${r.stdout}`);
	return r.stdout;
};

/** A team of two, Dana leading: the records a person writes the first time they group their people. */
function staff(root) {
	dt(root, 'add', 'users', '--name', 'Dana Oren');
	dt(root, 'add', 'users', '--name', 'Sam Diaz');
	dt(root, 'add', 'teams', '--name', 'Northwind delivery', '--members', 'users/dana-oren', '--members', 'users/sam-diaz', '--lead', 'users/dana-oren');
}

describe('users alone has teams', () => {
	let root;
	before(() => {
		root = virginWorkspace();
		installPacked(root, [...closure('users')]);
		compileAndCheck(root);
		staff(root);
	});
	test('the closure is users and nothing else — no projects anywhere', () => {
		assert.deepEqual([...closure('users')], ['users']);
		assert.equal(compiledDescriptor(root, 'projects'), null);
	});
	test('a team of two lands and check is clean', () => {
		assert.match(dt(root, 'get', 'teams/northwind-delivery'), /members:\n\s+- users\/dana-oren\n\s+- users\/sam-diaz/);
		assert.match(dt(root, 'check'), /0 violations/);
	});
	test('each member reads the team on their own record — the teams mirror', () => {
		for (const u of ['dana-oren', 'sam-diaz']) assert.match(dt(root, 'get', `users/${u}`), /teams:\n\s+- teams\/northwind-delivery/, u);
	});
	test('the lead reads it as led_teams, and a member who does not lead does not', () => {
		assert.match(dt(root, 'get', 'users/dana-oren'), /led_teams:\n\s+- teams\/northwind-delivery/);
		assert.doesNotMatch(dt(root, 'get', 'users/sam-diaz'), /led_teams:/);
	});
	test('without projects a team has no projects field', () => {
		assert.doesNotMatch(compiledDescriptor(root, 'teams'), /^\s{2}projects:/m);
	});
});

describe('users with projects — the plan adds its one mirror to the team', () => {
	let root;
	before(() => {
		root = virginWorkspace();
		installPacked(root, [...closure('projects')]);
		compileAndCheck(root);
		staff(root);
		dt(root, 'add', 'projects', '--name', 'Harbor rollout', '--teams', 'teams/northwind-delivery');
	});
	test('the team lists the project staffed with it, and the members still read the team', () => {
		assert.match(dt(root, 'get', 'teams/northwind-delivery'), /projects:\n\s+- projects\/harbor-rollout/);
		assert.match(dt(root, 'get', 'users/sam-diaz'), /teams:\n\s+- teams\/northwind-delivery/);
		assert.match(dt(root, 'check'), /0 violations/);
	});
});

describe('the move is a release a workspace is told about', () => {
	test('users 0.2.x ships an UPDATING.md: 0.2.1 says the pairing with projects is declared, 0.2.0 says teams moved here', () => {
		assert.equal(pkgOf('users').version, '0.2.1');
		assert.ok(packedFiles('users').includes('UPDATING.md'), 'UPDATING.md is in the tarball');
		const [, newest, previous] = fs.readFileSync(path.join(MODULES, 'users', 'UPDATING.md'), 'utf8').split(/^## /m);
		assert.match(newest, /^0\.2\.1 — the pairing with projects is declared/);
		assert.match(newest, /peerOptional @dreamteamer\/projects@">=0\.4\.0"/);
		assert.match(previous, /^0\.2\.0 — teams ships with users/);
		assert.match(previous, /name collision on collection "teams"/);
	});
});
