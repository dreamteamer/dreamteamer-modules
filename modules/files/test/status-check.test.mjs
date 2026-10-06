import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api } from './fixture.mjs';
import { driveWorkspace } from './helpers.mjs';
import { doctorFiles } from '../src/status.js';
import { checkFiles } from '../src/check.js';
import { bind } from '../src/engine.js';

bind(api);

test('dt files status: one row per drive, mounted or not, with the counts', () => {
	const { ws } = driveWorkspace();
	assert.equal(ws.dt('add', 'file-drives', 'Nowhere', '--path', '${env:NOWHERE}').code, 0);
	assert.equal(ws.dt('files', 'sync').code, 0);
	const r = ws.dt('files', 'status', '--json');
	assert.equal(r.code, 0, r.stderr);
	const rows = JSON.parse(r.stdout).drives;
	const d = rows.find((x) => x.id === 'drive'); const n = rows.find((x) => x.id === 'nowhere');
	assert.equal(d.exists, true); assert.equal(d.entries, 10); assert.equal(d.missing, 0); assert.equal(d.cloudOnly, 0);
	assert.match(d.last_synced, /^\d{4}-/);
	assert.equal(n.path, null); assert.match(n.skipped, /not declared/);
	const text = ws.dt('files', 'status');
	assert.match(text.stdout, /drive .*10 entries/); assert.match(text.stdout, /nowhere .*not declared/);
});

test('doctor: an unresolved drive is bad with a fix, a never-synced one warns, a synced one is ok', async () => {
	const { ws } = driveWorkspace();
	assert.equal(ws.dt('add', 'file-drives', 'Nowhere', '--path', '${env:NOWHERE}').code, 0);
	const wsHandle = await ws.open();
	let rows = await doctorFiles({ root: ws.root, ws: wsHandle, dt: api });
	assert.equal(rows.find((r) => r.label === 'drive nowhere').state, 'bad');
	assert.match(rows.find((r) => r.label === 'drive nowhere').fix, /declare NOWHERE in dreamteamer\.vars/, 'an undeclared variable is declared before it is set');
	assert.equal(ws.dt('add', 'file-drives', 'Far Inbox', '--path', '${env:INBOXES}', '--index', '5').code, 0);
	rows = await doctorFiles({ root: ws.root, ws: wsHandle, dt: api });
	const far = rows.find((r) => r.label === 'drive far-inbox');
	assert.equal(far.state, 'bad'); assert.match(far.fix, /index/, 'an index past the last line is fixed on the drive, not in .env');
	assert.equal(rows.find((r) => r.label === 'drive drive').state, 'warn', 'never synced');
	assert.equal(ws.dt('files', 'sync', 'drive').code, 0);
	rows = await doctorFiles({ root: ws.root, ws: wsHandle, dt: api });
	assert.equal(rows.find((r) => r.label === 'drive drive').state, 'ok');
	const board = ws.dt('doctor');
	assert.match(board.stdout, /files — (READY|DEGRADED|UNAVAILABLE)/, 'the extension renders as one capability');
});

test('check: an entry whose id disagrees with drive/path is a violation', async () => {
	const { ws } = driveWorkspace();
	assert.equal(ws.dt('files', 'sync').code, 0);
	const wsHandle = await ws.open();
	assert.deepEqual(await checkFiles({ root: ws.root, ws: wsHandle, dt: api }), []);
	const file = path.join(ws.root, 'data/files/drive/docs/readme.md.file.md');
	fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('path: docs/readme.md', 'path: docs/other.md'));
	const out = await checkFiles({ root: ws.root, ws: wsHandle, dt: api });
	assert.equal(out.length, 1);
	assert.match(out[0].message, /expected "drive\/docs\/other.md"/);
	assert.equal(out[0].file, 'data/files/drive/docs/readme.md.file.md');
	assert.notEqual(ws.dt('check').code, 0, 'dt check reports it');
});
