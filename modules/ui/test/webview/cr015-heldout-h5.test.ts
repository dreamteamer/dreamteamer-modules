// HELD-OUT h5 (cr-vscode-015) — navigator.clipboard rejecting (or absent) inside the webview: the
// fallback still copies the invocation, the button reads `Copied` and its command again after 1.5 s,
// and nothing is run. Reviewer-written; the builder never reads it.
import assert from 'node:assert/strict';
import test, { afterEach, beforeEach, mock } from 'node:test';
import { requests } from './host-stub';
import { all, text, type TestNode } from './render';
import { PLAN_READY, answers, cmdButton, draw, invocationOf, settle, setup } from './cr015-heldout-fixture';

const INVOCATION = invocationOf('rnd--plan--change-requests', 'otp-expiry'); // '/rnd:plan rnd/change-requests/otp-expiry'
let selected: string | null = null;
let execs: string[] = [];
const g = globalThis as Record<string, unknown>;
const saved = { document: g['document'], navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };

function installFallbackDom(): void {
	const base = (saved.document ?? {}) as Record<string, unknown>;
	g['document'] = {
		...base,
		addEventListener() {}, removeEventListener() {},
		body: { appendChild() {}, removeChild() {} },
		createElement: () => ({ value: '', style: {}, setAttribute() {}, focus() {}, remove() {}, setSelectionRange() {}, select(this: { value: string }) { selected = this.value; } }),
		getSelection: () => ({ removeAllRanges() {}, addRange() {}, rangeCount: 0 }),
		execCommand: (cmd: string) => { execs.push(cmd); return true; },
	};
}
/** A template-drawn hidden textarea, if the build uses one: its `select` records what it holds. */
function armTextareas(root: TestNode): void {
	for (const t of all(root, (n) => n.tag === 'textarea')) {
		Object.defineProperty(t, 'select', { configurable: true, writable: true, value: () => { selected = String(t.props['value'] ?? (t as unknown as { value?: string }).value ?? text(t)); } });
		Object.defineProperty(t, 'setSelectionRange', { configurable: true, writable: true, value: () => {} });
	}
}
const setNavigator = (value: unknown) => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });

beforeEach(() => { setup(); selected = null; execs = []; installFallbackDom(); });
afterEach(() => {
	mock.timers.reset();
	g['document'] = saved.document;
	if (saved.navigator) Object.defineProperty(globalThis, 'navigator', saved.navigator); else delete g['navigator'];
});

for (const [label, nav] of [
	['writeText rejects (permission withheld)', { clipboard: { writeText: async () => { throw new Error('NotAllowedError: Write permission denied.'); } } }],
	['no clipboard API at all', {}],
] as const) {
	test(`h5: ${label} — the fallback copies the invocation, the button reads Copied, then its command`, async () => {
		setNavigator(nav);
		answers.set('otp-expiry', () => PLAN_READY);
		const { root } = await draw('otp-expiry');
		const button = cmdButton(root);
		assert.ok(button, 'the subtitle draws its copy button');
		assert.equal(String(button.props['title']), INVOCATION);
		armTextareas(root);
		const before = requests.length;
		mock.timers.enable({ apis: ['setTimeout'] });
		await (button.props['onClick'] as (e?: unknown) => unknown)({ preventDefault() {}, stopPropagation() {} });
		await settle();
		assert.ok(execs.includes('copy'), `execCommand('copy') ran (got ${JSON.stringify(execs)})`);
		assert.equal(selected, INVOCATION, 'what was selected for the copy is the invocation');
		assert.equal(text(cmdButton(root)!).trim(), 'Copied');
		assert.ok(requests.slice(before).every((q) => q.method === 'GET'), 'nothing was run on the host');
		mock.timers.tick(1500);
		await settle();
		assert.equal(text(cmdButton(root)!).trim(), '/rnd:plan');
	});
}
