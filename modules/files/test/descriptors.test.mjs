// The two collections compile in a real workspace, and a `files` id keeps a path verbatim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspace, api } from './fixture.mjs';

// `stub` is engine-owned since 0.41.0 (injected where a record can yield), like id and the two dates.
test('the module compiles and both collections exist with the agreed fields', () => {
	const ws = workspace();
	const store = new api.Store({ root: ws.root, pkg: ws.pkg });
	const drives = store.descriptor('file-drives');
	const files = store.descriptor('files');
	assert.deepEqual(Object.keys(api.fieldsOf(drives)).filter((k) => !['id', 'created', 'last_modified', 'stub'].includes(k)),
		['name', 'path', 'index', 'provider', 'include', 'exclude', 'preview', 'hash_max_bytes', 'description', 'tags', 'last_synced', 'entries', 'notes']);
	assert.deepEqual(Object.keys(api.fieldsOf(files)).filter((k) => !['id', 'created', 'last_modified', 'stub'].includes(k)),
		['drive', 'path', 'name', 'kind', 'ext', 'mime', 'bytes', 'modified', 'local', 'status', 'hash', 'preview', 'referenced_by', 'description', 'tags', 'notes']);
});

// Non-Latin letters: sync.test.mjs, "a non-Latin name with spaces syncs, reads back by its id, and passes dt check".
test('a files id is <drive>/<relative path>, verbatim — dots and spaces kept', () => {
	const ws = workspace();
	assert.equal(ws.dt('add', 'file-drives', 'Drive', '--path', '${env:DRIVE}').code, 0);
	const r = ws.dt('add', 'files', '--drive', 'file-drives/drive', '--path', 'docs/Quarter Plan v2.pdf', '--name', 'Quarter Plan v2.pdf', '--kind', 'file');
	assert.equal(r.code, 0, r.stderr);
	assert.ok(fs.existsSync(path.join(ws.root, 'data/files/drive/docs/Quarter Plan v2.pdf.file.md')), 'the record mirrors the path');
	const got = ws.dt('get', 'files/drive/docs/Quarter Plan v2.pdf', '--json');
	assert.equal(got.code, 0, got.stderr);
	assert.equal(JSON.parse(got.stdout).path, 'docs/Quarter Plan v2.pdf');
});

test('a required derived field is editable at creation only, so the engine can still create a record', () => {
	const ws = workspace();
	const d = new api.Store({ root: ws.root, pkg: ws.pkg }).descriptor('files');
	const f = api.fieldsOf(d);
	for (const k of ['drive', 'path', 'name']) assert.equal(f[k].display?.editable, 'create', k);
	for (const k of ['kind', 'ext', 'mime', 'bytes', 'modified', 'local', 'status', 'hash', 'preview', 'referenced_by']) assert.equal(f[k].display?.editable, false, k);
});
