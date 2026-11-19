<!--
	WHERE A VIEW GOES — the module choice, as ONE dropdown, for Save as… and for a ui-view's record page
	(cr-vscode-010). Until 0.24.26 both drew a radio row per module with its source path under it, and
	every npm-installed module as a locked row repeating its reason; with ~19 modules the Save as…
	popover ran ~1800px and Save sat below the window.

	So: the label, the app's dropdown (`DtSelect` — its panel is fixed-position and capped by the
	viewport, with a search box above 7 choices), the SELECTED module's path on one line under it (each
	option carries its own as a hover), and — only when some module is installed by npm — one sentence
	saying they are not offered, their names on hover. Presentational: the parent owns the value.
-->
<script setup lang="ts">
import { computed } from 'vue';
import DtSelect from './DtSelect.vue';
import { lockedNote, moduleChoices, whereOf, type ViewModuleTarget } from '../lib/view-module-targets';

const props = defineProps<{
	modelValue: string | null;
	targets: ViewModuleTarget[];
	disabled?: boolean;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string | null] }>();

const split = computed(() => moduleChoices(props.targets));
/** The selected target — none while the value matches no choice (a record page that has not read its module yet). */
const selected = computed(() => props.targets.find((t) => !t.locked && t.id === props.modelValue) ?? null);
const lockedNames = computed(() => split.value.locked.map((t) => t.label).join(', '));

function update(value: unknown): void {
	emit('update:modelValue', typeof value === 'string' ? value : null);
}
</script>

<template>
	<div class="dt-vms" data-view-module-select>
		<p class="dt-vms__label">Module</p>
		<DtSelect :model-value="modelValue" :choices="split.choices" :disabled="disabled" aria-label="Module" @update:model-value="update" />
		<p v-if="selected" class="dt-vms__where" data-module-where>{{ whereOf(selected) }}</p>
		<p v-if="split.locked.length" class="dt-vms__locked" data-modules-locked :title="lockedNames">{{ lockedNote(split.locked.length) }}</p>
	</div>
</template>

<style scoped>
.dt-vms {
	display: flex;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}
.dt-vms__label {
	margin: 0;
	font-size: var(--dt-label);
	font-weight: 600;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--dt-fg-subtle);
}
.dt-vms__where,
.dt-vms__locked {
	margin: 0;
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
	/* a linked module's path is long: wrap inside the popover rather than run past it */
	overflow-wrap: anywhere;
}
</style>
