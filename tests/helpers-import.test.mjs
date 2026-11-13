// The suites' helpers build and drive workspaces through the engine's own `dreamteamer/testing` (cr-dt-007,
// acceptance line 8, D69/D71): each helper imports it, none spawns the engine binary itself, and none
// builds a workspace with a private `init`. The helpers' own tar, git and npm spawns stay (D69) — the
// engine's testing contract carries no tarball listing and no git. Every suite imports these helpers,
// so this is the transitive proof that the suites run on `dreamteamer/testing`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers/workspace.mjs';

const HELPERS = ['tests/helpers/workspace.mjs', 'tests/helpers/fixture.mjs', 'modules/files/test/fixture.mjs', 'modules/notebooklm/test/fixture.mjs'];
// code only: a comment may describe what the helper no longer does
const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

describe('the helpers stand on dreamteamer/testing', () => {
	test('dreamteamer/testing resolves from this repo', () => {
		assert.ok(import.meta.resolve('dreamteamer/testing').endsWith('/src/testing.js'));
	});
	for (const f of HELPERS) {
		test(`${f}: imports it, spawns no engine binary, builds no workspace with its own init`, () => {
			const src = code(f);
			assert.match(src, /from 'dreamteamer\/testing'/, 'imports dreamteamer/testing');
			assert.doesNotMatch(src, /process\.execPath,\s*\[\s*(BIN|path\.join\([^)]*'bin',\s*'dreamteamer\.js'\))/, 'spawns the engine binary itself');
			assert.doesNotMatch(src, /\[\s*BIN\s*,/, 'spawns the engine binary itself');
			assert.doesNotMatch(src, /['"]init['"]/, 'runs init itself');
		});
	}
});
