<!--
	THE STAGE MAP on a record page — the lifecycle its collection declares under
	`display.record.options.stages`, drawn above the properties (read mode only) as TWO LINES at most
	(cr-vscode-015): one row of numbered stages, each checked when its gate passed, the current one marked,
	the rest muted; under it one short subtitle naming the current stage's next command, which copies its
	invocation on one click. Each stage's fields, reviews and gate — what the stage cards drew before —
	open in a card on hover or keyboard focus.

	What it knows comes from two reads and nothing else: the engine's `commandsFor` answer for this
	record (the gate states — the same call the Commands section makes) and the reviews whose owning
	field names this record (the `stage_reviews` mirror's `mirror_of`). Every reading — the stage state,
	the current stage, the marks, where the card goes and which card is open — is `lib/stage-map.ts`.
-->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watchEffect } from 'vue';
import type { FieldRow } from '../api/types';
import { api, buildQuery } from '../api/client';
import type { CommandRow } from '../lib/command-rows';
import { labelOf } from '../lib/format-title';
import {
	CARD_CLOSED,
	STAGE_STATE_LABEL,
	bareRef,
	cardLeft,
	cardState,
	currentStage,
	gateEntries,
	isEmptyValue,
	stageMark,
	stageReviews,
	stageReviewsField,
	stageSpecs,
	stageState,
	type CardEvent,
	type CardState,
	type StageSpec,
} from '../lib/stage-map';
import DtIcon from './DtIcon.vue';
import DtLink from './DtLink.vue';
import RenderView from './render/RenderView.vue';

const props = defineProps<{
	/** The collection the record belongs to. */
	collection: string;
	/** The record, as the page loaded it. */
	record: Record<string, unknown> | null;
	/** The collection's field rows — labels, and the View each stage field draws with. */
	fields: FieldRow[];
	/** field → target collection, for the reviews mirror. */
	relationTargets?: Map<string, string>;
	/** The record display's options — where `stages` and `stage_reviews` are declared. */
	options?: Record<string, unknown>;
}>();

const specs = computed<StageSpec[]>(() => stageSpecs(props.options) ?? []);
const id = computed(() => String(props.record?.['id'] ?? ''));
const self = computed(() => `${props.collection}/${id.value}`);

const commands = ref<CommandRow[]>([]);
/** No mark is claimed before the gate answer, nor after a refused one. */
const gates = ref<'loading' | 'loaded' | 'failed'>('loading');
const reviews = ref<Record<string, unknown>[]>([]);
// only the newest commands request may paint: a late answer for an earlier record never repaints this one
let asked = 0;

watchEffect(() => {
	if (!specs.value.length || !id.value) return;
	const mine = ++asked;
	gates.value = 'loading';
	void api
		.get<{ commands: CommandRow[] }>(`/commands/${encodeURIComponent(props.collection)}?ids=${encodeURIComponent(id.value)}`)
		.then(({ data }) => { if (mine !== asked) return; commands.value = data.commands ?? []; gates.value = 'loaded'; })
		.catch(() => { if (mine !== asked) return; commands.value = []; gates.value = 'failed'; });
	const field = stageReviewsField(props.options);
	const row = field ? props.fields.find((f) => f.field === field) : undefined;
	const target = field ? props.relationTargets?.get(field) : undefined;
	if (!row?.mirror_of || !target) { reviews.value = []; return; }
	// `buildQuery`, never a JSON `filter=` param: the adapter reads a filter only in its bracketed form
	const query = buildQuery({ limit: 100000, filter: { [row.mirror_of]: { _eq: self.value } } });
	void api
		.get<Record<string, unknown>[]>(`/items/${encodeURIComponent(target)}${query}`)
		.then(({ data }) => { reviews.value = Array.isArray(data) ? data : []; })
		.catch(() => { reviews.value = []; });
});

const reviewsTarget = computed(() => {
	const field = stageReviewsField(props.options);
	return field ? props.relationTargets?.get(field) ?? '' : '';
});

const stages = computed(() => {
	const gateLists = specs.value.map((spec) => gateEntries(spec, commands.value, id.value));
	const loaded = gates.value === 'loaded';
	const current = loaded ? currentStage(gateLists) : -1;
	return specs.value.map((spec, i) => {
		const gate = gateLists[i]!;
		const state = stageState(gate);
		const mark = loaded ? stageMark(i, current, state) : 'ahead';
		return {
			i,
			index: i + 1,
			spec,
			state,
			mark,
			gate,
			fields: spec.fields.map((name) => ({ name, row: props.fields.find((f) => f.field === name), value: props.record?.[name] })),
			reviews: stageReviews(spec, reviews.value, props.record ?? {}, self.value),
		};
	});
});

const current = computed(() => stages.value.find((s) => s.mark === 'current') ?? null);
const commandName = (name: string) => `/${name.replace('/', ':')}`;

/** Line 2: the current stage's first available command, or what the map can honestly say instead. */
const next = computed<{ kind: 'loading' } | { kind: 'text'; text: string } | { kind: 'command'; name: string; invocation: string | null }>(() => {
	if (gates.value === 'loading') return { kind: 'loading' };
	if (gates.value === 'failed') return { kind: 'text', text: 'stages unavailable' };
	const cur = current.value;
	if (cur) {
		const entry = cur.gate.find((g) => g.state === 'available');
		if (!entry) return { kind: 'text', text: 'no command available' };
		const row = commands.value.find((r) => r.binding.replace(/^command-bindings\//, '') === entry.binding);
		return { kind: 'command', name: commandName(entry.name), invocation: row?.invocation ?? null };
	}
	const all = stages.value;
	if (all.length && all[all.length - 1]!.mark === 'passed') {
		const skipped = all.filter((s) => s.mark === 'skipped').length;
		return { kind: 'text', text: skipped ? `done · ${skipped} skipped` : 'all stages passed' };
	}
	return { kind: 'text', text: 'no command available' };
});

// ── the card: which stage's is open (the reducer), and where it goes ─────────────────────────────
const card = ref<CardState>(CARD_CLOSED);
const cardX = ref(0);
const section = ref<HTMLElement | null>(null);
const chips = ref<Array<HTMLElement | null>>([]);
const cardEls = ref<Array<HTMLElement | null>>([]);
let grace: ReturnType<typeof setTimeout> | undefined;

const activeElement = (): Element | null => (typeof document !== 'undefined' ? (document as Document).activeElement ?? null : null);
const cardHasFocus = (): boolean => {
	const open = card.value.open;
	const el = open === null ? null : cardEls.value[open];
	const active = activeElement();
	return !!(el && active && typeof el.contains === 'function' && el.contains(active));
};

function send(e: CardEvent): void {
	const before = card.value.open;
	card.value = cardState(card.value, e);
	if (card.value.open !== null && card.value.open !== before) void place(card.value.open);
}

async function place(i: number): Promise<void> {
	cardX.value = 0;
	if (typeof window === 'undefined') return;
	await nextTick();
	const chip = chips.value[i];
	const sec = section.value;
	const el = cardEls.value[i];
	if (!chip?.getBoundingClientRect || !sec?.getBoundingClientRect || !el?.getBoundingClientRect) return;
	const map = sec.getBoundingClientRect();
	cardX.value = cardLeft(chip.getBoundingClientRect().left - map.left, el.getBoundingClientRect().width, map.width);
}

function onEnter(i: number): void {
	clearTimeout(grace);
	grace = undefined;
	send({ type: 'enter', i, cardHasFocus: cardHasFocus() });
}
function onLeave(i: number): void {
	send({ type: 'leave', i });
	clearTimeout(grace);
	grace = setTimeout(() => {
		grace = undefined;
		send({ type: 'grace', cardHasFocus: cardHasFocus() });
	}, 200);
}
function onFocusin(i: number, e: FocusEvent): void {
	const target = e.target as Element | null;
	const keyboard = !!target && typeof target.matches === 'function' && target.matches(':focus-visible');
	const el = cardEls.value[i];
	const inCard = !!(el && target && typeof el.contains === 'function' && el.contains(target));
	send({ type: 'focus', i, keyboard, inCard });
}
function onFocusout(i: number, e: FocusEvent, li: EventTarget | null): void {
	const to = e.relatedTarget as Node | null;
	const host = li as Node | null;
	if (to && host && typeof (host as Element).contains === 'function' && (host as Element).contains(to)) return;
	send({ type: 'blur', i });
}
function onKeydown(i: number, e: KeyboardEvent): void {
	if (e.key !== 'Escape') return;
	send({ type: 'escape', i });
	chips.value[i]?.focus();
}
onBeforeUnmount(() => clearTimeout(grace));

// ── line 2's one click: the invocation on the clipboard, never a run ─────────────────────────────
const copied = ref(false);
async function copy(invocation: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(invocation);
	} catch {
		// webview clipboard permission can be withheld — the Commands section's classic fallback
		if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
			const area = document.createElement('textarea');
			area.value = invocation;
			document.body.appendChild(area);
			area.select();
			document.execCommand('copy');
			area.remove();
		}
	}
	copied.value = true;
	setTimeout(() => (copied.value = false), 1500);
}

const MARK_ICON = { passed: 'pass-filled', current: 'circle-large-filled', skipped: 'circle-slash', ahead: 'circle-large-outline' } as const;
const stateWord = (s: { mark: string; state: keyof typeof STAGE_STATE_LABEL }) => (s.mark === 'skipped' ? 'skipped' : STAGE_STATE_LABEL[s.state]);
const cardId = (i: number) => `dt-stage-card-${id.value}-${i}`;
const reviewLabel = (r: Record<string, unknown>) => String(r['name'] ?? r['id'] ?? '');
const reviewRoute = (r: Record<string, unknown>) => `/content/${reviewsTarget.value}/${bareRef(r['id'])}`;
</script>

<template>
	<section v-if="stages.length" ref="section" class="dt-stages" aria-label="Lifecycle">
		<ol class="dt-stages__list">
			<li
				v-for="stage in stages"
				:key="stage.spec.title"
				class="dt-stage"
				:data-stage="stage.spec.title"
				:data-state="stage.state"
				:data-mark="stage.mark"
				:data-current="stage.mark === 'current' ? 'true' : undefined"
				@mouseenter="onEnter(stage.i)"
				@mouseleave="onLeave(stage.i)"
				@focusin="onFocusin(stage.i, $event)"
				@focusout="onFocusout(stage.i, $event, $event.currentTarget)"
				@keydown="onKeydown(stage.i, $event)"
			>
				<button
					:ref="(el) => (chips[stage.i] = el as HTMLElement | null)"
					type="button"
					class="dt-stage__chip"
					:aria-current="stage.mark === 'current' ? 'step' : undefined"
					:aria-expanded="card.open === stage.i"
					:aria-controls="cardId(stage.i)"
					:aria-label="`${stage.index} ${stage.spec.title} — ${stateWord(stage)}`"
				>
					<DtIcon class="dt-stage__icon" :name="MARK_ICON[stage.mark]" />
					<span class="dt-stage__index">{{ stage.index }}</span>{{ ' ' }}<span class="dt-stage__title">{{ stage.spec.title }}</span>
				</button>
				<div
					v-if="card.open === stage.i"
					:id="cardId(stage.i)"
					:ref="(el) => (cardEls[stage.i] = el as HTMLElement | null)"
					class="dt-stage__card"
					role="group"
					:aria-label="stage.spec.title"
					:style="{ left: `${cardX}px` }"
				>
					<header class="dt-stage__head">
						<span class="dt-stage__card-title">{{ stage.spec.title }}</span>
						<span class="dt-stage__state">· {{ stateWord(stage) }}</span>
					</header>
					<dl class="dt-stage__body">
						<template v-for="f in stage.fields" :key="f.name">
							<dt class="dt-stage__key">{{ f.row ? labelOf(f.row) : f.name }}</dt>
							<dd class="dt-stage__value" :data-field="f.name">
								<span v-if="isEmptyValue(f.value) || !f.row" class="dt-stage__empty">Empty</span>
								<RenderView v-else :field="f.row" :value="f.value" context="record" />
							</dd>
						</template>
						<dt class="dt-stage__key">Reviews</dt>
						<dd class="dt-stage__value" data-field="$reviews">
							<span v-if="!stage.reviews.length" class="dt-stage__empty">No review yet</span>
							<span v-for="r in stage.reviews" v-else :key="String(r['id'])" class="dt-stage__review" :data-verdict="String(r['verdict'] ?? '')">
								<DtLink :to="reviewRoute(r)">{{ reviewLabel(r) }}</DtLink>
								<span class="dt-stage__verdict">{{ r['verdict'] ? String(r['verdict']) : 'no verdict' }}</span>
							</span>
						</dd>
						<dt class="dt-stage__key">Gate</dt>
						<dd class="dt-stage__value dt-stage__gate" data-field="$gate">
							<span v-for="g in stage.gate" :key="g.binding" class="dt-stage__binding" :data-binding="g.binding" :data-state="g.state" :title="g.binding">
								{{ commandName(g.name) }} · {{ g.state === 'not-applicable' ? 'not yet' : g.state }}
							</span>
						</dd>
					</dl>
				</div>
			</li>
		</ol>
		<p class="dt-stages__next">
			<template v-if="next.kind === 'loading'">&nbsp;</template>
			<template v-else-if="next.kind === 'text'">{{ next.text }}</template>
			<template v-else>
				<button
					v-if="next.invocation"
					type="button"
					class="dt-stages__cmd"
					:title="next.invocation"
					@click="copy(next.invocation)"
				>{{ copied ? 'Copied' : next.name }}</button><span v-else class="dt-stages__cmd-name">{{ next.name }}</span>
				available
			</template>
		</p>
	</section>
</template>

<style scoped>
/* Two lines at most (cr-vscode-015): one non-wrapping row of stages and one subtitle. The section is
   the size container the width rules ask, and the containing block the card is placed against — the
   row and its items are NOT positioned, so the row's clipping never clips the card. */
.dt-stages {
	position: relative;
	container-type: inline-size;
	margin-bottom: var(--dt-space-4);
	padding-bottom: var(--dt-space-2);
	border-bottom: 1px solid var(--dt-border);
	font-size: var(--dt-text);
}
.dt-stages__list {
	display: flex;
	flex-wrap: nowrap;
	align-items: center;
	white-space: nowrap;
	gap: var(--dt-space-1);
	overflow: hidden;
	margin: 0;
	padding: 0;
	list-style: none;
}
.dt-stage {
	display: flex;
	align-items: center;
	flex-shrink: 0;
	gap: var(--dt-space-1);
}
/* the connector between two stages */
.dt-stage + .dt-stage::before {
	content: '';
	display: inline-block;
	width: 12px;
	height: 1px;
	background: var(--dt-border);
}
.dt-stage__chip {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 4px;
	border: 0;
	border-radius: var(--dt-radius);
	background: transparent;
	color: inherit;
	font: inherit;
	cursor: default;
}
.dt-stage__chip:hover,
.dt-stage__chip[aria-expanded='true'] {
	background: var(--vscode-toolbar-hoverBackground, transparent);
}
.dt-stage__chip:focus-visible {
	outline: 1px solid var(--vscode-focusBorder, var(--dt-accent));
	outline-offset: 1px;
}
.dt-stage__index {
	font-variant-numeric: tabular-nums;
}
.dt-stage__title {
	text-transform: capitalize;
}
.dt-stage[data-mark='passed'] .dt-stage__icon {
	color: var(--vscode-testing-iconPassed, var(--dt-accent));
}
.dt-stage[data-mark='current'] .dt-stage__icon {
	color: var(--dt-accent);
}
.dt-stage[data-mark='current'] .dt-stage__title {
	font-weight: 600;
}
.dt-stage[data-mark='ahead'] .dt-stage__chip {
	color: var(--dt-fg-muted);
}
.dt-stage[data-mark='skipped'] .dt-stage__chip {
	color: var(--dt-fg-muted);
}

/* line 2 */
.dt-stages__next {
	margin: 2px 0 0;
	min-height: 1.4em;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: var(--dt-label);
	color: var(--dt-fg-muted);
}
.dt-stages__cmd {
	padding: 0;
	border: 0;
	background: none;
	color: var(--dt-accent);
	font: inherit;
	cursor: pointer;
}
.dt-stages__cmd:hover {
	text-decoration: underline;
}

/* the card: below line 2, inside the map, its own text wrapping */
.dt-stage__card {
	position: absolute;
	top: 100%;
	z-index: 20;
	width: min(360px, 100%);
	max-height: 60vh;
	overflow: auto;
	box-sizing: border-box;
	padding: var(--dt-space-2);
	white-space: normal;
	border: 1px solid var(--vscode-editorHoverWidget-border, var(--dt-border));
	border-radius: var(--dt-radius);
	background: var(--vscode-editorHoverWidget-background, var(--vscode-editor-background, Canvas));
	color: var(--vscode-editorHoverWidget-foreground, inherit);
	box-shadow: 0 2px 8px var(--vscode-widget-shadow, transparent);
}
.dt-stage__head {
	display: flex;
	align-items: baseline;
	gap: 4px;
	margin-bottom: var(--dt-space-1);
}
.dt-stage__card-title {
	text-transform: capitalize;
	font-weight: 600;
}
.dt-stage__state {
	font-size: var(--dt-label);
	color: var(--dt-fg-muted);
}
.dt-stage__body {
	margin: 0;
}
.dt-stage__key {
	margin-top: var(--dt-space-1);
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-stage__value {
	margin: 0;
	min-width: 0;
	overflow-wrap: anywhere;
}
.dt-stage__empty,
.dt-stage__verdict {
	color: var(--dt-fg-muted);
}
.dt-stage__review,
.dt-stage__binding {
	display: block;
}
.dt-stage__verdict {
	margin-left: 6px;
	font-size: var(--dt-label);
}
.dt-stage__binding {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
.dt-stage__binding[data-state='available'] {
	color: var(--dt-accent);
}

/* line 5: narrow — only the current stage keeps its title; narrower — indices only, no connectors */
@container (max-width: 559px) {
	.dt-stage:not([data-current]) .dt-stage__chip .dt-stage__title {
		display: none;
	}
}
@container (max-width: 399px) {
	.dt-stage__chip .dt-stage__title {
		display: none;
	}
	.dt-stage + .dt-stage::before {
		display: none;
	}
	/* the narrowest editor VS Code allows leaves ~172 px of map (measured, cr-vscode-015 deviation) */
	.dt-stages__list {
		gap: 2px;
	}
	.dt-stage__chip {
		gap: 2px;
		padding: 2px 1px;
	}
}
</style>
