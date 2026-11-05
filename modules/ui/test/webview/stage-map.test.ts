/**
 * THE STAGE MAP on a record page — the render tier.
 *
 * A collection that declares `display.record.options.stages` gets its lifecycle drawn above the
 * properties, by the record page's real renderer (`ItemProperties`) over the real adapter: the gate
 * states come from the host's `commands` answer, the reviews from the host's records read filtered on
 * the mirror's owning field. What is asserted is what DRAWS:
 *
 *   1. every declared stage, in order, each with its state;
 *   2. an EMPTY field — no plan yet, no review yet — drawn as the empty stage, not left out;
 *   3. a review drawn in the stage it belongs to, with its verdict;
 *   4. a collection that declares no stages draws no map.
 *
 * The cast is the synthetic Northwind change request; `ContentDetail` cannot mount here (reka-ui) and
 * hands ItemProperties exactly these props.
 */
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h, ref } from 'vue';
import { onHostRequest, requests, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';

/** One attribute of a drawn node, as a string — `data-*` values are what the stage map is asserted by. */
const attr = (n: TestNode, name: string): string | undefined => (n.props[name] === undefined ? undefined : String(n.props[name]));
import { invalidateContract } from '../../webview/src/api/adapter';
import { invalidateRelations } from '../../webview/src/composables/fields';
import { refreshCollections } from '../../webview/src/composables/collections';
import type { FieldRow } from '../../webview/src/api/types';
import { fieldRow, mirrorRow } from '../unit/field-rows';
import { lists, views } from '../../webview/src/registry/index';
import DataTable from '../../webview/src/components/DataTable.vue';
import ItemProperties from '../../webview/src/components/ItemProperties.vue';

lists.register({ id: 'table', name: 'Table', component: DataTable });

views.register({
	id: 'text',
	name: 'Text',
	types: [],
	component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } },
});
views.register({
	id: 'relation',
	name: 'Relation',
	types: [],
	component: {
		props: ['value'],
		render(this: { value: unknown }) {
			return h('span', { class: 'dt-links' }, (Array.isArray(this.value) ? this.value : [this.value]).join(', '));
		},
	},
});
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

const CR = 'rnd/change-requests';
// rnd 0.8.0's declaration, verbatim in shape (rnd/change-requests' display.record.options)
const STAGES = {
	stage_reviews: 'reviews',
	stages: [
		{ title: 'design', fields: ['design_docs'], reviews: [{ subject: 'design_docs' }, { subject: 'self', kind: ['acceptance'], before: 'deployed_on' }], gate: ['rnd--design--change-requests', 'rnd--review--change-requests--design', 'rnd--review--change-requests'] },
		{ title: 'plan', fields: ['implementation_plans'], reviews: [{ subject: 'implementation_plans', kind: ['design', 'ux', 'security', 'compliance', 'other'] }], gate: ['rnd--plan--change-requests', 'rnd--review--change-requests--plan'] },
		{ title: 'implement', fields: ['implementation_plans'], reviews: [{ kind: ['code'] }], gate: ['rnd--implement--change-requests', 'rnd--review--change-requests--code'] },
		{ title: 'test', fields: ['tests', 'tested_on', 'verified_on'], reviews: [{ kind: ['test'] }], gate: ['rnd--test--change-requests', 'rnd--review--change-requests--test'] },
		{ title: 'deploy', fields: ['release', 'deployed_on'], reviews: [{ subject: 'self', kind: ['acceptance'], since: 'deployed_on' }], gate: ['rnd--deploy--change-requests', 'rnd--release--change-requests', 'rnd--review--change-requests--deploy'] },
	],
};
const FIELDS: FieldRow[] = [
	fieldRow('name', { collection: CR }),
	{ ...mirrorRow('design_docs', 'change_requests'), collection: CR },
	{ ...mirrorRow('implementation_plans', 'change_request'), collection: CR },
	{ ...mirrorRow('tests', 'covers'), collection: CR },
	{ ...mirrorRow('reviews', 'change_request'), collection: CR },
	fieldRow('tested_on', { collection: CR, type: 'datetime' }),
	fieldRow('verified_on', { collection: CR, type: 'datetime' }),
	fieldRow('deployed_on', { collection: CR, type: 'datetime' }),
	fieldRow('release', { collection: CR }),
];
const TARGETS = new Map([['design_docs', 'rnd/design-docs'], ['implementation_plans', 'rnd/implementation-plans'], ['tests', 'rnd/tests'], ['reviews', 'rnd/reviews']]);

/** The engine's `commandsFor` answer for one record: binding → state. */
let states: Record<string, string> = {};
let reviews: Array<Record<string, unknown>> = [];
/** How the host answers `/commands`: at once (default), held until released, or refused. */
let commandsMode: 'answer' | 'hold' | 'reject' = 'answer';
let releaseHeld: () => void = () => {};

beforeEach(() => {
	commandsMode = 'answer';
	unmountAll();
	resetHost();
	invalidateContract();
	invalidateRelations();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (path.startsWith('/commands/')) {
			if (commandsMode === 'reject') throw new Error('host restarting');
			const answer = () => ({
				collection: CR,
				ids: ['otp-expiry'],
				commands: Object.entries(states).map(([b, s]) => ({ binding: `command-bindings/${b}`, command: 'commands/rnd/x', name: b.startsWith('rnd--review') ? 'rnd/review' : `rnd/${b.split('--')[1]}`, description: '', 'argument-hint': null, scope: 'record', states: { 'otp-expiry': s }, eligible: [], done: [], invocation: s === 'available' ? `/${b.startsWith('rnd--review') ? 'rnd:review' : `rnd:${b.split('--')[1]}`} ${CR}/otp-expiry` : null })),
			});
			if (commandsMode === 'hold') return new Promise((resolve) => { releaseHeld = () => resolve(answer()); });
			return answer();
		}
		if (path.includes('/records?')) {
			const params = new URLSearchParams(path.slice(path.indexOf('?') + 1));
			const filter = JSON.parse(params.get('filter') ?? '{}') as { change_request?: { _eq?: string } };
			return { records: reviews.filter((r) => r['change_request'] === filter.change_request?._eq), total: reviews.length };
		}
		throw new Error(`the render tier did not stub ${method} ${path}`);
	});
});

async function draw(record: Record<string, unknown>, options: Record<string, unknown> = STAGES): Promise<TestNode> {
	await refreshCollections();
	const item = { record: ref({ id: 'otp-expiry', name: 'OTP expiry', ...record }), edits: ref({}), setField() {} };
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(`/content/${CR}/otp-expiry`);
	await r.isReady();
	const Page = defineComponent({ setup: () => () => h(ItemProperties, { fields: FIELDS, item, readonly: true, relationTargets: TARGETS, options }) });
	const root = await render(Page, {}, [r]);
	for (let i = 0; i < 30; i++) await flush();
	return root;
}

const stageNodes = (root: TestNode) => all(root, (n) => n.tag === 'li' && attr(n, 'data-stage') !== undefined);
const stageOf = (root: TestNode, title: string) => stageNodes(root).find((n) => attr(n, 'data-stage') === title)!;
const valueIn = (stage: TestNode, field: string) => text(find(stage, (n) => attr(n, 'data-field') === field)!).trim();
const chipOf = (stage: TestNode) => find(stage, (n) => hasClass(n, 'dt-stage__chip'))!;
const iconOf = (stage: TestNode) => String(find(chipOf(stage), (n) => hasClass(n, 'codicon'))!.props['class']);
const subtitle = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-stages__next'));
const cards = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-stage__card'));
const fire = async (n: TestNode, name: string, event: Record<string, unknown> = {}) => {
	(n.props[name] as (e: unknown) => void)(event);
	await flush();
};
const keyboard = { target: { matches: (q: string) => q === ':focus-visible' } };
const mouse = { target: { matches: () => false } };

const DONE_DESIGN = { 'rnd--design--change-requests': 'done', 'rnd--review--change-requests--design': 'done', 'rnd--review--change-requests': 'done' };
const PLAN_READY = { ...DONE_DESIGN, 'rnd--plan--change-requests': 'available', 'rnd--review--change-requests--plan': 'not-applicable', 'rnd--implement--change-requests': 'not-applicable', 'rnd--review--change-requests--code': 'not-applicable', 'rnd--test--change-requests': 'not-applicable', 'rnd--review--change-requests--test': 'not-applicable', 'rnd--deploy--change-requests': 'not-applicable', 'rnd--release--change-requests': 'not-applicable', 'rnd--review--change-requests--deploy': 'not-applicable' };
// cr-rnd-001's shape: code and test reviews never recorded, deploy waiting on its release
const RELEASE_WAITING = { ...DONE_DESIGN, 'rnd--plan--change-requests': 'done', 'rnd--review--change-requests--plan': 'done', 'rnd--implement--change-requests': 'done', 'rnd--review--change-requests--code': 'not-applicable', 'rnd--test--change-requests': 'not-applicable', 'rnd--review--change-requests--test': 'done', 'rnd--deploy--change-requests': 'not-applicable', 'rnd--release--change-requests': 'available', 'rnd--review--change-requests--deploy': 'not-applicable' };
const ALL_DONE = Object.fromEntries(Object.keys(RELEASE_WAITING).map((k) => [k, 'done']));
const SHIPPED_SKIPPING = { ...ALL_DONE, 'rnd--review--change-requests--code': 'not-applicable', 'rnd--test--change-requests': 'not-applicable' };

test('line 1: one row of five indexed stages, in declared order', async () => {
	states = PLAN_READY;
	reviews = [];
	const root = await draw({});
	const lists = all(root, (n) => n.tag === 'ol' && hasClass(n, 'dt-stages__list'));
	assert.equal(lists.length, 1);
	assert.deepEqual(stageNodes(root).map((n) => attr(n, 'data-stage')), ['design', 'plan', 'implement', 'test', 'deploy']);
	assert.deepEqual(stageNodes(root).map((n) => text(chipOf(n)).trim()), ['1 design', '2 plan', '3 implement', '4 test', '5 deploy']);
	assert.ok(requests.some((q) => q.path.startsWith('/commands/')), 'the gate states come from the engine\'s commands answer');
});

test('line 2: a passed stage is checked, the current one marked, the rest muted', async () => {
	states = PLAN_READY;
	reviews = [];
	const root = await draw({});
	assert.deepEqual(stageNodes(root).map((n) => attr(n, 'data-mark')), ['passed', 'current', 'ahead', 'ahead', 'ahead']);
	assert.match(iconOf(stageOf(root, 'design')), /codicon-pass-filled/);
	assert.deepEqual(stageNodes(root).filter((n) => attr(n, 'data-current') === 'true').map((n) => attr(n, 'data-stage')), ['plan']);
	assert.equal(attr(chipOf(stageOf(root, 'plan')), 'aria-current'), 'step');
	for (const t of ['implement', 'test', 'deploy']) assert.match(iconOf(stageOf(root, t)), /codicon-circle-large-outline/);
});

test('cr-rnd-001\'s shape: deploy is current on the release, implement and test were passed over', async () => {
	states = RELEASE_WAITING;
	reviews = [];
	const root = await draw({});
	assert.deepEqual(stageNodes(root).map((n) => attr(n, 'data-mark')), ['passed', 'passed', 'skipped', 'skipped', 'current']);
	assert.match(iconOf(stageOf(root, 'implement')), /codicon-circle-slash/);
	assert.equal(attr(stageOf(root, 'deploy'), 'data-state'), 'ready', 'waiting on /rnd:release is work, not a review');
	assert.equal(text(subtitle(root)[0]!).trim(), '/rnd:release available');
});

test('line 3: one short subtitle per state, and nothing else drawn on the page', async () => {
	const cases: Array<[Record<string, string>, string]> = [
		[PLAN_READY, '/rnd:plan available'],
		[{ ...DONE_DESIGN, 'rnd--plan--change-requests': 'done', 'rnd--review--change-requests--plan': 'done', 'rnd--implement--change-requests': 'done', 'rnd--review--change-requests--code': 'available' }, '/rnd:review available'],
		[ALL_DONE, 'all stages passed'],
		[SHIPPED_SKIPPING, 'done · 2 skipped'],
		[Object.fromEntries(Object.keys(ALL_DONE).map((k) => [k, 'not-applicable'])), 'no command available'],
	];
	for (const [s, want] of cases) {
		states = s;
		reviews = [];
		unmountAll();
		const root = await draw({});
		assert.equal(subtitle(root).length, 1);
		assert.equal(text(subtitle(root)[0]!).replace(/\s+/g, ' ').trim(), want);
		const section = find(root, (n) => hasClass(n, 'dt-stages'))!;
		const chips = stageNodes(root).map((n) => text(n)).join('');
		assert.equal(text(section).replace(/\s+/g, ''), (chips + text(subtitle(root)[0]!)).replace(/\s+/g, ''), 'the row and the subtitle are the map\'s only text');
	}
});

test('line 4: no field, review or gate on the page until a stage is hovered; hovering opens its card at once', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	states = PLAN_READY;
	reviews = [{ id: '2026-01-11--otp-expiry-design', name: 'OTP expiry design — design', kind: 'design', subject: '/rnd/design-docs/2026-01-10--otp-expiry', change_request: `${CR}/otp-expiry`, verdict: 'approve', created: '2026-01-11T09:00:00+02:00' }];
	const root = await draw({ design_docs: ['/rnd/design-docs/2026-01-10--otp-expiry'] });
	const map = find(root, (n) => hasClass(n, 'dt-stages'))!;
	assert.equal(all(map, (n) => attr(n, 'data-field') !== undefined).length, 0, 'the map draws no field, review or gate');
	assert.equal(cards(root).length, 0);
	await fire(stageOf(root, 'plan'), 'onMouseenter');
	assert.equal(cards(root).length, 1, 'open with no timer advanced');
	const plan = stageOf(root, 'plan');
	assert.equal(valueIn(plan, 'implementation_plans'), 'Empty');
	assert.equal(valueIn(plan, '$reviews'), 'No review yet');
	assert.match(valueIn(plan, '$gate'), /\/rnd:plan · available/);
	await fire(plan, 'onMouseleave');
	assert.equal(cards(root).length, 1, 'the grace: still open');
	await fire(plan, 'onMouseenter');
	t.mock.timers.tick(250);
	await flush();
	assert.equal(cards(root).length, 1, 're-entering inside the grace keeps it');
	await fire(plan, 'onMouseleave');
	t.mock.timers.tick(200);
	await flush();
	assert.equal(cards(root).length, 0, 'closed once the grace elapsed');
	await fire(stageOf(root, 'design'), 'onMouseenter');
	assert.match(valueIn(stageOf(root, 'design'), '$reviews'), /OTP expiry design — design\s*approve/);
});

test('line 4: keyboard focus opens a card, a mouse focus does not; the pointer takes it; Escape closes and returns focus', async (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	states = PLAN_READY;
	reviews = [];
	const root = await draw({});
	await fire(stageOf(root, 'plan'), 'onFocusin', mouse);
	assert.equal(cards(root).length, 0, 'a clicked chip pins nothing');
	await fire(stageOf(root, 'plan'), 'onFocusin', keyboard);
	assert.equal(attr(cards(root)[0]!.parent!, 'data-stage') ?? attr(find(root, (n) => n.tag === 'li' && cards(n).length === 1)!, 'data-stage'), 'plan');
	await fire(stageOf(root, 'test'), 'onMouseenter');
	assert.equal(attr(find(root, (n) => n.tag === 'li' && cards(n).length === 1)!, 'data-stage'), 'test', 'the pointer takes the card');
	await fire(stageOf(root, 'test'), 'onMouseleave');
	t.mock.timers.tick(200);
	await flush();
	assert.equal(attr(find(root, (n) => n.tag === 'li' && cards(n).length === 1)!, 'data-stage'), 'plan', 'and the grace gives it back to the keyboard');
	const chip = chipOf(stageOf(root, 'plan'));
	const spy = t.mock.method(chip as unknown as { focus: () => void }, 'focus');
	await fire(stageOf(root, 'plan'), 'onKeydown', { key: 'Escape' });
	assert.equal(cards(root).length, 0);
	assert.equal(spy.mock.callCount(), 1, 'focus returns to the chip, never the body');
});

test('line 4: the subtitle\'s command copies its invocation on one click', async (t) => {
	states = PLAN_READY;
	reviews = [];
	const writes: string[] = [];
	const nav = globalThis.navigator as unknown as Record<string, unknown>;
	const had = Object.getOwnPropertyDescriptor(nav, 'clipboard');
	Object.defineProperty(nav, 'clipboard', { configurable: true, value: { writeText: async (s: string) => { writes.push(s); } } });
	t.after(() => { if (had) Object.defineProperty(nav, 'clipboard', had); else delete nav['clipboard']; });
	const root = await draw({});
	const btn = find(subtitle(root)[0]!, (n) => n.tag === 'button')!;
	assert.equal(attr(btn, 'title'), `/rnd:plan ${CR}/otp-expiry`);
	await fire(btn, 'onClick');
	for (let i = 0; i < 5; i++) await flush();
	assert.deepEqual(writes, [`/rnd:plan ${CR}/otp-expiry`]);
	assert.equal(text(btn).trim(), 'Copied', 'the button itself reads Copied');
});

test('no gate answer yet, or a refused one: no stage marked skipped or current, no command claimed', async () => {
	states = PLAN_READY;
	reviews = [];
	commandsMode = 'hold';
	let root = await draw({});
	assert.deepEqual(stageNodes(root).map((n) => attr(n, 'data-mark')), ['ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
	assert.equal(subtitle(root).length, 1, 'the subtitle line is kept while loading — no height jump');
	assert.equal(text(subtitle(root)[0]!).trim(), '');
	releaseHeld();
	for (let i = 0; i < 10; i++) await flush();
	assert.equal(text(subtitle(root)[0]!).trim(), '/rnd:plan available');
	unmountAll();
	commandsMode = 'reject';
	root = await draw({});
	assert.deepEqual(stageNodes(root).map((n) => attr(n, 'data-mark')), ['ahead', 'ahead', 'ahead', 'ahead', 'ahead']);
	assert.equal(text(subtitle(root)[0]!).trim(), 'stages unavailable');
});

test('a collection that declares no stages draws no map', async () => {
	states = {};
	reviews = [];
	const root = await draw({}, {});
	assert.deepEqual(stageNodes(root), []);
	assert.equal(requests.some((q) => q.path.startsWith('/commands/')), false, 'and asks the host nothing for it');
});

test('the harness lets a test spy a drawn node\'s focus (cr-vscode-015: Escape returns focus to the chip)', async (t) => {
	states = {};
	const root = await draw({});
	const n = find(root, (x) => x.tag === 'section')!;
	const spy = t.mock.method(n as unknown as { focus: () => void }, 'focus');
	(n as unknown as { focus: () => void }).focus();
	assert.equal(spy.mock.callCount(), 1);
});
