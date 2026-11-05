/**
 * The running-sessions band does not ship with plain sessions (cr-vscode-019, acceptance line 5; test
 * cr-vscode-019-t5). Core 0.9.0 has no session status and no heartbeat, so a band of "running" sessions
 * could draw nothing true: its component, its slot on the Activity page, its route and its tests are gone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceApi } from '../../src/api';
import { initEngine } from '../../src/engine';
import { NO_ENGINE } from './engine-under-test';
import { v2Workspace } from './v2-workspace';

const SELF = 'no-running-sessions.test.ts';
function files(dir: string): string[] {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) return e.name === 'node_modules' || e.name === 'fixtures' ? [] : files(p);
		return /\.(ts|vue|js|mjs)$/.test(e.name) && e.name !== SELF ? [p] : [];
	});
}

test('nothing in src/, webview/src or test/ names RunningSessions or sessions/running', () => {
	const root = process.cwd();
	const hits = ['src', 'webview/src', 'test'].flatMap((d) => files(path.join(root, d)))
		.filter((f) => /RunningSessions|sessions\/running/.test(fs.readFileSync(f, 'utf8')))
		.map((f) => path.relative(root, f));
	assert.deepEqual(hits, []);
});

test('GET /sessions/running is not a route', { skip: NO_ENGINE }, async () => {
	const ws = v2Workspace('no-running', { 'collections/things.collection.yaml': 'name: things\ndescription: A thing.\nuse_when: a thing is named\nids:\n  from: "{{ title | slug }}"\nfields:\n  title:\n    type: string\n    required: true\n' });
	await initEngine(ws.root);
	const api = new WorkspaceApi(ws.root);
	const r = await api.handle('GET', '/sessions/running').catch((e: { status?: number; message?: string }) => ({ status: e.status ?? 500, body: e.message }));
	assert.equal(r.status, 404, JSON.stringify(r));
});
