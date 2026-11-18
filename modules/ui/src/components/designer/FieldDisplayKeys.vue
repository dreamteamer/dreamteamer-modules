<!--
	The field editor's DISPLAY keys (descriptor v2, §3.4.2) — how surfaces draw one field, stored in
	the descriptor as the field's `display` block: whether the UI offers a control (`editable`), which
	surfaces it is hidden from, its form section, placeholder, unit (and the currency field), the text
	direction of its values, and its list column width in characters.

	It edits the drawer's staged def IN PLACE (the def is the drawer's reactive draft), through the
	pure helpers in `lib/field-display-keys.ts`, so an untouched control writes nothing the field did
	not already say.
-->
<script setup lang="ts">
import { computed } from 'vue';
import {
	editableOf,
	isHiddenOn,
	setDirection,
	setEditable,
	setHiddenOn,
	setText,
	setWidth,
	unitFieldApplies,
	widthOf,
	type Editable,
	type Surface,
} from '../../lib/field-display-keys';
import DtSelect from '../DtSelect.vue';

const props = defineProps<{
	def: Record<string, unknown>;
	/** The collection's `display.form.sections` titles — what `form_section` may name. */
	sections: string[];
	/** The collection's other field names — what `unit_field` may name. */
	siblings: string[];
}>();

const editableChoices = [
	{ text: 'Yes', value: 'true' },
	{ text: 'No — never offer a control', value: 'false' },
	{ text: 'Only on the create form', value: 'create' },
];
const directionChoices = [
	{ text: 'Left to right', value: 'ltr' },
	{ text: 'Right to left', value: 'rtl' },
];
const SURFACE_LABELS: Array<{ id: Surface; label: string }> = [
	{ id: 'list', label: 'Lists' },
	{ id: 'form', label: 'Form' },
	{ id: 'record', label: 'Record page' },
];

const editable = computed<string>({ get: () => editableOf(props.def), set: (v) => setEditable(props.def, v as Editable) });
const direction = computed<string>({ get: () => (props.def['direction'] === 'rtl' ? 'rtl' : 'ltr'), set: (v) => setDirection(props.def, v) });
const text = (key: 'form_section' | 'placeholder' | 'unit' | 'unit_field') =>
	computed<string>({ get: () => (typeof props.def[key] === 'string' ? (props.def[key] as string) : ''), set: (v) => setText(props.def, key, v) });
const section = text('form_section');
const placeholder = text('placeholder');
const unit = text('unit');
const unitField = text('unit_field');
const width = computed<string>({ get: () => widthOf(props.def), set: (v) => setWidth(props.def, v) });
</script>

<template>
	<div class="dt-display-keys">
		<label class="dt-field-row">
			<span class="dt-field-label">Editable</span>
			<DtSelect v-model="editable" :choices="editableChoices" aria-label="Editable" />
		</label>

		<fieldset class="dt-field-row dt-display-keys__hidden">
			<legend class="dt-field-label">Hidden on</legend>
			<label v-for="s in SURFACE_LABELS" :key="s.id" class="dt-field-check">
				<input type="checkbox" class="dt-checkbox" :checked="isHiddenOn(def, s.id)" @change="setHiddenOn(def, s.id, ($event.target as HTMLInputElement).checked)" />
				<span>{{ s.label }}</span>
			</label>
		</fieldset>

		<label class="dt-field-row">
			<span class="dt-field-label">Form section</span>
			<input v-model="section" class="dt-input" list="dt-display-sections" placeholder="(the last, unnamed section)" />
			<datalist id="dt-display-sections">
				<option v-for="s in sections" :key="s" :value="s" />
			</datalist>
		</label>

		<label class="dt-field-row">
			<span class="dt-field-label">Placeholder</span>
			<input v-model="placeholder" class="dt-input" placeholder="Shown in an empty control" />
		</label>

		<label class="dt-field-row">
			<span class="dt-field-label">Unit</span>
			<input v-model="unit" class="dt-input" list="dt-display-units" placeholder="currency · percent · bytes · or a suffix (min, kg)" />
			<datalist id="dt-display-units">
				<option value="currency" />
				<option value="percent" />
				<option value="bytes" />
			</datalist>
		</label>

		<label v-if="unitFieldApplies(def)" class="dt-field-row">
			<span class="dt-field-label">Currency field</span>
			<input v-model="unitField" class="dt-input" list="dt-display-siblings" placeholder="the field holding the ISO code" />
			<datalist id="dt-display-siblings">
				<option v-for="f in siblings" :key="f" :value="f" />
			</datalist>
		</label>

		<label class="dt-field-row">
			<span class="dt-field-label">Text direction</span>
			<DtSelect v-model="direction" :choices="directionChoices" aria-label="Text direction" />
		</label>

		<label class="dt-field-row">
			<span class="dt-field-label">Column width</span>
			<input v-model="width" class="dt-input" inputmode="numeric" placeholder="characters — blank for automatic" />
		</label>
	</div>
</template>

<style scoped>
.dt-display-keys {
	display: flex;
	flex-direction: column;
	gap: 16px;
}
.dt-display-keys__hidden {
	border: none;
	margin: 0;
	padding: 0;
}
.dt-field-row {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.dt-field-label {
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
}
.dt-field-check {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: var(--dt-text);
	color: var(--dt-fg);
}
</style>
