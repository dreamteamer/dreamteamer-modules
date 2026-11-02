<!--
	The record page's DEFAULT layout (operator ask 2026-07-29: "obsidian layout looks sooo much
	better, lets do the same"). Obsidian's note view, not a web form: a "Properties" block of
	one-line `icon · label · value` rows with no input chrome, then the body rendered as a document
	beneath a hairline.

	It is a record-scoped Edit AND View (`properties`, registered on both registries), so it backs
	both modes of the SAME page — ContentDetail's pencil flips `readonly` and the widgets swap in
	place, rows keeping their geometry (operator call 2026-07-29: keep the pencil rather than go
	always-inline-editable). `form`/`doc` stay registered untouched, so a `.schema/presets` record
	naming them still gets the old two-column form; only lib/presets.ts's built-in default moved
	(decision: change the default, don't rewrite the layout everyone else may have pinned).

	Same contract as ItemForm — props identical, `item` is the caller's own useItem instance, every
	edit goes straight through `item.setField`, no parallel dirty-tracking here.

	Two geometry rules the screenshot doesn't show but the data demands:
	- The body field (`role: body`) leaves the property list entirely and renders label-less below
	  the divider. That's what makes the page read as a document.
	- A list relation drawn as its target's own view STACKS — label on its own line, value
	  full-width under it.

	And the display contract's per-field answers, the same ones ItemForm follows (descriptor v2
	§3.4.2, §3.5): SECTIONS from `form.sections` (a heading over each, the unclaimed fields last and
	unnamed, the body after them all); `hidden` per surface (`record` on the read, `form` while
	editing or creating); a control only where `hasControl` says so; and `unit`, `direction` and
	`placeholder` on the value and the control.
-->
<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import type { FieldRow } from '../api/types';
import { api } from '../api/client';
import type { useItem } from '../composables/items';
import { useCollections } from '../composables/collections';
import { useFormSections } from '../composables/form-sections';
import { useSectionDisclosure } from '../composables/section-disclosure';
import { hasForeignSource } from '../lib/sources';
import { fieldIcon } from '../lib/field-icon';
import { computedReason, drawnOn, formSections, hasControl, isBodyField, isMirrorField } from '../lib/field-row';
import { formatWithUnit, unitSuffix } from '../lib/field-unit';
import { labelOf as sharedLabelOf } from '../lib/format-title';
import { embeddedRelationPlan, type EmbeddedRelationPlan } from '../lib/relation-view';
import { uiViews } from '../ui-views';
import RelationField from './RelationField.vue';
import StageMap from './StageMap.vue';
import RenderEdit from './render/RenderEdit.vue';
import RenderView from './render/RenderView.vue';
import DtIcon from './DtIcon.vue';

const props = defineProps<{
	fields: FieldRow[];
	item: ReturnType<typeof useItem>;
	relationTargets?: Map<string, string>;
	/** View mode (detail default, and bundle `$writable === false` records): every row renders its
	 *  registry-resolved View, and `setField` is gated as defense in depth. */
	readonly?: boolean;
	/** Create form: an `editable: create` field gets its control here and nowhere else. */
	create?: boolean;
	/**
	 * The record display's `options` (descriptor v2 §3.5) — a `scope: record` view's when the page is
	 * that view's route, else the collection's own `display.record.options` (`ContentDetail` resolves
	 * which, through `composables/record-display.ts`). Where `relation_views.<field>` is authored; see
	 * `lib/relation-view.ts`.
	 *
	 * ⚠ ContentDetail has ALWAYS passed this; it was landing as an inherited attr and being dropped,
	 * because nothing declared it.
	 */
	options?: Record<string, unknown>;
}>();

// ContentDetail passes the module record-page prop set (record/mode) alongside the props declared
// above; drop attr inheritance so the extras don't land on the root element as DOM attrs.
defineOptions({ inheritAttrs: false });

const sectionSpecs = useFormSections(() => props.fields[0]?.collection);

/** The surface this rendering is: the read, or the (edit or create) form. */
const drawn = computed(() => props.fields.filter((f) => drawnOn(f, props.readonly ? 'record' : 'form')));
const sections = computed(() => formSections(drawn.value, sectionSpecs.value));
const { isShut, toggle } = useSectionDisclosure();
const propertyFields = computed(() => sections.value.flatMap((s) => s.fields));
const bodyFields = computed(() => drawn.value.filter(isBodyField));

// The same rule ItemForm follows, stated twice because this is the layout the record page actually
// DEFAULTS to (lib/presets.ts) and the other one is what a `.schema/presets` record can pin: a
// control only where `hasControl` says so — never for a field the engine owns (`kind`), never for
// `editable: false`, and for `editable: create` on the create form alone.
function isFieldReadonly(field: FieldRow): boolean {
	return Boolean(props.readonly) || !hasControl(field, { create: Boolean(props.create) });
}

/** Why this field is not written here, or null — THE computed rule (`lib/field-row.ts#computedReason`),
 *  in view mode as much as in edit mode: a computed value is drawn dimmed on every read. */
function computedWhy(field: FieldRow): string | null {
	return computedReason(field, { create: Boolean(props.create), target: props.relationTargets?.get(field.field) });
}

/** WHY a generated mirror cannot be edited, and where it is set — the answer to "so how do I change
 *  this?", so it is shown on the row rather than left in a tooltip. */
function readonlyHintOf(field: FieldRow): string {
	if (!isFieldReadonly(field) || !isMirrorField(field) || !field.mirror_of) return '';
	return computedWhy(field) ?? '';
}

/** The record with pending edits applied — what a currency field reads its code from. */
const current = computed<Record<string, unknown>>(() => ({ ...(props.item.record.value ?? {}), ...props.item.edits.value }));

/** The value with its unit, or null when the field has none (or the value is not a number). */
function unitValueOf(field: FieldRow): string | null {
	return formatWithUnit(field, valueFor(field.field), current.value);
}

function valueFor(field: string): unknown {
	if (field in props.item.edits.value) return props.item.edits.value[field];
	return props.item.record.value?.[field] ?? null;
}

/**
 * "Nothing here yet" — rendered as a muted placeholder instead of the field's View, so an unset
 * property reads as unset rather than as a stray em-dash. `false` and `0` are VALUES, not
 * emptiness: only null/undefined, the empty string and the empty array qualify.
 */
function isEmpty(value: unknown): boolean {
	if (value === null || value === undefined || value === '') return true;
	return Array.isArray(value) && value.length === 0;
}

function labelOf(field: FieldRow): string {
	return sharedLabelOf(field);
}

/**
 * What the property MEANS, hovering over its label: the field's `description` — the raw field name
 * stays on the second line because that is what you type at the CLI.
 */
function tooltipOf(field: FieldRow): string {
	const note = (field.description ?? '').trim();
	return note ? `${note}\n\n${field.field}` : field.field;
}

function onFieldInput(field: FieldRow, value: unknown): void {
	if (isFieldReadonly(field)) return;
	props.item.setField(field.field, value);
}

/**
 * Which rows draw the target collection's own view instead of a row of links — field name → plan.
 *
 * ⚠ ONE computed, read twice: the row needs the answer to pick the component AND to stack itself to
 * full width. Deciding it in two places is exactly how the first cut shipped a `teams` row wearing
 * the table's geometry around a plain list of links (measured in the dev host): the row asked "could
 * this embed?" while the component asked "did it?", and for a target with no view those differ.
 *
 * READ MODE ONLY, deliberately: edit mode's job is the relation PICKER, and a table you cannot add
 * to or remove from is not an editor. `embeddedRelationPlan` answers `null` for everything else —
 * a single reference, an empty relation, an unresolved target, a target with no view — and every
 * one of those keeps exactly the rendering it has always had.
 */
/**
 * MIRRORS ACROSS REPOS ARE NEVER WRITTEN (engine 0.35.0): a record's generated mirror lists only the
 * owners in ITS OWN repo, so a layer project's `tasks` seen from the HQ is the layer's own view —
 * incomplete by design. The reverse lookup says how incomplete: the owner collection is asked how
 * many records point at this one, and the difference from what the mirror lists is drawn beside it
 * as *N more from other sources*. Only in read mode, only for a mirror with a resolved target, and
 * only when this collection reads a foreign root at all — a plain workspace asks nothing.
 */
const { tree } = useCollections();
const collectionName = computed(() => props.fields[0]?.collection);
const foreign = computed(() => hasForeignSource(tree.value.find((r) => r.collection === collectionName.value)?.sources));
const mirrorOverflow = ref<Record<string, number>>({});
watchEffect(() => {
	if (!props.readonly || !foreign.value) return;
	const id = props.item.record.value?.['id'];
	const collection = collectionName.value;
	if (typeof id !== 'string' || !id || !collection) return;
	for (const field of props.fields) {
		if (!isMirrorField(field) || !field.mirror_of) continue;
		const target = props.relationTargets?.get(field.field);
		if (!target) continue;
		const value = valueFor(field.field);
		const listed = Array.isArray(value) ? value.length : value ? 1 : 0;
		const filter = encodeURIComponent(JSON.stringify({ [field.mirror_of]: { _eq: `${collection}/${id}` } }));
		void api
			.get(`/items/${encodeURIComponent(target)}?limit=1&filter=${filter}`)
			.then((res) => {
				const meta = res.raw['meta'] as { filter_count?: number } | undefined;
				const total = meta?.filter_count ?? listed;
				mirrorOverflow.value = { ...mirrorOverflow.value, [field.field]: Math.max(0, total - listed) };
			})
			.catch(() => {});
	}
});

const relationPlans = computed(() => {
	const out = new Map<string, EmbeddedRelationPlan>();
	for (const field of propertyFields.value) {
		if (!isFieldReadonly(field)) continue;
		const plan = embeddedRelationPlan({
			field,
			value: valueFor(field.field),
			target: props.relationTargets?.get(field.field),
			views: uiViews.value,
			pageOptions: props.options,
		});
		if (plan) out.set(field.field, plan);
	}
	return out;
});
</script>

<template>
	<form class="dt-props" @submit.prevent>
		<!-- The lifecycle its collection declares (`display.record.options.stages`), above the properties,
		     on the read only — StageMap draws nothing for a collection that declares no stages. -->
		<StageMap
			v-if="readonly && !create && collectionName"
			:collection="collectionName"
			:record="item.record.value"
			:fields="fields"
			:relation-targets="relationTargets"
			:options="options"
		/>
		<!-- No "Properties" heading (operator 2026-07-29): the rows are self-evidently the record's
		     properties, and the label was one more thing between the title and the data. -->
		<section
			v-for="section in sections"
			:key="section.title"
			class="dt-props__list"
			:class="{ 'dt-props__list--named': Boolean(section.title) }"
			:data-section="section.title"
			:data-collapsed="section.collapsed ? (isShut(section) ? 'shut' : 'open') : undefined"
		>
			<h3 v-if="section.title && !section.collapsed" class="dt-props__section">{{ section.title }}</h3>
			<!-- a collapsed section (the provenance block): its heading is the toggle, shut until opened -->
			<button v-else-if="section.title" type="button" class="dt-props__section dt-section-toggle" :aria-expanded="!isShut(section)" @click="toggle(section)">
				<DtIcon :name="isShut(section) ? 'chevron-right' : 'chevron-down'" />{{ section.title }}
			</button>
			<div
				v-for="field in isShut(section) ? [] : section.fields"
				:key="field.field"
				class="dt-prop"
				:class="{ 'dt-prop--stacked': relationPlans.has(field.field), 'dt-prop--computed': computedWhy(field) !== null }"
				:data-field="field.field"
			>
				<div class="dt-prop__key" :title="tooltipOf(field)" :class="{ 'is-documented': Boolean(field.description) }">
					<DtIcon class="dt-prop__icon" :name="fieldIcon(field)" />
					<span class="dt-prop__label">{{ labelOf(field) }}</span>
					<span v-if="field.required" class="dt-prop__required" aria-hidden="true">*</span>
				</div>

				<div class="dt-prop__value" :class="{ 'dt-computed': computedWhy(field) !== null }" :title="computedWhy(field) ?? undefined" :dir="field.direction">
					<!-- The read wrapper carries the horizontal inset an Edit widget gets from its own
					     padding + border, so a row's text sits at the SAME x in both modes and the
					     pencil doesn't nudge the whole column sideways. -->
					<span v-if="isFieldReadonly(field)" class="dt-prop__read">
						<span v-if="isEmpty(valueFor(field.field))" class="dt-prop__empty">Empty</span>
						<!-- A list relation with a resolvable target view gets the TARGET COLLECTION's own
						     view — its table, its columns, its sort, its paging — scoped to exactly the
						     related records. Everything else falls through to the RenderView below, which is
						     what keeps an un-migrated workspace on the links it has always had. -->
						<RelationField v-else-if="relationPlans.get(field.field)" :plan="relationPlans.get(field.field)!" />
						<span v-else-if="unitValueOf(field) !== null" class="dt-prop__unit-value">{{ unitValueOf(field) }}</span>
						<RenderView v-else :field="field" :value="valueFor(field.field)" context="record" :record="current" />
						<span v-if="readonlyHintOf(field)" class="dt-prop__generated" :title="readonlyHintOf(field)">
							<DtIcon name="lock" />{{ readonlyHintOf(field) }}
						</span>
						<!-- the owners in another repo this mirror cannot list (`lib/sources.ts`) -->
						<span v-if="mirrorOverflow[field.field]" class="dt-prop__overflow" :title="`${mirrorOverflow[field.field]} record${mirrorOverflow[field.field] === 1 ? '' : 's'} in another repo point${mirrorOverflow[field.field] === 1 ? 's' : ''} at this one — a mirror lists only its own repo's`">
							{{ mirrorOverflow[field.field] }} more from other sources
						</span>
					</span>
					<span v-else class="dt-prop__control">
						<RenderEdit
							:field="field"
							:value="valueFor(field.field)"
							:target-collection="relationTargets?.get(field.field)"
							@update:value="onFieldInput(field, $event)"
						/>
						<span v-if="unitSuffix(field, current)" class="dt-prop__suffix">{{ unitSuffix(field, current) }}</span>
					</span>
				</div>
			</div>
		</section>

		<!-- The document. No label, no box — the body IS the page below the properties. An EMPTY
		     body in view mode renders nothing at all (not even the divider): a record with no note
		     should end at its last property, rather than trail off into a rule and an em-dash. -->
		<template v-for="field in bodyFields" :key="field.field">
			<section v-if="!isFieldReadonly(field)" class="dt-props__body" :dir="field.direction">
				<RenderEdit :field="field" :value="valueFor(field.field)" @update:value="onFieldInput(field, $event)" />
			</section>
			<section v-else-if="!isEmpty(valueFor(field.field))" class="dt-props__body" :dir="field.direction">
				<RenderView :field="field" :value="valueFor(field.field)" context="record" :record="current" />
			</section>
		</template>
	</form>
</template>

<style scoped>
.dt-props {
	display: flex;
	flex-direction: column;
}

/* One property = one line. The key column is fixed so labels form a clean edge (the whole point
   of the layout); the value column takes the rest. */
.dt-prop {
	display: grid;
	grid-template-columns: 172px minmax(0, 1fr);
	align-items: start;
	gap: var(--dt-space-2);
	min-height: 28px;
	border-radius: var(--dt-radius);
	transition: background-color 0.12s ease;
}

.dt-prop:hover {
	background: color-mix(in srgb, var(--dt-bg-subtle) 60%, transparent);
}

.dt-prop__key {
	display: flex;
	align-items: center;
	gap: var(--dt-space-2);
	min-height: 28px;
	padding-left: var(--dt-space-1);
	min-width: 0;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}

.dt-prop__icon {
	flex-shrink: 0;
	font-size: var(--dt-icon);
	color: var(--dt-fg-muted);
}

.dt-prop__label {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* A documented field says so — otherwise the tooltip is a secret only the person who wrote the
   descriptor knows about. Dotted underline is the long-standing "there is an explanation here"
   convention, and it only paints on hover so the property list keeps its clean label edge. */
.dt-prop__key.is-documented {
	cursor: help;
}

.dt-prop__key.is-documented:hover .dt-prop__label {
	text-decoration: underline dotted currentColor;
	text-underline-offset: 3px;
}

.dt-prop__required {
	color: var(--dt-danger);
	flex-shrink: 0;
}

.dt-prop__value {
	display: flex;
	flex-direction: column;
	justify-content: center;
	min-height: 28px;
	min-width: 0;
	font-size: var(--dt-text);
	line-height: 1.5;
	color: var(--dt-fg);
	padding: 3px 0;
}

/* 8px of widget padding + its 1px (transparent) border — see the template comment. */
.dt-prop__read {
	padding: 0 9px;
	min-width: 0;
}

.dt-prop__empty {
	color: var(--dt-fg-muted);
}

/* ---- a relation drawn as its target's own view ------------------------------------------------
   The 172px key column is right for `Status  active`; it is absurd for an eight-column table. A
   stacked row puts the label on its own line and gives the value the whole width, which is the same
   rule this layout already states for `json`/`list` and `width: full` fields — a repeatable editor
   (or a table) squeezed into the value column is unusable. */
.dt-prop--stacked {
	grid-template-columns: minmax(0, 1fr);
	gap: 0;
	margin-bottom: var(--dt-space-4);
}

/* The read wrapper is an inline `<span>` carrying a 9px inset so view and edit modes line up. A
   table is not inline, and it does not want the inset. */
.dt-prop--stacked .dt-prop__read {
	display: block;
	padding: 0;
}

.dt-prop--stacked .dt-prop__value {
	padding-top: var(--dt-space-1);
}
/* A generated mirror explains itself on the row, beside the value it holds. */
.dt-prop__generated {
	display: inline-flex;
	align-items: baseline;
	gap: 5px;
	margin-left: 8px;
	font-size: var(--dt-label);
	color: var(--dt-fg-muted);
}
.dt-prop__generated .codicon {
	font-size: var(--dt-label);
}
.dt-prop__overflow {
	display: inline-block;
	margin-left: 8px;
	font-size: var(--dt-label);
	color: var(--dt-fg-muted);
}

/* ---- edit mode: the widgets lose their chrome until you touch them --------------------------
   A boxed input per row would rebuild the form this layout replaces. Flattened by default, the
   border and fill come back on hover/focus so the row still reads as editable.

   The selector list is every widget ROOT that draws a box of its own — `.dt-input`/`.dt-select`/
   `.dt-textarea` (base.css) plus the components that roll their own control surface
   (EditRelation's button, EditTags' chip well, EditCode/EditJson). Widgets that draw no box
   (EditBoolean's switch, EditColor's swatch) are deliberately absent: there's nothing to flatten,
   and blanking their background would erase the control itself. */
.dt-prop__value :deep(.dt-input),
.dt-prop__value :deep(.dt-select),
.dt-prop__value :deep(.dt-textarea),
.dt-prop__value :deep(.dt-relation-control),
.dt-prop__value :deep(.dt-tags),
.dt-prop__value :deep(.dt-code) {
	min-height: 22px;
	padding: 1px var(--dt-space-2);
	background: transparent;
	border-color: transparent;
}

.dt-prop:hover .dt-prop__value :deep(.dt-input),
.dt-prop:hover .dt-prop__value :deep(.dt-select),
.dt-prop:hover .dt-prop__value :deep(.dt-textarea),
.dt-prop:hover .dt-prop__value :deep(.dt-relation-control),
.dt-prop:hover .dt-prop__value :deep(.dt-tags),
.dt-prop:hover .dt-prop__value :deep(.dt-code) {
	background: var(--dt-bg-subtle);
	border-color: var(--dt-border);
}

.dt-prop__value :deep(.dt-input:focus),
.dt-prop__value :deep(.dt-select:focus),
.dt-prop__value :deep(.dt-textarea:focus),
.dt-prop__value :deep(.dt-relation-control.is-open),
.dt-prop__value :deep(.dt-code:focus-within) {
	background: var(--dt-bg);
	border-color: var(--dt-accent);
}

.dt-prop__value :deep(.dt-textarea),
.dt-prop__value :deep(.dt-code) {
	padding: 4px var(--dt-space-2);
}

/* The popover the relation picker opens is a real floating surface — it must keep its own
   background and border, which the flattening rules above would otherwise have stripped from the
   search input inside it. */
.dt-prop__value :deep(.dt-relation-popover .dt-input) {
	background: var(--dt-bg-subtle);
	border-color: var(--dt-border-strong);
}

/* ---- sections: a quiet heading over each named one, space between them ------------------------ */
.dt-props__list--named + .dt-props__list,
.dt-props__list + .dt-props__list--named {
	margin-top: var(--dt-space-4);
}

.dt-props__section {
	margin: 0 0 var(--dt-space-1);
	padding-left: var(--dt-space-1);
	font-size: var(--dt-label);
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--dt-fg-subtle);
}

/* A unit sits beside its control, quiet, so the number reads as an amount while it is typed. */
.dt-prop__control {
	display: flex;
	align-items: center;
	gap: var(--dt-space-2);
	min-width: 0;
}

.dt-prop__control > :first-child {
	flex: 1 1 auto;
	min-width: 0;
}

.dt-prop__suffix {
	flex: 0 0 auto;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}

/* ---- the document ---------------------------------------------------------------------------- */
.dt-props__body {
	margin-top: var(--dt-space-5);
	padding-top: var(--dt-space-5);
	border-top: 1px solid var(--dt-border);
}

/* A body with no properties above it needs neither the rule nor the gap. */
.dt-props > .dt-props__body:first-child {
	margin-top: 0;
	padding-top: 0;
	border-top: none;
}

/* The markdown editor loses its box for the same reason the field widgets do — the body should
   read as the page, not as a control parked on it. The toolbar keeps its own bottom rule so the
   writing surface still has a visible top edge. */
.dt-props__body :deep(.dt-markdown) {
	border-color: transparent;
	background: transparent;
}

.dt-props__body :deep(.dt-markdown:focus-within) {
	border-color: transparent;
	background: transparent;
}

.dt-props__body :deep(.dt-markdown-toolbar) {
	padding-left: 0;
	padding-right: 0;
}

@media (max-width: 720px) {
	.dt-prop {
		grid-template-columns: minmax(0, 1fr);
		gap: 0;
	}
	.dt-prop__value {
		padding-top: 0;
	}
}
</style>
