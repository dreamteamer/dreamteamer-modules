// @dreamteamer/setup IS GONE (cr-dt-007, D70): `dt status` / `dt doctor` / `dt setup` are the engine's
// since 0.47, and the bundle preview it carried is `scripts/preview.mjs`. No shipped file, doc or script
// may still send a reader to `dt-setup` or to the package. What may still name it: UPDATING.md entries
// (history — what a release changed), tests asserting it is absent, and the preview's legacy hook marker,
// which recognises a hook an older install wrote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { ROOT } from './helpers/workspace.mjs';

const ALLOWED = [/(^|\/)UPDATING\.md$/, /(^|\/)tests?\//, /^scripts\/preview\/link\.mjs$/];

test('no file outside UPDATING history and the tests of its absence names dt-setup or @dreamteamer/setup', () => {
	const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
	assert.ok(files.length > 100, 'git ls-files listed the repo');
	let hits = [];
	try {
		hits = execFileSync('git', ['grep', '-n', '-E', 'dt-setup|@dreamteamer/setup\\b|modules/setup/', '--', '.', ':!package-lock.json'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
	} catch (e) { if (e.status !== 1) throw e; }
	const stray = hits.filter((h) => !ALLOWED.some((re) => re.test(h.split(':')[0])));
	assert.deepEqual(stray, []);
});
