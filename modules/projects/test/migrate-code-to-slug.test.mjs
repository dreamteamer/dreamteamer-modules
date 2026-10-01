// `code` → `slug` on the four collections where it was never a code.
//
// The rename exists because this module used ONE field name for two different things.
// `activities.code` (`a-01`) and `risks.code` (`rk-01`) are identifiers a room says out loud and
// reads in ORDER — codes, required, untouched. On `tasks`, `decisions`, `goals` and `deliverables`
// the same field existed for one reason: a name in any script has to produce a typeable id, because
// the engine's `slug` filter returns a hash when a value has no latin characters. That is a slug,
// and naming it a code made a workaround look like a domain concept — and made it REQUIRED on every
// record of four collections.
//
// Every assertion below guards something that would be silent if it broke: a body line eaten by a
// whole-file replace, a real code flattened into a slug, or an id that moved and took every
// reference with it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { load } from 'js-yaml';
import { renameKey, plan, RENAMED, KEPT_AS_CODE } from '../bin/migrate-code-to-slug.mjs';

const PROJECTS = path.resolve(import.meta.dirname, '../modules/projects');
const desc = (c) => load(fs.readFileSync(path.join(PROJECTS, 'collections', `${c}.collection.yaml`), 'utf8'));

describe('the descriptors after the rename', () => {
	test('the four latin-handle collections carry an OPTIONAL `slug` and no `code`', () => {
		for (const c of RENAMED) {
			const d = desc(c);
			const props = d.schema.properties;
			assert.ok(props.slug, `${c} has no slug`);
			assert.equal(props.code, undefined, `${c} still has a code`);
			assert.ok(!(d.schema.required ?? []).includes('slug'),
				`${c}.slug must be OPTIONAL — the whole point of the ordered id template`);
			assert.ok(!(d.schema.required ?? []).includes('code'));
			assert.equal(props.slug.pattern, '^[a-z0-9][a-z0-9-]*$');
		}
	});

	test('`activities` and `risks` KEEP their codes, required', () => {
		// ⚠ The distinction is the point of the change, so it is asserted rather than assumed. A
		// later sweep that "tidies" these into slugs would be undoing a deliberate decision.
		for (const c of KEPT_AS_CODE) {
			const d = desc(c);
			assert.ok(d.schema.properties.code, `${c} lost its code`);
			assert.equal(d.schema.properties.slug, undefined, `${c} must not have a slug`);
			assert.ok(d.schema.required.includes('code'), `${c}.code must stay required`);
		}
	});

	test('every id.generate is an ORDERED LIST whose second arm is the name', () => {
		for (const c of RENAMED) {
			const gen = desc(c).id.generate;
			assert.ok(Array.isArray(gen), `${c}.id.generate must be a list`);
			assert.equal(gen.length, 2, `${c} needs exactly the slug arm and the name arm`);
			assert.match(gen[0], /\{\{\s*slug\s*\}\}/, `${c}: the first arm must use the slug FIELD`);
			assert.match(gen[1], /\{\{\s*name\s*\|\s*slug\s*\}\}/, `${c}: the second arm must be the name through the slug FILTER`);
			// The two arms must agree on everything except the final segment, or an id would move
			// depending on whether a record happened to carry a slug.
			const shape = (t) => t.replace(/\{\{\s*slug\s*\}\}/, 'X').replace(/\{\{\s*name\s*\|\s*slug\s*\}\}/, 'X');
			assert.equal(shape(gen[0]), shape(gen[1]), `${c}: the two arms produce differently shaped ids`);
		}
	});

	test('the module declares the engine floor the list form needs — 0.25.1, not 0.25.0', () => {
		// ⚠ 0.25.0 ACCEPTS the list and REFUSES it. `generateId` learned the ordered form there, but
		// the meta-descriptor that validates a collection still said `type: string`, so a consumer on
		// 0.25.0 installs this module, compiles clean, and then `check` rejects four descriptors with
		// "must be string". 0.25.1 widened the schema. A floor of >=0.25.0 would be a promise this
		// module cannot keep, and it would break at the CONSUMER's check — never in this repo's CI.
		const pkg = JSON.parse(fs.readFileSync(path.join(PROJECTS, 'package.json'), 'utf8'));
		assert.equal(pkg.dreamteamer.engine, '>=0.25.1');
	});
});

describe('renameKey', () => {
	const doc = (front, body = 'Some prose.\n') => `---\n${front}\n---\n\n${body}`;

	test('renames the top-level key in the frontmatter', () => {
		const out = renameKey(doc('code: pay-the-vat\nname: Pay the VAT'));
		assert.match(out, /^slug: pay-the-vat$/m);
		assert.doesNotMatch(out, /^code:/m);
		assert.match(out, /^name: Pay the VAT$/m, 'the other keys are untouched');
	});

	test('a `code:` line in the BODY is never touched', () => {
		// ⚠ A whole-file replace would corrupt this silently — a decision quoting a config, a
		// deliverable describing a field. The body is not frontmatter.
		const out = renameKey(doc('code: ship-it\nname: Ship it', 'The config said:\n\ncode: 42\n'));
		assert.match(out, /^slug: ship-it$/m);
		assert.match(out, /^code: 42$/m, 'the body line survived');
		assert.equal((out.match(/^slug:/gm) ?? []).length, 1, 'exactly one key was renamed');
	});

	test('an INDENTED code: is a nested map key, not this field', () => {
		const out = renameKey(doc('name: Nested\nmeta:\n  code: inner'));
		assert.equal(out, null, 'nothing at the top level to rename');
	});

	test('a record with no code, no frontmatter, or already migrated returns null', () => {
		assert.equal(renameKey(doc('name: No code here')), null);
		assert.equal(renameKey('# just a document\n'), null);
		assert.equal(renameKey(doc('slug: already\nname: Done')), null);
	});

	test('the value is carried verbatim, including an empty one', () => {
		assert.match(renameKey(doc('code:\nname: Empty')), /^slug:$/m);
		assert.match(renameKey(doc("code: 'quoted-value'\nname: Q")), /^slug: 'quoted-value'$/m);
	});
});

describe('plan', () => {
	const ws = () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), 'c2s-'));
		const write = (coll, suffix, id, front) => {
			// An id is a PATH — `deliverables` generates `<project>/<slug>` — so the directories in it
			// have to exist before the file does.
			const f = path.join(root, 'data', coll, `${id}.${suffix}.md`);
			fs.mkdirSync(path.dirname(f), { recursive: true });
			fs.writeFileSync(f, `---\n${front}\n---\n\nbody\n`);
		};
		return { root, write };
	};

	test('finds the four, and leaves activities and risks alone', () => {
		const { root, write } = ws();
		write('tasks', 'task', '2026-01-01--a', 'code: a\nname: A');
		write('decisions', 'decision', '2026-01-01--b', 'code: b\nname: B');
		write('goals', 'goal', 'c', 'code: c\nname: C');
		write('deliverables', 'deliverable', 'p/d', 'code: d\nname: D');
		write('activities', 'activity', 'a-01', 'code: a-01\nname: Kickoff');
		write('risks', 'risk', 'rk-01', 'code: rk-01\nname: Exposure');

		const { todo, refusals } = plan(root, path.join(root, 'data'));
		assert.deepEqual(refusals, []);
		assert.equal(todo.length, 4);
		assert.deepEqual([...new Set(todo.map((t) => t.collection))].sort(), [...RENAMED].sort());
		assert.ok(!todo.some((t) => /activities|risks/.test(t.file)), 'a real code was queued for renaming');
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('REFUSES when a code-keeping collection has already lost its codes', () => {
		// The tree is not in the state this migration expects — something upstream renamed them.
		// Stopping is the only safe answer; half-migrating is not.
		const { root, write } = ws();
		write('tasks', 'task', '2026-01-01--a', 'code: a\nname: A');
		write('risks', 'risk', 'rk-01', 'slug: rk-01\nname: Exposure');
		const { refusals } = plan(root, path.join(root, 'data'));
		assert.equal(refusals.length, 1);
		assert.match(refusals[0], /risks/);
		fs.rmSync(root, { recursive: true, force: true });
	});

	test('a workspace with nothing to do plans nothing', () => {
		const { root, write } = ws();
		write('tasks', 'task', '2026-01-01--a', 'slug: a\nname: A');
		assert.deepEqual(plan(root, path.join(root, 'data')).todo, []);
		fs.rmSync(root, { recursive: true, force: true });
	});
});
