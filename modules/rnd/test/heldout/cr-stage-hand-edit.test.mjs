// HELD-OUT (cr-modules-006-h3-hand-edit-repaired): a hand edit that contradicts the record (`dt set … stage=done`
// on an accepted request mid-build) is named by dt check — the gate rule first, one line — and repaired by the
// migration's --write, touching nothing else. Written by the test stage from the review's steps.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { rndWorkspace, run, cleanupAll } from '../helpers/rnd-workspace.mjs';
import { product, doc, plan, req, reqFile, settle, linesFor, stageLines, migrate, accepted, designs } from './lib/cr-stage-records.mjs';

after(() => cleanupAll());
const git = (root, ...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' } });

test('h3 — a hand edit is named, then repaired', () => {
	const root = rndWorkspace();
	product(root);
	doc(root, 'act', 'active');
	req(root, 'mid-build', [...accepted, designs('act'), 'stage: implement']);
	plan(root, 'mid', 'mid-build', 'approved');
	settle(root);
	git(root, 'add', '-A');
	git(root, 'commit', '-qm', 'fixture');

	assert.deepEqual(stageLines(run(root, ['check']).stdout), [], 'baseline');
	const set = run(root, ['set', 'rnd/change-requests/mid-build', 'stage=done']);
	assert.equal(set.status, 0, set.stderr);
	const c = run(root, ['check']);
	assert.equal(c.status, 0);
	const lines = stageLines(c.stdout);
	assert.equal(lines.length, 1, lines.join('\n'));
	assert.match(lines[0], /data\/rnd\/change-requests\/mid-build\.change-request\.md — stage is done but the record is at implement — dt next names \/rnd:implement; set stage=implement \(@dreamteamer\/rnd\)/);

	const afterHand = fs.readFileSync(reqFile(root, 'mid-build'), 'utf8');
	const dry = migrate(root);
	assert.match(dry.out, /would set rnd\/change-requests\/mid-build stage=implement \(was done\)/);
	assert.equal(fs.readFileSync(reqFile(root, 'mid-build'), 'utf8'), afterHand, 'the dry run writes nothing');

	assert.equal(migrate(root, { args: ['--write'] }).code, 0);
	const diff = git(root, 'diff', '-U0', '--', 'data/rnd/change-requests/mid-build.change-request.md').split('\n').filter((l) => /^[+-][^+-]/.test(l));
	assert.deepEqual(diff, [], `against the committed fixture, the repaired file is unchanged: ${diff.join(' | ')}`);
	assert.deepEqual(stageLines(run(root, ['check']).stdout), []);
	assert.doesNotMatch(migrate(root).out, /would set/);
	assert.deepEqual(linesFor(run(root, ['check']).stdout, 'mid-build'), []);
});
