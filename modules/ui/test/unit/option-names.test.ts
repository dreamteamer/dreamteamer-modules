/**
 * Tier 1 — NO REGISTERED LAYOUT OPTION ENDS IN `_field`.
 *
 * Descriptor v2 (§3.5.1) names an option that takes a field for the ROLE the field plays — `group_by`,
 * `start`, `folder` — never `<role>_field`. The rename was applied to the design's table and left five
 * behind (the carousel's `folder_field` / `text_field`, the cards' `image_field`, the gantt's
 * `bar_label_field` / `group_icon_field`), and because a List reads only the keys it declares, a
 * module descriptor written to the design — `options: { folder: screenshots_folder }` — was NAMED
 * as unknown by `UnknownOptionsHint`, told to "check the spelling", while the layout silently fell
 * back to its default. This pins the class: a `_field` key cannot be registered again, and every old
 * spelling the extension once read is in `RENAMED_OPTIONS` so a stale view is told the new name.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import '../../src/registry/register-defaults';
import { lists } from '../../src/registry/index';
import { RENAMED_OPTIONS } from '../../src/lib/list-options';

const registered = () => lists.all().flatMap((l) => (l.options ?? []).map((o) => ({ layout: l.id, field: o.field })));

describe('layout option names follow §3.5.1', () => {
	test('the fixture is real — the default Lists are registered with options', () => {
		assert.ok(registered().length > 20, 'the registry carries the built-in layouts and their options');
		assert.ok(registered().some((o) => o.layout === 'carousel' && o.field === 'folder'));
	});

	test('no registered List declares an option ending in `_field`', () => {
		const offenders = registered().filter((o) => /_field$/.test(o.field));
		assert.deepEqual(offenders, [], 'an option that takes a field is named for the role it plays, with no `_field` suffix');
	});

	test('every old `_field` spelling in RENAMED_OPTIONS points at a name some List declares', () => {
		const declared = new Set(registered().map((o) => o.field));
		for (const [old, now] of Object.entries(RENAMED_OPTIONS)) {
			assert.ok(declared.has(now), `${old} → ${now}: no layout declares ${now}, so the hint would name a key nothing reads`);
		}
	});
});
