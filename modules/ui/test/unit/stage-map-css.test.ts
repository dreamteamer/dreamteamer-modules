// Tier 1 — THE STAGE MAP'S STYLESHEET (cr-vscode-015). The render tier has no layout, so the rules that
// keep the map to two lines are read here as text: a non-wrapping row, capitalised titles, muted marks,
// the two width rules scoped to the chip, and a card that wraps. The running check is
// scripts/walk-stage-map.mjs in a dev host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Rule { at: string | null; selector: string; body: string }

/** Every rule of a `.vue` file's style blocks, with the `@container` condition it sits in (or null). */
function rules(file: string): Rule[] {
	const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
	const css = [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
	const out: Rule[] = [];
	let i = 0;
	const block = (at: string | null, end: number) => {
		while (i < end) {
			const open = css.indexOf('{', i);
			if (open < 0 || open >= end) { i = end; return; }
			const head = css.slice(i, open).trim();
			if (head.startsWith('@')) {
				let depth = 1, j = open + 1;
				while (depth && j < css.length) { if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
				i = open + 1;
				block(head, j - 1);
				i = j;
			} else {
				const close = css.indexOf('}', open);
				for (const sel of head.split(',')) out.push({ at, selector: sel.trim(), body: css.slice(open + 1, close) });
				i = close + 1;
			}
		}
	};
	block(null, css.length);
	return out;
}

const R = rules('src/components/StageMap.vue');
const body = (selector: string, at: string | null = null) => R.filter((r) => r.selector === selector && r.at === at).map((r) => r.body).join(';');
const has = (selector: string, decl: RegExp, at: string | null = null) => assert.match(body(selector, at), decl, `${at ?? ''} ${selector} ${decl}`);

test('line 1: the stages are one non-wrapping flex row with capitalised titles', () => {
	has('.dt-stages__list', /display\s*:\s*flex/);
	has('.dt-stages__list', /flex-wrap\s*:\s*nowrap/);
	has('.dt-stages__list', /white-space\s*:\s*nowrap/);
	has('.dt-stage__title', /text-transform\s*:\s*capitalize/);
	has('.dt-stages', /container-type\s*:\s*inline-size/);
});

test('line 2: stages not reached and stages passed over are muted', () => {
	has(".dt-stage[data-mark='ahead'] .dt-stage__chip", /color\s*:\s*var\(--dt-fg-muted\)/);
	has(".dt-stage[data-mark='skipped'] .dt-stage__chip", /color\s*:\s*var\(--dt-fg-muted\)/);
});

test('line 3: the subtitle is one line that ellipsises and keeps its height while loading', () => {
	has('.dt-stages__next', /white-space\s*:\s*nowrap/);
	has('.dt-stages__next', /text-overflow\s*:\s*ellipsis/);
	has('.dt-stages__next', /overflow\s*:\s*hidden/);
});

test('line 4: the card is placed against the map, wraps its text, and heads with a capitalised title', () => {
	has('.dt-stages', /position\s*:\s*relative/);
	has('.dt-stage__card', /position\s*:\s*absolute/);
	has('.dt-stage__card', /top\s*:\s*100%/);
	has('.dt-stage__card', /white-space\s*:\s*normal/);
	has('.dt-stage__card-title', /text-transform\s*:\s*capitalize/);
	has('.dt-stage__card-title', /font-weight\s*:\s*600/);
	assert.doesNotMatch(body('.dt-stage') + body('.dt-stages__list'), /position\s*:\s*(relative|absolute)/, 'neither the row nor an item is positioned, so the row never clips the card');
});

test('line 5: two width rules shorten titles to the index, scoped to the chip, never reaching the card', () => {
	const narrow = R.filter((r) => r.at && /max-width:\s*559px/.test(r.at));
	const tiny = R.filter((r) => r.at && /max-width:\s*399px/.test(r.at));
	assert.ok(narrow.some((r) => r.selector === '.dt-stage:not([data-current]) .dt-stage__chip .dt-stage__title' && /display\s*:\s*none/.test(r.body)));
	assert.ok(tiny.some((r) => r.selector === '.dt-stage__chip .dt-stage__title' && /display\s*:\s*none/.test(r.body)));
	for (const r of R.filter((x) => x.at)) {
		assert.notEqual(r.selector, '.dt-stage__title', 'no width rule selects a bare title');
		assert.doesNotMatch(r.selector, /dt-stage__card/, 'no width rule reaches into the card');
	}
});
