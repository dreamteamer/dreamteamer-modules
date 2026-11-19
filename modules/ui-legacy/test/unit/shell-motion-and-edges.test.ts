// The browser shell's rough edges, read from the stylesheets as text (the `card-mark-css.test.ts` technique):
//   - "With prefers-reduced-motion set no tab or menu or panel animates": every transition the tab strip, the nav's
//     resize edge and the slide-over panel declare runs on a duration token the reduced-motion block zeroes, the one
//     menu declares none at all, and the browser host's catch-all stops anything that names its own time.
//   - In the dark theme the slide-over panel has no light edge: its shadow is its own token, whose dark value draws no
//     ring of the light ink.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const css = (rel: string) => { const t = read(rel); return rel.endsWith('.vue') ? [...t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n') : t; };
const noComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '');

test('reduced motion zeroes the duration tokens, and the browser host stops every other transition and animation', () => {
	const tokens = noComments(read('styles/tokens.css'));
	const block = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokens)?.[1] ?? '';
	assert.match(block, /--dt-dur-fast:\s*0ms/);
	assert.match(block, /--dt-dur-med:\s*0ms/);
	const browser = noComments(read('styles/browser.css'));
	const all = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?\})\s*\}/.exec(browser)?.[1] ?? '';
	assert.match(all, /transition-duration:\s*0\.01ms\s*!important/);
	assert.match(all, /animation-duration:\s*0\.01ms\s*!important/);
});

test('no tab, menu or panel transition runs on a time of its own: each names a duration token', () => {
	for (const rel of ['components/TabStrip.vue', 'components/NavSidebar.vue', 'components/RightSidebar.vue', 'components/SearchModal.vue']) {
		for (const m of noComments(css(rel)).matchAll(/transition:\s*([^;]+);/g)) {
			if (m[1]!.trim() === 'none') continue;
			for (const part of m[1]!.split(',')) assert.match(part, /var\(--dt-dur-(fast|med)\)/, `${rel}: "${part.trim()}" names its own time`);
		}
	}
	for (const rel of ['components/DtMenu.vue']) assert.doesNotMatch(noComments(css(rel)), /transition|animation/, `${rel} animates`);
});

test('the slide-over panel draws its own shadow token, and in the dark no light ink rings it', () => {
	assert.match(css('components/RightSidebar.vue'), /\.dt-rsb--over \.dt-rsb-panel \{[^}]*box-shadow:\s*var\(--dt-shadow-panel\)/);
	assert.match(read('styles/tokens.css'), /--dt-shadow-panel:\s*var\(--dt-shadow-menu\);/, 'the editor and the light theme keep the menu\'s lift');
	const browser = noComments(read('styles/browser.css'));
	const dark = [...browser.matchAll(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
	const panel = /--dt-shadow-panel:\s*([^;]+);/.exec(dark)?.[1];
	assert.ok(panel, 'the dark set does not define the panel shadow');
	assert.doesNotMatch(panel!, /--dt-ink/, 'the dark panel is ringed by the light ink — the faint light edge');
	assert.match(panel!, /0 0 0 1px rgb\(0 0 0/, 'the dark panel has no dark hairline to cover the sheet\'s ring beside it');
});
