// THE STAGE MIGRATION — bin/migrate-change-request-stage.mjs fills `stage` on a workspace's own change
// requests from the gate `dt next` names on each, dry run first, and repairs one that drifted. A layer's
// requests are its own workspace's to migrate: counted and named, never written. A request with no gate
// open is reported with the stages its record allows, never guessed.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { rndWorkspace, layeredWorkspace, put, run, cleanupAll } from './helpers/rnd-workspace.mjs';
import { seedStates, settleAll } from './helpers/cr-stage-fixtures.mjs';

after(() => cleanupAll());

const RND = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BIN = path.join(RND, 'bin', 'migrate-change-request-stage.mjs');
const migrate = (root, ...args) => {
	const r = spawnSync(process.execPath, [BIN, '--root', root, ...args], { cwd: root, encoding: 'utf8', timeout: 120_000 });
	return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
};
const crFile = (root, id) => path.join(root, `data/rnd/change-requests/${id}.change-request.md`);
const snapshot = (root) => Object.fromEntries(fs.readdirSync(path.join(root, 'data/rnd/change-requests')).map((f) => [f, fs.readFileSync(path.join(root, 'data/rnd/change-requests', f), 'utf8')]));
const ALLOWED = 'plan-review · implement · code-review · test';

/** Four requests with a gate open and no stage, and one accepted request whose plan was abandoned. */
function fixture() {
	const root = rndWorkspace();
	seedStates(root, { states: ['design', 'plan', 'code-review', 'done', 'implement'], stageOf: () => undefined });
	fs.writeFileSync(path.join(root, 'data/rnd/implementation-plans/2026-01-01--plan-s-implement.implementation-plan.md'), '---\nname: p\nchange_request: rnd/change-requests/s-implement\nstatus: abandoned\n---\n');
	settleAll(root);
	return root;
}

describe('migrate-change-request-stage', () => {
	test('dry run: lists what it would set and what it cannot tell, and writes nothing', () => {
		const root = fixture();
		const before = snapshot(root);
		const r = migrate(root);
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /would set rnd\/change-requests\/s-design stage=design \(was empty\)/);
		assert.match(r.out, /would set rnd\/change-requests\/s-plan stage=plan \(was empty\)/);
		assert.match(r.out, /would set rnd\/change-requests\/s-code-review stage=code-review \(was empty\)/);
		assert.match(r.out, /would set rnd\/change-requests\/s-done stage=done \(was empty\)/);
		assert.match(r.out, new RegExp(`cannot tell rnd/change-requests/s-implement: no gate open \\(status accepted\\) — the record allows ${ALLOWED}; set stage by hand`));
		assert.match(r.out, /4 to set — run again with --write/);
		assert.deepEqual(snapshot(root), before, 'nothing written');
	});

	test('--write fills them; a second run finds nothing; dt check is left with the one reported request', () => {
		const root = fixture();
		const w = migrate(root, '--write');
		assert.equal(w.code, 0, w.out);
		assert.match(w.out, /4 set/);
		for (const [id, s] of [['s-design', 'design'], ['s-plan', 'plan'], ['s-code-review', 'code-review'], ['s-done', 'done']]) {
			assert.match(fs.readFileSync(crFile(root, id), 'utf8'), new RegExp(`^stage: ${s}$`, 'm'), id);
		}
		assert.doesNotMatch(fs.readFileSync(crFile(root, 's-implement'), 'utf8'), /^stage:/m);
		const again = migrate(root);
		assert.equal(again.code, 0, again.out);
		assert.doesNotMatch(again.out, /would set/);
		assert.match(again.out, /nothing to set/);
		const c = run(root, ['check']);
		assert.equal(c.status, 0, c.stdout + c.stderr);
		const lines = c.stdout.split('\n').filter((l) => /— stage /.test(l));
		assert.equal(lines.length, 1, lines.join('\n'));
		assert.match(lines[0], new RegExp(`s-implement\\.change-request\\.md — stage is empty and no gate is open — the record allows ${ALLOWED}`));
	});

	test('a drifted stage with a gate open is repaired; one the record contradicts with no gate open is named, with the stages allowed', () => {
		const root = fixture();
		fs.writeFileSync(crFile(root, 's-plan'), fs.readFileSync(crFile(root, 's-plan'), 'utf8').replace('---\n', '---\nstage: test\n'));
		fs.writeFileSync(crFile(root, 's-implement'), fs.readFileSync(crFile(root, 's-implement'), 'utf8').replace(/\n---\n?$/, '\nstage: done\n---\n'));
		const r = migrate(root);
		assert.match(r.out, /would set rnd\/change-requests\/s-plan stage=plan \(was test\)/);
		assert.match(r.out, new RegExp(`cannot tell rnd/change-requests/s-implement: stage done contradicts the record \\(done needs status implemented \\(status is accepted\\)\\) — the record allows ${ALLOWED}; set stage to one of them`));
	});

	test('refuses on a workspace whose compiled rnd has no stage field, writing nothing', () => {
		const { layer } = layeredWorkspace({ layerStage: false });
		put(layer, 'data/rnd/products/p.product.md', '---\nname: P\n---\n');
		put(layer, 'data/rnd/change-requests/x.change-request.md', '---\nkey: x\nname: x\nproducts:\n  - rnd/products/p\nstatus: suggested\n---\n');
		const before = snapshot(layer);
		const r = migrate(layer, '--write');
		assert.equal(r.code, 1, r.out);
		assert.match(r.out, /run dt compile first: the compiled rnd\/change-requests has no stage field\. nothing was written\./);
		assert.deepEqual(snapshot(layer), before);
	});

	test('a layer\'s requests are counted and named, never written', () => {
		const { reader, layer } = layeredWorkspace({ layerStage: false });
		put(reader, 'data/rnd/change-requests/own.change-request.md', '---\nkey: own\nname: own\nproducts:\n  - rnd/products/p\nstatus: suggested\n---\n');
		seedStates(layer, { prefix: 'l', states: ['design', 'plan'], stageOf: () => undefined });
		settleAll(reader);
		const before = snapshot(layer);
		const r = migrate(reader, '--write');
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /set rnd\/change-requests\/own stage=design/);
		assert.match(r.out, /lay: 2 change requests held by the layer — migrate them in its own workspace \(--root git_modules\/lay\) once it is on this rnd/);
		assert.deepEqual(snapshot(layer), before, 'the layer is not written');
		const c = run(reader, ['check']);
		assert.equal(c.status, 0, c.stdout + c.stderr);
		assert.doesNotMatch(c.stdout, /— stage /);
	});

	test('--json', () => {
		const root = fixture();
		const r = migrate(root, '--json');
		assert.equal(r.code, 0, r.out);
		const j = JSON.parse(r.out);
		assert.deepEqual(j.planned.map((p) => p.id).sort(), ['s-code-review', 's-design', 's-done', 's-plan']);
		assert.deepEqual(j.cannot_tell.map((p) => p.id), ['s-implement']);
		assert.deepEqual(j.set, []);
		assert.deepEqual(j.layers, {});
		assert.deepEqual(j.failed, []);
	});
});
