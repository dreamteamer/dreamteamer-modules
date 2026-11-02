// The UI's own suites, run from the repo's runner: the logic tier and the render tier (scripts/test.mjs,
// esbuild + Vue's compiler, no browser) and the types (vue-tsc). Each is a child with a timeout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('the logic and render tiers pass', { timeout: 300_000 }, () => {
	const r = spawnSync(process.execPath, ['scripts/test.mjs'], { cwd: UI, encoding: 'utf8', timeout: 280_000 });
	assert.equal(r.status, 0, `${r.stdout.slice(-4000)}\n${r.stderr.slice(-2000)}`);
});

test('the source typechecks', { timeout: 300_000 }, () => {
	const bin = path.join(path.dirname(require.resolve('vue-tsc/package.json')), 'bin', 'vue-tsc.js');
	const r = spawnSync(process.execPath, [bin, '--noEmit', '-p', 'src/tsconfig.json'], { cwd: UI, encoding: 'utf8', timeout: 280_000 });
	assert.equal(r.status, 0, `${r.stdout.slice(-4000)}\n${r.stderr.slice(-2000)}`);
});
