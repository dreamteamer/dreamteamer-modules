// HELD-OUT (cr-modules-006-h6-engine-below-the-warning-channel): rnd's stage rule on an engine at the floor, below
// the warning channel (dreamteamer 0.42.0, before CHECK_WARNINGS): compile holds, dt check is silent — never a
// violation, never a stack trace — the migration runs or refuses in one line, and the extension's check returns
// nothing and opens no store. Installs dreamteamer@0.42.0 from the registry into a scratch folder (skipped,
// with a diagnostic, when the registry cannot be reached). Written by the test stage from the review's steps.
import { test, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { installCopied } from '../../../../tests/helpers/workspace.mjs';
import { RND, T, docRef } from './lib/cr-stage-records.mjs';

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); made.push(d); return d; };

let ENGINE = null;
try {
	const dir = tmp('h6-eng-');
	fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"h6","private":true}');
	execFileSync('npm', ['install', '--no-audit', '--no-fund', '--silent', 'dreamteamer@0.42.0'], { cwd: dir, stdio: 'pipe', timeout: 180_000 });
	ENGINE = path.join(dir, 'node_modules', 'dreamteamer');
} catch (e) { ENGINE = null; }

const dt = (root, args) => spawnSync(process.execPath, [path.join(ENGINE, 'bin', 'dreamteamer.js'), ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 });
const put = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };

test('h6 — the engine below the warning channel', { skip: ENGINE ? false : 'dreamteamer@0.42.0 could not be installed from the registry' }, async () => {
	assert.equal(JSON.parse(fs.readFileSync(path.join(ENGINE, 'package.json'), 'utf8')).version, '0.42.0');
	const root = tmp('h6-ws-');
	execFileSync('git', ['init', '-q'], { cwd: root });
	fs.mkdirSync(path.join(root, 'node_modules'));
	fs.symlinkSync(ENGINE, path.join(root, 'node_modules', 'dreamteamer'), 'dir');
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'probe', private: true, dependencies: { dreamteamer: '*' } }, null, '\t'));
	const init = dt(root, ['init', '--name', 'probe']);
	assert.equal(init.status, 0, init.stderr + init.stdout);
	fs.writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
	installCopied(root, ['rnd']);
	const comp = dt(root, ['compile']);
	assert.equal(comp.status, 0, `1: compile on 0.42.0\n${comp.stderr}${comp.stdout}`);

	put(root, 'data/rnd/products/p.product.md', '---\nname: P\n---\n');
	put(root, 'data/rnd/design-docs/2026-02-01--act.design-doc.md', '---\nname: act\nstatus: active\n---\n');
	const req = (id, extra) => put(root, `data/rnd/change-requests/${id}.change-request.md`, `---\nkey: ${id}\nname: ${id}\nproducts:\n  - rnd/products/p\nstatus: accepted\naccepted_on: '${T}'\ndesign_docs:\n  - ${docRef('act')}\n${extra}---\n`);
	req('wrong', 'stage: design-review\n');
	req('empty', '');
	req('contradiction', 'stage: done\n');
	put(root, 'data/rnd/implementation-plans/2026-02-01--c.implementation-plan.md', '---\nname: c\nchange_request: rnd/change-requests/contradiction\nstatus: abandoned\n---\n');
	for (const c of ['rnd/products', 'rnd/change-requests', 'rnd/design-docs', 'rnd/implementation-plans']) assert.equal(dt(root, ['relations', 'rebuild', c]).status, 0, c);

	const check = dt(root, ['check']);
	assert.equal(check.status, 0, `2: ${check.stdout}${check.stderr}`);
	assert.doesNotMatch(check.stdout + check.stderr, /stage.*\(@dreamteamer\/rnd\)/);
	assert.doesNotMatch(check.stdout + check.stderr, /check failed|^\s+at /m);

	const mig = (...a) => { const r = spawnSync(process.execPath, [path.join(root, 'modules/rnd/bin/migrate-change-request-stage.mjs'), ...a], { cwd: root, encoding: 'utf8', timeout: 120_000 }); return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' }; };
	const dry = mig();
	assert.doesNotMatch(dry.out + dry.err, /^\s+at /m, `3: no stack trace\n${dry.out}${dry.err}`);
	test.diagnostic?.(`3: the migration on 0.42.0 exits ${dry.code}: ${dry.out.trim().split('\n').join(' | ')}`);
	if (dry.code === 0) {
		assert.match(dry.out, /would set rnd\/change-requests\/wrong stage=plan \(was design-review\)/);
		assert.match(dry.out, /would set rnd\/change-requests\/empty stage=plan \(was empty\)/);
		JSON.parse(mig('--json').out);
		const w = mig('--write');
		assert.equal(w.code, 0, w.out + w.err);
		assert.match(fs.readFileSync(path.join(root, 'data/rnd/change-requests/wrong.change-request.md'), 'utf8'), /^stage: plan$/m);
		assert.equal(dt(root, ['check']).status, 0);
	} else {
		assert.equal(dry.code, 1);
		assert.equal(dry.out.trim().split('\n').length, 1, dry.out);
	}

	const api = await import(pathToFileURL(path.join(ENGINE, 'src', 'api.js')).href);
	assert.notEqual(api.CHECK_WARNINGS, true, 'below the warning channel');
	const { checkChangeRequestStage } = await import(pathToFileURL(path.join(root, 'modules/rnd/lib/cr-stage.mjs')).href);
	let opened = 0;
	const spy = { ...api, Store: class extends api.Store { constructor(...a) { super(...a); opened++; } } };
	const ws = await api.openWorkspace(root);
	assert.deepEqual(await checkChangeRequestStage({ ws, dt: spy }), []);
	assert.equal(opened, 0, '4: no store constructed');
});
