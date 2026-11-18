<!--
	What only a MODULE has, under its record page in the Schema tab: New collection… TARGETED AT IT —
	the reason the module page exists (before it, a new collection could only ever land in the
	workspace module). The collections it already ships are the record's own `collections` field
	above; its fields edit on the ordinary record page; nothing here writes the module record.

	⚠ A `node_modules`-shaped module takes no new collection: a write there is erased by the next
	`npm install`, so the action is disabled and says so. A field edit on it is refused by the ENGINE,
	in its own sentence, on the record page's save — nothing here composes a refusal of its own.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import CreateCollectionDialog from './CreateCollectionDialog.vue';
import DtIcon from './DtIcon.vue';
import { useModules } from '../composables/modules';

const props = defineProps<{ moduleId: string }>();

const { modules } = useModules();
const entry = computed(() => modules.value.find((m) => m.id === props.moduleId));
/** `node_modules` is the one location a write cannot survive. */
const readOnly = computed(() => entry.value?.location === 'node_modules');
const createOpen = ref(false);
</script>

<template>
	<section v-if="entry" class="dt-module-collections">
		<button
			type="button"
			class="dt-btn dt-btn--secondary dt-btn--sm"
			:disabled="readOnly"
			:title="readOnly ? 'This module lives under node_modules — a new collection would be erased by the next npm install' : `New collection in ${moduleId}`"
			@click="createOpen = true"
		>
			<DtIcon name="add" /> New collection in this module…
		</button>

		<!-- The module TARGET is the whole point: the dialog posts `?module=<id>`. -->
		<CreateCollectionDialog v-model:open="createOpen" :module="moduleId" />
	</section>
</template>

<style scoped>
.dt-module-collections {
	margin-top: 20px;
}
</style>
