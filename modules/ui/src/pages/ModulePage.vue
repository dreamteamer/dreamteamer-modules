<!--
	A MODULE'S PAGE in the Schema tab — where a module folder clicked in the nav lands (cr: nested
	ui-views). When a page view names this module (`options.module`, `lib/page-view.ts#modulePageView`)
	it draws THAT view — for rnd, its activity beside the counts of its key collections; when none does,
	the module's Activity feed alone, exactly as before.

	`source` is the record layer the folder was clicked in (`?source=` on the route, `src/nav.ts`
	moduleRoute): the page, or the Activity, is scoped to that layer's records.
-->
<script setup lang="ts">
import { computed } from 'vue';
import { modulePageView } from '../lib/page-view';
import { uiViews } from '../ui-views';
import ActivityPane from './ActivityPane.vue';
import UiPageView from './UiPageView.vue';

const props = defineProps<{ module?: string; moduleTitle?: string; source?: string }>();

const page = computed(() => (props.module ? modulePageView(uiViews.value, props.module) : undefined));
</script>

<template>
	<UiPageView v-if="page" :key="`${page.id}:${source ?? ''}`" :view-id="page.id" :source="source" />
	<ActivityPane v-else :module="module" :module-title="moduleTitle" :source="source" />
</template>
