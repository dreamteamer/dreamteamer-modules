// THE EDIT SIDE MUST NOT FLIP A HEBREW VALUE TO LTR. The webview root is dir=ltr; every VIEW
// widget resolves direction per value (ViewText's dir="auto", render-md per block — measured
// 2026-08-09), and until 2026-09-12 NO edit widget did: a Hebrew field read RTL on the page and
// flipped the moment it was edited (filed as a vault issue the same day). A vue-mount tier does
// not exist here, so this pins the SOURCE: every value-carrying control declares dir="auto" — or
// the field's own `direction` with `auto` as its default (descriptor v2 §3.4.2; the rendered rtl is
// pinned by test/webview/record-form.test.ts).
// Code-shaped editors (code, json, display-template, datetime, color, slider, field pickers) stay
// LTR on purpose — their content is syntax, not language.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// built to .test-build/unit/*.mjs — ESM, so __dirname does not exist here
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALUE_CARRYING = [
	'src/edits/EditInput.vue',
	'src/edits/EditTextarea.vue',
	'src/edits/EditTags.vue',
	'src/edits/EditRelation.vue',
];

test('every value-carrying edit control declares dir="auto"', () => {
	for (const rel of VALUE_CARRYING) {
		const src = readFileSync(join(ROOT, rel), 'utf8');
		assert.ok(
			src.includes('dir="auto"') || src.includes(`:dir="field.direction ?? 'auto'"`),
			`${rel} has no dir="auto" — a Hebrew value will flip to LTR in edit mode`,
		);
	}
});
