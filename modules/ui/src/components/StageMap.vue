<!--
	THE STAGE MAP on a record page — the lifecycle its collection declares under
	`display.record.options.stages`, drawn in order above the properties (read mode only).

	Every stage draws, always: its title and gate state, the records its `fields` hold, the reviews that
	belong to it, and the bindings whose states are its gate. An EMPTY field — no plan yet, no review
	yet, a generated mirror the engine has not written because nothing points here — is drawn as the
	empty stage ("Empty", "No review yet"), never left out: the point of the map is to show what has
	NOT happened as plainly as what has.

	What it knows comes from two reads and nothing else: the engine's `commandsFor` answer for this
	record (the gate states — the same call the Commands section makes) and the reviews whose owning
	field names this record (the `stage_reviews` mirror's `mirror_of`). The reading is `lib/stage-map.ts`.
-->
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import type { FieldRow } from '../api/types';
import { api, buildQuery } from '../api/client';
import type { CommandRow } from '../lib/command-rows';
import { labelOf } from '../lib/format-title';
import {
	STAGE_STATE_LABEL,
	bareRef,
	gateEntries,
	isEmptyValue,
	stageReviews,
	stageReviewsField,
	stageSpecs,
	stageState,
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
const reviews = ref<Record<string, unknown>[]>([]);

watchEffect(() => {
	if (!specs.value.length || !id.value) return;
	void api
		.get<{ commands: CommandRow[] }>(`/commands/${encodeURIComponent(props.collection)}?ids=${encodeURIComponent(id.value)}`)
		.then(({ data }) => { commands.value = data.commands ?? []; })
		.catch(() => { commands.value = []; });
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

const stages = computed(() =>
	specs.value.map((spec, i) => {
		const gate = gateEntries(spec, commands.value, id.value);
		return {
			index: i + 1,
			spec,
			state: stageState(gate),
			gate,
			fields: spec.fields.map((name) => ({ name, row: props.fields.find((f) => f.field === name), value: props.record?.[name] })),
			reviews: stageReviews(spec, reviews.value, props.record ?? {}, self.value),
		};
	}),
);

const STATE_ICON = { passed: 'pass-filled', review: 'eye', ready: 'circle-large-outline', 'not-started': 'circle-small' } as const;
const reviewLabel = (r: Record<string, unknown>) => String(r['name'] ?? r['id'] ?? '');
const reviewRoute = (r: Record<string, unknown>) => `/content/${reviewsTarget.value}/${bareRef(r['id'])}`;
</script>

<template>
	<section v-if="stages.length" class="dt-stages" aria-label="Lifecycle">
		<ol class="dt-stages__list">
			<li v-for="stage in stages" :key="stage.spec.title" class="dt-stage" :data-stage="stage.spec.title" :data-state="stage.state">
				<header class="dt-stage__head">
					<DtIcon class="dt-stage__icon" :name="STATE_ICON[stage.state]" />
					<span class="dt-stage__title">{{ stage.index }}. {{ stage.spec.title }}</span>
					<span class="dt-stage__state">{{ STAGE_STATE_LABEL[stage.state] }}</span>
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
							/{{ g.name.replace('/', ':') }} · {{ g.state === 'not-applicable' ? 'not yet' : g.state }}
						</span>
					</dd>
				</dl>
			</li>
		</ol>
	</section>
</template>

<style scoped>
.dt-stages {
	margin-bottom: var(--dt-space-5);
	padding-bottom: var(--dt-space-4);
	border-bottom: 1px solid var(--dt-border);
}
.dt-stages__list {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: var(--dt-space-2);
	margin: 0;
	padding: 0;
	list-style: none;
}
.dt-stage {
	min-width: 0;
	padding: var(--dt-space-2);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	font-size: var(--dt-text);
}
.dt-stage[data-state='passed'] {
	border-color: var(--vscode-testing-iconPassed, var(--dt-border));
}
.dt-stage[data-state='review'],
.dt-stage[data-state='ready'] {
	border-color: var(--dt-accent);
}
.dt-stage[data-state='not-started'] {
	border-style: dashed;
	color: var(--dt-fg-subtle);
}
.dt-stage__head {
	display: flex;
	align-items: center;
	gap: var(--dt-space-1);
	margin-bottom: var(--dt-space-1);
}
.dt-stage__title {
	font-weight: 600;
	text-transform: capitalize;
}
.dt-stage__state {
	margin-left: auto;
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
</style>
