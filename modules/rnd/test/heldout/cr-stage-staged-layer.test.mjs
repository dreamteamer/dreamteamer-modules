// HELD-OUT (cr-modules-006-h4-staged-layer-judged-like-own): a layer whose home has the field, read from a reader —
// every staged layer request judged by the same rules as the reader's own; an unstaged one left to its home; the
// reader's migration never writes the layer; the layer's own migration fills it. The layer is built here, not
// with the builder's layeredWorkspace. Written by the test stage from the review's steps.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { rndWorkspace, run, cleanupAll } from '../helpers/rnd-workspace.mjs';
import { product, doc, plan, req, reqFile, settle, linesFor, migrate, accepted, designs, bytes } from './lib/cr-stage-records.mjs';

after(() => cleanupAll());
const GENV = { ...process.env, GIT_AUTHOR_NAME: 'probe', GIT_AUTHOR_EMAIL: 'probe@example.invalid', GIT_COMMITTER_NAME: 'probe', GIT_COMMITTER_EMAIL: 'probe@example.invalid' };
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: GENV });
const msg = (line) => line.replace(/^.*?\.change-request\.md — /, '');

test('h4 — a staged layer is judged like the reader\'s own', () => {
	const reader = rndWorkspace();
	const lay = path.join(reader, 'git_modules', 'lay');
	fs.mkdirSync(path.dirname(lay), { recursive: true });
	fs.cpSync(rndWorkspace(), lay, { recursive: true, verbatimSymlinks: true });
	fs.rmSync(path.join(lay, '.git'), { recursive: true, force: true });
	git(lay, 'init', '-q');
	product(lay);
	doc(lay, 'act', 'active');
	req(lay, 'lay-right', [...accepted, designs('act'), 'stage: implement']);
	plan(lay, 'lay-right', 'lay-right', 'approved');
	req(lay, 'lay-gate-wrong', [...accepted, designs('act'), 'stage: design-review']);
	req(lay, 'lay-contradiction', [...accepted, designs('act'), 'stage: done']);
	plan(lay, 'lay-contradiction', 'lay-contradiction', 'abandoned');
	req(lay, 'lay-empty', [...accepted, designs('act')]);
	settle(lay, ['--workspace', lay]);
	git(lay, 'add', '-A');
	git(lay, 'commit', '-qm', 'layer');
	const pf = path.join(reader, 'package.json');
	const pkg = JSON.parse(fs.readFileSync(pf, 'utf8'));
	pkg.dreamteamer.git_modules = { lay: { url: 'https://example.invalid/lay.git', ref: 'main', records: ['rnd/change-requests', 'rnd/products', 'rnd/design-docs', 'rnd/implementation-plans', 'rnd/tests'] } };
	fs.writeFileSync(pf, JSON.stringify(pkg, null, '\t') + '\n');
	assert.equal(run(reader, ['compile']).status, 0);
	req(reader, 'own-gate-wrong', [...accepted, designs('act'), 'stage: design-review']);
	req(reader, 'own-contradiction', [...accepted, designs('act'), 'stage: done']);
	plan(reader, 'own-contradiction', 'own-contradiction', 'abandoned');
	settle(reader);

	const c = run(reader, ['check']);
	assert.equal(c.status, 0, c.stdout + c.stderr);
	assert.deepEqual(linesFor(c.stdout, 'lay-right'), []);
	const lgw = linesFor(c.stdout, 'lay-gate-wrong');
	assert.equal(lgw.length, 1);
	assert.match(lgw[0], /⚠ git_modules\/lay\/data\/rnd\/change-requests\/lay-gate-wrong\.change-request\.md — stage is design-review but the record is at plan — dt next names \/rnd:plan; set stage=plan \(@dreamteamer\/rnd\)/);
	const lc = linesFor(c.stdout, 'lay-contradiction');
	assert.equal(lc.length, 1);
	assert.match(lc[0], /done needs status implemented/);
	assert.deepEqual(linesFor(c.stdout, 'lay-empty'), [], 'D11: a layer request with no stage is its home\'s');
	assert.equal(msg(linesFor(c.stdout, 'own-gate-wrong')[0]), msg(lgw[0]));
	assert.equal(msg(linesFor(c.stdout, 'own-contradiction')[0]), msg(lc[0]));

	const files = ['lay-right', 'lay-gate-wrong', 'lay-contradiction', 'lay-empty'].map((id) => reqFile(lay, id));
	const before = files.map(bytes);
	const w = migrate(reader, { args: ['--write'] });
	assert.equal(w.code, 0, w.out + w.err);
	assert.match(w.out, /set rnd\/change-requests\/own-gate-wrong stage=plan/);
	assert.doesNotMatch(w.out, /set rnd\/change-requests\/own-contradiction stage=/);
	assert.match(w.out, /cannot tell rnd\/change-requests\/own-contradiction: .* — the record allows /);
	assert.match(w.out, /lay: 4 change requests held by the layer — migrate them in its own workspace \(--root git_modules\/lay\)/);
	assert.equal(git(lay, 'status', '--porcelain'), '');
	assert.deepEqual(files.map(bytes), before);

	const l = migrate(lay, { cwd: reader, args: ['--root', 'git_modules/lay', '--write'] });
	assert.equal(l.code, 0, l.out + l.err);
	assert.match(fs.readFileSync(reqFile(lay, 'lay-gate-wrong'), 'utf8'), /^stage: plan$/m);
	assert.match(fs.readFileSync(reqFile(lay, 'lay-empty'), 'utf8'), /^stage: plan$/m);
	const c2 = run(reader, ['check']);
	assert.deepEqual(linesFor(c2.stdout, 'lay-gate-wrong'), []);
	assert.deepEqual(linesFor(c2.stdout, 'lay-empty'), []);
	assert.equal(linesFor(c2.stdout, 'lay-contradiction').length, 1);
	assert.equal(linesFor(c2.stdout, 'own-contradiction').length, 1);
	assert.equal(c2.stdout.split('\n').filter((x) => /— stage /.test(x)).length, 2, c2.stdout);
});
