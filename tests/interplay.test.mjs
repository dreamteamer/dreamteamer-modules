// THE MODULES INTERPLAY — measured on real record writes, not on descriptors.
//
// What "independent modules that work together" has to mean, as assertions: install them side by
// side from their packed tarballs, write the records a person actually writes, and read back what each
// module added to the others. Then take one away and check that what it added goes with it, and that
// a write needing it is refused by name rather than accepted into nowhere.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert';
import { virginWorkspace, installPacked, run, compileAndCheck, compiledDescriptor, cleanup } from './helpers/workspace.mjs';

after(cleanup);

const dt = (root, ...args) => {
	const r = run(root, args);
	assert.equal(r.status, 0, `dt ${args.join(' ')} → ${r.status}\n${r.stderr}${r.stdout}`);
	return r.stdout;
};

describe('assets · users · contacts · tasks · meetings, together', () => {
	let root;
	before(() => {
		root = virginWorkspace();
		installPacked(root, ['assets', 'users', 'contacts', 'tasks', 'meetings']);
		compileAndCheck(root);
		dt(root, 'add', 'users', '--name', 'Sam Diaz');
		dt(root, 'add', 'companies', '--name', 'Harbor Mutual');
		dt(root, 'add', 'contacts', '--name', 'Priya Raman', '--company', 'companies/harbor-mutual');
		dt(root, 'add', 'tasks', '--name', 'Send the benchmark', '--slug', 'send-the-benchmark', '--assignee', 'users/sam-diaz');
		dt(root, 'add', 'meetings', '--name', 'Harbor weekly', '--starts', '2026-10-05T10:00:00+03:00',
			'--attendees', 'contacts/priya-raman', '--ours', 'users/sam-diaz', '--company', 'companies/harbor-mutual');
	});

	test('every write lands and check is clean', () => {
		assert.match(dt(root, 'check'), /0 violations/);
	});
	test('a person sees what is theirs — tasks stamps `tasks`, meetings stamps `meetings`, onto users', () => {
		const sam = dt(root, 'get', 'users/sam-diaz');
		assert.match(sam, /tasks:\n\s+- tasks\/\d{4}-\d{2}-\d{2}--send-the-benchmark/);
		assert.match(sam, /meetings:\n\s+- meetings\/2026\/10\/2026-10-05--10-00--harbor-mutual--harbor-weekly/);
	});
	test('a company sees its people — contacts stamps `contacts` onto companies', () => {
		assert.match(dt(root, 'get', 'companies/harbor-mutual'), /contacts:\n\s+- contacts\/priya-raman/);
	});
	test('meetings without the recordings module carries no recordings field', () => {
		assert.doesNotMatch(compiledDescriptor(root, 'meetings'), /\brecordings:/);
	});
});

describe('tasks with users, and without projects', () => {
	let root;
	before(() => {
		root = virginWorkspace();
		installPacked(root, ['users', 'tasks']);
		compileAndCheck(root);
	});
	test('assignee works: the mirror is stamped onto users', () => {
		assert.match(compiledDescriptor(root, 'users'), /\btasks:/);
	});
	test('a task naming a project is refused by name, not written into nowhere', () => {
		const r = run(root, ['add', 'tasks', '--name', 'Plan rung work', '--project', 'projects/atlas']);
		assert.notEqual(r.status, 0, 'the write was accepted with no projects collection installed');
		assert.match(r.stderr + r.stdout, /unknown collection "projects"/);
	});
	test('no meetings field appears on users when meetings is not installed', () => {
		assert.doesNotMatch(compiledDescriptor(root, 'users'), /\bmeetings:/);
	});
});
