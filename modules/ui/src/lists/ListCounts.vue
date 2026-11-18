<!--
	THE COUNTS LAYOUT — a collection view grouped by one field, drawn as ONE NUMBER PER VALUE, each a
	link to the view's own list filtered to that value (cr: nested ui-views). What a person wants from a
	page at a glance: change requests suggested vs accepted, issues open vs fixed, tests passing.

	Not a second query vocabulary: it is an ordinary list layout over the browse state, so the view's
	own filter, the page's layer scope (`$source`, opaque) and the engine's filter all apply before a
	single record is counted. The bands are the SHARED derivation (`lib/grouping.ts#bucketize`) — the
	same buckets the table, the cards and the kanban band by, in the enum's declared order, with its
	labels and colours — so a number here and a band header there cannot disagree. A grouped list
	requests All rows (`lib/page-size.ts`), so a count is never one page's worth.

	`options.group_by` is a field-taking option, so compile CHECKS it against the collection — a typo is
	a compile error naming the view, for free. With no `group_by` the layout draws the total alone. A
	list-valued group field (tags) counts a record once under each of its values (`multi`).

	The links open the RECORDS behind a number: the collection's list with `?filter=` carrying the view's
	own filter, `<field> is <value>`, and `$source is <layer>` when the page is scoped (`PAGE_SOURCE`) —
	ordinary removable rules (`lib/page-view.ts#countLink`). Registered `summarizes: true`, so the browse draws no pager under it.
-->
<script setup lang="ts">
import { computed, inject, ref } from 'vue';
import type { BrowseState } from '../composables/browse-state';
import { bucketize, type Bucket } from '../lib/grouping';
import { themeColor } from '../lib/collection-display';
import { countLink, PAGE_SOURCE, UNLINKED_COUNT } from '../lib/page-view';
import { uiViews } from '../ui-views';
import DtIcon from '../components/DtIcon.vue';
import DtLink from '../components/DtLink.vue';

const props = defineProps<{ state: BrowseState }>();
defineOptions({ inheritAttrs: false });

const options = computed<Record<string, unknown>>(() => props.state.listOptions.value['counts'] ?? {});
const source = inject(PAGE_SOURCE, ref<string | undefined>(undefined));

const groupField = computed(() => {
	const named = options.value['group_by'];
	if (typeof named !== 'string' || !named) return null;
	return props.state.fields.visibleFields.value.find((f) => f.field === named) ?? null;
});

const bands = computed<Bucket[]>(() =>
	bucketize(groupField.value, props.state.items.items.value, {
		showUngrouped: options.value['show_ungrouped_rows'] === true,
		showEmpty: options.value['show_empty_rows'] === true,
		ungroupedLabel: 'none',
		multi: groupField.value?.many === true,
	}),
);

/** The records behind a number: the collection's list, filtered by the view's own filter, the value and
 *  the scope (`countLink`). A counts browse with no view record behind it filters by nothing of its own. */
const view = computed(() => (props.state.viewId ? uiViews.value.find((v) => v.id === props.state.viewId) : undefined));
const subject = computed(() => view.value ?? { id: '', route: `/content/${props.state.collection}`, scope: 'collection' as const, collection: props.state.collection });

function linkOf(b: Bucket): string | null {
	return countLink(subject.value, groupField.value!.field, b.ungrouped ? null : b.value, source.value);
}
const totalLink = computed(() => countLink(subject.value, undefined, null, source.value));
const loading = computed(() => props.state.items.loading.value && !props.state.items.items.value.length);
</script>

<template>
	<div class="dt-counts" :data-group-by="groupField?.field ?? ''">
		<component :is="totalLink ? DtLink : 'span'" class="dt-counts__total" :class="{ 'dt-counts--unlinked': !totalLink }" :to="totalLink ?? undefined" :title="totalLink ? 'Open the whole list' : UNLINKED_COUNT">
			<span class="dt-counts__num">{{ loading ? '…' : state.items.total.value }}</span>
			<span class="dt-counts__label">total</span>
		</component>
		<component
			:is="linkOf(b) ? DtLink : 'span'"
			v-for="b in bands"
			:key="b.value"
			class="dt-counts__item"
			:class="{ 'dt-counts--unlinked': !linkOf(b) }"
			:data-value="b.ungrouped ? '' : b.value"
			:to="linkOf(b) ?? undefined"
			:title="linkOf(b) ? (b.description ?? `Open the list where ${groupField?.field} is ${b.ungrouped ? 'empty' : b.label}`) : UNLINKED_COUNT"
		>
			<span class="dt-counts__num" :style="b.color ? { color: themeColor(b.color) } : undefined">{{ b.records.length }}</span>
			<span class="dt-counts__label">
				<DtIcon v-if="b.icon && !b.icon.includes('/')" class="dt-counts__icon" :name="b.icon" />{{ b.label }}
			</span>
		</component>
	</div>
</template>

<style scoped>
.dt-counts {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.dt-counts__total,
.dt-counts__item {
	display: flex;
	flex-direction: column;
	align-items: flex-start;
	min-width: 72px;
	padding: 6px 10px;
	border: 1px solid var(--dt-border);
	border-radius: 4px;
	color: var(--dt-fg);
	text-decoration: none;
}
.dt-counts__total {
	background: var(--dt-bg-subtle);
}
.dt-counts--unlinked {
	cursor: default;
}
.dt-counts__total:not(.dt-counts--unlinked):hover,
.dt-counts__item:not(.dt-counts--unlinked):hover {
	border-color: var(--vscode-focusBorder, var(--dt-focus-ring));
}
.dt-counts__num {
	font-size: calc(var(--dt-text) + 6px);
	font-weight: 600;
	font-variant-numeric: tabular-nums;
	line-height: 1.2;
}
.dt-counts__label {
	display: flex;
	align-items: center;
	gap: 4px;
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
	white-space: nowrap;
}
.dt-counts__icon {
	font-size: var(--dt-label);
}
</style>
