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
import { all, find, flush, render, text, unmountAll, type TestNode } from './render';

/** One attribute of a drawn node, as a string — `data-*` values are what the stage map is asserted by. */
const attr = (n: TestNode, name: string): string | undefined => (n.props[name] === undefined ? undefined : String(n.props[name]));
import { invalidateContract } from '../../src/api/adapter';
import { invalidateRelations } from '../../src/composables/fields';
import { refreshCollections } from '../../src/composables/collections';
import type { FieldRow } from '../../src/api/types';
import { fieldRow, mirrorRow } from '../unit/field-rows';
import { lists, views } from '../../src/registry/index';
import DataTable from '../../src/components/DataTable.vue';
import ItemProperties from '../../src/components/ItemProperties.vue';

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
const STAGES = {
	stage_reviews: 'reviews',
	stages: [
		{ title: 'design', fields: ['design_docs'], reviews: [{ subject: 'design_docs' }, { subject: 'self', kind: ['acceptance'], before: 'deployed_on' }], gate: ['rnd--design--change-requests', 'rnd--review--change-requests--design', 'rnd--review--change-requests'] },
		{ title: 'plan', fields: ['implementation_plans'], reviews: [{ subject: 'implementation_plans', kind: ['design'] }], gate: ['rnd--plan--change-requests', 'rnd--review--change-requests--plan'] },
		{ title: 'implement', fields: ['implementation_plans'], reviews: [{ kind: ['code'] }], gate: ['rnd--implement--change-requests', 'rnd--review--change-requests--code'] },
		{ title: 'test', fields: ['tests', 'tested_on', 'verified_on'], reviews: [{ kind: ['test'] }], gate: ['rnd--test--change-requests', 'rnd--review--change-requests--test'] },
		{ title: 'deploy', fields: ['deployed_on'], reviews: [{ subject: 'self', kind: ['acceptance'], since: 'deployed_on' }], gate: ['rnd--deploy--change-requests', 'rnd--review--change-requests--deploy'] },
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
];
const TARGETS = new Map([['design_docs', 'rnd/design-docs'], ['implementation_plans', 'rnd/implementation-plans'], ['tests', 'rnd/tests'], ['reviews', 'rnd/reviews']]);

/** The engine's `commandsFor` answer for one record: binding → state. */
let states: Record<string, string> = {};
let reviews: Array<Record<string, unknown>> = [];

beforeEach(() => {
	unmountAll();
	resetHost();
	invalidateContract();
	invalidateRelations();
	onHostRequest((method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (path.startsWith('/commands/')) {
			return {
				collection: CR,
				ids: ['otp-expiry'],
				commands: Object.entries(states).map(([b, s]) => ({ binding: `command-bindings/${b}`, command: 'commands/rnd/x', name: b.startsWith('rnd--review') ? 'rnd/review' : `rnd/${b.split('--')[1]}`, description: '', 'argument-hint': null, scope: 'record', states: { 'otp-expiry': s }, eligible: [], done: [], invocation: null })),
			};
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

test('an accepted request with no plan yet: five stages in order, the plan stage drawn EMPTY rather than left out', async () => {
	states = { 'rnd--design--change-requests': 'done', 'rnd--review--change-requests--design': 'done', 'rnd--review--change-requests': 'done', 'rnd--plan--change-requests': 'available' };
	reviews = [{ id: '2026-01-11--otp-expiry-design', name: 'OTP expiry design — design', kind: 'design', subject: '/rnd/design-docs/2026-01-10--otp-expiry', change_request: `${CR}/otp-expiry`, verdict: 'approve', created: '2026-01-11T09:00:00+02:00' }];
	const root = await draw({ design_docs: ['/rnd/design-docs/2026-01-10--otp-expiry'] });
	assert.deepEqual(stageNodes(root).map((n) => attr(n, 'data-stage')), ['design', 'plan', 'implement', 'test', 'deploy']);
	assert.deepEqual(stageNodes(root).map((n) => attr(n, 'data-state')), ['passed', 'ready', 'not-started', 'not-started', 'not-started']);
	const plan = stageOf(root, 'plan');
	assert.equal(valueIn(plan, 'implementation_plans'), 'Empty', 'no plan yet is an empty stage, drawn');
	assert.equal(valueIn(plan, '$reviews'), 'No review yet');
	assert.equal(valueIn(stageOf(root, 'test'), 'tests'), 'Empty');
	assert.match(valueIn(stageOf(root, 'design'), '$reviews'), /OTP expiry design — design\s*approve/);
	assert.match(valueIn(plan, '$gate'), /\/rnd:plan · available/);
	assert.ok(requests.some((q) => q.path.startsWith('/commands/')), 'the gate states come from the engine\'s commands answer');
});

test('a review lands in its stage with its verdict, and the stage awaiting it says so', async () => {
	states = { 'rnd--implement--change-requests': 'done', 'rnd--review--change-requests--code': 'available' };
	reviews = [{ id: '2026-01-13--otp-expiry-code', name: 'OTP expiry branch — code', kind: 'code', subject: '/rnd/implementation-plans/2026-01-12--otp-expiry', change_request: `${CR}/otp-expiry`, verdict: 'changes-requested', created: '2026-01-13T12:00:00+02:00' }];
	const root = await draw({ implementation_plans: ['/rnd/implementation-plans/2026-01-12--otp-expiry'] });
	const implement = stageOf(root, 'implement');
	assert.equal(attr(implement, 'data-state'), 'review');
	assert.match(valueIn(implement, '$reviews'), /OTP expiry branch — code\s*changes-requested/);
	assert.equal(valueIn(stageOf(root, 'plan'), '$reviews'), 'No review yet', 'a code review is not the plan\'s draft review');
});

test('a collection that declares no stages draws no map', async () => {
	states = {};
	reviews = [];
	const root = await draw({}, {});
	assert.deepEqual(stageNodes(root), []);
	assert.equal(requests.some((q) => q.path.startsWith('/commands/')), false, 'and asks the host nothing for it');
});
