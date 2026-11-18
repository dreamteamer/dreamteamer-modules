// HELD-OUT h1 (cr-vscode-015) — seven stages with titles far longer than rnd's: one row, one current
// stage that keeps its title, nothing wraps. Reviewer-written; the builder never reads it.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { text, hasClass, find, type TestNode } from './render';
import { answers, attr, chip, currentTitles, draw, setup, stages, subtitle } from './cr015-heldout-fixture';

const TITLES = ['requirements gathering and stakeholder alignment', 'architecture and threat modelling review', 'implementation across every affected package', 'integration and regression verification', 'security and compliance sign-off', 'staged rollout to the canary population', 'general availability and post-launch watch'];
const LONG = {
	stage_reviews: 'reviews',
	stages: TITLES.map((title, i) => ({ title, fields: [], reviews: [], gate: [`rnd--s${i}--change-requests`] })),
};

beforeEach(setup);

test('h1: seven long-titled stages draw as one ol of seven chips, in order, indexed; only stage 4 is current and keeps its title', async () => {
	answers.set('long', () => ({ 'rnd--s0--change-requests': 'done', 'rnd--s1--change-requests': 'done', 'rnd--s2--change-requests': 'done', 'rnd--s3--change-requests': 'available' }));
	const { root } = await draw('long', LONG);
	const lis = stages(root);
	assert.equal(lis.length, 7);
	assert.equal(new Set(lis.map((l) => l.parent)).size, 1, 'every stage in ONE list');
	assert.equal(lis[0]!.parent!.tag, 'ol');
	assert.deepEqual(lis.map((l) => attr(l, 'data-stage')), TITLES);
	lis.forEach((l, i) => assert.equal(text(chip(l)).replace(/\s+/g, ' ').trim(), `${i + 1} ${TITLES[i]}`));
	assert.deepEqual(currentTitles(root), [TITLES[3]]);
	const titleSpan = find(lis[3]!, (n) => hasClass(n, 'dt-stage__title'))!;
	assert.equal(text(titleSpan).trim(), TITLES[3], 'the current chip holds its title span (the 559 px rule must not reach it)');
	// two lines: the section holds the list and the subtitle and nothing else while no card is open
	const section = lis[0]!.parent!.parent as TestNode;
	assert.ok(hasClass(section, 'dt-stages'));
	const kids = section.children.filter((c): c is TestNode => typeof c !== 'string' && c.tag !== '#comment' && !(c.tag === '#text' && !String(c.props['text'] ?? '').trim()));
	assert.deepEqual(kids.map((k) => k.tag), ['ol', 'p']);
	assert.equal(kids[1], subtitle(root));
});

test('h1: the stylesheet keeps the row one line however long a title is, and the narrow rule spares the current stage', () => {
	const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
	const src = fs.readFileSync(path.join(ROOT, 'src/components/StageMap.vue'), 'utf8');
	const css = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]!).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
	const list = [...css.matchAll(/([^{}]*\.dt-stages__list)\s*\{([^{}]*)\}/g)].map((m) => m[2]!).join(';');
	assert.match(list, /flex-wrap\s*:\s*nowrap/);
	assert.match(list, /overflow\s*:\s*hidden/);
	assert.doesNotMatch(css, /flex-wrap\s*:\s*wrap/, 'nothing in the stage map wraps a flex row');
	// a chip or a title that may wrap would make line 1 two lines with long titles
	for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		if (/dt-stage__(chip|title|index)\b/.test(m[1]!) && !/dt-stage__card/.test(m[1]!)) assert.doesNotMatch(m[2]!, /white-space\s*:\s*(normal|pre-wrap|pre-line)/, m[1]!.trim());
	}
	const at559 = /@container[^{]*max-width\s*:\s*559px[^{]*\{([\s\S]*?)\}\s*\}/.exec(css);
	assert.ok(at559, 'a 559 px container rule exists');
	assert.match(at559[1]!, /:not\(\[data-current[^\]]*\]\)/, 'the 559 px rule hides only the non-current titles');
});
