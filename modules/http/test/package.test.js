// The package as a module: importing it is inert, activation binds the engine and contributes one
// verb, and the verb's flags are the only ones it takes.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { api, packageDir, SPAWN_TIMEOUT_MS } from '../../../tests/helpers/fixture.mjs';
import activate, { apiVersion, parseServeArgs } from '../src/extension.js';

const SRC = path.join(packageDir('http'), 'src');

describe('importing the package', () => {
	test('binds no port and prints nothing — the process exits on its own, silently', () => {
		// an open listener would keep the event loop alive; the hard timeout turns that into a failure
		const script = `
			await import(${JSON.stringify(pathToFileURL(path.join(SRC, 'app.js')).href)});
			const ext = await import(${JSON.stringify(pathToFileURL(path.join(SRC, 'extension.js')).href)});
			const dt = await import(${JSON.stringify(pathToFileURL(path.join(api.engineRoot, 'src', 'api.js')).href)});
			ext.default(dt);
		`;
		const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
		assert.equal(r.signal, null, 'the process exited by itself rather than being killed by the timeout');
		assert.equal(r.status, 0, r.stderr);
		assert.equal(r.stdout, '');
		assert.equal(r.stderr, '');
	});
});

describe('activate(dt)', () => {
	test('targets extension API 1 and contributes exactly the serve verb', () => {
		assert.equal(apiVersion, 1);
		const c = activate(api);
		assert.deepEqual(Object.keys(c), ['commands']);
		assert.deepEqual(Object.keys(c.commands), ['serve']);
		assert.equal(typeof c.commands.serve.run, 'function');
		assert.match(c.commands.serve.usage, /serve \[--port <n>\] \[--host <addr>\]/);
	});
});

describe('dt serve flags', () => {
	test('defaults to loopback on 8080', () => {
		assert.deepEqual(parseServeArgs([]), { port: 8080, host: '127.0.0.1' });
	});
	test('--port and --host, spaced or with =', () => {
		assert.deepEqual(parseServeArgs(['--port', '0', '--host', '::1']), { port: 0, host: '::1' });
		assert.deepEqual(parseServeArgs(['--port=3000', '--host=0.0.0.0']), { port: 3000, host: '0.0.0.0' });
	});
	test('an unknown flag or a positional is refused, naming the usage', () => {
		assert.throws(() => parseServeArgs(['--admin']), /does not take "--admin".*dt serve \[--port <n>\] \[--host <addr>\]/);
		assert.throws(() => parseServeArgs(['3000']), /does not take "3000"/);
	});
	test('a missing or malformed value is refused', () => {
		assert.throws(() => parseServeArgs(['--port']), /--port needs a value/);
		assert.throws(() => parseServeArgs(['--port', '--host', 'x']), /--port needs a value/);
		assert.throws(() => parseServeArgs(['--port', 'abc']), /--port must be a number/);
		assert.throws(() => parseServeArgs(['--port', '70000']), /--port must be a number/);
		assert.throws(() => parseServeArgs(['--host=']), /--host needs a value/);
	});
});
