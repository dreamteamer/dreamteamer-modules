<!--
	The collection DESIGNER, as a record-scoped Edit/View.

	`collections` is a collection and a descriptor is one of its records, so the field editor is not
	a page you navigate to — it is how a record of `collections` is DRAWN. Registered as
	`data-model` on both registries (like `properties`) and selected by `display.record.layout:
	data-model` on the `collections` collection (or a `scope: record` view of it).

	This wrapper exists only to translate the contract: a record-scoped renderer is handed the
	record, and `DataModelDetail` wants the collection NAME — which, for this collection, is the
	record's own id. Nothing else is adapted; the designer is unchanged apart from an `embedded`
	flag that drops the page header the host already drew.

	⚠ Before 2026-08-11 this was reached by a special-case in `routeFor` that sent the `collections`
	row to `/settings/data-model` instead of browsing it. Deleting that special-case is what made
	the schema diagram reachable — and it took the designer with it until this registration. Both
	are now the same mechanism: the collection's `display` says how it is drawn, as a list and as a
	record.
-->
<script setup lang="ts">
import { computed } from 'vue';
import DataModelDetail from '../pages/DataModelDetail.vue';

const props = defineProps<{
	/** The record being drawn — for `collections`, its id IS the collection name. */
	record?: Record<string, unknown> | null;
}>();

const name = computed(() => String(props.record?.['name'] ?? props.record?.['id'] ?? '').trim());
</script>

<template>
	<DataModelDetail v-if="name" :collection="name" embedded />
	<p v-else class="dt-dm-empty">no collection on this record — the designer draws records of <code>collections</code></p>
</template>

<style scoped>
.dt-dm-empty {
	padding: 16px 0;
	color: var(--dt-fg-subtle);
	font-size: 12px;
}
</style>
