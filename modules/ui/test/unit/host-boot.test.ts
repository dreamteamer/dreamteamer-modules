// Tier 1 — cr-modules-017 task 14: the page's boot values come from GET /host behind the cookie, not from globals
// in the shell. `loadHost` fills `hostInfo`; a 401 is the signed-out page; a host without the route (the editor
// before it answers one, or a 404) leaves the globals in charge; and because `hostInfo` is a ref, a second load
// after the files key rotated changes every URL computed from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HostError } from '../../src/transport/types';

const win: Record<string, unknown> = {
	__DT_FILE_BASES__: [{ collection: 'assets', path: 'data/assets', suffix: 'asset', uri: 'vscode-webview://w/assets' }],
	__DT_VAR_ROOTS__: [{ name: 'FILES_FOLDER', path: '/Users/x/files', uri: 'vscode-webview://w/files' }],
	__DT_FILES__: 'http://127.0.0.1:9/old',
	addEventListener() {},
};
(globalThis as any).window = win;

const { loadHost, hostInfo, signedOut, filesBase, framesBase, paneHost } = await import('../../src/lib/host-boot');
const { srcForRecord, fileBases } = await import('../../src/lib/file-record');
const { uriForPath } = await import('../../src/lib/var-roots');

const host = (key: string) => ({
	level: 'edit', chat: true, workspace: { id: 'a1b2c3d4e5f60718', name: 'Northwind' },
	filesBase: `/_files/${key}`, framesBase: `/_frames/${key}`,
	fileBases: [{ collection: 'assets', path: 'data/assets', suffix: 'asset', uri: `/_files/${key}/w/data/assets` }],
	varRoots: [{ name: 'FILES_FOLDER', path: '/Users/x/files', uri: `/_files/${key}/v/FILES_FOLDER` }],
	moduleGrants: {}, moduleGrantProblem: null,
});

test('before any host answers, the window globals the editor injects are what the lookups use', () => {
	assert.equal(hostInfo.value, null);
	assert.equal(paneHost(), false);
	assert.equal(filesBase(), 'http://127.0.0.1:9/old');
	assert.equal(srcForRecord('assets', 'logos/acme', 'png'), 'vscode-webview://w/assets/logos/acme.asset.png');
	assert.equal(uriForPath('/Users/x/files/a b.png'), 'vscode-webview://w/files/a%20b.png');
});

test('a 404 (a host without the route) leaves hostInfo null and paneHost() false', async () => {
	const got = await loadHost(async () => { throw new HostError('no route', 404); });
	assert.equal(got, null);
	assert.equal(hostInfo.value, null);
	assert.equal(paneHost(), false);
	assert.equal(signedOut.value, false);
});

test('loadHost sets hostInfo from the host; the lookups read it first', async () => {
	const asked: string[] = [];
	const got = await loadHost(async (method, path) => { asked.push(`${method} ${path}`); return host('k1'); });
	assert.deepEqual(asked, ['GET /host']);
	assert.equal(got?.workspace.name, 'Northwind');
	assert.equal(paneHost(), true);
	assert.equal(filesBase(), '/_files/k1');
	assert.equal(framesBase(), '/_frames/k1');
	assert.equal(fileBases()[0].uri, '/_files/k1/w/data/assets');
	assert.equal(srcForRecord('assets', 'logos/acme', 'png'), '/_files/k1/w/data/assets/logos/acme.asset.png');
	assert.equal(uriForPath('/Users/x/files/a b.png'), '/_files/k1/v/FILES_FOLDER/a%20b.png');
});

test('a second load after the key rotated changes every URL computed from it', async () => {
	await loadHost(async () => host('k2'));
	assert.equal(srcForRecord('assets', 'logos/acme', 'png'), '/_files/k2/w/data/assets/logos/acme.asset.png');
	assert.equal(uriForPath('/Users/x/files/a.png'), '/_files/k2/v/FILES_FOLDER/a.png');
	assert.equal(framesBase(), '/_frames/k2');
});

test('a host answering no workspace id (the editor) is not a pane host', async () => {
	await loadHost(async () => ({ level: 'admin', chat: false, workspace: { name: 'x' } }));
	assert.equal(paneHost(), false);
});

test('a 401 is the signed-out page: signedOut true, hostInfo null', async () => {
	const got = await loadHost(async () => { throw new HostError('sign in again', 401); });
	assert.equal(got, null);
	assert.equal(signedOut.value, true);
	assert.equal(hostInfo.value, null);
});
