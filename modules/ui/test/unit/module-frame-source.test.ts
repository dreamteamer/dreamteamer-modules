// cr-modules-008 D6/D15: a module frame is ONE self-contained document carrying the host's stylesheet. dt web
// inlines guest.css on the files origin; the srcdoc path (VS Code) builds the document in the page and must carry
// the same stylesheet, read from beside the guest — or the frame falls back to the browser's serif default.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const served: Record<string, string> = {
	'vscode-resource://x/guest/guest.js': 'window.guest=1',
	'vscode-resource://x/guest/guest.css': 'body{font-family:var(--dt-font)}',
	'vscode-resource://ui/m1/app.js': 'export default 1',
};
(globalThis as any).window = {
	__DT_GUEST_URL__: 'vscode-resource://x/guest/guest.js',
	__DT_UI_BASE__: 'vscode-resource://ui',
	__DT_HOST__: { moduleFrames: 'srcdoc' },
	addEventListener() {},
};
(globalThis as any).fetch = async (url: string) => ({ ok: url in served, status: url in served ? 200 : 404, text: async () => served[url] ?? 'not found' });
const { frameSource } = await import('../../src/modules');

test('the srcdoc frame document carries the stylesheet beside the guest, inline', async () => {
	const s = await frameSource('m1', 'edit');
	assert.ok(s.srcdoc && !s.src, 'srcdoc on the VS Code host');
	assert.match(s.srcdoc!, /<style>body\{font-family:var\(--dt-font\)\}<\/style>/, 'guest.css inlined in the frame');
	assert.match(s.srcdoc!, /window\.guest=1/, 'the guest script');
});

test('a guest without a stylesheet beside it still frames — unstyled, never broken', async () => {
	delete served['vscode-resource://x/guest/guest.css'];
	const s = await frameSource('m1', 'view');
	assert.ok(s.srcdoc, 'the document is built');
	assert.doesNotMatch(s.srcdoc!, /not found/, 'a 404 body is never inlined as a stylesheet');
});

test('cr-modules-017: a url-framed host draws the frame from the frames base GET /host answered', async () => {
	const { hostInfo } = await import('../../src/lib/host-boot');
	(globalThis as any).window.__DT_HOST__ = { moduleFrames: 'url' };
	hostInfo.value = { level: 'admin', chat: false, workspace: { id: 'w', name: 'w' }, framesBase: '/_frames/k1' };
	assert.deepEqual(await frameSource('m1', 'edit'), { src: '/_frames/k1/m1/edit.html' });
	hostInfo.value = { ...hostInfo.value, framesBase: '/_frames/k2' };
	assert.deepEqual(await frameSource('m1', 'edit'), { src: '/_frames/k2/m1/edit.html' });
	(globalThis as any).window.__DT_HOST__ = { moduleFrames: 'srcdoc' };
});
