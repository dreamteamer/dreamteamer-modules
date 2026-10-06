// The real CLI against a fixture drive: the contract of `dt files sync`, case by case.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { api, writeCollection } from './fixture.mjs';
import { driveWorkspace, recordMtimes, TREE } from './helpers.mjs';

const sync = (ws, ...a) => { const r = ws.dt('files', 'sync', '--json', ...a); assert.equal(r.code, 0, r.stderr + r.stdout); return JSON.parse(r.stdout); };
const get = (ws, ref) => { const r = ws.dt('get', ref, '--json'); return r.code === 0 ? JSON.parse(r.stdout) : null; };
const ids = (ws) => { const r = ws.dt('list', 'files', '--json'); assert.equal(r.code, 0, r.stderr); return JSON.parse(r.stdout).map((x) => x.id).sort(); };

test('first sync creates one record per included file and folder, with the derived fields and a preview', () => {
	const { ws } = driveWorkspace();
	const out = sync(ws);
	assert.deepEqual(out.drives.map((d) => [d.id, d.walked, d.added, d.updated, d.missing]), [['drive', 10, 10, 0, 0]]);
	assert.deepEqual(ids(ws), [
		'drive/docs', 'drive/docs/a', 'drive/docs/a-b.txt', 'drive/docs/a/x.txt', 'drive/docs/big.txt', 'drive/docs/notes.txt',
		'drive/docs/readme.md', 'drive/empty', 'drive/media', 'drive/media/clip.m4a',
	]);
	const readme = get(ws, 'files/drive/docs/readme.md');
	assert.equal(readme.kind, 'file'); assert.equal(readme.ext, 'md'); assert.equal(readme.bytes, TREE['docs/readme.md'].length);
	assert.equal(readme.local, true); assert.equal(readme.status, 'present');
	assert.match(readme.hash, /^[0-9a-f]{64}$/);
	assert.equal(readme.preview, '# Readme\n\nHello from the fixture.');
	assert.match(get(ws, 'files/drive/docs/big.txt').preview, /_\(preview cut at 32 KB of 40960 characters\)_$/);
	assert.equal(get(ws, 'files/drive/media/clip.m4a').preview, undefined, 'no preview for audio');
	assert.equal(get(ws, 'files/drive/docs').bytes, undefined, 'a folder has no size');
	assert.ok(fs.existsSync(path.join(ws.root, 'data/files/drive/docs/readme.md.file.md')));
	const drive = get(ws, 'file-drives/drive');
	assert.equal(drive.entries, 10); assert.match(drive.last_synced, /^\d{4}-/);
});

test('a second sync over an unchanged tree writes nothing', () => {
	const { ws } = driveWorkspace();
	sync(ws);
	const c = ws.dt('commit');
	assert.equal(c.code, 0, c.stderr + c.stdout);
	const before = recordMtimes(ws.root);
	const out = sync(ws);
	assert.deepEqual(out.drives.map((d) => [d.added, d.updated, d.moved, d.missing, d.unchanged]), [[0, 0, 0, 0, 10]]);
	assert.deepEqual(recordMtimes(ws.root), before, 'no record file was touched');
	assert.equal(ws.git(['status', '--porcelain']), '', 'the drive record is not re-stamped either');
});

test('an edited file is one update with a new hash and preview; your description, tags and notes survive', () => {
	const { ws, drive } = driveWorkspace();
	sync(ws);
	assert.equal(ws.dt('set', 'files/drive/docs/notes.txt', 'description=my take', 'tags=keep', 'notes=Read twice.').code, 0);
	const h1 = get(ws, 'files/drive/docs/notes.txt').hash;
	fs.writeFileSync(path.join(drive, 'docs/notes.txt'), 'line one\nline two\nline three\n');
	const out = sync(ws);
	assert.equal(out.drives[0].updated, 1);
	const after = get(ws, 'files/drive/docs/notes.txt');
	assert.notEqual(after.hash, h1);
	assert.match(after.preview, /line three/);
	assert.equal(after.description, 'my take'); assert.deepEqual(after.tags, ['keep']); assert.match(after.notes, /Read twice/);
});

test('a deleted file is marked missing and its record stays; a renamed file keeps its record and its inbound reference', () => {
	const { ws, drive } = driveWorkspace();
	writeCollection(ws.root, 'notes', { description: 'A note.', ids: { from: '{{ name | slug }}' }, fields: { name: { type: 'string', required: true }, file: { type: 'files' }, attachment: { type: 'string' }, body: { type: 'markdown', body: true } } });
	assert.equal(ws.dt('compile').code, 0);
	sync(ws);
	assert.equal(ws.dt('add', 'notes', 'Plan', '--file', 'files/drive/docs/notes.txt', '--attachment', '${env:DRIVE}/docs/readme.md').code, 0);
	fs.unlinkSync(path.join(drive, 'docs/big.txt'));
	fs.renameSync(path.join(drive, 'docs/notes.txt'), path.join(drive, 'docs/renamed.txt'));
	const out = sync(ws);
	assert.equal(out.drives[0].missing, 1); assert.equal(out.drives[0].moved, 1);
	assert.equal(get(ws, 'files/drive/docs/big.txt').status, 'missing');
	assert.equal(get(ws, 'files/drive/docs/notes.txt'), null);
	assert.equal(get(ws, 'files/drive/docs/renamed.txt').path, 'docs/renamed.txt');
	assert.equal(get(ws, 'notes/plan').file, 'files/drive/docs/renamed.txt', 'rename rewrote the inbound reference');
	assert.deepEqual(get(ws, 'files/drive/docs/renamed.txt').referenced_by, ['notes/plan']);
	assert.deepEqual(get(ws, 'files/drive/docs/readme.md').referenced_by, ['notes/plan'], 'the ${env} string form counts too');
});

test('--prune removes a missing entry only when nobody annotated or references it', () => {
	const { ws, drive } = driveWorkspace();
	sync(ws);
	assert.equal(ws.dt('set', 'files/drive/docs/readme.md', 'description=keep me').code, 0);
	fs.unlinkSync(path.join(drive, 'docs/readme.md'));
	fs.unlinkSync(path.join(drive, 'docs/big.txt'));
	const out = sync(ws, '--prune');
	assert.equal(out.drives[0].pruned, 1);
	assert.equal(get(ws, 'files/drive/docs/big.txt'), null);
	assert.equal(get(ws, 'files/drive/docs/readme.md').status, 'missing');
});

test('include limits the walk; exclude skips trash and *.log; a subfolder scope leaves the rest untouched', () => {
	const { ws, drive } = driveWorkspace();
	sync(ws);
	assert.ok(!ids(ws).some((id) => id.startsWith('drive/private') || id.startsWith('drive/trash') || id.endsWith('.log')));
	fs.unlinkSync(path.join(drive, 'media/clip.m4a'));
	const out = sync(ws, 'drive/docs');
	assert.equal(out.drives[0].walked, 7);
	assert.equal(get(ws, 'files/drive/media/clip.m4a').status, 'present', 'outside the scope: not marked missing');
});

test('index picks a line of a list variable; an unset variable skips the drive with a note and exit 0', () => {
	const { ws, inboxB } = driveWorkspace({ drives: false });
	assert.equal(ws.dt('add', 'file-drives', 'Inbox B', '--path', '${env:INBOXES}', '--index', '1', '--include', 'meeting-recordings').code, 0);
	assert.equal(ws.dt('add', 'file-drives', 'Nowhere', '--path', '${env:NOWHERE}').code, 0, 'a template is inert data');
	const out = sync(ws);
	const b = out.drives.find((d) => d.id === 'inbox-b'); const n = out.drives.find((d) => d.id === 'nowhere');
	assert.deepEqual([b.walked, b.added], [2, 2]);
	assert.deepEqual(ids(ws), ['inbox-b/meeting-recordings', 'inbox-b/meeting-recordings/two.m4a']);
	assert.match(n.skipped, /not declared/);
	assert.equal(get(ws, 'file-drives/nowhere').last_synced, undefined, 'a skipped drive is not stamped');
	assert.ok(fs.existsSync(path.join(inboxB, 'meeting-recordings/two.m4a')));
});

test('--dry-run reports the plan and writes nothing', () => {
	const { ws } = driveWorkspace();
	const out = sync(ws, '--dry-run');
	assert.equal(out.dryRun, true); assert.equal(out.drives[0].added, 10);
	const list = ws.dt('list', 'files', '--json');
	assert.equal(list.code, 0, list.stderr);
	assert.deepEqual(JSON.parse(list.stdout), [], 'no record was written');
	assert.equal(get(ws, 'file-drives/drive').last_synced, undefined);
});

test('the records pass dt check, and preview: false on the drive writes no preview', () => {
	const { ws } = driveWorkspace();
	assert.equal(ws.dt('set', 'file-drives/drive', 'preview=false').code, 0);
	sync(ws);
	assert.equal(get(ws, 'files/drive/docs/readme.md').preview, undefined);
	const r = ws.dt('check');
	assert.equal(r.code, 0, r.stdout + r.stderr);
});
