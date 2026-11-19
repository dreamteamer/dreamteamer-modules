// Tier 1 — THE NEW RECORD MENU'S LAYOUT, read from the style blocks as text (cr-vscode-016; the
// `card-mark-css.test.ts` technique). In 0.24.27 a long layer's row drew its kind word wrapped over the pencil:
// the mark could shrink below its own nowrap text and a second text competed for the line. These rules are the
// ones that make a row one line whatever the name — the walk on a real host (scripts/walk-new-record-menu.mjs)
// measures what they draw.
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
const rule = (file: string, selector: string) => {
	const r = rules(file).find((x) => x.selector.split(',').map((s) => s.trim()).includes(selector));
	assert.ok(r, `${selector} is styled in ${path.basename(file)}`);
	return r!.body;
};
const has = (body: string, prop: string, value: string) => assert.match(body, new RegExp(`(^|[;\\s])${prop}\\s*:\\s*${value.replace(/[()]/g, '\\$&')}\\s*(;|$)`), `${prop}: ${value}`);

const MARK = 'src/components/SourceMark.vue';

test('SourceMark fit: the mark fills its row, the name ellipsises, the glyph keeps its size at the right edge', () => {
	const fit = rule(MARK, '.dt-source-mark--fit');
	has(fit, 'flex', '1 1 auto');
	has(fit, 'min-width', '0');
	const name = rule(MARK, '.dt-source-mark--fit .dt-source-mark__name');
	has(name, 'overflow', 'hidden');
	has(name, 'text-overflow', 'ellipsis');
	has(name, 'min-width', '0');
	const glyph = rule(MARK, '.dt-source-mark--fit .dt-source-mark__access');
	has(glyph, 'margin-left', 'auto');
	has(glyph, 'flex-shrink', '0');
});

const MENU = 'src/components/browse/TargetChoice.vue';

test('TargetChoice: the menu is capped border-box and never clips its card; only the inner list scrolls', () => {
	const menu = rule(MENU, '.dt-target-choice');
	has(menu, 'box-sizing', 'border-box');
	has(menu, 'width', 'max-content');
	has(menu, 'min-width', '180px');
	has(menu, 'max-width', 'min(280px, calc(100vw - 16px))');
	assert.doesNotMatch(menu, /(^|[;\s])(overflow|overflow-y|max-height)\s*:/, 'the outer box clips nothing — the card hangs outside it');
	const list = rule(MENU, '.dt-target-choice__list');
	has(list, 'overflow-y', 'auto');
	assert.match(list, /max-height\s*:/);
});

test('TargetChoice: a row is one line; the count line is muted and one line; the card is theme-coloured and never takes the pointer', () => {
	const row = rule(MENU, '.dt-target-choice__row');
	has(row, 'white-space', 'nowrap');
	has(row, 'min-width', '0');
	const more = rule(MENU, '.dt-target-choice__more');
	has(more, 'color', 'var(--dt-fg-muted)');
	has(more, 'white-space', 'nowrap');
	const card = rule(MENU, '.dt-target-choice__card');
	has(card, 'pointer-events', 'none');
	has(card, 'max-width', 'min(280px, calc(100vw - 8px))');
	assert.match(card, /--vscode-editorHoverWidget-background/);
	assert.match(card, /--vscode-editorHoverWidget-border/);
	assert.doesNotMatch(card, /#[0-9a-f]{3,8}\b/i, 'theme ids, never hex');
	assert.equal(rules(MENU).some((r) => /dt-target-choice__via/.test(r.selector)), false, 'no kind column left behind');
});
