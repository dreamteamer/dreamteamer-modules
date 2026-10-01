// Review F6 — machine-readable output larger than a pipe buffer. The engine's dispatcher calls
// `process.exit` the moment a command returns, and `console.log` to a PIPE is asynchronous, so a JSON
// document past ~64 KiB was cut mid-string at exit 0. `dt.emit` writes synchronously; these pin that
// every `--json` answer arrives whole through a real child-process pipe (spawnSync is one).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspace, writeProof } from '../helpers.mjs';

describe('large --json answers arrive whole through a pipe', () => {
	test('dt prove --list --json: a proof whose description alone is 250,000 characters', () => {
		const ws = workspace({ compile: false });
		const long = `${'x'.repeat(249_990)}THE-END`;
		writeProof(ws.root, 'long-one', { description: long });
		writeProof(ws.root, 'short-one');
		assert.equal(ws.dt('compile').code, 0);
		const r = ws.dt('prove', '--list', '--json');
		assert.equal(r.code, 0, r.stderr);
		assert.ok(r.stdout.length > 250_000, `stdout is only ${r.stdout.length} bytes`);
		const doc = JSON.parse(r.stdout); // throws on a truncated document
		assert.equal(doc.proofs.length, 2);
		const row = doc.proofs.find((p) => p.id === 'long-one' || p.name === 'long-one');
		assert.ok(row, JSON.stringify(doc.proofs.map((p) => p.id ?? p.name)));
		assert.ok(JSON.stringify(row).includes('THE-END'), 'the last field of the long row was cut');
	});

	test('dt prove --list --missing --json: more unproven artifacts than one pipe buffer holds', () => {
		const ws = workspace({ compile: false });
		const dir = path.join(ws.root, 'modules', 'default', 'commands');
		fs.mkdirSync(dir, { recursive: true });
		const n = 900;
		for (let i = 0; i < n; i++) {
			const id = `a-command-with-a-deliberately-long-name-so-the-listing-grows-${String(i).padStart(4, '0')}`;
			fs.writeFileSync(path.join(dir, `${id}.command.md`), `---\nname: ${id}\ndescription: one of many\n---\n\nDo it.\n`);
		}
		assert.equal(ws.dt('compile').code, 0);
		const r = ws.dt('prove', '--list', '--missing', '--json');
		assert.equal(r.code, 0, r.stderr);
		assert.ok(r.stdout.length > 70_000, `stdout is only ${r.stdout.length} bytes — the fixture no longer crosses a pipe buffer`);
		const missing = JSON.parse(r.stdout);
		const commands = missing.filter((m) => String(m.ref ?? m).startsWith('commands/'));
		assert.equal(commands.length, n);
		assert.ok(JSON.stringify(missing).includes(`listing-grows-${String(n - 1).padStart(4, '0')}`), 'the last entry was cut');
	});
});
