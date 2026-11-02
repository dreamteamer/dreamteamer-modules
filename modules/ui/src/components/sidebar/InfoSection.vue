<!--
	Right-sidebar 'info' section for ContentDetail (spec §"placement conventions"): a
	small facts panel — collection, id, record type, created/updated — sized for the 280px sidebar
	column. `record type` and `created`/`updated` come from the item's IMPLICIT fields (`type`,
	`date_created`, `date_updated` — mirrors DataModelDetail's IMPLICIT_FIELD_NAMES set) when the
	collection actually declares them; they're absent on plenty of collections, so every row is
	optional and falls back to '—' rather than hiding.

	Takes a single `record` computed ref from ContentDetail (not the whole `item` composable
	instance) so it stays live as the record loads/reloads — passing the whole `item` composable
	object here previously threw "Cannot read properties of null (reading 'value')" from a
	double-unwrap (a plain object nested inside `section.props`, itself nested inside
	`composables/page-sidebar.ts`'s deep-reactive `ref<SidebarSection[]>([])`, had ITS OWN ref
	properties silently auto-unwrapped one level down by the time `RightSidebar`'s
	`v-bind="section.props"` spreads them here).

	`record` itself is accepted as either a plain value or a `Ref` and normalized with `unref()`:
	whether Vue's ref-in-reactive auto-unwrap actually fires for a top-level `props` key going
	through that same array-nested store isn't reliable to assume either way —
	`unref()` is correct regardless of which way it resolves.
-->
<script setup lang="ts">
import { computed, unref, type Ref } from 'vue';
import type { AttachmentInfo, ItemRecord, SourceEntry } from '../../api/types';
import { formatFilesize } from '../../lib/format-filesize';
import { relativeTime } from '../../lib/relative-time';
import { DUPLICATES_FIELD, SOURCE_FIELD, SOURCE_KIND_FIELD, isOwnSource } from '../../lib/sources';
import SourceMark from '../SourceMark.vue';

const props = defineProps<{
	collection: string;
	id: string;
	record: ItemRecord | null | Ref<ItemRecord | null>;
	/** The collection's roots, named (`lib/sources.ts`) — what says whether `$source` is the
	 *  workspace's own (no row) or a layer's or a module's (a Source row beside Updated). */
	sources?: SourceEntry[] | Ref<SourceEntry[] | undefined>;
}>();

const record = computed(() => unref(props.record));
const sources = computed(() => unref(props.sources));

/** Where the record is read from, when that is not this workspace — the mark, as a sidebar row. */
const source = computed(() => {
	const name = record.value?.[SOURCE_FIELD];
	if (typeof name !== 'string' || !name || isOwnSource(name, sources.value)) return null;
	const kind = record.value?.[SOURCE_KIND_FIELD];
	const entry = sources.value?.find((s) => s.name === name);
	return { name, kind: typeof kind === 'string' ? kind : '', record: entry?.record ?? null, access: entry?.access, via: entry?.via, note: entry?.note };
});
const duplicates = computed(() => {
	const roots = record.value?.[DUPLICATES_FIELD];
	return Array.isArray(roots) && roots.length > 1 ? (roots as string[]) : null;
});

function fieldText(field: string): string {
	const value = record.value?.[field];
	if (value === null || value === undefined || value === '') return '—';
	return String(value);
}

function dateText(field: string): string {
	const value = record.value?.[field];
	if (typeof value !== 'string' || !value) return '—';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : relativeTime(date);
}

const recordType = computed(() => fieldText('type'));
const created = computed(() => dateText('date_created'));
const updated = computed(() => dateText('date_updated'));
const createdTitle = computed(() => String(record.value?.['date_created'] ?? ''));
const updatedTitle = computed(() => String(record.value?.['date_updated'] ?? ''));

// Bundle-layered core facts: `$bundle` (only shown for dep-supplied records — '' = local) and
// the read-only `attachments` list folder-shape records carry ({name, size} rows).
const bundle = computed(() => {
	const value = record.value?.['$bundle'];
	return typeof value === 'string' ? value : '';
});
// Writability is per-record ($writable): symlinked/mounted clones with a real .git ARE
// writable even though they're dep-supplied — only snapshot installs are read-only.
const bundleReadonly = computed(() => record.value?.['$writable'] === false);
const attachments = computed<AttachmentInfo[]>(() => {
	const value = record.value?.['attachments'];
	if (!Array.isArray(value)) return [];
	return value.filter(
		(entry): entry is AttachmentInfo =>
			entry !== null && typeof entry === 'object' && typeof (entry as AttachmentInfo).name === 'string',
	);
});
</script>

<template>
	<dl class="dt-info-section">
		<div class="dt-info-row">
			<dt>Collection</dt>
			<dd :title="collection">{{ collection }}</dd>
		</div>
		<div class="dt-info-row">
			<dt>ID</dt>
			<dd :title="id">{{ id }}</dd>
		</div>
		<div class="dt-info-row">
			<dt>Record type</dt>
			<dd>{{ recordType }}</dd>
		</div>
		<div class="dt-info-row">
			<dt>Created</dt>
			<dd :title="createdTitle">{{ created }}</dd>
		</div>
		<div class="dt-info-row">
			<dt>Updated</dt>
			<dd :title="updatedTitle">{{ updated }}</dd>
		</div>
		<div v-if="source" class="dt-info-row" data-field="source">
	<dt>Source</dt>
	<dd class="dt-computed" :title="`read from ${source.name}${source.kind ? ` (${source.kind})` : ''}`">
		<SourceMark :name="source.name" :record="source.record" context="record" :access="source.access" :via="source.via" :note="source.note" />
	</dd>
</div>
<div v-if="duplicates" class="dt-info-row" data-field="duplicates">
	<dt>Duplicate id</dt>
	<dd :title="`held by both ${duplicates.join(' and ')} — ${duplicates[0]}'s copy is the one read`">held by {{ duplicates.join(' and ') }}</dd>
</div>
<div v-if="bundle" class="dt-info-row">
			<dt>Bundle</dt>
			<dd :title="bundle">{{ bundle }}{{ bundleReadonly ? ' (read-only)' : '' }}</dd>
		</div>
		<div v-if="attachments.length" class="dt-info-row">
			<dt>Attachments</dt>
			<dd>
				<ul class="dt-info-attachments">
					<li v-for="attachment in attachments" :key="attachment.name" class="dt-info-attachment">
						<span class="dt-info-attachment__name" :title="attachment.name">{{ attachment.name }}</span>
						<span class="dt-info-attachment__size">{{ formatFilesize(attachment.size) }}</span>
					</li>
				</ul>
			</dd>
		</div>
	</dl>
</template>

<style scoped>
.dt-info-section {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.dt-info-row {
	display: flex;
	flex-direction: column;
	gap: 2px;
}
.dt-info-row dt {
	font-size: var(--dt-label);
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.04em;
	color: var(--dt-fg-muted);
}
.dt-info-row dd {
	font-size: var(--dt-text);
	color: var(--dt-fg);
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-info-attachments {
	list-style: none;
	margin: 0;
	padding: 0;
	display: flex;
	flex-direction: column;
	gap: 4px;
}
.dt-info-attachment {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	gap: 8px;
}
.dt-info-attachment__name {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.dt-info-attachment__size {
	flex-shrink: 0;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
}
</style>
