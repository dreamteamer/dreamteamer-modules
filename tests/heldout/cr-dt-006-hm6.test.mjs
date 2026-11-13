// held-out cr-dt-006-hm6 — install-contract over a workspace that already declares @dreamteamer/core: every
// small module core provides is refused naming core, tree hash unchanged; every other package installs with
// an honest status line. rnd/tests/cr-dt-006-hm6.
import { test, describe, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { virginWorkspace, packedInto, moduleIds, pkgOf, dt, cleanEnv, cleanup, tmp, skipUnless, treeHash, cloneWorkspace, statusLines } from './cr-dt-006-lib.mjs';

after(cleanup);
const PROVIDED = (pkgOf('core').dreamteamer.provides ?? []).map((n) => n.replace('@dreamteamer/', ''));

describe('hm6', { skip: skipUnless('core') }, () => {
	let base, from, env;
	before(() => {
		from = packedInto(tmp('dtm-from-'), ...moduleIds());
		base = virginWorkspace(); env = cleanEnv();
		const r = dt(base, ['install', '@dreamteamer/core', '--from', from, '--input', `files_folder=${path.join(env.HOME, 'files')}`, '--no-input'], env);
		assert.equal(r.code, 0, r.stderr + r.stdout.slice(-500));
	});
	test('core provides the twelve origins', () => {
		assert.deepEqual(PROVIDED.sort(), ['assets', 'companies', 'contacts', 'engagements', 'files', 'meeting-docs', 'meetings', 'projects', 'recordings', 'tasks', 'users', 'workflows']);
	});
	for (const m of moduleIds().filter((m) => m !== 'core')) {
		test(`${m} → ${PROVIDED.includes(m) ? 'refused: core provides it' : 'installs with an honest line'}`, () => {
			const root = cloneWorkspace(base);
			const e = { ...env, HOME: tmp('dtm-HOME-') };
			const before = treeHash(root);
			const r = dt(root, ['install', `@dreamteamer/${m}`, '--from', from, '--no-input'], e);
			if (PROVIDED.includes(m)) {
				assert.equal(r.code, 1, `${m}: exit ${r.code}\n${r.stdout.slice(-300)}${r.stderr}`);
				assert.match(r.stderr, new RegExp(`@dreamteamer/core already provides @dreamteamer/${m}`), r.stderr);
				assert.equal(treeHash(root), before, 'tree hash unchanged');
			} else {
				assert.ok(r.code === 0 || r.code === 3, `${m}: exit ${r.code}\n${r.stdout.slice(-300)}${r.stderr}`);
				const mine = statusLines(root, e).filter((l) => l.package === `@dreamteamer/${m}`);
				assert.ok(mine.length, `${m}: a status line`);
				assert.ok(mine.every((l) => ['configured', 'blocked', 'ready', 'no-setup', 'skipped'].includes(l.state)), `${m}: ${JSON.stringify(mine.map((l) => [l.unit, l.state]))}`);
			}
		});
	}
});
