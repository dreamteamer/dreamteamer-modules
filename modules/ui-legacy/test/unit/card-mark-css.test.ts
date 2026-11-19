// Tier 1 — NO CARD STYLESHEET TAKES A SOURCE MARK OUT OF FLOW (cr-vscode-004, line 7). The mark used to
// be `position: absolute; top: 6px; right: 8px` over the card's title and cover; the render tier proves
// it now sits in the card's footer row, and this proves no style puts it back over the content.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every rule of a `.vue` file's style blocks: selector → body. */
function rules(file: string): Array<{ selector: string; body: string }> {
	const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
	const css = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
}

for (const file of ['src/lists/ListCards.vue', 'src/lists/ListKanban.vue']) {
	test(`${path.basename(file)}: no rule for a source mark or the card footer is positioned out of flow`, () => {
		const offenders = rules(file).filter((r) => /source|foot/.test(r.selector) && /position\s*:\s*(absolute|fixed)/.test(r.body));
		assert.deepEqual(offenders.map((r) => r.selector), []);
		assert.ok(rules(file).some((r) => r.selector.includes('.dt-card-foot')), 'and the footer row is styled here');
		// the walk on a screen (cr-vscode-004 line 8): a mark and a stub note in one footer drew over each
		// other when the row could not wrap and its pieces shrank below their text
		const foot = rules(file).find((r) => r.selector === '.dt-card-foot')!;
		assert.match(foot.body, /flex-wrap\s*:\s*wrap/, 'the footer row wraps');
		const kids = rules(file).find((r) => r.selector === '.dt-card-foot > *');
		assert.ok(kids && /flex-shrink\s*:\s*0/.test(kids.body), 'and its pieces never shrink under their text');
	});
}

test('StubNote.vue: a stub pill\'s pieces wrap inside it and never shrink under their text', () => {
	const item = rules('src/components/StubNote.vue').find((r) => r.selector === '.dt-stub-note__item')!;
	assert.match(item.body, /flex-wrap\s*:\s*wrap/);
	const kids = rules('src/components/StubNote.vue').find((r) => r.selector === '.dt-stub-note__item > *');
	assert.ok(kids && /flex-shrink\s*:\s*0/.test(kids.body));
});
