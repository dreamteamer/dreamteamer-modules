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
import { all, find, flush, hasClass, installDomShims, openSelect, pickOption, render, text, unmountAll, type TestNode } from './render';
import { onHostRequest, requests, resetHost } from './host-stub';
import ViewSaveActions from '../../webview/src/components/browse/ViewSaveActions.vue';
import ViewModuleField from '../../webview/src/components/ViewModuleField.vue';
import { refusalAnswer, savedAnswer } from '../../webview/src/lib/save-answer';
import { recordPageTargets, viewModuleTargets } from '../../webview/src/lib/view-module-targets';
import { saveUiView } from '../../webview/src/composables/schema';

installDomShims();
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

// ---- cr-vscode-010: Save as… picks the module in ONE dropdown, so the form fits the window ------------
// The radio list these replace (cr-vscode-002's "an installed one locked WITH the reason" and "confirming
// sends the picked module") drew a row per module with its path under it; with ~19 modules the popover
// ran ~1800px and Save sat below the window. A 19-module synthetic manifest: the workspace module, 2
// more inline, 11 linked under one clone, 5 installed by npm.
const inl = (id: string) => ({ id, title: id, location: 'modules', path: `modules/${id}` });
const lnk = (id: string) => ({ id, title: id, location: 'git_modules', path: `git_modules/northwind-modules/modules/${id}` });
const pkg = (id: string) => ({ id, title: id, location: 'node_modules', path: `node_modules/@harbor/${id}` });
const LINKED = ['claims', 'claims-archive', 'billing', 'fleet', 'ports', 'routes', 'tariffs', 'crews', 'cargo', 'docks', 'audits'];
const NPM = ['core', 'harbor-rnd', 'routines', 'search', 'carriers'];
const MANIFEST19 = [inl('default'), inl('reports'), ...LINKED.map(lnk), inl('ledger'), ...NPM.map(pkg)];
const TARGETS19 = viewModuleTargets(MANIFEST19, 'default');
const optionLabel = (o: TestNode) => text(find(o, (n) => hasClass(n, 'dt-dd__option-label'))!);
const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

test('Save as… draws ONE module control and no radio rows', async () => {
	const root = await render(ViewSaveActions, base({ formOpen: true, targets: TARGETS19 }));
	assert.equal(all(root, (n) => n.props['role'] === 'combobox' && n.props['aria-label'] === 'Module').length, 1);
	assert.equal(all(root, (n) => n.tag === 'input' && n.props['type'] === 'radio').length, 0);
});

test('Save as… defaults to the workspace module and offers every inline and linked module, no npm one', async () => {
	const root = await render(ViewSaveActions, base({ formOpen: true, targets: TARGETS19 }));
	const control = find(root, (n) => n.props['role'] === 'combobox' && n.props['aria-label'] === 'Module')!;
	assert.match(text(control), /^Workspace module/, 'the closed control reads the default');
	const options = await openSelect(root, 'Module');
	assert.deepEqual(options.map(optionLabel), ['Workspace module', 'reports', ...LINKED, 'ledger']);
	assert.equal(options.length, 14);
	for (const o of options) if (LINKED.includes(optionLabel(o))) assert.match(text(o), /linked$/, `${optionLabel(o)} is hinted linked`);
	for (const id of NPM) assert.ok(!options.some((o) => optionLabel(o) === id), `${id} is never offered`);
});

test('Save as… says ONCE that the npm-installed modules are not offered, and names them on hover', async () => {
	const root = await render(ViewSaveActions, base({ formOpen: true, targets: TARGETS19 }));
	await openSelect(root, 'Module');
	const note = all(root, (n) => 'data-modules-locked' in n.props);
	assert.equal(note.length, 1);
	assert.equal(text(note[0]!), '5 modules installed by npm are not offered — a write there is erased by the next npm install.');
	assert.equal(note[0]!.props['title'], NPM.join(', '));
	const form = byAttr(root, 'data-save-as-form')!;
	assert.equal(occurrences(text(form), 'installed by npm'), 1, 'once in the whole form, the open options included');

	const none = await render(ViewSaveActions, base({ formOpen: true, targets: viewModuleTargets([inl('default'), inl('reports')], 'default') }));
	assert.equal(find(none, (n) => 'data-modules-locked' in n.props), null, 'no npm module, no sentence');
});

test('a module\'s path is its option\'s hover and the line under the control — never drawn on every option', async () => {
	const root = await render(ViewSaveActions, base({ formOpen: true, targets: TARGETS19 }));
	const where = () => text(byAttr(root, 'data-module-where')!);
	assert.equal(where(), 'default · modules/default');
	const options = await openSelect(root, 'Module');
	for (const o of options) {
		assert.doesNotMatch(text(o), /\//, `no path drawn on ${optionLabel(o)}`);
		assert.match(String(o.props['title']), /·/, `${optionLabel(o)} carries its path as its hover`);
	}
	assert.equal(options.find((o) => optionLabel(o) === 'claims')!.props['title'], 'claims · linked · git_modules/northwind-modules/modules/claims');
	await pickOption(root, 'Module', 'claims');
	assert.equal(where(), 'claims · linked · git_modules/northwind-modules/modules/claims');
});

test('saving into a picked linked module carries that module to the save', async () => {
	const seen: Array<Record<string, unknown>> = [];
	const root = await render(ViewSaveActions, base({ formOpen: true, targets: TARGETS19, onConfirm: (v: Record<string, unknown>) => seen.push(v) }));
	const input = find(root, (n) => n.tag === 'input' && n.props['aria-label'] === 'View name')!;
	(input.props['onInput'] as (e: unknown) => void)({ target: { value: 'By status' } });
	await pickOption(root, 'Module', 'claims');
	(find(root, (n) => n.tag === 'form')!.props['onSubmit'] as (e: { preventDefault(): void }) => void)({ preventDefault() {} });
	assert.deepEqual(seen, [{ name: 'By status', icon: '', module: 'claims' }]);
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

test('the record page\'s Module field is the same one dropdown, and a pick asks to move the view (cr-vscode-010)', async () => {
	const moved: string[] = [];
	const targets = recordPageTargets(viewModuleTargets(MANIFEST19, 'default'), 'default');
	const props = { module: 'default', targets, readOnlyReason: null, busy: false, answer: null, onMove: (m: string) => moved.push(m) };
	const root = await render(ViewModuleField, props);
	const control = find(root, (n) => n.props['role'] === 'combobox' && n.props['aria-label'] === 'Module')!;
	assert.equal(all(root, (n) => n.tag === 'input' && n.props['type'] === 'radio').length, 0, 'no radio rows');
	assert.match(text(control), /^default \(workspace module\)/, 'the module it is in now');
	assert.equal(all(root, (n) => 'data-modules-locked' in n.props).length, 1, 'the npm modules said once');
	assert.equal(text(byAttr(root, 'data-module-where')!), 'default · modules/default');
	await pickOption(root, 'Module', 'reports');
	await pickOption(root, 'Module', 'default (workspace module)');
	assert.deepEqual(moved, ['reports'], 'picking the module it is already in is not a move');

	const busy = await render(ViewModuleField, { ...props, busy: true });
	assert.equal(find(busy, (n) => n.props['role'] === 'combobox')!.props['disabled'], true, 'no pick while a move runs');

	const unread = await render(ViewModuleField, { ...props, module: undefined });
	assert.match(text(find(unread, (n) => n.props['role'] === 'combobox')!), /^—/, 'a module not read yet shows no module');
	assert.equal(byAttr(unread, 'data-module-where'), null, 'and no path');
});

test('a view a package ships says why it does not move, instead of offering a choice', async () => {
	const root = await render(ViewModuleField, { module: 'carriers', targets: TARGETS, readOnlyReason: 'shipped by an installed package, so it moves with the package.', busy: false, answer: null });
	assert.match(text(byAttr(root, 'data-readonly')!), /shipped by an installed package/);
	assert.equal(find(root, (n) => 'data-module' in n.props), null, 'no choice is offered');
});
