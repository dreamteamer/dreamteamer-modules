import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isoWeek, isoWeekRange } from '../../skills/running-retrospectives/lib/workspace.mjs';
import { recordPath, writeRecord, readRecord } from '../../skills/running-retrospectives/lib/records.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('isoWeekRange is Monday to Sunday and the inverse of isoWeek — including the December-start week 1', () => {
	assert.deepEqual(isoWeekRange('2026-W36'), { start: '2026-08-31', end: '2026-09-06' });
	assert.deepEqual(isoWeekRange('2026-W01'), { start: '2025-12-29', end: '2026-01-04' });   // week 1 starts in the old year
	assert.deepEqual(isoWeekRange('2027-W01'), { start: '2027-01-04', end: '2027-01-10' });
	assert.deepEqual(isoWeekRange('2020-W53'), { start: '2020-12-28', end: '2021-01-03' });   // a 53-week year
	// round trip over four years of Mondays
	for (let d = new Date(Date.UTC(2023, 0, 2)); d < new Date(Date.UTC(2027, 0, 1)); d.setUTCDate(d.getUTCDate() + 7)) {
		const p = isoWeek(d);
		assert.equal(isoWeekRange(p).start, d.toISOString().slice(0, 10), p);
	}
	assert.throws(() => isoWeekRange('2026-09'), /not an ISO week/);
});

test('backfill-week-dates writes the pair once, keeps summary, and is idempotent', () => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'perspective-weeks-'));
	const p = (id) => recordPath('activity-weeks', id, 'activity-week', root);
	writeRecord(p('git--acme/2026-W36'), { source: 'perspective/sources/x/git--acme', period: '2026-W36', commits: 3, summary: 'a model wrote this' });
	writeRecord(p('git--acme/2026-W37'), { source: 'perspective/sources/x/git--acme', period: '2026-W37', start_date: '2026-09-07', end_date: '2026-09-13', commits: 1 });
	writeRecord(p('git--acme/2026-W38'), { source: 'perspective/sources/x/git--acme', period: '2026-W38', start_date: '2026-01-01', end_date: '2026-01-07', commits: 1 });  // wrong pair
	const run = () => spawnSync(process.execPath, [path.join(HERE, '../../skills/running-retrospectives/bin/backfill-week-dates.mjs'), '--data-root', root], { encoding: 'utf8' });
	let r = run();
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /already ok 1 · written 2/);
	const w36 = readRecord(p('git--acme/2026-W36')).fields;
	assert.equal(w36.start_date, '2026-08-31'); assert.equal(w36.end_date, '2026-09-06');
	assert.equal(w36.summary, 'a model wrote this');
	assert.deepEqual(Object.keys(w36).slice(0, 4), ['source', 'period', 'start_date', 'end_date']);
	assert.equal(readRecord(p('git--acme/2026-W38')).fields.start_date, '2026-09-14');
	r = run();
	assert.match(r.stdout, /already ok 3 · written 0/);
});
