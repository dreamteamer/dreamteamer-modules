// One name for one edge. Until this release the run was reached through `retrospective` on 11
// collections and `session` on 4, with the script flags carrying the same split — deliberate legacy
// that SKILL.md documented rather than fixed. `session` was the worse of the two, because this
// module also models agent sessions and calls them `conversations`.
//
// `contributor` is what makes a SECOND retrospective an update rather than a copy: it is the first
// segment of every evidence and model id (tests/keying.test.mjs), so the same person's projects,
// topics and goals resolve to the same records months later.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { shippedDescriptor } from '../skills/running-retrospectives/lib/descriptors.mjs';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', 'modules', 'perspective', 'collections', 'perspective');
const RUN = 'retrospective-sessions';
const RUN_LAYER = new Set([RUN, 'questions', 'proposals', 'gates']);

/** Every descriptor under `collections/perspective/`, by its name RELATIVE to that folder — so
 *  `users.collection.yaml` is `users`. Recursive, because `compile` enumerates `collections/` recursively. */
function descriptorNames(dir, prefix = '') {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? descriptorNames(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [`${prefix}${e.name.replace('.collection.yaml', '')}`] : []);
}

// read with their mixins merged in, so a field a mixin supplies counts as the collection's own
const descriptors = new Map(descriptorNames(DIR).map((n) => [n, shippedDescriptor(`perspective/${n}`)]));

test('twenty-three collections, and the run is one of them', () => {
	assert.equal(descriptors.size, 23);
	assert.ok(descriptors.has(RUN));
});

// ⚠ THE ONE COLLECTION WITH A DIFFERENT CARDINALITY, and it is a different RELATION rather than a
// second convention. Every other contributor-keyed record is PRODUCED by a run — a conversation is
// condensed once, an activity reconstructed — so "which run wrote it" and "which run last confirmed
// it" are the two questions anybody asks. A source is DURABLE: the repo, the transcripts tree, the
// mailbox exist independently of any run and EVERY run re-reads them, so first-plus-last lost every
// run in between from the third onward. `retrospectives` is a list and a run id begins with its own
// start date, so sorting it gives first, last and everything between from one field.
const M2M = 'sources';

test('sources is many-to-many with the run, and keeps neither retired scalar', () => {
	const props = descriptors.get(M2M).fields;
	assert.equal(props.retrospectives?.many, true);
	assert.equal(props.retrospectives?.type, `perspective/${RUN}`);
	assert.equal(props.retrospectives?.required, true, 'a source nothing has ever looked at is not a source');
	assert.ok(!('retrospective' in props), 'the scalar is gone, not kept beside the list');
	assert.ok(!('last_seen_in' in props), 'a sorted list gives last-seen; two places for one fact is the next thing to delete');
});

test('the run record declares the mirror, so it is visible where a reader looks', () => {
	const props = descriptors.get(RUN).fields;
	assert.equal(props.sources?.type, 'perspective/sources');
	assert.equal(props.sources?.mirror_of, 'retrospectives');
});

for (const [name, d] of descriptors) {
	const props = d.fields ?? {};
	const required = new Set(Object.entries(props).filter(([, f]) => f?.required).map(([k]) => k));

	test(`${name} declares no "session" field`, () => {
		assert.ok(!('session' in props), 'a session here means an agent session, which is a conversation');
	});

	if (name === RUN) {
		test('the run itself carries the contributor and no self-reference', () => {
			assert.equal(props.contributor?.type, 'string');
			assert.ok(required.has('contributor'));
			assert.ok(!('retrospective' in props));
			assert.ok(!('label' in props), 'label was the contributor under another name');
		});
		continue;
	}

	if (name === M2M) continue;   // asserted above, with its own cardinality

	test(`${name} points at the run through "retrospective", and requires it`, () => {
		assert.equal(props.retrospective?.type, `perspective/${RUN}`);
		assert.ok(!props.retrospective?.many);
		assert.ok(required.has('retrospective'));
	});

	test(`${name} can record the session that last confirmed it`, () => {
		assert.equal(props.last_seen_in?.type, `perspective/${RUN}`);
		assert.ok(!required.has('last_seen_in'), 'absent means exactly one session has ever touched it');
	});

	if (RUN_LAYER.has(name)) {
		test(`${name} is run-layer and carries no contributor of its own`, () => {
			assert.ok(!('contributor' in props), 'the run names the contributor; a question does not repeat it');
		});
		continue;
	}

	test(`${name} carries the contributor, and requires it`, () => {
		assert.equal(props.contributor?.type, 'string');
		assert.ok(required.has('contributor'));
	});
}

// ── AND THE WRITERS, NOT ONLY THE DESCRIPTORS ────────────────────────────────────────────────────
// The descriptor half of this gate passed all day while FIVE production writers went on stamping
// `session:` onto every `sources` record they wrote — read-git, read-asana, read-gmail and
// read-drive twice. The field does not exist any more, and `retrospective` is REQUIRED, so every
// source record those readers produce is refused by `check`: an unknown key and a missing required
// one, on the first record of the first stage. read-git additionally wrote no `contributor`, which
// is the id's own first segment.
//
// This is the same shape as the defect the compaction note records — "no writer set contributor,
// and check refused 7/7 source records while the suite was green". A descriptor test cannot see a
// writer. This one reads the writers.
const BINS = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'skills', 'running-retrospectives');
const SCRIPT_DIRS = ['bin', 'lib'];
/** Non-record uses of the word, each one checked by hand. */
const NOT_A_RECORD_KEY = new Set([
	'const KIND_ORDER = { session: 0, commit: 1, ticket: 2, thread: 3, deliverable: 4, meeting: 5 };',
]);

test('no writer stamps the retired run-link field onto a record', () => {
	const offenders = [];
	for (const d of SCRIPT_DIRS) {
		const dir = path.join(BINS, d);
		if (!fs.existsSync(dir)) continue;
		for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
			const body = fs.readFileSync(path.join(dir, f), 'utf8');
			for (const [i, line] of body.split('\n').entries()) {
				if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
				if (NOT_A_RECORD_KEY.has(line.trim())) continue;
				if (/(^|[^_\w])session:/.test(line)) offenders.push(`${d}/${f}:${i + 1}: ${line.trim()}`);
			}
		}
	}
	assert.deepEqual(offenders, [], `one run link, named retrospective — these still write the old one:\n  ${offenders.join('\n  ')}`);
});

test('every record a reader writes carries the run link and the contributor', () => {
	// ⚠ THIS GATE HAS HAD THREE HOLES, AND EACH ONE HID REAL CORRUPTION. Worth stating, because the
	// pattern is the lesson rather than any one bug:
	//
	//   1. It checked `sources` writes only — the collection the first instance was found on. Every
	//      reader writes several; the same omission sat in all of them. 1,429 invalid records.
	//   2. It matched `recordPath(` with `[^)]*`, which stops at the first `)` — and an id argument
	//      routinely contains one. Two call sites were never MATCHED. 913 more.
	//   3. It only looked at `writeRecord(recordPath(…))`. read-git precomputes the path into a
	//      variable and writes `writeRecord(g.file, {…})`, so its collaborator write was invisible. 12.
	//
	// So it no longer tries to be clever about which call is which: it reads EVERY `writeRecord(` in
	// every reader and library, and asks the object literal directly.
	const RUN_LAYER_WRITES = new Set([
		// Writes that update the run record or a run-layer record, where `contributor` does not belong.
		'inventory.mjs', 'import-paste-back.mjs',
	]);
	const offenders = [];
	for (const dir of ['bin', 'lib']) {
		const d = path.join(BINS, dir);
		if (!fs.existsSync(d)) continue;
		for (const f of fs.readdirSync(d).filter((x) => x.endsWith('.mjs'))) {
			const body = fs.readFileSync(path.join(d, f), 'utf8');
			for (const m of body.matchAll(/writeRecord\(/g)) {
				// Walk to the object literal: past the path argument's balanced parens, to the `{`.
				let i = m.index + 'writeRecord('.length, depth = 0;
				while (i < body.length) {
					const c = body[i];
					if (c === '(') depth++;
					else if (c === ')') { if (depth === 0) break; depth--; }
					else if (c === ',' && depth === 0) { i++; break; }
					i++;
				}
				while (i < body.length && /\s/.test(body[i])) i++;
				if (body[i] !== '{') continue;   // an identifier: covered where it is built, below
				// The literal, to its matching brace.
				let j = i + 1, braces = 1;
				while (j < body.length && braces > 0) { if (body[j] === '{') braces++; else if (body[j] === '}') braces--; j++; }
				const lit = body.slice(i, j);
				// A spread of an existing record inherits its fields — UNLESS it can be empty, which is a
				// creation wearing an update's clothes.
				const spread = /\.\.\.\s*\(?\s*(\w+(?:\.\w+)*)\s*(\?\?\s*\{\s*\})?/.exec(lit);
				if (spread && !spread[2]) continue;
				const hasKey = (k) => new RegExp(`(^|[{,\\s])${k}\\s*[:,]`, 'm').test(lit);
				const line = body.slice(0, m.index).split('\n').length;
				if (!hasKey('retrospective')) offenders.push(`${dir}/${f}:${line} — writeRecord with no retrospective`);
				if (!hasKey('contributor') && !RUN_LAYER_WRITES.has(f)) offenders.push(`${dir}/${f}:${line} — writeRecord with no contributor`);
			}
		}
	}
	assert.deepEqual([...new Set(offenders)], [],
		`retrospective is required on all nineteen collections, and the contributor is the id's first segment:\n  ${[...new Set(offenders)].join('\n  ')}`);
});
