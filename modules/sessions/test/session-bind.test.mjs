// dt session bind (cr-modules-010, lines 3-5; rnd/tests cr-modules-010-t3): a session's records take any
// number of references to records of any collection; a second bind changes nothing; an unknown ref is
// refused and nothing is written; another session listing the record gets one line, never a refusal;
// and a session record is written to the workspace the session runs in — never inside a git_modules/
// layer — so one harness session is one record.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanup, engineMeets, pkgOf, ENGINE_VERSION, compiledDescriptor } from '../../../tests/helpers/workspace.mjs';
import { dt, sessionsWorkspace, sessionFiles } from './helpers-sessions.mjs';
import { writeRootOf } from '../src/sessions/cli.js';

after(cleanup);
const skip = !engineMeets('sessions') && `needs engine ${pkgOf('sessions').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const SID = '3e880550-0000-4000-8000-0000000000b1';
const OTHER = '3e880550-0000-4000-8000-0000000000b2';
const as = (sid) => ({ env: { CLAUDE_CODE_SESSION_ID: sid } });

function seeded() {
	const root = sessionsWorkspace(undefined, { also: ['contacts', 'tasks'] });
	for (const a of [['companies', '--name', 'Northwind'], ['contacts', '--name', 'Dana Oren'], ['tasks', '--name', 'Send the Northwind quote']]) {
		const r = dt(root, ['add', ...a]);
		assert.equal(r.code, 0, r.err + r.out);
	}
	return root;
}
const refs = ['companies/northwind', 'contacts/dana-oren'];
const taskRef = (root) => `tasks/${fs.readdirSync(path.join(root, 'data', 'tasks'))[0].replace(/\.task\.md$/, '')}`;

describe('dt session bind', { skip }, () => {
	test('three refs of three collections in one call, then again: listed once, the file unchanged', () => {
		const root = seeded();
		const all = [...refs, taskRef(root)];
		const r1 = dt(root, ['session', 'bind', ...all], as(SID));
		assert.equal(r1.code, 0, r1.err + r1.out);
		assert.deepEqual(sessionFiles(root), [`${SID}.session.md`]);
		const file = path.join(root, 'data', 'sessions', `${SID}.session.md`);
		const text = fs.readFileSync(file, 'utf8');
		for (const ref of all) assert.ok(text.includes(ref), `${ref} not in records:\n${text}`);
		assert.match(text, /^session_id: /m);
		assert.match(text, /^harness: claude-code$/m);
		const r2 = dt(root, ['session', 'bind', ...all], as(SID));
		assert.equal(r2.code, 0, r2.err);
		assert.equal(fs.readFileSync(file, 'utf8'), text, 'a second bind changed the file');
		const listed = dt(root, ['get', `sessions/${SID}`, '--json']);
		assert.equal(JSON.parse(listed.out).records?.length ?? JSON.parse(listed.out).fields?.records?.length, 3);
	});

	test('an unknown ref is refused, naming it, and nothing is written', () => {
		const root = seeded();
		const r = dt(root, ['session', 'bind', 'companies/northwind', 'companies/harbor-mutual'], as(SID));
		assert.equal(r.code, 1, r.out);
		assert.match(r.err, /companies\/harbor-mutual/);
		assert.deepEqual(sessionFiles(root), []);
	});

	test('no session id and no --session: refused naming both', () => {
		const root = seeded();
		const r = dt(root, ['session', 'bind', 'companies/northwind']);
		assert.equal(r.code, 1);
		assert.match(r.err, /CLAUDE_CODE_SESSION_ID/);
		assert.match(r.err, /--session/);
	});

	test('a record another session lists: one line naming it, and bound anyway', () => {
		const root = seeded();
		assert.equal(dt(root, ['session', 'bind', 'companies/northwind'], as(OTHER)).code, 0);
		const r = dt(root, ['session', 'bind', 'companies/northwind', '--session', SID]);
		assert.equal(r.code, 0, r.err);
		const lines = (r.out + r.err).split('\n').filter((l) => l.includes('also bound to'));
		assert.equal(lines.length, 1, r.out + r.err);
		assert.ok(lines[0].includes(`sessions/${OTHER}`), lines[0]);
		assert.ok(fs.readFileSync(path.join(root, 'data', 'sessions', `${SID}.session.md`), 'utf8').includes('companies/northwind'));
	});

	test('the slash command ships: /session:bind runs dt session bind', () => {
		const root = sessionsWorkspace();
		const f = path.join(root, '.dreamteamer', 'commands', 'session', 'bind.command.md');
		assert.ok(fs.existsSync(f), 'no compiled session/bind command');
		assert.match(fs.readFileSync(f, 'utf8'), /dt session bind/);
		assert.ok(compiledDescriptor(root, 'sessions'));
	});
});

describe('one write root: the workspace the session runs in', () => {
	test('from inside git_modules/<layer>/ the write root is the parent workspace; a lone workspace is its own', () => {
		const hq = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-root-')));
		after(() => fs.rmSync(hq, { recursive: true, force: true }));
		const layer = path.join(hq, 'git_modules', 'northwind');
		fs.mkdirSync(layer, { recursive: true });
		for (const d of [hq, layer]) { fs.writeFileSync(path.join(d, 'package.json'), '{}'); fs.writeFileSync(path.join(d, 'package-lock.json'), '{}'); }
		assert.equal(writeRootOf(layer), hq);
		assert.equal(writeRootOf(hq), hq);
		const lone = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dtm-lone-')));
		after(() => fs.rmSync(lone, { recursive: true, force: true }));
		assert.equal(writeRootOf(lone), lone, 'a folder with no workspace above it writes to itself');
	});
});
