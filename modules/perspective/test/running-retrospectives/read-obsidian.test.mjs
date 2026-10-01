// A personal notes vault as evidence. What this pins is mostly what the reader REFUSES: no body
// text ever reaches a record, `.obsidian` and every other dot-directory is skipped, and the one
// thing a vault cannot tell you (who wrote it, and when it was really written) is not invented.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readRecord, recordPath, writeRecord, listRecords } from '../../skills/running-retrospectives/lib/records.mjs';

const BIN = fileURLToPath(new URL('../../skills/running-retrospectives/bin/read-obsidian.mjs', import.meta.url));
const BASE = '2026-09-08--fx', SESSION = `perspective/retrospective-sessions/${BASE}`;
const SLUG = 'fx';   // the contributor — evidence and model ids are keyed by it, not by the run
const SECRET = 'the-quick-brown-fox-nobody-should-copy';

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obsv-'));
	const vault = path.join(root, 'notes');
	const data = path.join(root, 'data');
	fs.mkdirSync(path.join(vault, 'ideas'), { recursive: true });
	fs.mkdirSync(path.join(vault, '.obsidian', 'plugins', 'sync'), { recursive: true });
	fs.mkdirSync(path.join(vault, '.trash'), { recursive: true });
	writeRecord(recordPath('retrospective-sessions', BASE, 'retrospective-session', data), { contributor: SLUG, handles: ['me@acme.example'], started: '2026-09-08' });

	fs.writeFileSync(path.join(vault, 'On pricing.md'),
		`---\ntags: [strategy, pricing]\n---\n\n${SECRET} and a link to [[Another note]] plus #inline-tag here.\n`);
	fs.writeFileSync(path.join(vault, 'ideas', 'A half thought.md'), 'three words only\n');
	// Never read: config, plugin state, and whatever a sync plugin keeps.
	fs.writeFileSync(path.join(vault, '.obsidian', 'plugins', 'sync', 'data.json'), `{"token":"${SECRET}"}`);
	fs.writeFileSync(path.join(vault, '.trash', 'Deleted.md'), 'gone\n');
	// Not markdown.
	fs.writeFileSync(path.join(vault, 'diagram.png'), 'PNG');
	return { root, vault, data };
}
const run = (vault, data, extra = []) =>
	execFileSync('node', [BIN, '--retrospective', SESSION, '--vault', vault, '--label', 'personal', '--data-root', data, ...extra], { encoding: 'utf8' });
const deliverables = (data) => listRecords(path.join(data, 'perspective', 'deliverables')).map((f) => ({ file: f, ...readRecord(f) }));

test('a note becomes a deliverable of kind `note`, with its tags and counts and no prose', () => {
	const { vault, data } = fixture();
	const receipt = run(vault, data);
	assert.match(receipt, /2 note\(s\)/, 'two markdown files, and neither the png nor the dot-directories');
	const rows = deliverables(data);
	assert.equal(rows.length, 2);
	const pricing = rows.find((r) => r.fields.name === 'On pricing');
	assert.equal(pricing.fields.kind, 'note');
	assert.equal(pricing.fields.source_kind, 'obsidian');
	assert.equal(pricing.fields.source, `perspective/sources/${SLUG}/obsidian--personal`);
	assert.deepEqual(pricing.fields.tags, ['inline-tag', 'pricing', 'strategy'], 'frontmatter and inline tags, deduped and sorted');
	assert.equal(pricing.fields.container, 'personal');
	assert.equal(rows.find((r) => r.fields.name === 'A half thought').fields.container, 'personal / ideas');
});

test('⚠ NO BODY REACHES A RECORD — not as a summary, not as a first line, not anywhere', () => {
	// The whole reason this source is different: a private vault was never addressed to anyone.
	const { vault, data } = fixture();
	run(vault, data);
	const everything = listRecords(path.join(data, 'perspective'))
		.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
	assert.ok(!everything.includes(SECRET), 'a word from a note body must not appear in any record');
});

test('a dot-directory is never walked — not .obsidian, not .trash', () => {
	const { vault, data } = fixture();
	run(vault, data);
	const names = deliverables(data).map((r) => r.fields.name).sort();
	assert.deepEqual(names, ['A half thought', 'On pricing']);
	assert.ok(!names.includes('Deleted'));
});

test('the week counts notes and words, and says so in fields that mean only that', () => {
	const { vault, data } = fixture();
	run(vault, data);
	const weeks = listRecords(path.join(data, 'perspective', 'activity-weeks')).map((f) => readRecord(f).fields);
	assert.equal(weeks.length, 1, 'both notes were written now, so one week');
	assert.equal(weeks[0].files_touched, 2);
	assert.ok(weeks[0].words_written >= 12, 'the words are counted even though none of them are kept');
	assert.equal(weeks[0].input_words, undefined, 'input_words is what was typed AT AN AGENT — a note is not that');
	assert.equal(weeks[0].output_words, undefined, 'and output_words is an agent’s reply');
	assert.ok(weeks[0].start_date && weeks[0].end_date, 'the week carries its dates so a gantt can draw it');
});

test('the source record says what was reachable, and re-running writes nothing new', () => {
	const { vault, data } = fixture();
	run(vault, data);
	const src = readRecord(recordPath('sources', `${SLUG}/obsidian--personal`, 'source', data));
	assert.equal(src.fields.kind, 'obsidian');
	assert.equal(src.fields.reach, 'available');
	assert.equal(src.fields.counts.notes, 2);
	assert.match(src.body, /No body of any note is read/);
	assert.match(run(vault, data), /written 0 · unchanged 2/);
});

test('`--notes` and `--vault` name the same folder', () => {
	const { vault, data } = fixture();
	const receipt = execFileSync('node', [BIN, '--retrospective', SESSION, '--notes', vault, '--label', 'personal', '--data-root', data], { encoding: 'utf8' });
	assert.match(receipt, /2 note\(s\)/);
	assert.equal(deliverables(data).length, 2);
});

test('an empty vault is `unavailable`, which is a stated gap rather than a silent one', () => {
	const { root, data } = fixture();
	const empty = path.join(root, 'nothing');
	fs.mkdirSync(empty);
	// ⚠ Built directly rather than through `run`, which already passes `--label`: a repeated flag
	// takes the FIRST occurrence, so appending a second one silently keeps the first.
	execFileSync('node', [BIN, '--retrospective', SESSION, '--vault', empty, '--label', 'empty', '--data-root', data], { encoding: 'utf8' });
	assert.equal(readRecord(recordPath('sources', `${SLUG}/obsidian--empty`, 'source', data)).fields.reach, 'unavailable');
});
