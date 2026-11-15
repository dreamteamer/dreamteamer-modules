// THE CONTRIBUTOR IS A SLUG, AND THE HANDLE IS A HANDLE — one gate over the three places that got
// this wrong at once when `contributor` stopped being a pointer and became an id segment.
//
// Until 2026-09-09 `contributor` held `perspective/collaborators/<id>`: a reference, resolved per
// record, one hop from the run's own handle. The three-layer re-keying made it the FIRST SEGMENT OF
// THE ID instead, which a reference cannot be. Three things did not follow the change:
//
//   1. No `contributor` property declared a pattern, so the schema still ACCEPTED a reference — the
//      id template would then generate `perspective/collaborators/…/name` as a path. A pattern is
//      what makes the engine refuse it, and a comment is not a gate.
//   2. `bin/set-contributor.mjs` still wrote exactly that reference into exactly that field, over
//      every activity and goal. Nothing referenced it — not SKILL.md, not the command, not a test —
//      so it was dead code that could only corrupt. Deleted.
//   3. Two descriptors kept a comment block arguing for the OLD design two lines under the new
//      field description that contradicts it. Stale justifications get copied; this catches them.
//
// And the fourth, found in the same read: the run record's `contact` was documented as a CRM
// reference (`contacts/<id>`) while five scripts and twenty fixtures used it as an email address to
// match against `collaborators.handles`. One field, two meanings, in a module whose sibling
// collection spells both of them correctly. Split: `handles` is the merge key exactly as it is on
// `collaborators`, and `contact` is the same typed reference it is there.
import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// the repo root — these tests were written at the root of dreamteamer/extensions, whose modules/ layout
// this repo keeps, so every `ROOT/modules/<m>/…` path still names the same file
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const DIR = path.join(ROOT, 'modules', 'perspective', 'collections', 'perspective');
const BINS = path.join(ROOT, 'modules', 'perspective', 'skills', 'running-retrospectives', 'bin');
const SLUG = '^[a-z0-9-]+$';

/** Every descriptor under `collections/perspective/`, keyed by its name RELATIVE to that folder —
 *  so `users.collection.yaml` is `users`. ⚠ Recursive: `compile` enumerates
 *  `collections/` recursively so a namespaced descriptor can be authored at `collections/<ns>/<c>`,
 *  and a flat readdir here would silently stop testing five collections. */
function descriptorNames(dir, prefix = '') {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? descriptorNames(path.join(dir, e.name), `${prefix}${e.name}/`)
			: e.name.endsWith('.collection.yaml') ? [`${prefix}${e.name.replace('.collection.yaml', '')}`] : []);
}

const NAMES = descriptorNames(DIR);
const descriptors = new Map(NAMES.map((n) => [n, yaml.load(fs.readFileSync(path.join(DIR, `${n}.collection.yaml`), 'utf8'))]));
const raw = new Map(NAMES.map((n) => [n, fs.readFileSync(path.join(DIR, `${n}.collection.yaml`), 'utf8')]));

test('every contributor field is a slug the schema can refuse a reference for', () => {
	const bad = [];
	for (const [name, d] of descriptors) {
		const p = d.fields?.contributor;
		if (!p) continue;
		if (p.pattern !== SLUG) bad.push(`${name}: pattern is ${JSON.stringify(p.pattern)}, want ${JSON.stringify(SLUG)}`);
	}
	assert.deepEqual(bad, [], `a contributor without a pattern accepts a reference, and the id template then renders it as a path:\n  ${bad.join('\n  ')}`);
});

test('the slug pattern actually rejects the reference the old design wrote', () => {
	const re = new RegExp(SLUG);
	assert.ok(re.test('dana-o'));
	assert.ok(!re.test('perspective/collaborators/dana-o/dana-oren'));
	assert.ok(!re.test('dana.o@northwind.example'));
});

test('no descriptor still argues that the contributor points at a collaborator record', () => {
	const offenders = [];
	for (const [name, body] of raw) {
		for (const line of body.split('\n')) {
			if (/^\s*#/.test(line) && /pointing at the `?collaborators`? record/i.test(line)) offenders.push(`${name}: ${line.trim()}`);
		}
	}
	assert.deepEqual(offenders, [], `a comment arguing for the design the field no longer has:\n  ${offenders.join('\n  ')}`);
});

test('no script writes a collaborator reference into the contributor field', () => {
	const offenders = [];
	for (const f of fs.readdirSync(BINS).filter((x) => x.endsWith('.mjs'))) {
		const body = fs.readFileSync(path.join(BINS, f), 'utf8');
		for (const [i, line] of body.split('\n').entries()) {
			if (/^\s*(\/\/|\*)/.test(line)) continue;
			if (/contributor:\s*ref\b/.test(line) || /contributor:\s*[`'"]perspective\//.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
		}
	}
	assert.deepEqual(offenders, [], `the contributor is an id segment now, so a reference in it is a corrupt record:\n  ${offenders.join('\n  ')}`);
});

test('the run record carries handles, spelled and shaped exactly as perspective/users spells them', () => {
	const run = descriptors.get('retrospective-sessions').fields;
	const collab = descriptors.get('users').fields;
	assert.equal(run.handles?.many, true, 'retrospective-sessions.handles must exist and be a list');
	assert.equal(run.handles?.type, collab.handles.type, 'the merge key must be the same shape on both collections');
	assert.equal(collab.handles.many, true);
});

test('the run record contact is the same typed reference perspective/users uses', () => {
	const run = descriptors.get('retrospective-sessions').fields;
	const collab = descriptors.get('users').fields;
	assert.equal(run.contact?.type, 'contacts');
	assert.equal(run.contact?.type, collab.contact.type, 'one field name, one meaning, across the module');
	assert.ok(!run.contact.many && !collab.contact.many);
});

test('no script reads the run record contact as if it were a handle', () => {
	const offenders = [];
	for (const f of fs.readdirSync(BINS).filter((x) => x.endsWith('.mjs'))) {
		const body = fs.readFileSync(path.join(BINS, f), 'utf8');
		for (const [i, line] of body.split('\n').entries()) {
			if (/^\s*(\/\/|\*)/.test(line)) continue;
			if (/\.fields\.contact\b/.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
		}
	}
	assert.deepEqual(offenders, [], `contact is a CRM reference; the address to match on is handles:\n  ${offenders.join('\n  ')}`);
});
