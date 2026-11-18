<script setup lang="ts">
/**
 * The view names a layout option this build does not know — say so, and when the key is an old
 * spelling (descriptor v2 renamed the layout option keys, §3.5.1), say what it is called now.
 *
 * The unregistered-layout hint one level down. The engine forwards options opaque (decision 195),
 * the List reads only the keys it declares, and until 2026-09-07 a key in between — `lane_by` on a
 * build that predated lanes — vanished without a word. An unregistered LAYOUT is BrowseView's own
 * hint; this stays quiet for it rather than saying two things about one cause.
 */
import { computed } from 'vue';
import { lists } from '../../registry/index';
import { unknownOptions } from '../../lib/list-options';
import DtIcon from '../DtIcon.vue';

const props = defineProps<{
	layout: string;
	options?: Record<string, unknown>;
}>();

const found = computed(() => {
	const entry = lists.get(props.layout);
	return entry ? unknownOptions(props.options, entry.options) : [];
});
const renamed = computed(() => found.value.filter((o) => o.renamedTo));
const unknown = computed(() => found.value.filter((o) => !o.renamedTo));
</script>

<template>
	<p v-if="renamed.length" class="dt-browse-degraded dt-browse-degraded--renamed">
		<DtIcon name="info" />
		renamed layout option{{ renamed.length > 1 ? 's' : '' }}:
		<template v-for="(o, i) in renamed" :key="o.key"><code>{{ o.key }}</code> is now <code>{{ o.renamedTo }}</code><template v-if="i < renamed.length - 1">, </template></template>
		— rename {{ renamed.length > 1 ? 'them' : 'it' }} in the view.
	</p>
	<p v-if="unknown.length" class="dt-browse-degraded">
		<DtIcon name="info" />
		layout option{{ unknown.length > 1 ? 's' : '' }}
		<template v-for="(o, i) in unknown" :key="o.key"><code>{{ o.key }}</code><template v-if="i < unknown.length - 1">, </template></template>
		{{ unknown.length > 1 ? "aren't" : "isn't" }} known to this build of the extension — update the extension, or check the
		spelling in the view.
	</p>
</template>
