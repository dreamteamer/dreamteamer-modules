// A RECORD'S SESSIONS (cr-modules-010, line 6, core's half; rnd/tests cr-modules-010-t6): `dt next <ref>`
// carries one note per sessions record whose records list the ref — its text names `sessions/<sid>`,
// because the engine keeps only id, text and by — read at call time from every root the workspace reads,
// a layer's records included. A record no session lists has no note. Nothing is written to the record.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { cleanup, engineMeets, pkgOf, editPkg, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';
import { dt, coreWorkspace } from './helpers-sessions.mjs';

after(cleanup);
const skip = !engineMeets('core') && `needs engine ${pkgOf('core').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const SID = '3e880550-0000-4000-8000-0000000000c1';
const notesOf = (root, ref) => { const r = dt(root, ['next', ref, '--json']); assert.equal(r.code, 0, r.err); return JSON.parse(r.out).notes ?? []; };

describe('next notes list the sessions that bound a record', { skip }, () => {
	test('a bound record, a record of a layer, and an unbound record', () => {
		const root = coreWorkspace((ws) => {
			// a record layer: another workspace's data, cloned under git_modules/, read for `tasks`
			const layer = path.join(ws, 'git_modules', 'northwind');
			fs.mkdirSync(path.join(layer, 'data', 'tasks'), { recursive: true });
			fs.writeFileSync(path.join(layer, 'data', 'tasks', 'send-the-northwind-quote.task.md'), '---\nname: Send the Northwind quote\nstatus: todo\n---\n');
			execFileSync('git', ['init', '-q'], { cwd: layer });
			editPkg(ws, (pkg) => { pkg.dreamteamer.git_modules = { northwind: { url: 'https://git.example/northwind.git', ref: 'main', records: ['tasks'] } }; });
		});
		for (const a of [['companies', '--name', 'Northwind'], ['companies', '--name', 'Harbor Mutual']]) assert.equal(dt(root, ['add', ...a]).code, 0);
		const before = fs.readFileSync(path.join(root, 'data', 'companies', 'northwind.company.md'), 'utf8');
		const b = dt(root, ['session', 'bind', 'companies/northwind', 'tasks/send-the-northwind-quote', '--session', SID]);
		assert.equal(b.code, 0, b.err + b.out);
		for (const ref of ['companies/northwind', 'tasks/send-the-northwind-quote']) {
			const notes = notesOf(root, ref);
			assert.equal(notes.length, 1, `${ref}: ${JSON.stringify(notes)}`);
			assert.ok(notes[0].text.includes(`sessions/${SID}`), notes[0].text);
		}
		assert.deepEqual(notesOf(root, 'companies/harbor-mutual'), [], 'an unbound record has a note');
		assert.equal(fs.readFileSync(path.join(root, 'data', 'companies', 'northwind.company.md'), 'utf8'), before, 'binding wrote into the bound record');
	});
});
