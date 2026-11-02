<!--
	The record page's MODULE field for a ui-view, wired: reads the view's `$module` (the module the host
	says it was compiled from), offers the modules it can move to, and performs the move through the
	host (`PATCH /collections/ui-views/records/<id> {module}` → the engine's `moveUiView`, compile-gated,
	committed in the repo that holds the destination). After a move the record is re-read and the views
	re-wired, so the page and the routes follow without a window reload; the host's system-write refresh
	redraws the native tree.
-->
<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import { useModules } from '../composables/modules';
import { moveUiView } from '../composables/schema';
import { refusalAnswer, type SaveAnswer } from '../lib/save-answer';
import { viewModuleTargets } from '../lib/view-module-targets';
import { isUnwritableModule } from '../../../src/module-targets';
import { loadUiViews } from '../ui-views';
import ViewModuleField from './ViewModuleField.vue';

const props = defineProps<{ viewId: string }>();
const router = useRouter();
const { modules, workspaceModule } = useModules();

const current = ref<string | undefined>(undefined);
const busy = ref(false);
const answer = ref<SaveAnswer | null>(null);

async function load(): Promise<void> {
	try {
		const res = await api.get<Record<string, unknown>>(`/items/ui-views/${encodeURIComponent(props.viewId)}`);
		const m = res.data?.['$module'];
		current.value = typeof m === 'string' ? m : undefined;
	} catch {
		current.value = undefined;
	}
}
onMounted(load);
watch(() => props.viewId, () => { answer.value = null; void load(); });

/** The workspace module by its id here — a move names a module, never "the default". */
const targets = computed(() => viewModuleTargets(modules.value, workspaceModule.value).map((t) => (t.id === null ? { ...t, id: workspaceModule.value, label: `${workspaceModule.value ?? 'workspace'} (workspace module)` } : t)));
const readOnlyReason = computed(() => {
	const m = modules.value.find((x) => x.id === current.value);
	return m && isUnwritableModule(m)
		? 'shipped by an installed package, so it moves with the package. Save it from its list to change it here (an overlay in the workspace module), or Save as… a new name and move that.'
		: null;
});

async function move(to: string): Promise<void> {
	busy.value = true;
	answer.value = null;
	try {
		const out = await moveUiView(props.viewId, to);
		await load();
		await loadUiViews(router);
		answer.value = { tone: 'ok', sentence: `Moved to ${to}${out['file'] ? ` — ${String(out['file'])}` : ''}.` };
	} catch (err) {
		answer.value = refusalAnswer(err, { saveAs: true });
	} finally {
		busy.value = false;
	}
}
</script>

<template>
	<ViewModuleField :module="current" :targets="targets" :read-only-reason="readOnlyReason" :busy="busy" :answer="answer" @move="move" />
</template>
