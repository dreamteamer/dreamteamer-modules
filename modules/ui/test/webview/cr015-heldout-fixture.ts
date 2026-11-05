/**
 * HELD-OUT FIXTURE for cr-vscode-015 — reviewer-written; the builder never reads it. Not a test file
 * (no `.test.ts`), so `scripts/test.mjs` bundles it only into the held-out files that import it.
 * Mounts the record page's real renderer (ItemProperties) over the host stub, like the visible
 * test/webview/stage-map.test.ts, with a commands answer per record id that can be HELD.
 */
import { createRouter, createMemoryHistory } from 'vue-router';
import { defineComponent, h, ref } from 'vue';
import { onHostRequest, resetHost } from './host-stub';
import { all, find, flush, hasClass, render, text, unmountAll, type TestNode } from './render';
import { invalidateContract } from '../../webview/src/api/adapter';
import { invalidateRelations } from '../../webview/src/composables/fields';
import { refreshCollections } from '../../webview/src/composables/collections';
import type { FieldRow } from '../../webview/src/api/types';
import { fieldRow, mirrorRow } from '../unit/field-rows';
import { lists, views } from '../../webview/src/registry/index';
import DataTable from '../../webview/src/components/DataTable.vue';
import ItemProperties from '../../webview/src/components/ItemProperties.vue';

lists.register({ id: 'table', name: 'Table', component: DataTable });
views.register({ id: 'text', name: 'Text', types: [], component: { props: ['value'], render(this: { value: unknown }) { return String(this.value ?? ''); } } });
views.register({ id: 'relation', name: 'Relation', types: [], component: { props: ['value'], render(this: { value: unknown }) { return h('span', { class: 'dt-links' }, (Array.isArray(this.value) ? this.value : [this.value]).join(', ')); } } });
(globalThis as { window?: unknown }).window ??= { addEventListener() {}, removeEventListener() {} };
(globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {} };

export const CR = 'rnd/change-requests';
/** rnd 0.8.0's declaration, verbatim (node_modules/@dreamteamer/rnd/collections/rnd/change-requests.collection.yaml). */
export const RND_STAGES = {
	stage_reviews: 'reviews',
	stages: [
		{ title: 'design', fields: ['design_docs'], reviews: [{ subject: 'design_docs' }, { subject: 'self', kind: ['acceptance'], before: 'deployed_on' }], gate: ['rnd--design--change-requests', 'rnd--review--change-requests--design', 'rnd--review--change-requests'] },
		{ title: 'plan', fields: ['implementation_plans'], reviews: [{ subject: 'implementation_plans', kind: ['design', 'ux', 'security', 'compliance', 'other'] }], gate: ['rnd--plan--change-requests', 'rnd--review--change-requests--plan'] },
		{ title: 'implement', fields: ['implementation_plans'], reviews: [{ kind: ['code'] }], gate: ['rnd--implement--change-requests', 'rnd--review--change-requests--code'] },
		{ title: 'test', fields: ['tests', 'tested_on', 'verified_on'], reviews: [{ kind: ['test'] }], gate: ['rnd--test--change-requests', 'rnd--review--change-requests--test'] },
		{ title: 'deploy', fields: ['release', 'deployed_on'], reviews: [{ subject: 'self', kind: ['acceptance'], since: 'deployed_on' }], gate: ['rnd--deploy--change-requests', 'rnd--release--change-requests', 'rnd--review--change-requests--deploy'] },
	],
};
export const FIELDS: FieldRow[] = [
	fieldRow('name', { collection: CR }),
	{ ...mirrorRow('design_docs', 'change_requests'), collection: CR },
	{ ...mirrorRow('implementation_plans', 'change_request'), collection: CR },
	{ ...mirrorRow('tests', 'covers'), collection: CR },
	{ ...mirrorRow('reviews', 'change_request'), collection: CR },
	fieldRow('release', { collection: CR }),
	fieldRow('tested_on', { collection: CR, type: 'datetime' }),
	fieldRow('verified_on', { collection: CR, type: 'datetime' }),
	fieldRow('deployed_on', { collection: CR, type: 'datetime' }),
];
export const TARGETS = new Map([['design_docs', 'rnd/design-docs'], ['implementation_plans', 'rnd/implementation-plans'], ['tests', 'rnd/tests'], ['reviews', 'rnd/reviews']]);

/** The shapes the held-out cases use: binding → state. A binding absent from the map is absent from the answer. */
export const PLAN_READY = { 'rnd--design--change-requests': 'done', 'rnd--review--change-requests--design': 'done', 'rnd--review--change-requests': 'done', 'rnd--plan--change-requests': 'available' };
export const CR_RND_001 = { ...PLAN_READY, 'rnd--plan--change-requests': 'done', 'rnd--review--change-requests--plan': 'done', 'rnd--implement--change-requests': 'done', 'rnd--test--change-requests': 'done', 'rnd--release--change-requests': 'available' };

/** record id → its commands answer (a function, so a test can return a promise it resolves later). */
export const answers = new Map<string, () => Record<string, string> | Promise<Record<string, string>>>();
/** The record the page shows now — the fallback when the request path carries no readable `ids`. */
export let shownId = 'otp-expiry';

/** A gate binding's command name and invocation, the way the engine answers them. */
export const nameOf = (b: string): string => (b.startsWith('rnd--review') ? 'rnd/review' : `rnd/${b.split('--')[1]}`);
export const invocationOf = (b: string, id: string): string => `/${nameOf(b).replace('/', ':')} ${CR}/${id}`;

export function setup(): void {
	unmountAll();
	resetHost();
	invalidateContract();
	invalidateRelations();
	answers.clear();
	shownId = 'otp-expiry';
	onHostRequest(async (method, path) => {
		if (path === '/presentation') return { collections: [], fields: {}, relations: [] };
		if (path === '/info') return { name: 'scratch', user: 'someone' };
		if (path.startsWith('/commands/')) {
			const m = /[?&]ids=([^&]*)/.exec(path);
			const id = m ? decodeURIComponent(m[1]!) : shownId;
			const states = (await answers.get(id)?.()) ?? {};
			return {
				collection: CR,
				ids: [id],
				commands: Object.entries(states).map(([b, s]) => ({ binding: `command-bindings/${b}`, command: 'commands/rnd/x', name: nameOf(b), description: '', 'argument-hint': null, scope: 'record', states: { [id]: s }, eligible: [], done: [], invocation: invocationOf(b, id) })),
			};
		}
		if (path.includes('/records?')) return { records: [], total: 0 };
		throw new Error(`the held-out stub did not expect ${method} ${path}`);
	});
}

export async function settle(): Promise<void> {
	for (let i = 0; i < 30; i++) await flush();
}

export async function draw(id: string, options: Record<string, unknown> = RND_STAGES) {
	shownId = id;
	await refreshCollections();
	const item = { record: ref<Record<string, unknown>>({ id, name: `Request ${id}` }), edits: ref({}), setField() {} };
	const r = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:path(.*)*', component: { render: () => null } }] });
	await r.push(`/content/${CR}/${id}`);
	await r.isReady();
	const Page = defineComponent({ setup: () => () => h(ItemProperties, { fields: FIELDS, item, readonly: true, relationTargets: TARGETS, options }) });
	const root = await render(Page, {}, [r]);
	await settle();
	return { root, item };
}

/** Show another record on the SAME mounted page — what navigating from one request to the next does. */
export async function show(item: { record: { value: Record<string, unknown> } }, id: string): Promise<void> {
	shownId = id;
	item.record.value = { id, name: `Request ${id}` };
	await settle();
}

export const attr = (n: TestNode, name: string): string | undefined => (n.props[name] === undefined ? undefined : String(n.props[name]));
export const stages = (root: TestNode) => all(root, (n) => n.tag === 'li' && attr(n, 'data-stage') !== undefined);
export const stage = (root: TestNode, title: string) => stages(root).find((n) => attr(n, 'data-stage') === title)!;
export const marks = (root: TestNode) => stages(root).map((n) => attr(n, 'data-mark'));
export const currentTitles = (root: TestNode) => stages(root).filter((n) => attr(n, 'data-current') === 'true').map((n) => attr(n, 'data-stage'));
export const chip = (li: TestNode) => find(li, (n) => n.tag === 'button' && hasClass(n, 'dt-stage__chip'))!;
export const subtitle = (root: TestNode) => find(root, (n) => n.tag === 'p' && hasClass(n, 'dt-stages__next'))!;
export const subtitleText = (root: TestNode) => text(subtitle(root)).replace(/\s+/g, ' ').trim();
export const cmdButton = (root: TestNode) => find(root, (n) => n.tag === 'button' && hasClass(n, 'dt-stages__cmd'));
export const cards = (root: TestNode) => all(root, (n) => hasClass(n, 'dt-stage__card'));
/** The stage whose card is drawn, or null. */
export function openStage(root: TestNode): string | null {
	const c = cards(root);
	if (c.length > 1) throw new Error(`${c.length} cards drawn at once`);
	let p = c[0]?.parent ?? null;
	while (p && attr(p, 'data-stage') === undefined) p = p.parent;
	return p ? attr(p, 'data-stage')! : null;
}
/** Fire a `li`'s Vue listener (`onMouseenter`, `onFocusin`, …) with a minimal event. */
export function fire(li: TestNode, listener: string, ev: Record<string, unknown> = {}): void {
	const fn = li.props[listener] as ((e: unknown) => void) | undefined;
	if (!fn) throw new Error(`the stage li carries no ${listener}`);
	fn({ target: li, currentTarget: li, relatedTarget: null, preventDefault() {}, stopPropagation() {}, ...ev });
}
/** A focus target that answers `matches(':focus-visible')` — true for a keyboard focus, false for a mouse one. */
export const focusTarget = (keyboard: boolean) => ({ matches: (s: string) => s === ':focus-visible' && keyboard });
