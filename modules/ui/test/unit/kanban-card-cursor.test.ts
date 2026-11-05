// Tier 1 — A LOCKED KANBAN CARD KEEPS THE POINTER (cr-vscode-009, code review round 1). A card on a board
// whose column field is locked cannot change column, but a click still opens its record — so it keeps the
// shared `.dt-card--interactive` pointer. A `cursor` on a kanban card rule (the `is-locked` one shipped as
// `cursor: default`) would override it and draw the arrow over a clickable card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every rule of a stylesheet (a `.vue` file's style blocks, or a `.css` file): selector → body. */
function rules(file: string): Array<{ selector: string; body: string }> {
	const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
	const css = (file.endsWith('.vue') ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n') : text).replace(
		/\/\*[\s\S]*?\*\//g,
		'',
	);
	return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
}

test('the shared interactive card draws the pointer', () => {
	const card = rules('webview/src/styles/base.css').find((r) => r.selector === '.dt-card--interactive');
	assert.ok(card, 'base.css styles .dt-card--interactive');
	assert.match(card!.body, /cursor\s*:\s*pointer/);
});

test('ListKanban.vue: no kanban card rule overrides the cursor — a locked card stays clickable-looking', () => {
	const offenders = rules('webview/src/lists/ListKanban.vue').filter(
		(r) => /\.dt-kanban-core-card\b/.test(r.selector) && /cursor\s*:/.test(r.body),
	);
	assert.deepEqual(
		offenders.map((r) => `${r.selector} { ${r.body.trim()} }`),
		[],
	);
});
