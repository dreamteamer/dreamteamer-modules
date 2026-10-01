// The one merge rule, pinned: keyed on email or id, never on a name; a display name that another
// record already carries is NOT written as a handle (that would be a merge by name); a name equal to
// the email is not two handles; an existing record keeps its count when the new evidence is smaller.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordPath, writeRecord, readRecord, listRecords } from '../lib/records.mjs';
import { upsertCollaborators } from '../lib/collaborators.mjs';

const BASE = '2026-09-08--fx', REF = `perspective/retrospective-sessions/${BASE}`;
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const args = (root, people) => ({ dataRoot: root, contributorSlug: SLUG, retrospective: REF, sourceRef: 'perspective/sources/x/gmail--me', people, role: 'correspondent', author: 't', context: 't' });

test('a name already on another record is not written as a handle, and the body says so', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-'));
	writeRecord(recordPath('world/users', `${SLUG}/tal-y`, 'user', root), { retrospective: REF, name: 'Tal Y', handles: ['12345+taly@users.noreply.github.example', 'Tal Y'], evidence_count: 900 });
	const r = upsertCollaborators(args(root, [{ email: 'tal@acme.example', name: 'Tal Y', count: 3, days: ['2026-08-01'] }]));
	assert.deepEqual(r, { added: 1, matched: 0 });
	const files = listRecords(path.join(root, 'perspective', 'world', 'users', SLUG)).sort();
	assert.equal(files.length, 2);
	const fresh = files.map((f) => readRecord(f)).find((x) => x.fields.handles.includes('tal@acme.example'));
	assert.deepEqual(fresh.fields.handles, ['tal@acme.example']);
	assert.match(fresh.body, /already a handle on another collaborator record/);
	assert.equal(readRecord(files.find((f) => f.endsWith('tal-y.user.md'))).fields.evidence_count, 900);
});

test('a name equal to the email is one handle, and a matched record keeps the larger count', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-'));
	let r = upsertCollaborators(args(root, [{ email: 'bob@acme.example', name: 'bob@acme.example', count: 2, days: ['2026-08-01'] }]));
	assert.deepEqual(r, { added: 1, matched: 0 });
	const f = listRecords(path.join(root, 'perspective', 'world', 'users', SLUG))[0];
	assert.deepEqual(readRecord(f).fields.handles, ['bob@acme.example']);
	r = upsertCollaborators(args(root, [{ email: 'Bob@Acme.example', name: 'Bob', count: 1, days: ['2026-08-09'] }]));
	assert.deepEqual(r, { added: 0, matched: 1 });
	const after = readRecord(f).fields;
	assert.deepEqual(after.handles, ['bob@acme.example', 'Bob']);
	assert.equal(after.evidence_count, 2);
	assert.equal(after.last_seen, '2026-08-09');
});
