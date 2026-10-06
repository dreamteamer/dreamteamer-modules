import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { walkDrive, extOf, mimeOf, isLocal, isoLocal } from '../src/walk.js';
import { makeTree, tmpDir, TREE } from './helpers.mjs';

test('walkDrive lists files and folders under the included top-level folders, sorted, skipping dotfiles and excludes', () => {
	const root = makeTree(tmpDir(), TREE);
	const got = walkDrive(root, { include: ['docs', 'media', 'empty'], exclude: ['trash', '*.log'] });
	assert.deepEqual(got.map((e) => `${e.kind}:${e.path}`), [
		'folder:docs', 'folder:docs/a', 'file:docs/a-b.txt', 'file:docs/a/x.txt',
		'file:docs/big.txt', 'file:docs/notes.txt', 'file:docs/readme.md',
		'folder:empty',
		'folder:media', 'file:media/clip.m4a',
	]);
	assert.deepEqual(got.map((e) => e.path), [...got.map((e) => e.path)].sort(), 'sorted by path, not in tree pre-order');
	const readme = got.find((e) => e.path === 'docs/readme.md');
	assert.equal(readme.name, 'readme.md');
	assert.equal(readme.ext, 'md');
	assert.equal(readme.mime, 'text/markdown');
	assert.equal(readme.bytes, TREE['docs/readme.md'].length);
	assert.match(readme.modified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
	assert.equal(readme.local, true);
	assert.equal(got.find((e) => e.path === 'docs').ext, undefined, 'a folder carries no file fields');
});

test('an empty include walks everything but the excludes', () => {
	const root = makeTree(tmpDir(), TREE);
	const paths = walkDrive(root, { exclude: ['trash'] }).map((e) => e.path);
	assert.ok(paths.includes('private/secret.txt'));
	assert.ok(paths.includes('docs/scan.log'), 'only *.log in exclude removes it');
	assert.ok(!paths.some((p) => p.split('/').includes('trash')), 'a rule with no slash is a name at any depth');
	assert.ok(walkDrive(root).some((e) => e.path === 'docs/trash/old.pdf'), 'without the rule it is walked');
});

test('a subfolder scope walks that subtree only, with the folder itself first', () => {
	const root = makeTree(tmpDir(), TREE);
	const paths = walkDrive(root, { include: ['docs', 'media'], exclude: ['trash', '*.log'], subfolder: 'docs' }).map((e) => e.path);
	assert.deepEqual(paths, ['docs', 'docs/a', 'docs/a-b.txt', 'docs/a/x.txt', 'docs/big.txt', 'docs/notes.txt', 'docs/readme.md']);
	assert.deepEqual(walkDrive(root, { include: ['docs'], subfolder: 'media' }), [], 'a subfolder outside include yields nothing');
});

test('a subfolder of "/" walks the whole drive', () => {
	const root = makeTree(tmpDir(), TREE);
	const opts = { include: ['docs', 'media', 'empty'], exclude: ['trash', '*.log'] };
	const all = walkDrive(root, opts);
	assert.equal(all.length, 10);
	assert.deepEqual(walkDrive(root, { ...opts, subfolder: '/' }), all);
});

test('a name holding a control character or a backslash is skipped and listed as unsafe', () => {
	const root = makeTree(tmpDir(), { ...TREE, 'docs/Icon\r': '', 'docs/back\\slash.txt': 'x', 'docs/ok.txt': 'fine' });
	const got = walkDrive(root, { include: ['docs', 'media', 'empty'], exclude: ['trash', '*.log'] });
	assert.ok(Array.isArray(got));
	const paths = got.map((e) => e.path);
	assert.ok(paths.includes('docs/ok.txt'));
	assert.ok(!paths.some((p) => /[\r\\]/.test(p)), `no unsafe name in ${JSON.stringify(paths)}`);
	assert.deepEqual([...got.unsafe].sort(), ['docs/Icon\r', 'docs/back\\slash.txt']);
	assert.deepEqual(got.unreadable, []);
	assert.equal(Object.keys(got).length, got.length, 'the two lists are not enumerable, so the entries compare as a plain array');
});

test('a folder that cannot be listed is reported unreadable, and the folder itself is still an entry', { skip: process.getuid?.() === 0 && 'root reads every folder' }, () => {
	const root = makeTree(tmpDir(), TREE);
	const locked = path.join(root, 'docs', 'a');
	fs.chmodSync(locked, 0o000);
	try {
		const got = walkDrive(root, { include: ['docs'], exclude: ['trash', '*.log'] });
		assert.deepEqual(got.unreadable, ['docs/a']);
		assert.ok(got.some((e) => e.path === 'docs/a' && e.kind === 'folder'));
		assert.ok(!got.some((e) => e.path === 'docs/a/x.txt'));
	} finally { fs.chmodSync(locked, 0o755); }
});

test('a subfolder scope behind a folder that cannot be searched reports that folder unreadable, not an empty subtree', { skip: process.getuid?.() === 0 && 'root reads every folder' }, () => {
	const root = makeTree(tmpDir(), TREE);
	const locked = path.join(root, 'docs');
	fs.chmodSync(locked, 0o000);
	try {
		const got = walkDrive(root, { include: ['docs'], subfolder: 'docs/a' });
		assert.deepEqual([...got], []);
		// lstat of docs/a fails with EACCES because docs cannot be searched, so the folder reported is
		// docs: the scope and everything in it are strictly under it, the same as a full walk reports.
		assert.deepEqual(got.unreadable, ['docs']);
		assert.deepEqual(walkDrive(root, { include: ['docs'] }).unreadable, ['docs'], 'the full walk names the same folder');
	} finally { fs.chmodSync(locked, 0o755); }
});

test('a subfolder scope that does not exist yields nothing and nothing unreadable: what was under it is gone', () => {
	const root = makeTree(tmpDir(), TREE);
	const got = walkDrive(root, { subfolder: 'nope/x' });
	assert.deepEqual([...got], []);
	assert.deepEqual(got.unreadable, []);
	assert.deepEqual(walkDrive(root, { subfolder: 'docs/nope' }).unreadable, []);
});

test('a name the disk spells decomposed (NFD) walks as NFC; abs keeps the spelling on disk', () => {
	const nfd = 'cafe\u0301.txt';
	const nfc = 'caf\u00e9.txt';
	assert.notEqual(nfd, nfc);
	const root = makeTree(tmpDir(), { [`docs/${nfd}`]: 'bonjour\n' });
	const got = walkDrive(root).find((e) => e.kind === 'file');
	assert.equal(got.path, `docs/${nfc}`);
	assert.equal(got.name, nfc);
	assert.ok(fs.existsSync(got.abs), got.abs);
});

test('a symlink is skipped, so a walk never leaves the drive through one', () => {
	const root = makeTree(tmpDir(), TREE);
	const outside = makeTree(tmpDir(), { 'leaked.txt': 'outside the drive\n', 'sub/deeper.txt': 'also outside\n' });
	fs.symlinkSync(outside, path.join(root, 'docs', 'link'));
	fs.symlinkSync(path.join(outside, 'leaked.txt'), path.join(root, 'docs', 'file-link.txt'));
	const opts = { include: ['docs', 'media', 'empty'], exclude: ['trash', '*.log'] };
	const paths = walkDrive(root, opts).map((e) => e.path);
	assert.ok(paths.includes('docs/readme.md'), 'the rest of the folder is still walked');
	assert.ok(!paths.some((p) => p.includes('link')), `no link in ${paths.join(', ')}`);
	assert.deepEqual(walkDrive(root, { ...opts, subfolder: 'docs/link' }), [], 'a symlinked subfolder yields nothing');
	assert.deepEqual(walkDrive(root, { ...opts, subfolder: 'docs/link/sub' }), [], 'nor does a folder reached through one');
});

test('extOf and mimeOf', () => {
	assert.equal(extOf('Quarter Plan v2.PDF'), 'pdf');
	assert.equal(extOf('README'), '');
	assert.equal(extOf('.env'), '', 'a leading dot is not an extension');
	assert.equal(mimeOf('m4a'), 'audio/mp4');
	assert.equal(mimeOf('xyz'), '');
});

test('isLocal reads the block count: a size with no blocks is a file evicted to the cloud', () => {
	assert.equal(isLocal({ size: 10, blocks: 8 }), true);
	assert.equal(isLocal({ size: 10, blocks: 0 }), false);
	assert.equal(isLocal({ size: 0, blocks: 0 }), true);
	assert.equal(isLocal({ size: 10 }), true, 'no block count (another platform) means local');
});

test('isoLocal renders seconds and the local offset, and round-trips', () => {
	const s = isoLocal(new Date('2026-01-02T03:04:05.678Z'));
	assert.match(s, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
	assert.equal(new Date(s).getTime(), Math.floor(new Date('2026-01-02T03:04:05.678Z').getTime() / 1000) * 1000);
});
