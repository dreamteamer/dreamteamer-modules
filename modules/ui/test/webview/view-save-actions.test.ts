/**
 * A SAVE ANSWERS BESIDE THE BUTTON THAT WAS PRESSED (cr-vscode-002). The operator, 2026-10-31: "most
 * save and save as operations on ui views fail with non intuitive UI (op btn on top, error below the
 * scroll on bottom)". The answer and the Save as… form now live in the SAME container as the title-bar
 * buttons (`ViewSaveActions`), anchored to the button they answer, carrying the engine's sentence and
 * its one next action; the form asks for the target MODULE. What this tier cannot show is the pixels
 * — that the callout drops down under the bar — which is CSS (`.dt-vsa__pop`, absolute, top: 100%).
 * Synthetic names only.
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { onHostRequest, requests, resetHost } from './host-stub';
import ViewSaveActions from '../../src/components/browse/ViewSaveActions.vue';
import ViewModuleField from '../../src/components/ViewModuleField.vue';
import { refusalAnswer, savedAnswer } from '../../src/lib/save-answer';
import { LOCKED_REASON, viewModuleTargets } from '../../src/lib/view-module-targets';
import { saveUiView } from '../../src/composables/schema';

afterEach(() => unmountAll());

const MODULES = [
	{ id: 'default', title: 'default', location: 'modules', path: 'modules/default' },
	{ id: 'reports', title: 'Reports', location: 'modules', path: 'modules/reports' },
	{ id: 'carriers', title: 'Harbor carriers', location: 'node_modules', path: 'node_modules/@harbor/carriers' },
	{ id: 'claims', title: 'claims', location: 'git_modules', path: 'git_modules/northwind-modules/modules/claims' },
];
const TARGETS = viewModuleTargets(MODULES, 'default');
const squash = (s: string) => s.replace(/\s+/g, '');
const byAttr = (root: TestNode, attr: string, value?: string) => find(root, (n) => attr in n.props && (value === undefined || n.props[attr] === value));

const COLLISION = new Error('compile error: name collision on ui-view "claims-board"\n    - modules/reports/ui-views/claims-board.ui-view.yaml\n    - modules/default/ui-views/claims-board.ui-view.yaml');

function base(extra: Record<string, unknown> = {}) {
	return { dirty: true, saving: false, saveTitle: 'Save', answer: null, answerFor: null, formOpen: false, busy: false, collection: 'claims', targets: TARGETS, ...extra };
}

test('a refused Save answers INSIDE the title-bar actions, anchored to Save, with the engine\'s sentence and the next action', async () => {
	const root = await render(ViewSaveActions, base({ answer: refusalAnswer(COLLISION, { saveAs: false }), answerFor: 'save' }));
	const bar = byAttr(root, 'data-view-save-actions')!;
	const answer = byAttr(bar, 'data-save-answer');
	assert.ok(answer, 'the answer is a descendant of the SAME container as the buttons — not a section at the bottom of the drawer');
	assert.equal(answer!.props['role'], 'alert');
	assert.equal(byAttr(bar, 'data-anchor')!.props['data-anchor'], 'save', 'and it says which press it answers');
	assert.match(text(answer!), /name collision on ui-view "claims-board"/, 'the engine\'s own first line, verbatim');
	assert.match(text(answer!), /modules\/reports\/ui-views/, 'with the rest of its message as detail');
	const next = byAttr(answer!, 'data-action', 'next')!;
	assert.match(text(next), /Save as…/, 'one next action, offered as a button');
});

test('the next action reaches the parent, which opens the form where the name and module are', async () => {
	const seen: unknown[] = [];
	const root = await render(ViewSaveActions, base({ answer: refusalAnswer(COLLISION, { saveAs: false }), answerFor: 'save', onNext: (a: unknown) => seen.push(a) }));
	(byAttr(root, 'data-action', 'next')!.props['onClick'] as () => void)();
	assert.deepEqual(seen, ['rename']);
});

test('a refusal with no action the drawer can take still names what to do', async () => {
	const root = await render(ViewSaveActions, base({ answer: refusalAnswer(new Error('display.list.columns: unknown field "shoe_size"'), { saveAs: false }), answerFor: 'save' }));
	assert.equal(byAttr(root, 'data-action', 'next'), null);
	assert.match(text(byAttr(root, 'data-next')!), /Fix what the compiler names/);
});

test('Save as… asks for the module: the workspace module first and picked, writable modules by name, an installed one locked WITH the reason', async () => {
	const root = await render(ViewSaveActions, base({ formOpen: true }));
	const pop = byAttr(root, 'data-anchor')!;
	assert.equal(pop.props['data-anchor'], 'save-as');
	const rows = all(root, (n) => 'data-module' in n.props);
	assert.deepEqual(rows.map((r) => r.props['data-module']), ['', 'reports', 'claims', 'carriers'], 'workspace, writable, then the locked one last');
	assert.match(squash(text(rows[0]!)), /^Workspacemoduledefault·thedefault/);
	const radio = (r: TestNode) => find(r, (n) => n.tag === 'input')!;
	assert.equal(radio(rows[0]!).props['checked'], true, 'the default is the workspace module');
	assert.match(text(rows[2]!), /linked · git_modules\/northwind-modules\/modules\/claims/, 'a linked clone\'s module is offered, and says where it lives');
	const locked = rows[3]!;
	assert.ok(hasClass(locked, 'locked'));
	assert.equal(radio(locked).props['disabled'], true, 'it cannot be picked');
	assert.match(text(locked), new RegExp(LOCKED_REASON), 'and the reason is ON the row, before anybody picks it');
});

test('confirming sends the picked module with the name', async () => {
	const seen: Array<Record<string, unknown>> = [];
	const root = await render(ViewSaveActions, base({ formOpen: true, onConfirm: (v: Record<string, unknown>) => seen.push(v) }));
	const input = find(root, (n) => n.tag === 'input' && n.props['aria-label'] === 'View name')!;
	(input.props['onInput'] as (e: unknown) => void)({ target: { value: 'By status' } });
	const reports = find(root, (n) => n.props['data-module'] === 'reports')!;
	(find(reports, (n) => n.tag === 'input')!.props['onChange'] as () => void)();
	await flush();
	(find(root, (n) => n.tag === 'form')!.props['onSubmit'] as (e: { preventDefault(): void }) => void)({ preventDefault() {} });
	assert.deepEqual(seen, [{ name: 'By status', icon: '', module: 'reports' }]);
});

test('a refused Save as… keeps the form open and answers under it', async () => {
	const root = await render(ViewSaveActions, base({ formOpen: true, answer: refusalAnswer(new Error('module "carriers" ships from node_modules (node_modules/@harbor/carriers) — a write there is erased by the next npm install.'), { saveAs: true }), answerFor: 'save-as' }));
	const pop = byAttr(root, 'data-anchor')!;
	assert.ok(byAttr(pop, 'data-save-as-form'));
	assert.ok(byAttr(pop, 'data-save-answer'));
	assert.match(text(byAttr(pop, 'data-action', 'next')!), /Pick a module/);
});

test('Save as… with a module posts it as the ?module= SELECTOR, never as a key of the view', async () => {
	resetHost();
	onHostRequest(() => ({ id: 'views-claims-by-status' }));
	await saveUiView(undefined, { route: '/views/claims/by-status', scope: 'collection', collection: 'collections/claims', display: { list: { layout: 'kanban' } } }, 'reports');
	const post = requests.find((r) => r.method === 'POST')!;
	assert.match(post.path, /\/collections\/ui-views\/records\?module=reports$/);
	assert.equal('module' in (post.body as Record<string, unknown>), false);
});

test('the success sentence says when a save became an overlay over a shipped view or display', () => {
	assert.match(savedAnswer('view', { overlay: true }).sentence, /overlay — it takes precedence over the shipped view/);
	assert.match(savedAnswer('collection', { overlay: true }).sentence, /overlay in the workspace module/);
	assert.doesNotMatch(savedAnswer('collection', { overlay: true }).sentence, /declared/, 'no declaration written, none claimed');
	assert.equal(
		savedAnswer('collection', { overlay: true, peer: { collection: 'rnd/change-requests', module: 'default' } }).sentence,
		'Saved to the collection — as an overlay in the workspace module, and declared rnd/change-requests as a peer collection of default; the package\'s own display is untouched.',
		'a write to the module\'s package.json is said out loud',
	);
	assert.equal(savedAnswer('view', {}).sentence, 'View updated.');
	assert.match(String(savedAnswer('collection', {}, { unsaved: ['filter'] }).detail), /does not hold a filter/);
});

test('the record page\'s module field: every module in view, an installed one locked, and a pick asks to move it', async () => {
	const moved: string[] = [];
	const targets = TARGETS.map((t) => (t.id === null ? { ...t, id: 'default' } : t));
	const root = await render(ViewModuleField, { module: 'default', targets, readOnlyReason: null, busy: false, answer: null, onMove: (m: string) => moved.push(m) });
	const rows = all(root, (n) => 'data-module' in n.props);
	const radio = (id: string) => find(rows.find((r) => r.props['data-module'] === id)!, (n) => n.tag === 'input')!;
	assert.equal(radio('default').props['checked'], true, 'the module it is in now is the checked one');
	assert.equal(radio('carriers').props['disabled'], true, 'an installed package is not a destination');
	(radio('claims').props['onChange'] as () => void)();
	(radio('default').props['onChange'] as () => void)();
	assert.deepEqual(moved, ['claims'], 'picking the module it is already in is not a move');
});

test('a view a package ships says why it does not move, instead of offering a choice', async () => {
	const root = await render(ViewModuleField, { module: 'carriers', targets: TARGETS, readOnlyReason: 'shipped by an installed package, so it moves with the package.', busy: false, answer: null });
	assert.match(text(byAttr(root, 'data-readonly')!), /shipped by an installed package/);
	assert.equal(find(root, (n) => 'data-module' in n.props), null, 'no choice is offered');
});
