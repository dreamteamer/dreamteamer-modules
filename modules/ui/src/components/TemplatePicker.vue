<!--
	"Start from an existing record" — the create-flow fallback for C2 spec item 4 (templates).

	Contract gap: the server has no dedicated template-file mechanism (`_templates/*` paths are
	invisible to the items engine end-to-end — see lib/template-prefill.ts's header for the
	curl-verified detail). Per the plan's own documented fallback, this offers duplicating any
	existing record of the collection instead of a curated template set: fetches a page of the
	collection's own records and, on pick, maps the chosen one through `prefillFromRecord` into the
	create-mode `item` the caller already owns (ContentDetail's `useItem(collection, null)`),
	applying every mapped field via `item.setField` — exactly the same write path ItemForm's
	FormField uses, so the result is indistinguishable from the operator having typed it in.

	Browse-restyle (BROWSE wave): restyled onto `.dt-select`/`.dt-section-label` tokens, no
	behavior change.

	Polish wave (defect 5): the gray "START FROM AN EXISTING RECORD" banner + always-visible select
	was the loudest thing on a create page before the operator had typed anything. Now a single
	quiet ghost-button row ("Start from existing…") reveals the select inline on click, and
	collapses back to the compact row once a pick completes (one-shot, same as before).
-->
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import type { FieldRow, ItemRecord } from '../api/types';
import { useItems } from '../composables/items';
import type { useItem } from '../composables/items';
import { titleOf } from '../lib/record-title';
import { prefillFromRecord } from '../lib/template-prefill';
import DtSelect from './DtSelect.vue';
import DtIcon from './DtIcon.vue';

const props = defineProps<{
	collection: string;
	fields: FieldRow[];
	pkField: string;
	item: ReturnType<typeof useItem>;
}>();

// A plain top-level useItems call is safe here: TemplatePicker is only ever mounted for the
// lifetime of one create-mode ContentDetail instance (itself remounted fresh per nav — see
// ContentBrowse's header), never reused across a collection change.
const source = useItems(props.collection);
source.limit.value = 25;

const hasCandidates = computed(() => !source.loading.value && source.items.value.length > 0);

function pkOf(record: ItemRecord): string {
	return String(record[props.pkField] ?? record['id'] ?? '');
}

function titleFor(record: ItemRecord): string {
	return titleOf(record) || pkOf(record);
}

const revealed = ref(false);


function reveal(): void {
	revealed.value = true;
}

/** The records this picker can duplicate from. */
const recordChoices = computed(() => source.items.value.map((r) => ({ text: titleFor(r), value: pkOf(r) })));

/**
 * A one-shot action, not a persistent selection: `model-value` is pinned to `''` so the control
 * never shows a lingering pick, and the row collapses once a choice completes.
 */
function pick(pk: string): void {
	revealed.value = false;

	const record = source.items.value.find((r) => pkOf(r) === pk);
	if (!record) return;

	const prefill = prefillFromRecord(record, props.fields);
	for (const [field, value] of Object.entries(prefill)) {
		props.item.setField(field, value);
	}
}
</script>

<template>
	<div v-if="hasCandidates" class="dt-template-picker">
		<button v-if="!revealed" type="button" class="dt-btn dt-btn--ghost dt-btn--sm dt-template-trigger" @click="reveal">
			<DtIcon name="copy" />
			Start from existing…
		</button>
		<div v-else class="dt-template-inline">
			<DtSelect
				class="dt-template-select"
				:model-value="''"
				:choices="recordChoices"
				placeholder="Choose a record to duplicate…"
				aria-label="Choose a record to duplicate"
				autofocus
				@update:model-value="pick(String($event ?? ''))"
			/>
		</div>
	</div>
</template>

<style scoped>
.dt-template-picker {
	margin-bottom: 20px;
}
.dt-template-trigger {
	padding: 0 10px;
}
.dt-template-inline {
	display: block;
	max-width: 320px;
}
.dt-template-select {
	min-height: var(--dt-control-height);
}
</style>
