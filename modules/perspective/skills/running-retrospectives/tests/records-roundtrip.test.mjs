// A read-modify-write of a record must be LOSSLESS in every field it did not touch.
//
// ⚠ YAML's core schema resolves an unquoted `2025-10-15` to a Date, and dumping that Date back
// writes `2025-10-15T00:00:00.000Z` — so a pass that only added one field silently turned a
// `format: date` field into a timestamp and `dt check` refused the record. Measured 2026-09-08 on
// one real goal, by a pass that never looked at its dates.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readRecord, writeRecord } from '../lib/records.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-')), 'x.record.md');

test('an unquoted date survives a round-trip as the string it was', () => {
	const file = tmp();
	fs.writeFileSync(file, '---\nname: A thing\nfirst_seen: 2025-10-15\nlast_seen: "2026-01-02"\n---\n\nthe body\n');
	const { fields, body } = readRecord(file);
	assert.equal(typeof fields.first_seen, 'string', 'a date must not come back as a Date object');
	assert.equal(fields.first_seen, '2025-10-15');
	writeRecord(file, { ...fields, added: 'a new field' }, body);
	const after = fs.readFileSync(file, 'utf8');
	// It goes back QUOTED — which is the point, not a compromise. `"2025-10-15"` is the only
	// spelling that means "string" to every reader; a bare one is a Date again to the engine's own
	// check and to the extension, which is the bug in the other direction.
	assert.match(after, /^first_seen: "2025-10-15"$/m);
	assert.match(after, /^last_seen: "2026-01-02"$/m, 'an already-quoted date is unchanged');
	assert.match(after, /^added: a new field$/m, 'and an ordinary string needs no quotes');
	assert.match(after, /\nthe body\n$/);
});

test('a timestamp string is not reinterpreted either', () => {
	const file = tmp();
	fs.writeFileSync(file, '---\nstarted_at: 2026-03-31T20:46:15.700Z\n---\n');
	const { fields } = readRecord(file);
	assert.equal(typeof fields.started_at, 'string');
	writeRecord(file, fields, '');
	assert.match(fs.readFileSync(file, 'utf8'), /^started_at: "2026-03-31T20:46:15\.700Z"$/m);
});

test('numbers, booleans and lists are untouched by the schema change', () => {
	const file = tmp();
	fs.writeFileSync(file, '---\ncount: 42\nratio: 0.5\nflag: true\nhandles:\n  - a@b.test\n  - c@d.test\n---\n');
	const { fields } = readRecord(file);
	assert.equal(fields.count, 42);
	assert.equal(fields.ratio, 0.5);
	assert.equal(fields.flag, true);
	assert.deepEqual(fields.handles, ['a@b.test', 'c@d.test']);
});
