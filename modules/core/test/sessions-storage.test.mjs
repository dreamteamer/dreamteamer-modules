// SESSIONS ARE PLAIN RECORDS (cr-modules-010, line 2; rnd/tests cr-modules-010-t2) — core installed the
// npm way into a virgin workspace on a real engine, with SESSIONS_FOLDER UNSET: a sessions record is an
// ordinary record under data/sessions/, committed like any other, and the var appears only in the
// transcript path session-save writes. Core needs engine 0.42.0 (the `next` contribution, line 6).
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import yaml from 'js-yaml';
import { cleanup, engineMeets, pkgOf, compiledDescriptor, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';
import { dt, coreWorkspace } from './helpers-sessions.mjs';
import { transcriptTemplate } from '../bin/session-save.mjs';

after(cleanup);
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;

describe('sessions are kept in the workspace\'s own data', { skip }, () => {
	test('storage.path carries no template; with SESSIONS_FOLDER unset add lands under data/sessions/ and commits', () => {
		const root = coreWorkspace();
		const d = yaml.load(compiledDescriptor(root, 'sessions'));
		assert.ok(!String(d.storage?.path ?? '').includes('${'), `storage.path is ${d.storage?.path}`);
		assert.ok(d.display.list.columns.includes('records'), 'the list shows a records column');
		const added = dt(root, ['add', 'sessions', '--name', 'Northwind calendar sync', '--started', '2026-10-28T09:00:00Z', '--harness', 'claude-code']);
		assert.equal(added.code, 0, added.err + added.out);
		const file = path.join(root, 'data', 'sessions', '2026', '10', '2026-10-28--northwind-calendar-sync.session.md');
		assert.ok(fs.existsSync(file), `no record at ${file}\n${added.out}`);
		const committed = dt(root, ['commit', 'sessions/2026/10/2026-10-28--northwind-calendar-sync', '-m', 'a session']);
		assert.equal(committed.code, 0, committed.err);
		assert.doesNotMatch(committed.out, /outside every git repo/);
		const tracked = execFileSync('git', ['ls-files', 'data/sessions'], { cwd: root, encoding: 'utf8' });
		assert.match(tracked, /2026-10-28--northwind-calendar-sync\.session\.md/);
	});

	test('core\'s engine floor is 0.47.0 — the engine that reads setup units (0.42 read `next`, which this still needs)', () => {
		assert.equal(pkgOf('core').dreamteamer.engine, '>=0.47.0');
	});
});

describe('the transcript path is the one place SESSIONS_FOLDER appears', () => {
	test('session-save names the transcript ${env:SESSIONS_FOLDER}/<yyyy>/<mm>/<id>.jsonl', () => {
		assert.equal(transcriptTemplate('3e880550-0000-4000-8000-000000000001', '2026-10-28T09:00:00Z'), '${env:SESSIONS_FOLDER}/2026/10/3e880550-0000-4000-8000-000000000001.jsonl');
	});
});
