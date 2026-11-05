// Tier 1 — a record's REPO STATE on its payload, against the real engine: which repo commits it
// (`$repo`, the engine's `Store#locate`), whether its file holds changes no commit has (`$dirty`),
// and how far that repo is ahead of its upstream (`$ahead`). The record page's sub-header draws them
// (`webview/src/lib/record-origin.ts`).
//
// An engine without `Store#locate` (0.39.1 and older) gets NO repo keys and the page draws the source
// alone — pinned here with the store's method removed, so the degradation is a test, not a hope.
// Synthetic names only.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkspaceApi } from '../../src/api';
import { NO_ENGINE } from './engine-under-test';
import { engine, initEngine } from '../../src/engine';
import { forgetAhead, repoStateKeys } from '../../src/repo-state';
import { v2Workspace, quiet, type V2Workspace } from './v2-workspace';

const NOTES = `name: notes
description: A note.
use_when: a thought is worth keeping
ids:
  from: '{{ title | slug }}'
fields:
  title:
    type: string
    required: true
`;

describe('the repo state on a record payload', { skip: NO_ENGINE }, () => {
	let ws: V2Workspace;
	let api: WorkspaceApi;
	let hasLocate = false;
	const fields = async (id: string) => {
		const r = await api.handle('GET', `/collections/notes/records/${id}`);
		assert.equal(r.status, 200, JSON.stringify(r.body));
		return (r.body as any).fields as Record<string, unknown>;
	};

	before(async () => {
		ws = v2Workspace('repo-state', { 'collections/notes.collection.yaml': NOTES }, {
			'data/notes/northwind-kickoff.note.md': '---\ntitle: Northwind kickoff\n---\n',
		});
		// an upstream, so the branch has something to be ahead of
		const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-repo-state-remote-'));
		execFileSync('git', ['init', '-q', '--bare', remote]);
		ws.git('remote', 'add', 'origin', remote);
		ws.git('push', '-q', '-u', 'origin', 'HEAD');
		await initEngine(ws.root);
		api = new WorkspaceApi(ws.root);
		hasLocate = typeof (new (engine() as any).Store({ root: ws.root }) as any).locate === 'function';
	});

	test('on an engine with Store#locate: the repo, clean, 0 ahead — then uncommitted after a save, and ahead 1 after a commit', { skip: false }, async (t) => {
		if (!hasLocate) return t.skip('this engine predates Store#locate (0.39.1 and older) — the degradation test below covers it');
		forgetAhead();
		let f = await fields('northwind-kickoff');
		assert.equal(f.$repo, '.');
		assert.equal(f.$dirty, false);
		assert.equal(f.$ahead, 0);

		const saved = await quiet(() => api.handle('PATCH', '/collections/notes/records/northwind-kickoff', { title: 'Northwind kickoff, moved' }));
		assert.equal(saved.status, 200, JSON.stringify(saved.body));
		f = await fields('northwind-kickoff');
		assert.equal(f.$dirty, true, 'a save that no commit holds yet is uncommitted');

		const committed = await quiet(() => api.handle('POST', '/commit', { only: ['notes/northwind-kickoff'] }));
		assert.equal(committed.status, 200, JSON.stringify(committed.body));
		f = await fields('northwind-kickoff');
		assert.equal(f.$dirty, false, 'committed');
		assert.equal(f.$ahead, 1, 'the commit is not pushed: one ahead — and the commit cleared the cached count');
	});

	test('the keys are never written back — a save echoing them persists none', async (t) => {
		if (!hasLocate) return t.skip('this engine predates Store#locate');
		const f = await fields('northwind-kickoff');
		const saved = await quiet(() => api.handle('PATCH', '/collections/notes/records/northwind-kickoff', { $repo: f.$repo, $dirty: f.$dirty, $ahead: f.$ahead, title: 'Northwind kickoff' }));
		assert.equal(saved.status, 200, JSON.stringify(saved.body));
		assert.doesNotMatch(fs.readFileSync(path.join(ws.root, 'data/notes/northwind-kickoff.note.md'), 'utf8'), /\$repo|\$dirty|\$ahead/);
	});
});

describe('repoStateKeys degrades instead of guessing', () => {
	test('no location (an engine without Store#locate) → no repo keys at all', () => {
		assert.deepEqual(repoStateKeys('/nowhere', null), {});
	});
	test('a root outside every repo → $repo null alone: never committed, nothing to ask git', () => {
		assert.deepEqual(repoStateKeys('/nowhere', { file: '/elsewhere/journal/first.entry.md', repo: null }), { $repo: null });
	});
});
