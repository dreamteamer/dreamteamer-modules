<!-- Renders a set of fields as a real form by delegating each to FormField — the registry's options
     recursion (research item 1). Two inputs, one form:
       - `options`: an extension's declared OptionFieldDef[], each turned into a field row by
         `optionRow` (its `note` printed under the control, its `when`/`group` honoured);
       - `fields`: field rows of the display contract as they are — an object's sub-field rows, drawn
         by EditList / EditNested over one item.
     No bespoke settings UI anywhere: an option IS a field. -->
<script setup lang="ts">
import { computed } from 'vue';
import type { FieldRow } from '../../api/types';
import { OPTION_GROUPS, optionRow, type OptionFieldDef } from '../../registry/index';
import FormField from '../FormField.vue';

const props = defineProps<{ options?: OptionFieldDef[]; fields?: FieldRow[]; modelValue: Record<string, unknown> }>();
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, unknown>] }>();

/** One drawable entry: the row FormField draws, and the option def it came from (none for a
 *  contract row). */
interface Entry {
	row: FieldRow;
	def?: OptionFieldDef;
}

const entries = computed<Entry[]>(() => [
	...(props.options ?? []).map((def) => ({ row: optionRow(def), def })),
	...(props.fields ?? []).map((row) => ({ row })),
]);

/** Contextual options (registry `when`): an option that cannot apply to the current choices is not
 *  drawn at all. The predicate sees the values WITH defaults applied, so a `when` can rely on the
 *  declared default rather than re-stating it. */
const values = computed<Record<string, unknown>>(() => {
	const out: Record<string, unknown> = { ...props.modelValue };
	for (const { row } of entries.value) if (out[row.field] === undefined && row.default !== undefined) out[row.field] = row.default;
	return out;
});

const visible = computed(() => entries.value.filter(({ def }) => !def?.when || def.when(values.value)));

/**
 * Consecutive options sharing a `group` become one block. Runs rather than a keyed bucket, so an
 * option can never be teleported away from its neighbours by a grouping it happens to share — the
 * declaration order in the registry stays the rendering order, which is the property every list's
 * options rely on.
 */
const blocks = computed(() => {
	const out: Array<{ key: string; group?: string; heading?: string; entries: Entry[] }> = [];
	visible.value.forEach((entry, i) => {
		const last = out[out.length - 1];
		const group = entry.def?.group;
		if (last && group && last.group === group) last.entries.push(entry);
		else out.push({ key: `${i}:${entry.row.field}`, group, heading: group ? OPTION_GROUPS[group] : undefined, entries: [entry] });
	});
	return out;
});

function valueFor(row: FieldRow): unknown {
	return props.modelValue[row.field] ?? row.default ?? null;
}
function setValue(row: FieldRow, value: unknown): void {
	emit('update:modelValue', { ...props.modelValue, [row.field]: value });
}
</script>

<template>
	<div class="dt-options-form">
		<!-- keyed by position, not by `field`: two mutually-exclusive `when` variants of the same
		     option legitimately share a storage key (the diagram's "Link fields" is one control for
		     references and another for values), and a duplicate :key would collapse them. -->
		<div v-for="block in blocks" :key="block.key" class="dt-options-form__block">
			<!-- The heading is what turns a stack of twelve controls into four decisions. Absent for an
			     unheaded group and for an ungrouped option, so a lone trailing control (page size)
			     does not get a section of its own. -->
			<h4 v-if="block.heading" class="dt-options-form__heading">{{ block.heading }}</h4>
			<FormField
				v-for="(entry, i) in block.entries"
				:key="`${i}:${entry.row.field}`"
				:field="entry.row"
				:value="valueFor(entry.row)"
				:note-under="Boolean(entry.def?.note)"
				@update:value="setValue(entry.row, $event)"
			/>
		</div>
	</div>
</template>

<style scoped>
/* ⚠ THIS CLASS HAD NO STYLESHEET AT ALL until 0.13.0 — it was written in the template, referenced
   nowhere else in the tree, and with base.css's `* { margin: 0 }` reset that meant consecutive
   options had ZERO separation: one option's control abutted the next option's label. Every gap the
   settings panel appeared to have came from the 8px between a label and its own control, which is
   the wrong side. The panel read as an undifferentiated stack for exactly this reason. */
.dt-options-form {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-3);
}

.dt-options-form__heading {
	font-size: var(--dt-label);
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--dt-fg-subtle);
	margin-bottom: var(--dt-space-1);
}

/* Tight inside a group, the form's own gap between groups — so a "group by" dropdown and its
   qualifying toggles read as one decision rather than three peers. */
.dt-options-form__block {
	display: flex;
	flex-direction: column;
	gap: var(--dt-space-1);
}
</style>
