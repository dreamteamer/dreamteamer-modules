/**
 * The browse page SAYS when a view asks for a layout option this build does not know — the
 * unregistered-layout hint, one level down. Rendered, not just computed: a hint that is derived
 * and never drawn is the silence this exists to end.
 *
 * The List is registered HERE, through the real registry, with a synthetic id and two declared
 * options. Not `register-defaults`: importing it drags the map List and leaflet's CSS (png urls)
 * into a tier that has no loader for them, and the kanban's real vocabulary is tier 3's to pin.
 * What this tier pins is the component's contract against whatever the registry declares.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lists } from '../../webview/src/registry/index';
import { render, text } from './render';
import UnknownOptionsHint from '../../webview/src/components/browse/UnknownOptionsHint.vue';

lists.register({
	id: 'demo-board',
	name: 'Demo board',
	component: { render: () => null },
	options: [
		{ field: 'group_by', name: 'Group by', type: 'string' },
		{ field: 'lane_by', name: 'Lane by', type: 'string' },
		{ field: 'lanes_by', name: 'Lanes by', type: 'string' },
	],
});

test('names the unknown key and not the known one, and says what to do', async () => {
	const root = await render(UnknownOptionsHint, { layout: 'demo-board', options: { lane_by: 'lane', bogus: 1 } });
	const words = text(root);
	assert.match(words, /bogus/);
	assert.doesNotMatch(words, /lane_by/, 'lane_by is declared on this List');
	assert.match(words, /update the extension/);
	assert.match(words, /isn.t known/, 'singular for one key');
});

test('two unknown keys are both named, plural', async () => {
	const root = await render(UnknownOptionsHint, { layout: 'demo-board', options: { a_by: 1, b_by: 2 } });
	const words = text(root);
	assert.match(words, /a_by/);
	assert.match(words, /b_by/);
	assert.match(words, /aren.t known/);
});

test('every key known → renders nothing', async () => {
	const root = await render(UnknownOptionsHint, { layout: 'demo-board', options: { lane_by: 'lane', group_by: 'status' } });
	assert.equal(text(root).trim(), '');
});

test("an unregistered layout is the OTHER hint's job — this one stays quiet", async () => {
	const root = await render(UnknownOptionsHint, { layout: 'no-such-layout', options: { anything: 1 } });
	assert.equal(text(root).trim(), '');
});

// Descriptor v2 renamed the layout option keys (§3.5.1). A view still carrying an old spelling is
// told the NEW one — "unknown, check the spelling" would send the operator hunting for a typo.
test('an old option key is named with the name to write instead', async () => {
	const root = await render(UnknownOptionsHint, { layout: 'demo-board', options: { group_rows_by_field: 'lane', group_columns_by_field: 'status' } });
	const words = text(root).replace(/\s+/g, ' ');
	assert.match(words, /group_rows_by_field is now group_by/);
	assert.match(words, /group_columns_by_field is now lanes_by/);
	assert.doesNotMatch(words, /update the extension/, 'a rename is not an unknown key');
});

test('a rename and an unknown key are both said, each its own way', async () => {
	const root = await render(UnknownOptionsHint, { layout: 'demo-board', options: { group_rows_by_field: 'lane', bogus: 1 } });
	const words = text(root).replace(/\s+/g, ' ');
	assert.match(words, /group_rows_by_field is now group_by/);
	assert.match(words, /bogus isn.t known/);
});
