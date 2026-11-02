<!--
	THE SOURCE MARK — `● name`: a dot in a colour hashed from the name, and the name, always together.
	The ONE component every surface draws a record's source with (the table cell, a card's corner, the
	line under a browse or record title, the sidebar's Source row, the Sources section), so a layer is
	the same colour and the same word wherever it appears (`lib/sources.ts`).

	It says where the record is READ FROM and, with `access`, WHETHER A WRITE LANDS THERE — one trailing
	codicon, a pencil or a lock (`lib/sources.ts` ACCESS_GLYPH, cr-vscode-004); the root's class and the
	reason are the hover's words. A dot alone would be decoration, a
	click would be a hidden gesture (the filter chip is the gesture). When a `repos` record matches
	the root's remote (`record`, resolved by the host), the name is a LINK to that record in a
	`record` context, exactly as a relation value links on a record page and stays inert text in a
	table cell, where the row is already the click target. Never a dangling reference: no match, no link.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import DtLink from './DtLink.vue';
import { currentContentBasePath } from '../lib/content-path';
import DtIcon from './DtIcon.vue';
import type { SourceAccess, SourceVia } from '../api/types';
import { ACCESS_GLYPH, markTitle, sourceColor } from '../lib/sources';

const props = defineProps<{
	/** The root's name — a layer's key, a module's id, the workspace's package name. */
	name: string;
	/** `repos/<id>` when the host matched the root's remote to a repos record. */
	record?: string | null;
	/** `record` draws the name as a link when `record` names one; `cell` (default) never does. */
	context?: 'cell' | 'record';
	/** Words before the mark — `shared from`, `from` — kept in the same span so they wrap together. */
	prefix?: string;
	/** Whether a write from here lands in the root — draws the pencil or the lock. Absent: no glyph. */
	access?: SourceAccess;
	/** What the root is — the hover's first word. */
	via?: SourceVia;
	/** Why, for anything short of `write` — the hover's second line. */
	note?: string;
}>();
const title = computed(() => markTitle(props.name, { via: props.via, access: props.access, note: props.note, record: props.record }));

const color = computed(() => sourceColor(props.name));
const route = useRoute();
const to = computed(() => {
	if (props.context !== 'record' || !props.record) return null;
	return `${currentContentBasePath(route)}${props.record.replace(/^\/+/, '')}`;
});
</script>

<template>
	<span class="dt-source-mark" :title="title" :data-source="name" :data-access="access">
		<span v-if="prefix" class="dt-source-mark__prefix">{{ prefix }} </span>
		<span class="dt-source-mark__dot" :style="{ background: color }" aria-hidden="true"></span>
		<DtLink v-if="to" :to="to" class="dt-source-mark__name">{{ name }}</DtLink>
		<span v-else class="dt-source-mark__name">{{ name }}</span>
		<DtIcon v-if="access" class="dt-source-mark__access" :name="ACCESS_GLYPH[access]" />
	</span>
</template>

<style scoped>
.dt-source-mark {
	display: inline-flex;
	align-items: center;
	gap: 5px;
	white-space: nowrap;
	color: var(--dt-fg-subtle);
	font-size: var(--dt-text);
	min-width: 0;
}
.dt-source-mark__dot {
	flex-shrink: 0;
	width: 8px;
	height: 8px;
	border-radius: 50%;
}
/* The name is never truncated away — a dot with no word is decoration. */
.dt-source-mark__name {
	color: inherit;
	text-decoration: none;
}
a.dt-source-mark__name:hover {
	color: var(--dt-fg);
	text-decoration: underline;
}
/* the writability glyph: the mark's size, in the mark's colour — a property of the root, not an alarm */
.dt-source-mark__access {
	flex-shrink: 0;
	font-size: 12px;
	opacity: 0.85;
}
.dt-source-mark[data-access='read'] .dt-source-mark__access {
	color: var(--dt-fg-muted);
}
.dt-source-mark__prefix {
	color: var(--dt-fg-muted);
}
</style>
