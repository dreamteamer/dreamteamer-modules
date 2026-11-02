<!--
	A reference reads as its TARGET's name: the target collection's `record_title` (descriptor v2
	§3.1), rendered by `lib/record-titles.ts` — the same one-hop resolution a display template uses,
	so a relation cell, a record header and a card can never name one record two ways. The record is
	fetched through the module-level `lib/record-cache`, so a column of 90 rows naming 20 distinct
	records issues 20 requests. Until a title lands — and for a reference that resolves to nothing —
	the de-slugged stem (`textFor`) stands. An expanded record (an object, not a reference) is titled
	through the field's relation target, resolved once via the cached `/relations` list.
-->
<script setup lang="ts">
// ⚠ The fetch cache is NOT declared here. It moved to `lib/record-cache.ts` in 0.12.0 — group-header
// icons needed the same "give me this record by reference", and a second cache would have been a
// second answer plus a guaranteed miss for every row this one had already paid for. It still has to
// live in a plain module for the reason it always did: bindings in `<script setup>` run PER
// INSTANCE, so a cache here would dedupe nothing across the cells of a column.
import { computed, ref, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import type { FieldRow, ItemRecord } from '../api/types';
import { fetchRecord } from '../lib/record-cache';
import DtLink from '../components/DtLink.vue';
import { loadRelations } from '../composables/fields';
import { fileRecordRef, isImageExt, srcForRecord } from '../lib/file-record';
import { isSquarish } from '../lib/row-size';
import { currentContentBasePath } from '../lib/content-path';
import { pathStem, titleOf } from '../lib/record-title';
import { knownReferenceTitle, recordTitle } from '../lib/record-titles';
import { useCollections } from '../composables/collections';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	/** 'record' (the properties page) renders each entry as a real link to the related record;
	 *  'cell' (default — table/card/kanban) stays inert text, because the row itself is already
	 *  one click target and a nested link inside it would hijack that gesture. */
	context?: 'cell' | 'record';
}>();

const { tree } = useCollections();

// The field's relation target, resolved once from the cached flat `/relations` list by field name
// (ambiguous only if two collections share a field name with different targets — same caveat as
// EditRelation). An EXPANDED relation value carries no collection of its own, so titling and linking
// one needs it; a reference names its own collection and does not.
const target = ref<string | null>(null);
watchEffect(() => {
	if (target.value) return;
	void loadRelations().then((rows) => {
		const match = rows.find((row) => row.field === props.field.field && row.related_collection);
		target.value = match?.related_collection ?? null;
	});
});

/**
 * Polish wave defect 4: an unresolved (un-expanded, still a bare path string) relation value
 * already went through `pathStem` — the remaining gap was the EXPANDED-but-titleless case (the
 * related collection has no `title`/`name` field): `titleOf`'s
 * generic last-resort there is `record.id`, which isn't guaranteed to be path-derived for every
 * collection. Preferring the expanded record's own `$path` (same `pathStem` convention as the
 * un-expanded branch) keeps both cases consistent and never surfaces a raw path with its
 * `data/…` prefix or `.<record_type>.<ext>` suffix — falling back to `titleOf` only when the
 * record carries no `$path` at all (defensive; every real item response has one).
 */
function textFor(entry: unknown): string {
	if (typeof entry === 'string') return pathStem(entry);
	if (entry !== null && typeof entry === 'object') {
		const record = entry as ItemRecord;
		const titleField = props.options?.['titleField'] as string | undefined;
		if (titleField && record[titleField] != null) return String(record[titleField]);
		if (record['title'] != null) return String(record['title']);
		if (record['name'] != null) return String(record['name']);
		const path = record['$path'];
		if (typeof path === 'string') return pathStem(path);
		return titleOf(record, titleField);
	}
	return '';
}

/** The target's `record_title` once it is known, else the de-slugged fallback. */
function labelFor(entry: unknown): string {
	if (typeof entry === 'string') return knownReferenceTitle(entry, tree.value) ?? textFor(entry);
	const row = target.value ? tree.value.find((r) => r.collection === target.value) : undefined;
	if (row && entry !== null && typeof entry === 'object') return recordTitle(row, entry as ItemRecord, textFor(entry));
	return textFor(entry);
}

const route = useRoute();
const basePath = computed(() => currentContentBasePath(route));

/**
 * The studio route for one related record, or null when it isn't safely derivable.
 *
 * An UN-EXPANDED value is already `<collection>/<id>` — the exact remainder the content route's
 * greedy `:path(.*)` takes — so it needs no target lookup and works for nested collection ids
 * (`crm/contacts/…`) for free. An EXPANDED record carries no collection, so that branch needs the
 * resolved `target`. Anything else stays plain text: a link that might 404 is worse than a label.
 */
function linkFor(entry: unknown): string | null {
	if (props.context !== 'record') return null;
	if (typeof entry === 'string') {
		const norm = entry.replace(/^\/+/, '');
		return norm.includes('/') ? `${basePath.value}${norm}` : null;
	}
	if (entry !== null && typeof entry === 'object' && target.value) {
		const id = (entry as ItemRecord)['id'];
		if (typeof id === 'string' && id) return `${basePath.value}${target.value}/${id}`;
	}
	return null;
}

const entries = computed<unknown[]>(() => {
	const value = props.value;
	if (value === null || value === undefined || value === '') return [];
	return (Array.isArray(value) ? value : [value]).filter((entry) => entry !== null && entry !== undefined && entry !== '');
});

/**
 * File-codec entries, resolved to something drawable.
 *
 * A reference to a `codec: file` collection points at BYTES, so the useful rendering is the picture
 * rather than the id. Which collections those are comes from the host's injected list, so this
 * branch knows about a CODEC and never about a collection called "assets" (decision 268).
 *
 * The extension is not derivable from a reference — `assets/logos/monday` says nothing about
 * `.svg` vs `.png` — so the record is fetched for its derived `ext`. That goes through the same
 * module-level `recordCache` a template render uses, so a column of 90 rows pointing at 20 distinct
 * logos issues 20 requests, not 90.
 */
const files = ref<Record<string, { src: string; ext: string }>>({});
watchEffect(() => {
	for (const entry of entries.value) {
		if (typeof entry !== 'string' || entry in files.value) continue;
		const ref_ = fileRecordRef(entry);
		if (!ref_) continue;
		void fetchRecord(ref_.collection, ref_.id).then((record) => {
			const ext = record?.['ext'];
			const src = srcForRecord(ref_.collection, ref_.id, ext);
			if (!src || typeof ext !== 'string') return;
			files.value = { ...files.value, [entry]: { src, ext } };
		});
	}
});


/**
 * Which drawn pictures are square-ish, by their own natural size once loaded — the one fact a
 * stylesheet cannot know and the comfortable table needs: a square picture in a leading column is
 * a circle (an avatar), any other keeps its corners (a wordmark cropped into a circle loses its
 * letters). Keyed by the entry, so a column of rows pointing at one picture decides once per cell
 * and never flickers between shapes.
 */
const square = ref<Record<string, boolean>>({});
function onImageLoad(entry: string, event: Event): void {
	const img = event.target as HTMLImageElement | null;
	if (!img) return;
	square.value = { ...square.value, [entry]: isSquarish(img.naturalWidth, img.naturalHeight) };
}

const items = computed(() =>
	entries.value.map((entry) => ({
		label: labelFor(entry),
		to: linkFor(entry),
		file: typeof entry === 'string' ? (files.value[entry] ?? null) : null,
		key: typeof entry === 'string' ? entry : '',
		square: typeof entry === 'string' ? square.value[entry] === true : false,
	})),
);

const text = computed(() => (items.value.length ? items.value.map((item) => item.label).join(', ') : '—'));
</script>

<template>
	<span
		class="dt-display-relation"
		:class="{ 'dt-display-relation--record': context === 'record' }"
		:title="text"
	>
		<template v-if="items.length">
			<template v-for="(item, index) in items" :key="index">
				<!-- Bytes we can draw: the picture IS the value. The label stays as the tooltip and as
				     the alt text, so the row is still readable to a screen reader and on a failed load. -->
				<img
					v-if="item.file && isImageExt(item.file.ext)"
					class="dt-display-file"
					:class="{ 'dt-display-file--square': item.square }"
					:src="item.file.src"
					:alt="item.label"
					:title="item.label"
					@load="onImageLoad(item.key, $event)"
				/>
				<DtLink v-else-if="item.to" :to="item.to">{{ item.label }}</DtLink>
				<span v-else>{{ item.label }}</span
				><span v-if="index < items.length - 1 && !item.file">, </span>
			</template>
		</template>
		<template v-else>—</template>
	</span>
</template>

<style scoped>
/* Inherits `--dt-fg` rather than pinning a hex — the old `#172940` was the LIGHT-theme foreground
   hardcoded, which is why relation values were nearly unreadable on a dark theme. */
.dt-display-relation {
	white-space: nowrap;
}

/* One line-height, so a logo in a table cell never changes the row height. `width: auto` keeps a
   wordmark's aspect ratio — a square box would squash every non-square mark. */
.dt-display-file {
	height: 1.35em;
	width: auto;
	max-width: 120px;
	object-fit: contain;
	vertical-align: text-bottom;
}

.dt-display-relation--record .dt-display-file {
	height: 2.4em;
	max-width: 240px;
}

/* A property row can hold a dozen attendees; only table/card cells need the one-line clamp. */
.dt-display-relation--record {
	white-space: normal;
}
</style>
