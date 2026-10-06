// The `dt files` dispatch: switches never swallow a positional, and only registered subcommands run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../../../node_modules/dreamteamer/src/api.js';
import { bind } from '../src/engine.js';
import { filesCommand, normalizeArgs } from '../src/cli.js';

test('a positional after a switch goes back to pos', () => {
	const argv = ['sync', '--dry-run', 'drive/rnd'];
	assert.deepEqual(normalizeArgs(parseArgs(argv)), { flags: { 'dry-run': true }, pos: ['sync', 'drive/rnd'] });
	assert.deepEqual(normalizeArgs(parseArgs(argv), argv), { flags: { 'dry-run': true }, pos: ['sync', 'drive/rnd'] });
});

test('a leading switch does not take the subcommand', () => {
	const r = normalizeArgs(parseArgs(['--json', 'status']));
	assert.deepEqual(r.pos, ['status']);
	assert.equal(r.flags.json, true);
});

test('given argv, a recovered word keeps its typed position', () => {
	const argv = ['--json', 'sync', 'drive'];
	assert.deepEqual(normalizeArgs(parseArgs(argv), argv), { flags: { json: true }, pos: ['sync', 'drive'] });
});

test('a trailing switch is left as it is', () => {
	assert.deepEqual(normalizeArgs(parseArgs(['sync', 'drive', '--hash'])), { flags: { hash: true }, pos: ['sync', 'drive'] });
});

test('the input is not changed', () => {
	const parsed = parseArgs(['sync', '--prune', 'drive']);
	normalizeArgs(parsed);
	assert.deepEqual(parsed, { flags: { prune: 'drive' }, pos: ['sync'] });
});

test('filesCommand dispatches to a registered handler, and refuses everything else', async () => {
	bind({ parseArgs });
	let seen = null;
	filesCommand.handlers.ping = (ws, pos, flags) => { seen = { pos, flags }; return 0; };
	const errors = [];
	const original = console.error;
	console.error = (...a) => { errors.push(a.join(' ')); };
	try {
		assert.equal(await filesCommand({}, ['ping', '--json', 'x']), 0);
		assert.deepEqual(seen, { pos: ['x'], flags: { json: true } });
		assert.equal(await filesCommand({}, ['--json', 'ping', 'y']), 0);
		assert.deepEqual(seen.pos, ['y']);
		assert.equal(await filesCommand({}, ['nope']), 2);
		assert.equal(await filesCommand({}, []), 2);
		assert.equal(await filesCommand({}, ['constructor']), 2);
		assert.equal(await filesCommand({}, ['toString']), 2);
	} finally {
		console.error = original;
		delete filesCommand.handlers.ping;
	}
	assert.ok(errors.some((e) => e.includes('unknown subcommand "constructor"')));
	assert.ok(errors.some((e) => e.includes('a subcommand is needed')));
});
