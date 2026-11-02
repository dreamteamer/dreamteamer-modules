<!--
	WHERE A NEW RECORD SAVES — said on the create form BEFORE the save (design 2026-10-30, Q3-B):

	  Saves to ● my-hq
	  Saves to ● my-hq — not to project-a: a layer's records are added in its own workspace. The list
	  will show my-hq too, so this record stays in view.

	The second form only when the list it was opened from is narrowed (Sources picker) to roots the new
	record will not be in (`lib/created-visibility.ts`). Drawn only when the question has more than one
	plausible answer — a collection reading some root besides the workspace's own, a narrowed list, or a
	root the target choice picked (`?target=`, cr-vscode-004), which this line then names, with its
	writability glyph, as where the save goes.
-->
<script setup lang="ts">
import type { SourceAccess, SourceVia } from '../api/types';
import SourceMark from './SourceMark.vue';

defineProps<{
	/** The root a new record of this collection is written to. */
	root: string;
	/** The selected sources the record will not be in — empty when the list shows its root. */
	excluded: string[];
	/** The root's writability and class — the mark's glyph and hover. */
	access?: SourceAccess;
	via?: SourceVia;
	/** A `?target=` the form could not use, and why — said here, and the save goes to `root`. */
	dropped?: { name: string; reason: string } | null;
}>();
</script>

<template>
	<p class="dt-save-target" :class="{ 'is-warning': excluded.length > 0 || !!dropped }" data-save-target :data-save-root="root">
		<span class="dt-save-target__lead">Saves to</span>
		<SourceMark :name="root" :access="access" :via="via" />
		<span v-if="dropped" class="dt-save-target__why" data-save-target-dropped>— not {{ dropped.name }}: {{ dropped.reason }}.</span>
		<template v-if="excluded.length">
			<span class="dt-save-target__why">
				— not to {{ excluded.join(', ') }}, which take{{ excluded.length === 1 ? 's' : '' }} no new record from here. The list will show {{ root }} too, so
				this record stays in view.
			</span>
		</template>
	</p>
</template>

<style scoped>
.dt-save-target {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 6px;
	margin: 0 0 16px;
	padding: 8px 12px;
	border-radius: var(--dt-radius, 6px);
	border: 1px solid var(--dt-border);
	font-size: var(--dt-text);
	color: var(--dt-fg-muted);
}
.dt-save-target.is-warning {
	border-color: var(--dt-warning);
}
.dt-save-target__lead {
	color: var(--dt-fg);
}
</style>
