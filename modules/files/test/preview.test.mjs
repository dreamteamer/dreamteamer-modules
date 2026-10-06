import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { previewOf, renderPreview, previewable, PREVIEW_CAP, PREVIEW_MAX_BYTES } from '../src/preview.js';
import { makeTree, tmpDir, TREE } from './helpers.mjs';

test('markdown is kept as is, other text is fenced by language', () => {
	assert.equal(renderPreview('# T\n\nbody\n', 'md'), '# T\n\nbody');
	assert.equal(renderPreview('a,b\n1,2\n', 'csv'), '````csv\na,b\n1,2\n````');
	assert.equal(renderPreview('k: v\n', 'yml'), '````yaml\nk: v\n````');
	assert.equal(renderPreview('hello', 'txt'), '````text\nhello\n````');
});

test('a long file is cut at the cap with a note saying so', () => {
	const out = renderPreview('x'.repeat(PREVIEW_CAP + 10), 'txt');
	assert.ok(out.includes('x'.repeat(PREVIEW_CAP)));
	assert.ok(!out.includes('x'.repeat(PREVIEW_CAP + 1)));
	assert.match(out, /_\(preview cut at 32 KB of 32778 characters\)_$/);
});

test('previewOf reads a text-like file and refuses the rest', () => {
	const root = makeTree(tmpDir(), TREE);
	assert.equal(previewOf(path.join(root, 'docs/readme.md'), 'md'), '# Readme\n\nHello from the fixture.');
	assert.equal(previewOf(path.join(root, 'media/clip.m4a'), 'm4a'), null, 'not a text extension');
	assert.equal(previewOf(path.join(root, 'docs/missing.txt'), 'txt'), null, 'unreadable is null, not a throw');
	assert.ok(previewable('eml') && previewable('log') && !previewable('pdf'));
});

test('a text extension on binary bytes yields no preview', () => {
	const root = makeTree(tmpDir(), { 'odd.txt': Buffer.from([0x68, 0x69, 0x00, 0x01]) });
	assert.equal(previewOf(path.join(root, 'odd.txt'), 'txt'), null);
});

test('a file over the size limit is not read; one at the limit is', () => {
	assert.equal(PREVIEW_MAX_BYTES, 8 * 1024 * 1024);
	const root = makeTree(tmpDir(), { 'big.log': 'y'.repeat(65), 'edge.log': 'y'.repeat(64) });
	assert.equal(previewOf(path.join(root, 'big.log'), 'log', { maxBytes: 64 }), null);
	assert.equal(previewOf(path.join(root, 'edge.log'), 'log', { maxBytes: 64 }), `\`\`\`\`text\n${'y'.repeat(64)}\n\`\`\`\``);
});

test('a run of backticks in the text gets a longer fence', () => {
	assert.equal(renderPreview('a,````,b\n', 'csv'), '`````csv\na,````,b\n`````');
});

test('trailing whitespace is trimmed in linear time', () => {
	const spaces = ' '.repeat(PREVIEW_CAP - 1);
	const t0 = Date.now();
	assert.equal(renderPreview(spaces + 'a', 'txt'), `\`\`\`\`text\n${spaces}a\n\`\`\`\``);
	assert.ok(Date.now() - t0 < 500, 'a cap-length run of spaces before the last character is scanned once');
});
