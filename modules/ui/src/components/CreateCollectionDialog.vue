<!--
	Create-collection dialog (M3 schema writes): parent namespace + name (live slug preview) + the
	MIXINS it starts from — `mixins` records, listed from the compiled runtime, applied in the order
	they are ticked — and an optional id template (`ids.from`). POSTs `{ name, mixins?, idFrom? }` to
	`POST /collections/collections/records[?module=<id>]` — the generic records endpoint, which is what
	a system collection is written through (a compile-gated source write). Then reloads
	`useCollections` and navigates to the new collection's page in the Schema tab.

	⚠ SELECTOR IN THE QUERY STRING, FIELD IN THE BODY. `?module=hr` narrows which SOURCE contributes;
	`{module: 'hr'}` in a body would be a value being WRITTEN — the move. The two mean different
	things and this dialog only ever means the first.

	The old record-type / note / storage-format knobs are GONE: the create endpoint doesn't accept
	them — offering knobs that silently don't persist would violate "honesty over silent loss".
	Namespace suggestions come from every existing collection's path prefixes — a plain `<input>` +
	`<datalist>` (free text; a brand-new namespace has no existing prefix to pick).
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
	DialogClose,
	DialogContent,
	DialogOverlay,
	DialogPortal,
	DialogRoot,
	DialogTitle,
} from 'reka-ui';
import { useRouter } from 'vue-router';
import { api } from '../api/client';
import { useCollections } from '../composables/collections';
import { createCollection } from '../composables/schema';
import { isOkfRow } from '../lib/okf';
import { joinCollectionPath, slugify } from '../lib/slugify';
import { createCollectionBody, mixinChoices, toggleMixin, type MixinChoice } from '../lib/create-collection';
import DtIcon from './DtIcon.vue';

const open = defineModel<boolean>('open', { default: false });

const props = defineProps<{
	/** The module the new collection is written INTO — `?module=<id>` on the create call.
	 *
	 *  ⚠ THIS IS THE DEFECT THE MODULE ROW FIXES. `newCollection` posted no module parameter at all,
	 *  so the UI could only ever write the workspace module: authoring a second inline module meant
	 *  moving the descriptor by hand and then watching the next field write land as an overlay in the
	 *  wrong module. Undefined still means the workspace module, which is the engine's own default. */
	module?: string;
}>();

const router = useRouter();
const { tree, reload } = useCollections();

const parent = ref('');
const name = ref('');
const mixins = ref<string[]>([]);
const idFrom = ref('');
const saving = ref(false);
const error = ref<string | null>(null);

const slug = computed(() => slugify(name.value));
const fullPath = computed(() => joinCollectionPath(parent.value, slug.value));

// Available mixins: the compiled `mixins` records (module-shipped + workspace).
const choices = ref<MixinChoice[]>([]);
async function loadMixins(): Promise<void> {
	try {
		const res = await api.get<Array<Record<string, unknown>>>('/items/mixins?limit=100');
		choices.value = mixinChoices(res.data);
	} catch {
		choices.value = []; // no mixins — the collection starts minimal
	}
}

function onToggle(id: string): void {
	mixins.value = toggleMixin(mixins.value, id);
}

// Namespace suggestions: every path-prefix (not the full id) of every registered OKF collection.
const namespaceSuggestions = computed(() => {
	const set = new Set<string>();
	for (const row of tree.value.filter(isOkfRow)) {
		const segments = row.collection.split('/');
		for (let i = 1; i < segments.length; i++) set.add(segments.slice(0, i).join('/'));
	}
	return [...set].sort();
});

function reset(): void {
	parent.value = '';
	name.value = '';
	mixins.value = [];
	idFrom.value = '';
	error.value = null;
}

watch(open, (isOpen) => {
	if (isOpen) {
		reset();
		void loadMixins();
	}
});

async function onSubmit(): Promise<void> {
	if (!slug.value) {
		error.value = 'Name is required';
		return;
	}

	saving.value = true;
	error.value = null;

	try {
		await createCollection({ ...createCollectionBody(fullPath.value, mixins.value, idFrom.value), module: props.module });
		await reload();
		open.value = false;
		await router.push(`/settings/schema/collections/${fullPath.value}`);
	} catch (err) {
		error.value = err instanceof Error ? err.message : String(err);
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<DialogRoot v-model:open="open">
		<DialogPortal>
			<DialogOverlay class="dt-dialog-overlay" />
			<DialogContent class="dt-dialog">
				<div class="dt-dialog-header">
					<DialogTitle class="dt-dialog__title">New collection</DialogTitle>
					<DialogClose as-child>
						<button type="button" class="dt-btn dt-btn--ghost dt-btn--icon dt-btn--sm" title="Close">
							<DtIcon name="close" />
						</button>
					</DialogClose>
				</div>

				<form class="dt-form" @submit.prevent="onSubmit">
					<label class="dt-form-row">
						<span class="dt-form-label">Parent namespace</span>
						<input v-model="parent" class="dt-input" list="dt-namespace-suggestions" placeholder="(root)" />
						<datalist id="dt-namespace-suggestions">
							<option v-for="ns in namespaceSuggestions" :key="ns" :value="ns" />
						</datalist>
					</label>

					<label class="dt-form-row">
						<span class="dt-form-label">Name</span>
						<input v-model="name" class="dt-input" autofocus placeholder="Contacts" />
					</label>

					<p class="dt-path-preview">Collection path: <code>{{ fullPath || '—' }}</code></p>

					<fieldset class="dt-form-row dt-mixins">
						<legend class="dt-form-label">Mixins</legend>
						<p v-if="!choices.length" class="dt-mixins__none">None — the collection starts with a name field; grow it in the designer.</p>
						<label v-for="m in choices" :key="m.id" class="dt-mixins__item" :title="m.description">
							<input type="checkbox" :checked="mixins.includes(m.id)" @change="onToggle(m.id)" />
							<span>{{ m.label }}</span>
							<span v-if="mixins.includes(m.id)" class="dt-mixins__order">{{ mixins.indexOf(m.id) + 1 }}</span>
						</label>
					</fieldset>

					<label class="dt-form-row">
						<span class="dt-form-label">Id template</span>
						<input v-model="idFrom" class="dt-input" placeholder="the engine's default — e.g. {{ name | slug }}" />
					</label>

					<p v-if="error" class="dt-dialog-error">{{ error }}</p>

					<div class="dt-dialog-actions">
						<DialogClose as-child>
							<button type="button" class="dt-btn dt-btn--secondary">Cancel</button>
						</DialogClose>
						<button type="submit" class="dt-btn" :disabled="saving || !slug">
							{{ saving ? 'Creating…' : 'Create' }}
						</button>
					</div>
				</form>
			</DialogContent>
		</DialogPortal>
	</DialogRoot>
</template>

<style scoped>
.dt-mixins {
	border: none;
	margin: 0;
	padding: 0;
}
.dt-mixins__item {
	display: flex;
	align-items: center;
	gap: 8px;
}
.dt-mixins__order {
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
	font-size: var(--vscode-font-size, 13px);
}
.dt-mixins__none {
	margin: 0;
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
}
.dt-dialog-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-bottom: 16px;
}
.dt-dialog-header .dt-dialog__title {
	margin-bottom: 0;
}
.dt-form {
	display: flex;
	flex-direction: column;
	gap: 16px;
}
.dt-form-row {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.dt-form-label {
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
}
.dt-path-preview {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
	margin: -8px 0 0;
}
.dt-path-preview code {
	color: var(--dt-fg);
	font-weight: 600;
}
.dt-dialog-error {
	color: var(--dt-danger);
	font-size: var(--dt-text);
}
.dt-dialog-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 4px;
}
</style>
