<!--
	Renders one record's fields via FormField, wired directly into the `item` composable instance the
	caller already owns. Every FormField's `update:value` calls `item.setField` straight through —
	`item` stays the single source of truth for record/edits/dirty; ItemForm adds no parallel
	dirty-tracking of its own. Save/delete live in ContentDetail's PageHeader: this is a pure fields
	renderer, no local state, no dialogs.

	What it draws is the display contract's answer, per field (descriptor v2 §3.4.2, §3.5):
	  - SECTIONS from the collection's `form.sections`, fields in each section's own order; every field
	    no section claims forms a last, unnamed section; the body comes after all of them.
	  - `hidden`: the edit and create forms skip a field hidden from `form`, the read skips one hidden
	    from `record`.
	  - a CONTROL only where `hasControl` says so: never for a `kind` (the engine owns the value) or
	    `editable: false`, and for `editable: create` on the create form alone — everywhere else such
	    a field is drawn as its read.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import type { useItem } from '../composables/items';
import { useFormSections } from '../composables/form-sections';
import { useSectionDisclosure } from '../composables/section-disclosure';
import DtIcon from './DtIcon.vue';
import { computedReason, drawnOn, formSections, hasControl, isBodyField } from '../lib/field-row';
import FormField from './FormField.vue';

const props = defineProps<{
	fields: FieldRow[];
	item: ReturnType<typeof useItem>;
	relationTargets?: Map<string, string>;
	/** View mode (detail page default, and bundle `$writable === false` records): every field
	 * renders its registry-resolved View via FormField's `readonly` prop — real read
	 * presentations, selectable/clickable — and `setField` is gated as defense in depth. */
	readonly?: boolean;
	/** Create form: an `editable: create` field gets its control here and nowhere else. */
	create?: boolean;
}>();

// Registered as BOTH built-in record-scoped renderers (spec §8): `form` (record-scoped Edit) and
// `doc` (record-scoped View, a read-only skin). ContentDetail renders it via the edits/views registry
// and passes the module record-page prop set (record/fields/mode/options) alongside these; this
// built-in only consumes the props it declares, so drop attr inheritance to keep the extras off the
// root element.
defineOptions({ inheritAttrs: false });

const sectionSpecs = useFormSections(() => props.fields[0]?.collection);

/** The surface this rendering is: the read, or the (edit or create) form. */
const drawn = computed(() => props.fields.filter((f) => drawnOn(f, props.readonly ? 'record' : 'form')));
const sections = computed(() => formSections(drawn.value, sectionSpecs.value));
const { isShut, toggle } = useSectionDisclosure();
const bodyFields = computed(() => drawn.value.filter(isBodyField));

// Wide fields span both grid columns: long text, objects, maps and lists need full width to be
// usable. Short scalar fields (string/number/date/boolean/single relation) pack two-up on wide
// viewports.
function isWideField(field: FieldRow): boolean {
	return field.type === 'markdown' || field.type === 'object' || field.type === 'map' || field.many === true;
}

function isFieldReadonly(field: FieldRow): boolean {
	return Boolean(props.readonly) || !hasControl(field, { create: Boolean(props.create) });
}

function classFor(field: FieldRow): Record<string, boolean> {
	return { 'dt-field-wide': isWideField(field) };
}

function valueFor(field: string): unknown {
	if (field in props.item.edits.value) return props.item.edits.value[field];
	return props.item.record.value?.[field] ?? null;
}

/** The record with pending edits applied — what a currency field reads its code from. */
const current = computed<Record<string, unknown>>(() => ({ ...(props.item.record.value ?? {}), ...props.item.edits.value }));

function onFieldInput(field: FieldRow, value: unknown): void {
	if (isFieldReadonly(field)) return;
	props.item.setField(field.field, value);
}
</script>

<template>
	<form class="dt-item-form-root" :class="{ 'is-readonly': readonly }" @submit.prevent>
		<section v-for="section in sections" :key="section.title" class="dt-item-form-section" :data-section="section.title" :data-collapsed="section.collapsed ? (isShut(section) ? 'shut' : 'open') : undefined">
			<h3 v-if="section.title && !section.collapsed" class="dt-item-form-section__title">{{ section.title }}</h3>
			<!-- a collapsed section (the provenance block): its heading is the toggle, shut until opened -->
			<button v-else-if="section.title" type="button" class="dt-item-form-section__title dt-section-toggle" :aria-expanded="!isShut(section)" @click="toggle(section)">
				<DtIcon :name="isShut(section) ? 'chevron-right' : 'chevron-down'" />{{ section.title }}
			</button>
			<div v-if="!isShut(section)" class="dt-item-form">
				<FormField
					v-for="field in section.fields"
					:key="field.field"
					:field="field"
					:value="valueFor(field.field)"
					:record="current"
					:target-collection="relationTargets?.get(field.field)"
					:readonly="isFieldReadonly(field)"
					:computed-reason="computedReason(field, { create: Boolean(create), target: relationTargets?.get(field.field) })"
					:class="classFor(field)"
					@update:value="onFieldInput(field, $event)"
				/>
			</div>
		</section>
		<div v-if="bodyFields.length" class="dt-item-form">
			<FormField
				v-for="field in bodyFields"
				:key="field.field"
				:field="field"
				:value="valueFor(field.field)"
				:record="current"
				:readonly="isFieldReadonly(field)"
				class="dt-field-body dt-field-wide"
				@update:value="onFieldInput(field, $event)"
			/>
		</div>
	</form>
</template>

<style scoped>
.dt-item-form-root {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-5);
}
.dt-item-form-section__title {
	margin: 0 0 var(--dt-space-3);
	font-size: var(--dt-label);
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--dt-fg-subtle);
}
.dt-item-form {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 18px 24px;
	align-items: start;
	max-width: 920px;
}
/* Wide fields (body, long text, objects, lists) span the full row. */
.dt-item-form :deep(.dt-field-wide) {
	grid-column: 1 / -1;
}

/* Narrow viewports collapse to a single column. */
@media (max-width: 720px) {
	.dt-item-form {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
