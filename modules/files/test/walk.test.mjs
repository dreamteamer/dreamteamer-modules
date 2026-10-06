import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walkDrive, extOf, mimeOf, isLocal, isoLocal } from '../src/walk.js';
import { makeTree, tmpDir, TREE } from './helpers.mjs';

test('walkDrive lists files and folders under the included top-level folders, sorted, skipping dotfiles and excludes', () => {
	const root = makeTree(tmpDir(), TREE);
	const got = walkDrive(root, { include: ['docs', 'media', 'empty'], exclude: ['trash', '*.log'] });
	assert.deepEqual(got.map((e) => `${e.kind}:${e.path}`), [
		'folder:docs', 'file:docs/big.txt', 'file:docs/notes.txt', 'file:docs/readme.md',
		'folder:empty',
		'folder:media', 'file:media/clip.m4a',
	]);
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
	assert.ok(!paths.some((p) => p.startsWith('trash')));
});

test('a subfolder scope walks that subtree only, with the folder itself first', () => {
	const root = makeTree(tmpDir(), TREE);
	const paths = walkDrive(root, { include: ['docs', 'media'], exclude: ['*.log'], subfolder: 'docs' }).map((e) => e.path);
	assert.deepEqual(paths, ['docs', 'docs/big.txt', 'docs/notes.txt', 'docs/readme.md']);
	assert.deepEqual(walkDrive(root, { include: ['docs'], subfolder: 'media' }), [], 'a subfolder outside include yields nothing');
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
