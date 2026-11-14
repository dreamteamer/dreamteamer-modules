// THE CALENDAR ROWS LAND HOWEVER THE MODULE ARRIVED. Since cr-dt-007 the rows are an env action the engine
// writes — `dt setup meetings --input calendar=<row>` — so there is no module script to name per channel:
// the direct npm package, an inline copy under modules/, and `@dreamteamer/core` (a module preset whose
// members include meetings) all go through the one engine verb. Each case installs the packed or copied module into a fresh workspace (a
// Git repository), runs the verb, and proves a second run is a no-op. Synthetic rows; no account touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { virginWorkspace, installPacked, installCopied, closure, packedFiles, pkgOf, run, cleanup, engineMeets, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';

after(cleanup);
const ROW = 'team@northwind.example | northwind | dana@northwind.example';

/** Keep .env out of Git the way a person would, if init did not already. */
function ignoreEnv(root) {
	const f = path.join(root, '.gitignore');
	const text = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
	if (!/^\.env$/m.test(text)) fs.writeFileSync(f, `${text}${text && !text.endsWith('\n') ? '\n' : ''}.env\n`);
}

/** Compile, set the rows through the engine, and prove the second run writes nothing. */
function roundTrip(root) {
	const c = run(root, ['compile']);
	assert.equal(c.status, 0, c.stderr);
	const env = { HOME: root };
	const r = run(root, ['setup', 'meetings', '--input', `calendar=${ROW}`, '--no-input'], env);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /✔ add-calendar-rows — wrote \.env \(WORK_CALENDARS\)/);
	const text = fs.readFileSync(path.join(root, '.env'), 'utf8');
	assert.match(text, /^WORK_CALENDARS="team@northwind\.example \| northwind \| dana@northwind\.example"$/m);
	assert.match(text, /^FILES_FOLDER=/m, 'the keys the fixture wrote are kept');
	const again = run(root, ['setup', 'meetings', '--input', `calendar=${ROW}`, '--no-input'], env);
	assert.equal(again.status, 0);
	assert.doesNotMatch(again.stdout, /✔ add-calendar-rows/, 'nothing written the second time');
	assert.equal(fs.readFileSync(path.join(root, '.env'), 'utf8'), text);
}

test('direct npm install', () => {
	const root = virginWorkspace();
	installPacked(root, [...closure('meetings')]);
	ignoreEnv(root);
	assert.ok(packedFiles('meetings').includes('SETUP.md'));
	assert.ok(!packedFiles('meetings').includes('bin/setup.mjs'), 'the dt-setup-era script is gone (D70)');
	roundTrip(root);
});

test('inline copy under modules/', () => {
	const root = virginWorkspace();
	installCopied(root, [...closure('meetings')]);
	ignoreEnv(root);
	roundTrip(root);
});

test('core: the preset brings meetings as a member, and dt setup meetings writes the rows', { skip: !engineMeets('core') && `core is a module preset, read by engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}` }, () => {
	const root = virginWorkspace();
	assert.ok(closure('core').has('meetings'), 'core\'s preset does not bring meetings');
	installPacked(root, [...closure('core')]);
	ignoreEnv(root);
	assert.ok(fs.existsSync(path.join(root, 'node_modules', '@dreamteamer', 'meetings', 'SETUP.md')), 'meetings arrives as its own package, with its SETUP.md');
	assert.ok(!packedFiles('core').includes('SETUP.md'), 'core ships no SETUP.md of its own');
	roundTrip(root);
});
