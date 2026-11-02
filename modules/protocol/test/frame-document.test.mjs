import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFrameDocument, FRAME_POLICY } from '../src/frame-document.js';

const bundle = 'export const X = "</script><b>Grüße ✓ 日本</b>";\nexport default async function register(api) {}\n';
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="dt-bundle">([\s\S]*?)<\/script>/)[1]);

test('the bundle round-trips byte-equal through the data block, </script and non-ASCII included', () => {
	const { html } = buildFrameDocument({ guestText: 'void 0', bundleText: bundle });
	assert.equal(dataOf(html), bundle);
	assert.equal(html.match(/<\/script/gi).length, 2); // the data block's own close and the guest's
});
test('a module frame has exactly one executable inline script; meta puts the policy first in head', () => {
	const { html, scriptTexts } = buildFrameDocument({ guestText: 'void 0', bundleText: bundle, meta: true });
	assert.deepEqual(scriptTexts, ['void 0']);
	assert.equal((html.match(/<script(?![^>]*application\/json)/g) ?? []).length, 1);
	assert.ok(html.startsWith(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${FRAME_POLICY}">`));
	assert.ok(!/ nonce=| integrity=| src=/.test(html));
});
test('the frame policy holds no host, hash or nonce', () => {
	assert.equal(FRAME_POLICY, "default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; worker-src 'none'");
	assert.ok(!/sha256|nonce|https?:/.test(FRAME_POLICY));
});
test('an artifact page: guest in head, bodyHtml (its JSON data blocks kept), then its scripts in page order, classic and module', () => {
	const { html, scriptTexts } = buildFrameDocument({
		guestText: 'window.dt={}', meta: true, policy: "default-src 'none'; script-src 'unsafe-inline'",
		bodyHtml: '<div id="app"></div><script type="application/json" id="cfg">{"a":1}</script>',
		scripts: [{ text: 'dt.subscribe()' }, { text: 'import "x"', type: 'module' }],
	});
	assert.deepEqual(scriptTexts, ['window.dt={}', 'dt.subscribe()', 'import "x"']);
	const order = ['window.dt={}', '<div id="app">', 'id="cfg"', '<script>dt.subscribe()', '<script type="module">import "x"'].map((s) => html.indexOf(s));
	assert.deepEqual([...order].sort((a, b) => a - b), order);
	assert.ok(order.every((i) => i > 0));
	assert.ok(!html.includes('dt-bundle'));
});
test('a script text that would close its own block is refused', () => {
	assert.throws(() => buildFrameDocument({ guestText: 'a="</SCRIPT>"' }), /closes its own block/);
	assert.throws(() => buildFrameDocument({ guestText: 'x', scripts: [{ text: '"</script >"' }] }), /closes its own block/);
	assert.throws(() => buildFrameDocument({ guestText: 'x', scripts: [{ text: 'y', type: 'text/x' }] }), /classic or module/);
});
