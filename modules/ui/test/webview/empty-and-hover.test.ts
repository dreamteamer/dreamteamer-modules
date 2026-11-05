/**
 * EMPTY READS EMPTY, DETAILS ON AN INSTANT HOVER — the record page's property rows (cr-vscode-013).
 *
 * The record page's real renderer (`ItemProperties`) over the real adapter, the host answering the
 * reverse lookup by running the ENGINE's own `matchesFilter` over five synthetic tickets — so the
 * count is whatever the filter the host actually received selects, never a number the stub made up.
 *
 *   t3 (line 1) an empty generated field's value cell is exactly `Empty` — no generated-from sentence,
 *               no "more from other sources" sentence;
 *   t4 (line 2) pointed at from elsewhere: `Empty` and a muted `+N elsewhere`, nothing else, no lock;
 *               the muted colour wins over base.css's `.dt-computed *`;
 *   t5 (line 3) the card opens on mouseenter of the name or of the empty value with NO timer, holds
 *               the full explanation, closes on mouseleave; neither trigger carries a native `title`;
 *   t6 (lines 4, 5) the count is the records pointing here, and a field holding a value is drawn as in
 *               0.24.27 (its lock line, its "N more" span, its value cell's title) with the right N.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { beforeEach } from 'node:test';
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h, nextTick, ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { ENGINE, NO_ENGINE } from '../unit/engine-under-test';
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

const REQ = 'requests';
const SOURCES = [
	{ name: 'scratch', kind: 'own', repo: '.', path: 'data/requests', installed: true, count: 2 },
	{ name: 'project-a', kind: 'layer', repo: 'git_modules/project-a', path: 'git_modules/project-a/data/requests', installed: true, count: 1 },
];
const ROW = { collection: REQ, title: 'Requests', nav: {}, list: { layout: 'table' }, record: { layout: 'page' }, form: { sections: [] }, record_title: '{{ title }}', runtime: false, internal: false, sources: SOURCES };

const FIELDS: FieldRow[] = [
	fieldRow('title', { collection: REQ }),
	fieldRow('notes_plain', { collection: REQ }),
	{ ...mirrorRow('tickets', 'requests'), collection: REQ },
	{ ...mirrorRow('linked', 'links'), collection: REQ },
];
const TICKETS_ROW = { ...ROW, collection: 'tickets', title: 'Tickets', record_title: '{{ id }}', sources: [] };
const TICKET_FIELDS: FieldRow[] = [
	fieldRow('requests', { collection: 'tickets', role: 'reference_many', many: true }),
	fieldRow('links', { collection: 'tickets', role: 'reference_many', many: true }),
];
const TARGETS = new Map([['tickets', 'tickets'], ['linked', 'tickets']]);

/** Five tickets in other sources: two point at r-1 through `requests`, three through `links`. */
const TICKETS = [
	{ id: 't-1', requests: ['requests/r-1'], links: ['requests/r-1'] },
	{ id: 't-2', requests: ['requests/r-1'] },
	{ id: 't-3', requests: ['requests/elsewhere'] },
	{ id: 't-4', links: ['requests/r-1'] },
	{ id: 't-5', links: ['requests/r-1'] },
];

let matchesFilter: ((row: unknown, filter: unknown) => boolean) | undefined;

beforeEach(async () => {
	unmountAll();
	resetHost();
	invalidateContract();
	invalidateRelations();
	if (ENGINE && !matchesFilter) {
		matchesFilter = ((await import(pathToFileURL(path.join(ENGINE, 'src', 'records-api.js')).href)) as { matchesFilter: typeof matchesFilter }).matchesFilter;
	}
	onHostRequest((method, p) => {
		if (p === '/presentation') return { collections: [ROW, TICKETS_ROW], fields: { [REQ]: FIELDS, tickets: TICKET_FIELDS }, relations: [] };
		if (p === '/info') return { name: 'scratch' };
		if (p.startsWith('/collections/tickets/records')) {
			const params = new URLSearchParams(p.slice(p.indexOf('?') + 1));
			const filter = JSON.parse(params.get('filter') ?? '{}');
			const rows = TICKETS.filter((r) => matchesFilter!(r, filter));
			return { records: rows.slice(0, Number(params.get('limit') ?? 200)), total: rows.length };
		}
		throw new Error(`the render tier did not stub ${method} ${p}`);
	});
});

async function draw(record: Record<string, unknown>): Promise<TestNode> {
	await refreshCollections();
	const item = { record: ref({ title: 'A request', ...record }), edits: ref({}), setField() {} };
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(`/content/${REQ}/${String(record['id'])}`);
	await r.isReady();
	const Page = defineComponent({ setup: () => () => h(ItemProperties, { fields: FIELDS, item, readonly: true, relationTargets: TARGETS }) });
	const root = await render(Page, {}, [r]);
	for (let i = 0; i < 10; i++) await flush();
	return root;
}

const rowOf = (root: TestNode, field: string) => find(root, (n) => hasClass(n, 'dt-prop') && n.props['data-field'] === field)!;
const keyOf = (row: TestNode) => find(row, (n) => hasClass(n, 'dt-prop__key'))!;
const valueOf = (row: TestNode) => find(row, (n) => hasClass(n, 'dt-prop__value'))!;
const tooltips = (root: TestNode) => all(root, (n) => n.props['role'] === 'tooltip');
/** The element children of a node, in order (text nodes left out). */
const elements = (n: TestNode) => n.children.filter((c): c is TestNode => typeof c !== 'string' && !c.tag.startsWith('#'));

const skip = NO_ENGINE || false;

test('t3 (line 1): an empty generated field nothing points at reads exactly Empty — no generated-from or other-sources sentence', { skip }, async () => {
	const root = await draw({ id: 'r-quiet', notes_plain: '', tickets: [], linked: [] });
	for (const field of ['tickets', 'linked', 'notes_plain']) {
		const row = rowOf(root, field);
		assert.equal(text(valueOf(row)).trim(), 'Empty', `${field}: the cell reads Empty`);
		assert.equal(find(row, (n) => hasClass(n, 'dt-prop__generated')), null, `${field}: no lock-and-sentence line`);
		assert.equal(find(row, (n) => hasClass(n, 'dt-prop__overflow')), null, `${field}: no other-sources sentence`);
		assert.doesNotMatch(text(row), /Generated from|more from other sources/);
	}
});

test('t4 (line 2): pointed at from elsewhere, the empty cell is Empty and a muted +2 elsewhere — nothing else, no lock', { skip }, async () => {
	const root = await draw({ id: 'r-1', tickets: [], linked: ['tickets/t-1'] });
	const read = find(valueOf(rowOf(root, 'tickets')), (n) => hasClass(n, 'dt-prop__read'))!;
	const parts = elements(read);
	assert.deepEqual(parts.map((n) => [String(n.props['class']), text(n).trim()]), [['dt-prop__empty', 'Empty'], ['dt-prop__soft', '+2 elsewhere']]);
	assert.equal(find(rowOf(root, 'tickets'), (n) => hasClass(n, 'codicon-lock')), null, 'no lock glyph in the row');
	// the muted colour must beat base.css's `.dt-computed * { color: var(--dt-fg-subtle) !important }`
	const source = fs.readFileSync(path.join(process.cwd(), 'webview', 'src', 'components', 'ItemProperties.vue'), 'utf8');
	assert.match(source, /\.dt-computed \.dt-prop__empty,\s*\.dt-computed \.dt-prop__soft\s*\{[^}]*color:\s*var\(--dt-fg-muted\)\s*!important/);
});

test('t5 (line 3): the card opens on mouseenter of the name or the empty value with no timer, holds the explanation, closes on mouseleave', { skip }, async () => {
	const root = await draw({ id: 'r-1', tickets: [], linked: ['tickets/t-1'] });
	const row = rowOf(root, 'tickets');
	const key = keyOf(row);
	const value = valueOf(row);
	assert.equal(key.props['title'], undefined, 'the name carries no native title');
	assert.equal(value.props['title'], undefined, 'the empty value carries no native title');
	const realTimeout = globalThis.setTimeout;
	for (const [label, trigger] of [['name', key], ['empty value', value]] as const) {
		(globalThis as { setTimeout: unknown }).setTimeout = () => {
			throw new Error('the card must open without a timer');
		};
		try {
			(trigger.props['onMouseenter'] as (e?: unknown) => void)();
			await nextTick();
		} finally {
			globalThis.setTimeout = realTimeout;
		}
		const cards = tooltips(root);
		assert.equal(cards.length, 1, `one card from the ${label}`);
		const words = text(cards[0]!);
		assert.match(words, /Generated from tickets\.requests — set that field\./, `${label}: where it is generated from`);
		assert.match(words, /2 records in other sources point here/, `${label}: the count sentence`);
		assert.match(words, /tickets/, `${label}: the field name`);
		(trigger.props['onMouseleave'] as (e?: unknown) => void)();
		await nextTick();
		assert.equal(tooltips(root).length, 0, `${label}: mouseleave closes it`);
	}
	// a plain field with no description still explains itself: its label and its name
	const plainKey = keyOf(rowOf(root, 'notes_plain'));
	(plainKey.props['onMouseenter'] as () => void)();
	await nextTick();
	assert.match(text(tooltips(root)[0]!), /Notes Plain[\s\S]*notes_plain/);
});

test('t6 (lines 4, 5): the count is the records pointing here; a field holding a value is drawn as in 0.24.27 with the right N', { skip }, async () => {
	const pointed = await draw({ id: 'r-1', tickets: [], linked: ['tickets/t-1'] });
	assert.equal(text(find(rowOf(pointed, 'tickets'), (n) => hasClass(n, 'dt-prop__soft'))!).trim(), '+2 elsewhere', 'two of five tickets point here, not five');
	const linked = rowOf(pointed, 'linked');
	assert.ok(find(linked, (n) => hasClass(n, 'dt-browse--embedded')), 'the value is drawn as the target collection\'s own list, as in 0.24.27');
	assert.match(text(find(linked, (n) => hasClass(n, 'dt-prop__generated'))!), /Generated from tickets\.links — set that field\./, 'the lock line stays beside a value');
	assert.ok(find(linked, (n) => hasClass(n, 'codicon-lock')), 'with its lock');
	assert.equal(text(find(linked, (n) => hasClass(n, 'dt-prop__overflow'))!).trim(), '2 more from other sources', 'three point here, one is listed');
	assert.match(String(valueOf(linked).props['title'] ?? ''), /Generated from tickets\.links/, 'the value cell keeps its title');
	assert.equal(find(linked, (n) => hasClass(n, 'dt-prop__soft')), null, 'no soft count beside a value');
	assert.equal(tooltips(pointed).length, 0);
	unmountAll();
	const quiet = await draw({ id: 'r-quiet', tickets: [], linked: [] });
	assert.equal(find(rowOf(quiet, 'tickets'), (n) => hasClass(n, 'dt-prop__soft')), null, 'nothing points here: no count');
});
