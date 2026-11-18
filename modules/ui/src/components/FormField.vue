<!--
	One labeled field in ItemForm: label (the engine-resolved field title), required marker, and the
	registry-resolved Edit component — or, when `readonly`, the field's registry-resolved View
	(RenderView): the detail page's view mode renders real read presentations (formatted dates,
	relation links, rendered markdown), not disabled inputs.

	Four display keys of the field are honoured here, so both record layouts share them through this
	component and `lib/field-unit.ts`:
	  `unit` / `unit_field`  a number reads with its unit (currency from the sibling field's ISO code,
	                         percent, bytes, or a literal suffix); the control carries the unit beside it
	  `direction`            the VALUES' text direction, on the read and on the control
	  `placeholder`          passed to the control (the basic Edits read `field.placeholder`)
	An authored `editor` id the build does not have falls back to the type's default and says so in
	the console (`registry/resolve.ts`), never in the form.
-->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../api/types';
import { labelOf } from '../lib/format-title';
import { formatWithUnit, unitSuffix } from '../lib/field-unit';
import { computedReason as computedReasonOf, isMirrorField } from '../lib/field-row';
import DtIcon from './DtIcon.vue';
import RenderEdit from './render/RenderEdit.vue';
import RenderView from './render/RenderView.vue';

const props = defineProps<{
	field: FieldRow;
	value: unknown;
	targetCollection?: string;
	readonly?: boolean;
	/** Why this field is computed — not written here — or null (`lib/field-row.ts#computedReason`). A
	 *  computed field's value is drawn DIMMED with this as its tooltip, in view and edit mode alike. */
	computedReason?: string | null;
	/** The record the value belongs to (edits applied) — what `unit_field` reads its sibling from. */
	record?: Record<string, unknown> | null;
	/** Print the description UNDER the control (a registry option) rather than on hover (a record
	 *  field). OptionsForm sets it for an option that declares a `note`. */
	noteUnder?: boolean;
}>();

const emit = defineEmits<{ 'update:value': [value: unknown] }>();

const label = computed(() => labelOf(props.field));
const required = computed(() => props.field.required);
// The descriptor's `description:` explains the field — on hover for a record field, under the
// control for a registry option (whose `note` became its description in `optionRow`).
const note = computed(() => (props.field.description ?? '').trim());
const tooltip = computed(() => (note.value ? `${note.value}\n\n${props.field.field}` : props.field.field));

/**
 * A REGISTRY OPTION prints its note under the control; a record FIELD keeps it on hover.
 *
 * The difference is how many there are. A record form is dozens of fields whose names are mostly
 * self-evident, and a paragraph under each would bury the form; a layout option is one of four, its
 * name is a term of art ("ungrouped band"), and the answer is one line the author already wrote.
 *
 * ⚠ And the two must not both fire. `.is-documented` draws a dotted underline meaning "hover me for
 * an explanation" — printing the explanation directly below it makes that a lie AND underlines every
 * label in the panel, which is exactly what it looked like the first time this shipped.
 */
const showsNote = computed(() => !props.readonly && Boolean(note.value) && props.noteUnder === true);

/** The value with its unit, when the field declares one and the value is a number. */
const withUnit = computed(() => formatWithUnit(props.field, props.value, props.record));
const suffix = computed(() => unitSuffix(props.field, props.record));

/**
 * WHY a generated mirror cannot be edited, and where it is set — the whole answer to "so how do I
 * change this?", and a tooltip is the wrong place for the answer to that. Shown only on the read,
 * because beside a control it would be a lie.
 */
const readonlyHint = computed(() => {
	if (!props.readonly || !isMirrorField(props.field) || !props.field.mirror_of) return '';
	// the computed rule's own sentence (`lib/field-row.ts#computedReason`), never a second wording
	return props.computedReason ?? computedReasonOf(props.field, { create: false, target: props.targetCollection }) ?? '';
});
</script>

<template>
	<div class="dt-form-field" :class="{ 'dt-form-field--computed': Boolean(computedReason) }" :data-field="field.field">
		<label class="dt-form-field-label" :class="{ 'is-documented': Boolean(note) && !showsNote }" :title="tooltip">
			{{ label }}<span v-if="required" class="dt-required" aria-hidden="true">*</span>
		</label>

		<div v-if="readonly" class="dt-form-field-view" :class="{ 'dt-computed': Boolean(computedReason) }" :title="computedReason || undefined" :dir="field.direction">
			<span v-if="withUnit !== null" class="dt-form-field-unit-value">{{ withUnit }}</span>
			<RenderView v-else :field="field" :value="value" context="record" :record="record" />
			<p v-if="readonlyHint" class="dt-form-field-hint">
				<DtIcon name="lock" />{{ readonlyHint }}
			</p>
		</div>
		<div v-else class="dt-form-field-control" :class="{ 'has-unit': Boolean(suffix) }" :dir="field.direction">
			<RenderEdit
				:field="field"
				:value="value"
				:target-collection="targetCollection"
				@update:value="emit('update:value', $event)"
			/>
			<span v-if="suffix" class="dt-form-field-suffix">{{ suffix }}</span>
		</div>

		<!-- Under the control, not only in the title attribute: a tooltip cannot answer a question the
		     reader does not yet know to ask, and these notes exist to name the thing the control does. -->
		<p v-if="showsNote" class="dt-form-field-note">{{ note }}</p>

		<slot name="error" />
	</div>
</template>

<style scoped>
/* The option's own sentence, quiet and directly under what it explains. Same size as every other
   hint in the app (`--dt-label`), which is the size all of them already agreed on except one. */
.dt-form-field-note {
	margin-top: var(--dt-space-1);
	font-size: var(--dt-label);
	line-height: 1.4;
	color: var(--dt-fg-subtle);
}

.dt-form-field-label {
	display: block;
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
	margin-bottom: 8px;
}
.dt-form-field-label.is-documented {
	cursor: help;
	text-decoration: underline dotted color-mix(in srgb, currentColor 45%, transparent);
	text-underline-offset: 3px;
}
.dt-required {
	color: var(--dt-danger);
	margin-left: 2px;
}
.dt-form-field-view {
	font-size: var(--dt-text);
	line-height: 1.6;
	color: var(--dt-fg);
	min-height: 21px;
}
.dt-form-field-hint {
	display: flex;
	align-items: baseline;
	gap: 6px;
	margin: 6px 0 0;
	font-size: var(--dt-label);
	line-height: 1.5;
	color: var(--dt-fg-subtle);
}
.dt-form-field-hint .codicon {
	font-size: var(--dt-label);
	flex: 0 0 auto;
}
/* A unit sits beside its control, quiet, so the number reads as an amount while it is typed. */
.dt-form-field-control.has-unit {
	display: flex;
	align-items: center;
	gap: var(--dt-space-2);
}
.dt-form-field-control.has-unit > :first-child {
	flex: 1 1 auto;
	min-width: 0;
}
.dt-form-field-suffix {
	flex: 0 0 auto;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
</style>
