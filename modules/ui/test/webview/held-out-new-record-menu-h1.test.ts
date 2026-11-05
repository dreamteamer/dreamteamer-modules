// Held-out h1 for cr-vscode-016 (rnd/tests/dreamteamer-vscode/cr-vscode-016-h1) — written by the plan
// review, never read by the builder. A source name with NO break characters (64 chars, no hyphen) and one
// with non-ASCII / wide glyphs: each target row is still exactly one fit SourceMark, the mark carries no
// native title, and the row's card titles the FULL name; the card's style lets an unbreakable name wrap.
// Synthetic names only. Run: npm test -- --only=held-out-new-record-menu-h1
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryHistory, createRouter } from 'vue-router';
import { all, find, flush, hasClass, render, text, type TestNode } from './render';
import type { SourceEntry } from '../../src/api/types';
import { targetChoice } from '../../src/lib/sources';
import TargetChoice from '../../src/components/browse/TargetChoice.vue';

(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {}, innerWidth: 1386, innerHeight: 800 };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const NOBREAK = 'exampleorgprojectwithaverylonglayernamethathasnobreakcharactersxy';
const WIDE = '例のプロジェクト-データ層-éßΩ-ｗｉｄｅ';
const SOURCES: SourceEntry[] = [
	{ name: 'hq-sample', kind: 'own', repo: '.', path: 'data/notes', installed: true, count: 1, via: 'own', access: 'write' },
	{ name: NOBREAK, kind: 'layer', repo: `git_modules/${NOBREAK}`, path: `git_modules/${NOBREAK}/data/notes`, installed: true, count: 1, via: 'layer', access: 'write' },
	{ name: WIDE, kind: 'layer', repo: 'git_modules/wide', path: 'git_modules/wide/data/notes', installed: true, count: 1, via: 'layer', access: 'write' },
];

async function router() {
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push('/content/notes');
	await r.isReady();
	return r;
}
const elementChildren = (n: TestNode) => n.children.filter((c): c is TestNode => typeof c !== 'string' && !c.tag.startsWith('#'));
const card = (root: TestNode) => all(root, (n) => n.props['role'] === 'tooltip');
const ev = (n: TestNode) => ({ currentTarget: n, target: n, relatedTarget: null, preventDefault() {}, stopPropagation() {} });

test('h1: the length is no class — names with no break characters or with wide glyphs stay one fit mark each, full name on the card', async () => {
	assert.ok(NOBREAK.length >= 60 && !/[-_\s.]/.test(NOBREAK), 'fixture: 60+ chars, no break character');
	const choice = targetChoice(SOURCES, []);
	assert.equal(choice.mode, 'choose');
	const root = await render(TargetChoice, { choice }, [await router()]);
	const rows = all(root, (n) => hasClass(n, 'dt-target-choice__row'));
	assert.deepEqual(rows.map((r) => r.props['data-target']), ['hq-sample', NOBREAK, WIDE]);
	for (const row of rows) {
		const name = String(row.props['data-target']);
		const kids = elementChildren(row);
		assert.equal(kids.length, 1, `${name}: the row holds exactly one element`);
		const mark = kids[0]!;
		assert.ok(hasClass(mark, 'dt-source-mark') && hasClass(mark, 'dt-source-mark--fit'), `${name}: that element is a fit source mark`);
		assert.equal(mark.props['title'], undefined, `${name}: no native title under fit — the card is the hover`);
		const nameNode = find(mark, (n) => hasClass(n, 'dt-source-mark__name'))!;
		assert.equal(text(nameNode), name, `${name}: the mark draws the name whole (the CSS ellipsises it, not the text)`);
		assert.ok(find(mark, (n) => hasClass(n, 'dt-source-mark__access')), `${name}: and its pencil`);

		(row.props['onMouseenter'] as (e: unknown) => void)(ev(row));
		await flush();
		const cards = card(root);
		assert.equal(cards.length, 1, `${name}: one card`);
		const title = find(cards[0]!, (n) => /\bdt-target-choice__line--title\b/.test(String(n.props['class'] ?? '')));
		assert.ok(title, `${name}: the card has a title line`);
		assert.equal(text(title!).trim(), name, `${name}: the card's title is the FULL name`);
		(row.props['onMouseleave'] as (e: unknown) => void)(ev(row));
		await flush();
		assert.equal(card(root).length, 0, `${name}: leaving the row closes the card`);
	}
	assert.doesNotMatch(text(root), /record layer|this workspace/, 'no kind word drawn in the menu itself');
});

test('h1: the card lets an unbreakable name wrap inside it, and the fit name is the one that ellipsises', () => {
	const here = path.dirname(fileURLToPath(import.meta.url));
	const read = (rel: string) => {
		for (const base of [path.resolve(here, '..', '..'), process.cwd()]) {
			const p = path.join(base, rel);
			if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
		}
		throw new Error(`cannot find ${rel}`);
	};
	const rules = (rel: string) => {
		const css = [...read(rel).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
		return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));
	};
	const tc = rules('webview/src/components/browse/TargetChoice.vue');
	const cardRule = tc.filter((r) => r.selector.split(',').some((s) => s.trim() === '.dt-target-choice__card')).map((r) => r.body).join(';');
	assert.match(cardRule, /overflow-wrap\s*:\s*anywhere|word-break\s*:\s*break-(all|word)/, 'the card wraps a name with no break character');
	assert.match(cardRule, /white-space\s*:\s*normal/, 'the card does not inherit the row\'s nowrap');
	const sm = rules('webview/src/components/SourceMark.vue');
	const fitName = sm.filter((r) => r.selector.includes('.dt-source-mark--fit') && r.selector.includes('.dt-source-mark__name')).map((r) => r.body).join(';');
	assert.match(fitName, /text-overflow\s*:\s*ellipsis/);
	assert.match(fitName, /overflow\s*:\s*hidden/);
	assert.match(fitName, /min-width\s*:\s*0/);
});
