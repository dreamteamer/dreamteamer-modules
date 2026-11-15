// dt session end WITHOUT STATUS (cr-modules-010, line 9; rnd/tests cr-modules-010-t9): it writes `ended`
// and, with --outcome, the body — nothing else — on any session, with no holder check, and a second run
// changes nothing.
import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { cleanup, engineMeets, pkgOf, ENGINE_VERSION } from '../../../tests/helpers/workspace.mjs';
import { dt, sessionsWorkspace } from './helpers-sessions.mjs';

after(cleanup);
const skip = !engineMeets('sessions') && `needs engine ${pkgOf('sessions').dreamteamer.engine}; testing ${ENGINE_VERSION}`;
const SID = '3e880550-0000-4000-8000-0000000000e1';

describe('dt session end', { skip }, () => {
	test('sets ended once, says so the second time, replaces the body with --outcome, never writes status or heartbeat', () => {
		const root = sessionsWorkspace();
		assert.equal(dt(root, ['add', 'sessions', '--id', SID, '--name', 'Northwind export', '--started', '2026-10-28T09:00:00Z', '--session_id', SID]).code, 0);
		const file = path.join(root, 'data', 'sessions', `${SID}.session.md`);
		const r1 = dt(root, ['session', 'end', SID], { env: { CLAUDE_CODE_SESSION_ID: 'someone-else' } });
		assert.equal(r1.code, 0, r1.err + r1.out);
		const once = fs.readFileSync(file, 'utf8');
		assert.match(once, /^ended: /m);
		assert.doesNotMatch(once, /^(status|heartbeat):/m);
		const r2 = dt(root, ['session', 'end', SID]);
		assert.equal(r2.code, 0, r2.err);
		assert.match(r2.out, /already ended/);
		assert.equal(fs.readFileSync(file, 'utf8'), once, 'a second end changed the file');
		const r3 = dt(root, ['session', 'end', SID, '--outcome', 'exported the Northwind grants']);
		assert.equal(r3.code, 0, r3.err);
		assert.match(fs.readFileSync(file, 'utf8'), /exported the Northwind grants/);
		const current = dt(root, ['session', 'end'], { env: { CLAUDE_CODE_SESSION_ID: SID } });
		assert.equal(current.code, 0, current.err);
		const missing = dt(root, ['session', 'end', 'no-such-session']);
		assert.equal(missing.code, 1);
		assert.match(missing.err, /no-such-session/);
	});
});
