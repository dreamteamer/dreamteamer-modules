/**
 * The band header a grouped layout draws — what it shows, and how it decides what an `icon` IS.
 *
 * A header is the whole visible payoff of the engine's `x-choices` (0.21.0): the label, a count, an
 * optional description, and a glyph that is EITHER a codicon name OR a reference to a record of a
 * `codec: file` collection. That fork is the interesting part and it is why this is a render test
 * rather than a tier-1 one — the discrimination is only true if the component actually draws two
 * different elements, and a pure function returning the string 'file' proves nothing about markup.
 *
 * ⚠ The file branch takes TWO steps and both are pinned here: a reference names bytes but not their
 * extension (`icons/lucide/anchor` says nothing about `.svg` vs `.png`), so the record is fetched
 * for its derived `ext` before a src can exist. A header that rendered an `<img>` with no src would
 * be a broken-image glyph in every band.
 *
 * Nothing here knows a collection called `assets`: the file-codec list is injected by the host and
 * the fixture below injects a synthetic one (decision 268).
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, hasClass, render, text } from './render';
import GroupHeader from '../../src/components/browse/GroupHeader.vue';

/** The host injects one entry per `codec: file` collection. Synthetic name, on purpose. */
function injectFileBases(): void {
	(globalThis as { window?: unknown }).window ??= {};
	(globalThis as { window: Record<string, unknown> }).window['__DT_FILE_BASES__'] = [
		{ collection: 'pictures', path: 'data/pictures', suffix: 'picture', uri: 'https://webview.test/pictures' },
	];
}

beforeEach(() => {
	resetHost();
	injectFileBases();
	onHostRequest((method, path) => {
		// The adapter reads the contract before any item request and caches it module-side, so it has
		// to be answered even by a test that only cares about one record.
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch' };
		// ⚠ THE CLEAN PATH, not `/items/…`. The adapter translates the old wire before the request
		// reaches the host, so a stub keyed on what the component ASKED FOR answers nothing.
		if (path.startsWith('/collections/pictures/records/')) {
			return { id: 'icons/lucide/anchor', fields: { ext: 'svg' } };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

const img = (root: Parameters<typeof text>[0]) => find(root, (n) => n.tag === 'img');
const codicons = (root: Parameters<typeof text>[0]) => all(root, (n) => hasClass(n, 'codicon'));

test('the label and the count, always', async () => {
	const root = await render(GroupHeader, { label: 'Finance', count: 8 });
	const words = text(root);
	assert.match(words, /Finance/);
	assert.match(words, /8/);
});

test('a count of zero is still shown — an empty band is information', async () => {
	const root = await render(GroupHeader, { label: 'Finance', count: 0 });
	assert.match(text(root), /0/);
});

test('the description renders when there is one, and nothing when there is not', async () => {
	const withDesc = await render(GroupHeader, { label: 'Finance', count: 1, description: 'money-touching work' });
	assert.match(text(withDesc), /money-touching work/);

	const without = await render(GroupHeader, { label: 'Finance', count: 1 });
	assert.doesNotMatch(text(without), /money-touching/);
});

test('an icon with no slash is a codicon — drawn as a glyph, never fetched', async () => {
	const root = await render(GroupHeader, { label: 'CRM', count: 3, icon: 'person' });
	const glyph = codicons(root);
	assert.equal(glyph.length, 1, 'exactly one glyph');
	assert.ok(
		String(glyph[0]!.props['class']).includes('codicon-person'),
		`expected codicon-person, saw ${String(glyph[0]!.props['class'])}`,
	);
	assert.equal(img(root), null, 'a codicon is not an image');
});

test('an icon that resolves as a file-codec reference is drawn as an image', async () => {
	const root = await render(GroupHeader, { label: 'Finance', count: 8, icon: 'pictures/icons/lucide/anchor' });
	const picture = img(root);
	assert.ok(picture, 'expected an <img> for a file-codec reference');
	assert.equal(
		picture.props['src'],
		'https://webview.test/pictures/icons/lucide/anchor.picture.svg',
		'built from the injected base, the id, the suffix and the record’s own ext',
	);
});

test('a reference into a collection that is NOT file-codec falls back to a codicon', async () => {
	// `contacts/ada` is a perfectly good reference and names no bytes. The discriminator is the
	// injected list, not the slash — the slash is only ever a hint.
	const root = await render(GroupHeader, { label: 'Owner', count: 2, icon: 'contacts/ada' });
	assert.equal(img(root), null);
	assert.equal(codicons(root).length, 1, 'it still draws something rather than nothing');
});

test('no icon at all draws no glyph and no image', async () => {
	const root = await render(GroupHeader, { label: 'Plain', count: 1 });
	assert.equal(img(root), null);
	assert.equal(codicons(root).length, 0);
});

test('colour and background are applied as styles, not as classes', async () => {
	// Theme colour ids, so they can only reach the DOM as a var() — a class would need one rule per
	// possible colour, which is exactly the coupling `x-choices` exists to avoid.
	const root = await render(GroupHeader, { label: 'Finance', count: 8, color: 'charts.yellow', background: 'charts.yellow' });
	const header = find(root, (n) => hasClass(n, 'dt-group-header'));
	assert.ok(header, 'the header element exists');
	// A THEME COLOUR ID BECOMES A CSS VARIABLE: VS Code publishes every theme colour as
	// `--vscode-<id with dots as dashes>`, so `charts.yellow` is `var(--vscode-charts-yellow, var(--dt-color-charts-yellow, var(--dt-unknown-color)))`. That
	// mapping is the whole reason an id is authorable at all, and it is asserted rather than assumed.
	const style = header.props['style'] as Record<string, string>;
	assert.equal(style['--dt-group-color'], 'var(--vscode-charts-yellow, var(--dt-color-charts-yellow, var(--dt-unknown-color)))');
	assert.equal(style['--dt-group-bg'], 'var(--vscode-charts-yellow, var(--dt-color-charts-yellow, var(--dt-unknown-color)))');
});

test('with no colour it carries no colour style at all', async () => {
	const root = await render(GroupHeader, { label: 'Plain', count: 1 });
	const header = find(root, (n) => hasClass(n, 'dt-group-header'))!;
	assert.deepEqual(header.props['style'] ?? {}, {}, 'no declared colour means no declaration at all');
});
