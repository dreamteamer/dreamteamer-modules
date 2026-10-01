// A paste-back is a SOURCE, not an answer. `perspective/answers` was deleted on 2026-09-08 when
// answers were folded into the question that asked them, and a paste-back has no question — so it
// lands in the body of its tool's `sources` record, whose `kind` enum has carried `paste-back`
// since v1. Verbatim is the whole promise: a Hebrew line, a bare `---` and every blank line survive.
import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRecord, recordPath, writeRecord } from '../lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'import-paste-back.mjs');
const SESSION = 'perspective/retrospective-sessions/2026-09-08--fx';
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const ID = `${SLUG}/paste-back--paste-back-chatgpt`;

/** Every reader resolves its key off the run record, so a data root without one cannot be read.
 *  ⚠ Not used by the refusal test below, which asserts that NOTHING is written. */
function seedSession(data) {
	const id = SESSION.split('/').pop();
	writeRecord(recordPath('retrospective-sessions', id, 'retrospective-session', data),
		{ contributor: SLUG, handles: ['dana.o@northwind.example'], started: id.slice(0, 10), stage: 'installed' });
	return data;
}

const REPLY = [
	'You work mostly on infrastructure for coding agents.',
	'',
	'---',
	'',
	'אתה עובד הרבה בלילה.',
	'',
	'    an indented line that is not code',
].join('\n');

function tmp(text) {
	const d = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-pb-'));
	const f = path.join(d, 'reply.md');
	fs.writeFileSync(f, text + '\n\n\n');
	return { d, f };
}
const run = (f, data, origin = 'paste-back-chatgpt') =>
	execFileSync('node', [BIN, f, '--retrospective', SESSION, '--origin', origin, '--data-root', data], { encoding: 'utf8' });

test('the reply lands verbatim in the source body, with the perimeter facts in frontmatter', () => {
	const { d, f } = tmp(REPLY);
	const data = seedSession(path.join(d, 'data'));
	const out = run(f, data);
	assert.match(out, /sources\/fx\/paste-back--paste-back-chatgpt · 1 import/);
	const { fields, body } = readRecord(recordPath('sources', ID, 'source', data));
	assert.equal(fields.kind, 'paste-back');
	assert.equal(fields.reach, 'available');
	assert.equal(fields.counts.imports, 1);
	assert.ok(body.includes('אתה עובד הרבה בלילה.'), 'a Hebrew line survives');
	assert.ok(body.includes('\n---\n'), 'a bare --- survives, and did not end the frontmatter');
	assert.ok(body.includes('    an indented line that is not code'), 'leading whitespace survives');
	assert.match(body, /^## pasted back \d{4}-\d{2}-\d{2}$/m);
});

test('a second, different reply from the same tool APPENDS — what it remembers changing IS the evidence', () => {
	const { d, f } = tmp(REPLY);
	const data = seedSession(path.join(d, 'data'));
	run(f, data);
	const f2 = path.join(d, 'later.md');
	fs.writeFileSync(f2, 'Six months on, you mostly do consulting now.\n');
	run(f2, data);
	const { fields, body } = readRecord(recordPath('sources', ID, 'source', data));
	assert.ok(body.includes('infrastructure for coding agents'), 'the first reply is still there');
	assert.ok(body.includes('consulting now'), 'and so is the second');
	assert.equal(fields.counts.imports, 2);
});

test('importing the same file twice is idempotent', () => {
	const { d, f } = tmp(REPLY);
	const data = seedSession(path.join(d, 'data'));
	run(f, data);
	run(f, data);
	assert.equal(readRecord(recordPath('sources', ID, 'source', data)).fields.counts.imports, 1);
});

test('an unknown origin is refused, and nothing is written', () => {
	const { d, f } = tmp(REPLY);
	const data = path.join(d, 'data');
	const r = spawnSync('node', [BIN, f, '--retrospective', SESSION, '--origin', 'paste-back-claude', '--data-root', data], { encoding: 'utf8' });
	assert.equal(r.status, 2);
	assert.match(r.stderr, /unknown --origin/);
	assert.equal(fs.existsSync(path.join(data, 'perspective')), false);
});
