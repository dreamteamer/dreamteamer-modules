// Threads and deliverables are evidence the cluster pass places — on first_on and last_touched_on,
// in a mail-domain or drive-container bucket — and the candidate carries their refs, so a naming
// agent can attach them. Without this a document- or mail-shaped contributor's evidence never
// reaches an activity.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { recordPath, writeRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSION = '2026-09-08--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const REF = `perspective/retrospective-sessions/${SESSION}`;

test('threads bucket by counterpart domain, deliverables by container, and the candidate cites both', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-cluster-'));
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-scratch-'));
	writeRecord(recordPath('retrospective-sessions', SESSION, 'retrospective-session', root), { contributor: SLUG, handles: ['me@work.example'], started: '2026-09-08', stage: 'inventoried' });
	const src = `perspective/sources/${SLUG}/gmail--me-work-example`;
	writeRecord(recordPath('sources', `${SLUG}/gmail--me-work-example`, 'source', root), { retrospective: REF, kind: 'gmail', label: 'gmail', reach: 'available' });
	writeRecord(recordPath('threads', `${SLUG}/gmail--me-work-example/T1`, 'thread', root), { source: src, external_id: 'T1', subject: 'Spec review', participants: ['bob@acme.example', 'me@work.example'], message_count: 3, contributor_messages: 1, first_on: '2026-08-03', last_on: '2026-08-04' });
	writeRecord(recordPath('threads', `${SLUG}/gmail--me-work-example/T2`, 'thread', root), { source: src, external_id: 'T2', subject: 'Spec review follow-up', participants: ['bob@acme.example', 'cy@acme.example', 'me@work.example'], message_count: 2, contributor_messages: 1, first_on: '2026-08-05', last_on: '2026-08-05' });
	writeRecord(recordPath('threads', `${SLUG}/gmail--me-work-example/T3`, 'thread', root), { source: src, external_id: 'T3', subject: 'Dinner', participants: ['friend@gmail.com', 'me@work.example'], message_count: 1, contributor_messages: 1, first_on: '2026-08-05', last_on: '2026-08-05' });
	writeRecord(recordPath('deliverables', `${SLUG}/2026-08-04--spec-v2`, 'deliverable', root), { retrospective: REF, name: 'Spec v2', kind: 'doc', source_kind: 'drive', container: 'Product', last_touched_on: '2026-08-04' });
	writeRecord(recordPath('deliverables', `2026-01-01--other/2026-08-04--not-mine`, 'deliverable', root), { retrospective: 'perspective/retrospective-sessions/2026-01-01--other', name: 'Not mine', kind: 'doc', source_kind: 'drive', container: 'Product', last_touched_on: '2026-08-04' });
	const r = spawnSync(process.execPath, [path.join(HERE, '../../skills/running-retrospectives/bin/cluster-activities.mjs'), '--retrospective', REF, '--data-root', root, '--scratch-root', scratch, '--since', '2026-01-01'], { encoding: 'utf8' });
	assert.equal(r.status, 0, r.stderr + r.stdout);
	const lines = fs.readFileSync(path.join(scratch, 'activity-candidates', `${SESSION}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
	const byRepo = Object.fromEntries(lines.map((c) => [c.repo, c]));
	assert.deepEqual(byRepo['mail:acme.example'].threads, [`perspective/threads/${SLUG}/gmail--me-work-example/T1`, `perspective/threads/${SLUG}/gmail--me-work-example/T2`]);
	assert.ok(byRepo['mail:acme.example'].handles.includes('bob@acme.example'));
	assert.deepEqual(byRepo['mail:(personal)'].threads, [`perspective/threads/${SLUG}/gmail--me-work-example/T3`]);
	assert.deepEqual(byRepo['drive:Product'].deliverables, [`perspective/world/deliverables/${SLUG}/2026-08-04--spec-v2`]);  // the other run's artefact is not here
	assert.equal(byRepo['mail:acme.example'].started, '2026-08-03');
});
