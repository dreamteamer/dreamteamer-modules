<!--
	Card-grid browse List (phase E scope item 3): the same `useItems`/`useFields` data DataTable
	renders as table rows, rendered as a responsive card grid instead. Registered as `cards` in
	register-defaults.ts. Driven entirely by the `state` prop (`composables/browse-state.ts`'s
	`BrowseState`) that ContentBrowse owns — this component holds no state of its own, so toggling
	table ↔ cards never re-fetches or re-derives anything.

	Card anatomy: title via the collection's `record_title` (`state.recordTitleOf`, the one template
	grammar — the id when it renders to nothing), tinted by `color_by` (`state.tintOf`), an optional thumbnail (`state.imageField` — the first visible field that resolves to
	the `image` display, see ViewImage.vue's header for why that's opt-in-only), and up to 3
	subtitle fields (`state.subtitleFields`, reusing the SAME column selection the table view
	uses) rendered through the normal views registry, exactly like DataTable's cells. Clicking a
	card calls the SAME `state.openRecord` DataTable's row click calls — sharing one composable
	instance is a stronger contract than copying an emit event, since there's only one function to
	drift.

	The `/assets/:pk` URL convention below (full image, not the `system-small-cover` transform
	ViewImage's 32×32 table thumbnail uses) is copied from ViewImage.vue's header comment,
	not the component itself — a card wants a much bigger image than a table cell does.

	Browse-restyle (BROWSE wave): the card shell (background/border/radius/hover-shadow) now
	comes from the frozen shared `.dt-card` utility in base.css instead of local duplicates; only
	the grid/image/title/field layout specific to a card stays scoped here. Empty/loading states
	use `.dt-empty` with a create CTA, matching the table layout's.

	Kanban alignment (2026-07-31, operator: "cards ui - align with kanban, display template etc").
	Two cards in one app rendered by two different rules was the problem, so both halves of the
	divergence closed:

	  content  a `template` option, the SAME `display-template` Edit and the SAME DisplayTemplate
	           renderer the kanban card uses (markdown, `{{ field }}` tokens keeping their Views,
	           `context="record"` so values wrap instead of being clipped as table cells). Blank
	           keeps the title + subtitle-fields card below, so an unconfigured grid is unchanged.
	  chrome   `.dt-card--interactive` in base.css — promoted out of ListKanban's scoped style, now
	           worn by both, so radius/padding/hover/wrap can't drift apart again.

	the `image` option joins it for the same reason `group_by` exists on the board: the auto-pick (first
	visible field whose View is `image`) is a good default and a bad ceiling.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BrowseState } from '../composables/browse-state';
import { bucketize, type Bucket } from '../lib/grouping';
import { fileBases, srcForRecord, isImageExt } from '../lib/file-record';
import { rowContext } from '../lib/vscode-context';
import RenderView from '../components/render/RenderView.vue';
import DisplayTemplate from '../components/render/DisplayTemplate.vue';
import GroupHeader from '../components/browse/GroupHeader.vue';
import SourceMark from '../components/SourceMark.vue';
import StubNote from '../components/StubNote.vue';
import NoteMark from '../components/NoteMark.vue';
import { notesOfRow } from '../lib/next-notes';
import type { FieldRow, ItemRecord } from '../api/types';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{ state: BrowseState }>();

const options = computed<Record<string, unknown>>(() => props.state.listOptions.value['cards'] ?? {});

// Self-describing List option (Task 5): the `image_fit` value the cards registration declares,
// written by OptionsForm into `state.listOptions['cards']`, drives the card image's CSS object-fit.
const imageFit = computed<'cover' | 'contain'>(() => (options.value['image_fit'] === 'contain' ? 'contain' : 'cover'));

/** The card's content template, or null for the built-in title + fields card. Same option shape,
 *  same parser and same renderer as the kanban's `template` — see ListKanban.vue's header. */
const cardTemplate = computed<string | null>(() => {
	const raw = options.value['card_title'];
	return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
});

/** Explicit `image` wins; otherwise the auto-detected one (`state.imageField`). A named field
 *  the schema no longer has falls back to auto rather than rendering an empty image slot. */
const imageField = computed<FieldRow | null>(() => {
	const named = options.value['image'];
	if (typeof named === 'string' && named.length) {
		return props.state.fields.visibleFields.value.find((f) => f.field === named) ?? props.state.imageField.value;
	}
	return props.state.imageField.value;
});

// Registered as the built-in `cards` List (spec §8). Same posture as DataTable: rendered via
// the lists registry with the module-List prop set alongside `state`, but only consumes `state`.
defineOptions({ inheritAttrs: false });

/**
 * ⚠ A FILE-CODEC RECORD IS ITS OWN IMAGE. `assets` and its kind hold records whose BYTES are the
 * file: the picture is not in a field, it IS the record, so the `image` option has nothing to point at
 * and the auto-pick finds nothing. The result was a gallery of file records rendered as text — the
 * one collection in the product whose entire purpose is being looked at.
 *
 * Keyed off the injected file-base list, never off a collection name: the dogfood vault's is called `assets`
 * and nothing in this repo may know that (decision 268).
 */
const selfImaged = computed(() => fileBases().some((b) => b.collection === props.state.collection));

function imageSrc(record: ItemRecord): string | null {
	if (selfImaged.value) {
		const ext = record['ext'];
		// A PDF or a font in the same collection is a file record too, and drawing it as a broken
		// <img> is worse than the placeholder — `isImageExt` is the same gate ViewImage uses.
		if (!isImageExt(typeof ext === 'string' ? ext : null)) return null;
		return srcForRecord(props.state.collection, props.state.pkOf(record), ext);
	}
	const field = imageField.value;
	if (!field) return null;
	const value = record[field.field];
	return typeof value === 'string' && value ? `/assets/${value}` : null;
}

// ---- grouping (0.12.0) ------------------------------------------------------------------------
// The same bands the table and the kanban draw, over a grid instead of rows. The derivation is the
// shared one (`lib/grouping.ts`) and the header is the shared component, so the three layouts cannot
// disagree about what a group IS or what it looks like.
//
// Ungrouped, `bands` is ONE implicit band with no header, and the grid inside it is the grid that
// was always there — every existing cards view is one of those.
const groupField = computed(() => {
	const named = options.value['group_by'];
	if (typeof named !== 'string' || !named.length) return null;
	return props.state.fields.visibleFields.value.find((f) => f.field === named) ?? null;
});
const showUngrouped = computed(() => options.value['show_ungrouped_rows'] === true);
// Empty BANDS are hidden unless asked for — a band is not a drop target, so an empty one is only
// distance between the reader and the work (operator, 2026-09-07).
const showEmpty = computed(() => options.value['show_empty_rows'] === true);
const grouped = computed(() => groupField.value !== null);

const bands = computed<Bucket[]>(() => {
	const records = props.state.items.items.value;
	if (!groupField.value) return [{ value: '', label: '', records }];
	return bucketize(groupField.value, records, { showUngrouped: showUngrouped.value, showEmpty: showEmpty.value });
});

// Ephemeral, like the table's: a saved view reopening with bands shut would read as missing data.
const collapsed = ref(new Set<string>());
function toggleBand(value: string): void {
	const next = new Set(collapsed.value);
	if (!next.delete(value)) next.add(value);
	collapsed.value = next;
}
</script>

<template>
	<div class="dt-cards">
		<!-- Stale-while-revalidate, same as DataTable: current cards stay put during a refetch
		     (BrowseView's pager spinner shows the activity); tall loading block on first load only. -->
		<div v-if="state.items.loading.value && !state.items.items.value.length" class="dt-empty">
			<DtIcon name="loading" />
			<p class="dt-empty__line">Loading…</p>
		</div>
		<div v-else-if="!state.items.loading.value && !state.items.items.value.length" class="dt-empty">
			<DtIcon name="inbox" />
			<p class="dt-empty__line">{{ state.hasActiveQuery.value ? 'No records match your search/filters' : 'No records yet' }}</p>
			<button v-if="!state.hasActiveQuery.value" type="button" class="dt-btn dt-btn--sm" @click="state.createRecord()">Create record</button>
		</div>

		<template v-else>
		<section v-for="band in bands" :key="band.value" class="dt-cards-band">
			<div v-if="grouped" class="dt-cards-band-header">
				<button
					type="button"
					class="dt-group-toggle"
					:aria-expanded="!collapsed.has(band.value)"
					:title="collapsed.has(band.value) ? 'Expand' : 'Collapse'"
					@click="toggleBand(band.value)"
				>
					<DtIcon :name="collapsed.has(band.value) ? 'chevron-right' : 'chevron-down'" />
				</button>
				<GroupHeader
					:label="band.label"
					:count="band.records.length"
					:description="band.description"
					:icon="band.icon"
					:color="band.color"
					:background="band.background"
				/>
			</div>
			<div v-if="!collapsed.has(band.value)" class="dt-cards-grid" :class="{ 'is-revalidating': state.items.loading.value }">
			<article
				v-for="record in band.records"
				:key="state.pkOf(record)"
				class="dt-card dt-card--interactive dt-cards-card"
				:class="{ 'dt-tinted': !!state.tintOf(record) }"
				:style="state.tintOf(record)"
				:data-vscode-context="rowContext(state.collection, state.pkOf(record))"
				@click="state.openRecord(record)"
			>
<div v-if="imageField || selfImaged" class="dt-card-image">
					<img v-if="imageSrc(record)" :src="imageSrc(record) ?? undefined" alt="" class="dt-card-image-img" :style="{ objectFit: imageFit }" />
					<div v-else class="dt-card-image-placeholder"></div>
				</div>

				<!-- `context="record"`: a card wants the whole value, wrapped — cell semantics would
				     nowrap-and-clip it at the card edge (see DisplayTemplate's header). -->
				<DisplayTemplate
					v-if="cardTemplate"
					:template="cardTemplate"
					:record="record"
					:fields="state.fields.fields.value"
					context="record"
				/>
				<template v-else>
					<h3 class="dt-card-title">{{ state.recordTitleOf(record) || '—' }}</h3>

					<dl v-if="state.subtitleFields.value.length" class="dt-card-fields">
						<div v-for="field in state.subtitleFields.value" :key="field.field" class="dt-card-field">
							<dt class="dt-card-field-label">{{ field.field }}</dt>
							<dd class="dt-card-field-value">
								<RenderView :field="field" :value="record[field.field]" :record="record" />
							</dd>
						</div>
					</dl>
				</template>
				<!-- WHERE IT COMES FROM, in the card's FOOTER ROW (cr-vscode-004: the corner mark covered the
				     card's title and cover). Last, in flow — so it can never sit over a field value or the
				     cover at any width. An own record wears nothing (`lib/sources.ts`, rule 1). -->
				<footer v-if="state.sourceOf?.(record) || state.stubOf?.(record) || notesOfRow(record).length" class="dt-card-foot">
					<SourceMark v-if="state.sourceOf?.(record)" class="dt-card-source" v-bind="state.sourceOf?.(record)!" />
					<StubNote v-if="state.stubOf?.(record)" v-bind="state.stubOf?.(record)!" :sources="state.sourceFacets?.value" />
					<NoteMark v-if="notesOfRow(record).length" :notes="notesOfRow(record)" />
				</footer>
			</article>
			</div>
		</section>
		</template>
	</div>
</template>

<style scoped>
/* A band is a section with its own header above its own grid. `gap` rather than a margin so a
   collapsed band contributes nothing but its header. */
.dt-cards-band + .dt-cards-band {
	margin-top: 14px;
}
.dt-cards-band-header {
	display: flex;
	align-items: center;
	gap: 2px;
	margin-bottom: 8px;
}
.dt-group-toggle {
	display: flex;
	align-items: center;
	background: none;
	border: 0;
	padding: 4px 2px;
	cursor: pointer;
	color: var(--dt-fg-subtle);
}
.dt-group-toggle:hover {
	color: var(--dt-fg);
}

.dt-cards-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 16px;
}
.dt-cards-grid.is-revalidating {
	opacity: 0.55;
	transition: opacity 0.15s ease 0.15s; /* small delay so fast refetches never visibly flicker */
	pointer-events: none;
}
/* Chrome (border/radius/padding/hover/wrap) is `.dt-card` + `.dt-card--interactive`; what stays
   here is only the stacking and the image, which no other card has. */
.dt-cards-card {
	display: flex;
	flex-direction: column;
	position: relative;
}
/* the footer row the source mark sits in — in flow, after everything else on the card */
.dt-card-foot {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: flex-end;
	gap: 6px;
	margin-top: auto;
	padding-top: 8px;
	font-size: var(--dt-label);
	min-width: 0;
}
/* WRAP, never shrink: a mark beside a stub note squeezed below its own text and the two drew over
   each other (measured in the dev host, cr-vscode-004 walk) — each piece keeps its width and the row
   wraps; a piece wider than the card ellipsizes inside itself */
.dt-card-foot > * {
	flex-shrink: 0;
	max-width: 100%;
	overflow: hidden;
}
/* Full-bleed cover inside a PADDED shell: the utility's 10px/12px is what keeps the card's text
   aligned with a kanban card's, so the image cancels it with negative margins instead of the shell
   dropping its padding. No `width: 100%` — the flex container already stretches it, and 100% plus
   negative side margins would overflow by exactly the padding. */
.dt-card-image {
	margin: -10px -12px 10px;
	aspect-ratio: 16 / 9;
	background: var(--dt-bg-subtle);
}
.dt-card-image-img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	display: block;
}
.dt-card-image-placeholder {
	width: 100%;
	height: 100%;
}
.dt-card-title {
	margin: 0;
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-card-fields {
	margin: 6px 0 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.dt-card-field {
	display: flex;
	align-items: baseline;
	gap: 6px;
	font-size: var(--dt-text);
}
.dt-card-field-label {
	color: var(--dt-fg-subtle);
	text-transform: uppercase;
	letter-spacing: 0.02em;
	font-size: var(--dt-label);
	flex: 0 0 auto;
}
.dt-card-field-value {
	margin: 0;
	color: var(--dt-fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	min-width: 0;
}
</style>
