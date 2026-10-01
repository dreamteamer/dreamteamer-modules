#!/usr/bin/env node
// backfill-week-dates — write `start_date` and `end_date` onto every activity-weeks record that lacks
// them (or carries a pair that disagrees with `period`). Derived from `period` by `isoWeekRange`, the
// same function the readers use, so a backfilled week and a freshly read one cannot differ.
//
//   node backfill-week-dates.mjs [--data-root d] [--dry-run]
//
// Idempotent: a record already carrying the right pair is left untouched and counted as `ok`. Every
// other field on the record — including a model-written `summary` — is carried through unchanged.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, isoWeekRange } from '../lib/vault.mjs';
import { readRecord, writeRecord } from '../lib/records.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = '') => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dataRoot = opt('data-root', DATA);
const root = path.join(dataRoot, 'perspective', 'activity-weeks');

function* walk(dir) {
	if (!fs.existsSync(dir)) return;
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) yield* walk(p);
		else if (e.name.endsWith('.activity-week.md')) yield p;
	}
}

let ok = 0, written = 0, skipped = 0;
for (const file of walk(root)) {
	const { fields, body } = readRecord(file);
	let range;
	try { range = isoWeekRange(fields.period); } catch { skipped++; process.stderr.write(`skip ${path.relative(dataRoot, file)}: period ${fields.period}\n`); continue; }
	if (fields.start_date === range.start && fields.end_date === range.end) { ok++; continue; }
	// Keep the field order the readers use: the dates sit right after `period`.
	const next = {};
	for (const [k, v] of Object.entries(fields)) {
		if (k === 'start_date' || k === 'end_date') continue;
		next[k] = v;
		if (k === 'period') { next.start_date = range.start; next.end_date = range.end; }
	}
	if (!('start_date' in next)) { next.start_date = range.start; next.end_date = range.end; }
	if (!flag('dry-run')) writeRecord(file, next, body);
	written++;
}
process.stdout.write(`✔ activity-weeks dated · already ok ${ok} · written ${written} · skipped ${skipped}${flag('dry-run') ? ' · DRY RUN, nothing written' : ''}\n`);
