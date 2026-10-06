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
	assert.ok(!ids(ws).some((id) => id.startsWith('drive/private') || id.split('/').includes('trash') || id.endsWith('.log')), 'docs/trash is under an included folder; the rule "trash" skips it');
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

test('--prune after a move from an entry that was already missing: the moved id is not pruned', () => {
	const { ws, drive } = driveWorkspace();
	sync(ws);
	const bytes = fs.readFileSync(path.join(drive, 'docs/notes.txt'));
	fs.unlinkSync(path.join(drive, 'docs/notes.txt'));
	assert.equal(sync(ws).drives[0].missing, 1);
	fs.writeFileSync(path.join(drive, 'docs/renamed.txt'), bytes);
	const dry = sync(ws, '--prune', '--dry-run');
	assert.deepEqual([dry.drives[0].moved, dry.drives[0].pruned], [1, 0]);
	const out = sync(ws, '--prune');
	assert.deepEqual([out.drives[0].moved, out.drives[0].pruned], [1, 0]);
	assert.equal(get(ws, 'files/drive/docs/renamed.txt').status, 'present');
	assert.equal(get(ws, 'files/drive/docs/notes.txt'), null);
});

test('--prune keeps a missing entry that only a ${env} string points at, and refreshes its referenced_by', () => {
	const { ws, drive } = driveWorkspace();
	writeCollection(ws.root, 'notes', { description: 'A note.', ids: { from: '{{ name | slug }}' }, fields: { name: { type: 'string', required: true }, attachment: { type: 'string' }, body: { type: 'markdown', body: true } } });
	assert.equal(ws.dt('compile').code, 0);
	sync(ws);
	assert.equal(ws.dt('add', 'notes', 'Plan', '--attachment', '${env:DRIVE}/docs/readme.md').code, 0);
	fs.unlinkSync(path.join(drive, 'docs/readme.md'));
	const out = sync(ws, '--prune');
	assert.equal(out.drives[0].pruned, 0);
	const readme = get(ws, 'files/drive/docs/readme.md');
	assert.equal(readme.status, 'missing');
	assert.deepEqual(readme.referenced_by, ['notes/plan']);
});

test('a file that cannot be hashed is counted unhashed and the run goes on', () => {
	const { ws, drive } = driveWorkspace();
	const locked = path.join(drive, 'docs/notes.txt');
	fs.chmodSync(locked, 0o000);
	try {
		const r = ws.dt('files', 'sync');
		assert.equal(r.code, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /unhashed 1/);
		assert.equal(get(ws, 'files/drive/docs/notes.txt').hash, undefined);
		assert.match(get(ws, 'files/drive/docs/readme.md').hash, /^[0-9a-f]{64}$/);
	} finally { fs.chmodSync(locked, 0o644); }
});

test('the pending hint names the records, never the bare collection', () => {
	const { ws } = driveWorkspace();
	const r = ws.dt('files', 'sync');
	assert.equal(r.code, 0, r.stderr + r.stdout);
	assert.match(r.stdout, /dreamteamer commit file-drives\/drive files\/drive\/… — scope it to the records this run wrote/);
	assert.doesNotMatch(r.stdout, /commit files file-drives/);
	assert.doesNotMatch(ws.dt('files', 'sync').stdout, /pending/, 'nothing written, no hint');
});

test('--hash fills the hashes a lower cap left out', () => {
	const { ws } = driveWorkspace();
	assert.equal(ws.dt('set', 'file-drives/drive', 'hash_max_bytes=10').code, 0);
	sync(ws);
	assert.equal(get(ws, 'files/drive/docs/readme.md').hash, undefined, 'over the cap');
	assert.match(get(ws, 'files/drive/docs/a/x.txt').hash, /^[0-9a-f]{64}$/, 'under the cap');
	assert.equal(ws.dt('set', 'file-drives/drive', 'hash_max_bytes=67108864').code, 0);
	assert.equal(sync(ws).drives[0].updated, 0, 'without --hash an unchanged file is not hashed');
	const out = sync(ws, '--hash');
	assert.equal(out.drives[0].updated, 4, 'readme, notes, big and clip');
	assert.match(get(ws, 'files/drive/docs/readme.md').hash, /^[0-9a-f]{64}$/);
});

test('a name no id can carry is skipped as unsafe; the rest is indexed and the run exits 0', () => {
	const { ws } = driveWorkspace({ tree: { ...TREE, 'docs/Icon\r': '' } });
	const r = ws.dt('files', 'sync');
	assert.equal(r.code, 0, r.stderr + r.stdout);
	assert.match(r.stdout, /walked 10 · added 10 · .* · unsafe 1/);
	assert.match(r.stderr, /unsafe name, not indexed: drive drive "docs\/Icon\\r"/);
	assert.equal(ids(ws).length, 10);
});

test('a write the store refuses is counted failed, named on stderr, the rest is written, and the run exits 1', () => {
	const long = `docs/${'x'.repeat(246)}.txt`;
	const { ws } = driveWorkspace({ tree: { ...TREE, [long]: 'a name the record file cannot carry\n' } });
	const r = ws.dt('files', 'sync');
	assert.equal(r.code, 1, r.stderr + r.stdout);
	assert.match(r.stdout, /walked 11 · added 10 · .* · failed 1/);
	assert.match(r.stderr, new RegExp(`failed files/drive/${long}: `));
	assert.equal(ids(ws).length, 10);
	assert.equal(get(ws, 'file-drives/drive').entries, 10, 'the drive is still stamped');
});

test('a scope with repeated slashes is the same subfolder; a ".." segment is refused with exit 2', () => {
	const { ws } = driveWorkspace();
	sync(ws);
	const out = sync(ws, 'drive/docs//a');
	assert.equal(out.drives[0].walked, 2);
	assert.deepEqual([out.drives[0].added, out.drives[0].unchanged, out.drives[0].failed.length], [0, 2, 0]);
	const bad = ws.dt('files', 'sync', 'drive/../x');
	assert.equal(bad.code, 2, bad.stderr + bad.stdout);
	assert.match(bad.stderr, /no "\." or "\.\." segment/);
});

test('an unreadable folder keeps its entries: not missing, not pruned', { skip: process.getuid?.() === 0 && 'root reads every folder' }, () => {
	const { ws, drive } = driveWorkspace();
	sync(ws);
	const locked = path.join(drive, 'docs/a');
	fs.chmodSync(locked, 0o000);
	try {
		const r = ws.dt('files', 'sync', '--prune');
		assert.equal(r.code, 0, r.stderr + r.stdout);
		assert.match(r.stdout, /missing 0 · .* · unreadable 1/);
		assert.doesNotMatch(r.stdout, /pruned/);
		assert.match(r.stderr, /unreadable folder, its entries left as they were: drive drive "docs\/a"/);
	} finally { fs.chmodSync(locked, 0o755); }
	assert.equal(get(ws, 'files/drive/docs/a/x.txt').status, 'present');
});

test('a non-Latin name with spaces syncs, reads back by its id, and passes dt check', () => {
	const name = 'docs/\u05ea\u05d5\u05db\u05e0\u05d9\u05ea \u05e2\u05d1\u05d5\u05d3\u05d4 v2.md';
	const { ws } = driveWorkspace({ tree: { ...TREE, [name]: '# plan\n' } });
	const out = sync(ws);
	assert.equal(out.drives[0].added, 11);
	const got = get(ws, `files/drive/${name}`);
	assert.ok(got, 'dt get finds it');
	assert.equal(got.path, name);
	const check = ws.dt('check');
	assert.equal(check.code, 0, check.stdout + check.stderr);
});

test('the first sync of an empty drive stamps the drive, and the pending hint names it', () => {
	const { ws } = driveWorkspace({ tree: {} });
	const r = ws.dt('files', 'sync');
	assert.equal(r.code, 0, r.stderr + r.stdout);
	assert.match(r.stdout, /walked 0 · added 0/);
	assert.match(r.stdout, /pending — dreamteamer commit file-drives\/drive /);
	assert.equal(get(ws, 'file-drives/drive').entries, 0);
});
