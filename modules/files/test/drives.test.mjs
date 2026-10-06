import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envKeysOf, resolveDrivePath, included, excluded, parseScope } from '../src/drives.js';

/** A stand-in for the engine's renderTemplate: substitutes declared, set vars; throws like the engine otherwise. */
const render = (tpl, ctx) => tpl.replace(/\$\{env:([A-Za-z0-9_]+)\}/g, (_, k) => {
	if (!ctx.declared.includes(k)) throw new Error(`\${env:${k}}: "${k}" is not declared in dreamteamer.vars`);
	if (!ctx.env.has(k) || !ctx.env.get(k).trim()) throw new Error(`\${env:${k}} is declared but has no value in .env on this machine`);
	return ctx.env.get(k);
});
const ctx = (env, declared = Object.keys(env)) => ({ env: new Map(Object.entries(env)), workspaceFolder: '/Users/someone/ws', declared });

test('envKeysOf lists the variables a template names', () => {
	assert.deepEqual(envKeysOf('${env:FILES_FOLDER}/sub'), ['FILES_FOLDER']);
	assert.deepEqual(envKeysOf('/plain'), []);
});

test('a one-line variable renders as the drive path', () => {
	assert.deepEqual(resolveDrivePath({ path: '${env:DRIVE}' }, ctx({ DRIVE: '/Users/someone/drive' }), render), { path: '/Users/someone/drive' });
});

test('an undeclared or unset variable skips the drive with the engine\'s reason', () => {
	assert.match(resolveDrivePath({ path: '${env:DRIVE}' }, ctx({}, []), render).skipped, /not declared/);
	assert.match(resolveDrivePath({ path: '${env:DRIVE}' }, ctx({ DRIVE: '' }), render).skipped, /no value/);
	assert.deepEqual(resolveDrivePath({ path: '' }, ctx({}), render), { skipped: 'no path' });
});

test('index picks one line of a newline-separated variable', () => {
	const c = ctx({ INBOXES: '\n/Users/someone/a\n/Users/someone/b\n' });
	assert.deepEqual(resolveDrivePath({ path: '${env:INBOXES}', index: 1 }, c, render), { path: '/Users/someone/b' });
	assert.deepEqual(resolveDrivePath({ path: '${env:INBOXES}/sub', index: 0 }, c, render), { path: '/Users/someone/a/sub' });
	assert.match(resolveDrivePath({ path: '${env:INBOXES}', index: 2 }, c, render).skipped, /2 line\(s\); index 2/);
});

test('index: the renderer\'s own error for an undeclared or empty variable, and a whole number from 0', () => {
	assert.match(resolveDrivePath({ path: '${env:INBOXES}', index: 0 }, ctx({}, []), render).skipped, /not declared/);
	assert.match(resolveDrivePath({ path: '${env:INBOXES}', index: 0 }, ctx({ INBOXES: '\n  \n' }), render).skipped, /no value/);
	const c = ctx({ INBOXES: '/Users/someone/a\n/Users/someone/b' });
	assert.match(resolveDrivePath({ path: '${env:INBOXES}', index: -1 }, c, render).skipped, /whole number from 0 \(got "-1"\)/);
	assert.match(resolveDrivePath({ path: '${env:INBOXES}', index: 1.5 }, c, render).skipped, /whole number from 0/);
	assert.match(resolveDrivePath({ path: '${env:INBOXES}', index: 'one' }, c, render).skipped, /whole number from 0 \(got "one"\)/);
	assert.deepEqual(resolveDrivePath({ path: '${env:INBOXES}', index: '1' }, c, render), { path: '/Users/someone/b' });
});

test('a variable of several lines with no index asks for index', () => {
	const c = ctx({ INBOXES: '/Users/someone/a\n/Users/someone/b' });
	assert.deepEqual(resolveDrivePath({ path: '${env:INBOXES}/sub' }, c, render), { skipped: '${env:INBOXES} has several lines — set index on this drive to pick one' });
});

test('included: empty means everything; otherwise the top-level folder must be listed', () => {
	assert.equal(included([], 'anything/at/all'), true);
	assert.equal(included(['rnd', 'meetings'], 'rnd'), true);
	assert.equal(included(['rnd', 'meetings'], 'rnd/projects/plan.pdf'), true);
	assert.equal(included(['rnd'], 'finance/x.pdf'), false);
	assert.equal(included(['rnd'], 'rnd-archive/x.pdf'), false, 'a prefix is a folder, not a substring');
});

test('excluded: dotfiles always, a prefix, an extension', () => {
	assert.equal(excluded([], 'a/.DS_Store'), true);
	assert.equal(excluded([], '.git/config'), true, 'inside a dot-folder');
	assert.equal(excluded([], 'a/.hidden/x.pdf'), true, 'inside a nested dot-folder');
	assert.equal(excluded([], 'a.b/c.pdf'), false, 'a dot inside a name is not a leading dot');
	assert.equal(excluded(['trash'], 'trash/old.pdf'), true);
	assert.equal(excluded(['trash'], 'trash'), true);
	assert.equal(excluded(['trash'], 'trashy/x.pdf'), false);
	assert.equal(excluded(['*.log'], 'inbox/a.m4a.LOG'), true);
	assert.equal(excluded(['*.log'], 'inbox/a.m4a'), false);
});

test('parseScope splits at the first slash', () => {
	assert.deepEqual(parseScope('drive'), { drive: 'drive', subfolder: null });
	assert.deepEqual(parseScope('drive/rnd/projects/'), { drive: 'drive', subfolder: 'rnd/projects' });
	assert.equal(parseScope(''), null);
});
