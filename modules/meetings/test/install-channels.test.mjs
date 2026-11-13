// THE PLANNED COMMAND EXISTS, HOWEVER THE MODULE ARRIVED. The setup reference tells an agent to run a
// plan's `command` argv as given, so that argv must name the script actually installed: the direct npm
// package, an inline copy under modules/, or the composed `@dreamteamer/core` (where the script is
// `bin/meetings-setup.mjs` and no `@dreamteamer/meetings` package exists). Each case installs the
// packed or copied module into a fresh `dreamteamer init` workspace (a Git repository), plans from the
// path its SETUP.md names, then executes the generated argv. Synthetic rows; no account is touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { virginWorkspace, installPacked, installCopied, closure, packedFiles, cleanup } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const ROW = 'team@northwind.example | northwind | dana@northwind.example';

/** Keep .env out of Git the way a person would, if init did not already; and leave the lockfile a real
 *  `npm install` writes, which is how a module script finds its workspace (house rule 6). */
function ignoreEnv(root) {
	if (!fs.existsSync(path.join(root, 'package-lock.json'))) fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
	const f = path.join(root, '.gitignore');
	const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
	if (!/^\.env$/m.test(text)) fs.writeFileSync(f, `${text}${text && !text.endsWith('\n') ? '\n' : ''}.env\n`);
}
const node = (root, argv) => spawnSync(process.execPath, argv, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root } });

/** Plan through `script`, run the planned argv, and prove the second plan is a no-op. */
function roundTrip(root, script) {
	assert.ok(fs.existsSync(path.join(root, script)), `${script} is not installed`);
	const planned = node(root, [script, 'plan', '--row', ROW, '--json']);
	assert.equal(planned.status, 0, planned.stderr);
	const step = JSON.parse(planned.stdout).actions.find((a) => a.id === 'add-calendar-rows');
	assert.equal(step.state, 'ready', step.reason);
	assert.equal(step.preview.vcs, 'git');
	assert.equal(step.command[0], 'node');
	assert.equal(path.resolve(root, step.command[1]), path.resolve(root, script), 'the argv names the installed script');
	const applied = node(root, step.command.slice(1));
	assert.equal(applied.status, 0, applied.stdout + applied.stderr);
	assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /^WORK_CALENDARS="team@northwind\.example \| northwind \| dana@northwind\.example"$/m);
	assert.match(fs.readFileSync(path.join(root, '.env'), 'utf8'), /^FILES_FOLDER=/m, 'the keys init wrote are kept');
	const again = JSON.parse(node(root, [script, 'plan', '--row', ROW, '--json']).stdout).actions.find((a) => a.id === 'add-calendar-rows');
	assert.equal(again.state, 'done');
	return step;
}

test('direct npm install: the package script', () => {
	const root = virginWorkspace();
	installPacked(root, [...closure('meetings')]);
	ignoreEnv(root);
	assert.ok(packedFiles('meetings').includes('SETUP.md'));
	roundTrip(root, 'node_modules/@dreamteamer/meetings/bin/setup.mjs');
});

test('inline copy under modules/: the copied script', () => {
	const root = virginWorkspace();
	installCopied(root, [...closure('meetings')]);
	ignoreEnv(root);
	const step = roundTrip(root, 'modules/meetings/bin/setup.mjs');
	assert.equal(step.command[1], 'modules/meetings/bin/setup.mjs');
});

test('core only: the packed core ships a root SETUP.md that routes to its composed meetings script, and that argv runs', () => {
	const root = virginWorkspace();
	installPacked(root, [...closure('core')]);
	ignoreEnv(root);
	assert.ok(!fs.existsSync(path.join(root, 'node_modules', '@dreamteamer', 'meetings')), 'no separate meetings package');
	assert.ok(packedFiles('core').includes('SETUP.md'));
	const reference = fs.readFileSync(path.join(root, 'node_modules', '@dreamteamer', 'core', 'SETUP.md'), 'utf8');
	assert.match(reference, /composed from meetings/);
	const named = /`node (node_modules\/@dreamteamer\/core\/bin\/meetings-setup\.mjs) inspect/.exec(reference)?.[1];
	assert.ok(named, 'the reference names core\'s own script');
	assert.doesNotMatch(reference, /@dreamteamer\/meetings\/bin/);
	const step = roundTrip(root, named);
	assert.equal(step.command[1], named);
});
