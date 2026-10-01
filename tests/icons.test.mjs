// EVERY COLLECTION HAS ITS OWN GLYPH, AND IT IS A REAL ONE.
//
// ⚠ Not cosmetic. The nav tree, the collection picker and every reference chip draw the icon beside
// the name, so two collections wearing the same glyph is the row a reader mis-clicks — and the
// extension's icon layer passes a name straight through to a codicon with NO allow-list, so a name
// that is not a codicon draws a blank rather than erroring. Both failures are silent, which is why
// they are asserted here.
//
// Measured when this was written (2026-09-10): 50 collections, 8 of them sharing a glyph with another
// and one (`light-bulb`) not a codicon at all — the vocabulary is `lightbulb`.
import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODULES = path.join(ROOT, 'modules');

/** Every collection descriptor in the package, as { name, icon, file }. */
function collections() {
	const out = [];
	const walk = (dir) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith('.collection.yaml')) {
				const d = yaml.load(fs.readFileSync(p, 'utf8'));
				out.push({ name: d.name, icon: d.icon, file: path.relative(ROOT, p) });
			}
		}
	};
	walk(MODULES);
	return out;
}

const ALL = collections();

describe('collection icons', () => {
	test('the scan is not vacuous', () => {
		assert.ok(ALL.length >= 9, `expected every collection in the repo, saw ${ALL.length}`);
	});

	test('every collection declares an icon', () => {
		const missing = ALL.filter((c) => !c.icon).map((c) => c.file);
		assert.deepEqual(missing, [], `no icon on:\n  ${missing.join('\n  ')}`);
	});

	// A codicon id is lowercase kebab. `light-bulb` passes this and was still wrong, which is why the
	// vocabulary check below exists as well — this one catches the shape, that one catches the word.
	test('every icon is a lowercase kebab-case id, the codicon shape', () => {
		const bad = ALL.filter((c) => !/^[a-z][a-z0-9-]*$/.test(c.icon)).map((c) => `${c.name}: ${c.icon}`);
		assert.deepEqual(bad, [], `not codicon-shaped:\n  ${bad.join('\n  ')}`);
	});

	// ⚠ THE ONE THAT CAUGHT A REAL DEFECT. `light-bulb` is not a codicon; `lightbulb` is. The extension
	// has no allow-list, so it drew nothing and said nothing.
	test('no icon uses a known-wrong spelling of a real codicon', () => {
		const WRONG = { 'light-bulb': 'lightbulb', 'check-list': 'checklist', 'list-ordered-': 'list-ordered', 'graph-line-': 'graph-line' };
		const hits = ALL.filter((c) => WRONG[c.icon]).map((c) => `${c.name}: ${c.icon} → ${WRONG[c.icon]}`);
		assert.deepEqual(hits, [], `misspelled:\n  ${hits.join('\n  ')}`);
	});

	// ⚠ THE ALLOW-LIST THE HEADER ABOVE SAID DID NOT EXIST, AND IT CAUGHT FIVE MORE (2026-09-11):
	// `organization-filled` (teams), `science` (rnd/experiments), `star` (rnd/features), `alert`
	// (perspective/assumptions) and `north-star` (perspective/world/goals) were all codicon-SHAPED,
	// all passed the spelling check above, and all drew a blank glyph in the nav — silently, for
	// months. The known-wrong map was only ever going to catch mistakes somebody had already made.
	//
	// `fixtures/codicons.json` is the vendored name list, generated from `@vscode/codicons`'
	// `src/icons/*.svg`. VENDORED rather than resolved from the extension's node_modules on purpose:
	// this package must test standalone on a machine that has never cloned the extension, and a check
	// that silently skips when a path is missing is the failure mode this whole file exists to refuse.
	// Regenerate it when the codicon dependency moves, and expect the diff to be additions only.
	test('every icon is a REAL codicon, by name', () => {
		const known = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/codicons.json'), 'utf8')));
		assert.ok(known.size > 400, `the vendored codicon list looks truncated: ${known.size} names`);
		const blanks = ALL.filter((c) => !known.has(c.icon)).map((c) => `${c.name}: ${c.icon}`);
		assert.deepEqual(blanks, [], `NOT codicons — these draw a blank, silently:\n  ${blanks.join('\n  ')}`);
	});

	test('no two collections share a glyph', () => {
		const byIcon = new Map();
		for (const c of ALL) byIcon.set(c.icon, [...(byIcon.get(c.icon) ?? []), c.name]);
		const shared = [...byIcon.entries()].filter(([, names]) => names.length > 1).map(([icon, names]) => `${icon}: ${names.join(', ')}`);
		assert.deepEqual(shared, [], `shared glyphs — a reader mis-clicks these:\n  ${shared.join('\n  ')}`);
	});
});
