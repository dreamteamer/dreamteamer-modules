// dt-nav migrate (cr-dt-008, task 11; rnd/tests dreamteamer-modules/dt-nav-migrate).
//
// The one command that writes a workspace's old nav settings into nav.yaml, for a person who uses neither the editor
// nor dt web: `npx -p @dreamteamer/protocol@0.2 dt-nav migrate [root]`. It loads the WORKSPACE's own engine, so on
// an engine that merges nav fragments (0.49) it applies them after writing and says so, and on an older one it does
// not. No settings: nothing to migrate, exit 0. No workspace: ✖ and exit 1. An unknown subcommand: usage, exit 2.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import { ENGINE_DIR, ROOT } from '../../../tests/helpers/fixture.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(PKG, 'bin', 'dt-nav.mjs');
const { makeFixture } = await import(pathToFileURL(path.join(PKG, 'lib', 'contract', 'fixture.js')).href);
const { meetsFloor } = await import(pathToFileURL(path.join(PKG, 'src', 'host', 'floor.js')).href);

const PUBLISHED = fs.realpathSync(path.join(ROOT, 'node_modules', 'dreamteamer'));
const versionOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
const CANDIDATE = meetsFloor(versionOf(ENGINE_DIR), '0.49.0');

const fixtures = [];
after(() => { for (const f of fixtures) f.cleanup(); });

const dtNav = (args, cwd = PKG) => {
	const r = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', timeout: 60_000 });
	return { code: r.status, out: `${r.stdout}${r.stderr}` };
};

/** A fixture on one engine with old nav settings and no nav.yaml, and a twin of it (the same files) for a second run. */
function withSettings(engineDir) {
	const f = makeFixture({ engineDir });
	fixtures.push(f);
	fs.mkdirSync(path.join(f.root, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(f.root, '.vscode', 'settings.json'), '{\n\t"dreamteamer.navOrder": ["tasks", "lab"],\n\t"dreamteamer.navHidden": ["projects"],\n}\n');
	return f;
}

const engines = [['the published engine', PUBLISHED, false], ...(CANDIDATE ? [['the candidate', ENGINE_DIR, true]] : [])];
for (const [label, engineDir, fragments] of engines) {
	test(`on ${label} (${versionOf(engineDir)}): dt-nav migrate writes nav.yaml${fragments ? ' and applies the fragments' : ', no fragments'}`, { timeout: 180_000 }, () => {
		const f = withSettings(engineDir);
		const twin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-nav-twin-')));
		fs.cpSync(f.root, twin, { recursive: true, verbatimSymlinks: true });
		fixtures.push({ cleanup: () => fs.rmSync(twin, { recursive: true, force: true }) });
		// a workspace npm installed carries a lockfile, which is what the walk up from a folder stops at (the fixture
		// links its engine and never runs npm)
		fs.writeFileSync(path.join(twin, 'package-lock.json'), '{ "lockfileVersion": 3 }\n');

		const r = dtNav(['migrate', f.root]);
		assert.equal(r.code, 0, r.out);
		assert.match(r.out, /✔ nav\.yaml written from your nav settings/);
		assert.equal(/fragments applied/.test(r.out), fragments, r.out);
		const doc = yaml.load(fs.readFileSync(path.join(f.root, 'nav.yaml'), 'utf8'));
		assert.equal(doc.tree[0], 'tasks', JSON.stringify(doc));
		assert.ok(doc.tree.some((e) => e && e.namespace === 'lab'), JSON.stringify(doc));
		assert.deepEqual(doc.hidden, ['projects']);

		// the report, as data: from the workspace root found by walking up from a folder inside it
		const j = dtNav(['migrate', '--json'], path.join(twin, 'data'));
		assert.equal(j.code, 0, j.out);
		assert.deepEqual(JSON.parse(j.out), { written: true, fragments });

		const again = dtNav(['migrate', f.root]);
		assert.equal(again.code, 0, again.out);
		assert.match(again.out, /nothing to migrate/);
	});
}

test('a workspace with no nav settings: nothing to migrate, exit 0, no file', { timeout: 180_000 }, () => {
	const f = makeFixture({ engineDir: ENGINE_DIR });
	fixtures.push(f);
	const r = dtNav(['migrate', f.root]);
	assert.equal(r.code, 0, r.out);
	assert.match(r.out, /nothing to migrate/);
	assert.equal(fs.existsSync(path.join(f.root, 'nav.yaml')), false);
});

test('a folder with no workspace: ✖ and exit 1; an unknown subcommand: usage and exit 2', () => {
	const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dt-nav-none-')));
	fixtures.push({ cleanup: () => fs.rmSync(empty, { recursive: true, force: true }) });
	const r = dtNav(['migrate', empty]);
	assert.equal(r.code, 1, r.out);
	assert.match(r.out, /^✖ /m);
	const u = dtNav(['tidy']);
	assert.equal(u.code, 2, u.out);
	assert.match(u.out, /usage: dt-nav migrate/);
});
