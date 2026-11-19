<script setup lang="ts">
/**
 * A nav row's menu (cr-dt-008): a short list of entries, drawn where the right click was. An entry that needs a
 * value — a folder label, a hidden name, an icon — asks for it in place (a text field, or the IconPicker) before it
 * is picked. What an entry DOES is NavSidebar's: this component only says which entry, and with what value.
 * A toolbar button that IS one entry (the nav toolbar's New folder, Show hidden…) opens the menu at that entry's ask
 * (`start`), with no list to choose from first.
 */
import { nextTick, onMounted, ref, shallowRef, watch } from 'vue';
import IconPicker from './IconPicker.vue';
import DtMenu from './DtMenu.vue';

export interface NavMenuItem {
	id: string;
	label: string;
	disabled?: boolean;
	/** The value the entry needs before it is picked: a text (a label, a name) or an icon. */
	ask?: 'text' | 'icon';
	/** The text field's starting value and placeholder. */
	value?: string;
	placeholder?: string;
	/** Values to offer beside the text field (Show hidden…: the names hidden last). */
	suggestions?: string[];
}

const props = defineProps<{ x: number; y: number; items: NavMenuItem[]; start?: string; trigger?: unknown }>();
const emit = defineEmits<{ pick: [{ id: string; value?: string | null }]; close: [] }>();

const first = props.start ? props.items.find((i) => i.id === props.start && i.ask && !i.disabled) ?? null : null;
const asking = ref<NavMenuItem | null>(first);
const text = ref(first?.value ?? '');
/** The text field of an ask: focused the moment the ask opens (straight from a toolbar button, or from an entry). */
const field = shallowRef<{ focus?: () => void } | null>(null);
const focusField = () => { void nextTick(() => field.value?.focus?.()); };
onMounted(() => { if (asking.value?.ask === 'text') focusField(); });
watch(asking, (a) => { if (a?.ask === 'text') focusField(); });

function choose(item: NavMenuItem): void {
	if (item.disabled) return;
	if (item.ask) {
		asking.value = item;
		text.value = item.value ?? '';
		return;
	}
	emit('pick', { id: item.id });
}
function submit(): void {
	const item = asking.value;
	if (!item || !text.value.trim()) return;
	emit('pick', { id: item.id, value: text.value.trim() });
}
function onIcon(name: string): void {
	if (asking.value) emit('pick', { id: asking.value.id, value: name || null });
}
</script>

<template>
	<!-- DtMenu (the one menu): the surface, the keyboard over the entries, Escape and a press outside -->
	<DtMenu class="dt-nav-menu" label="Nav" :at="{ x, y }" :trigger="trigger" @close="emit('close')" @click.stop>
		<template v-if="!asking">
			<button
				v-for="item in items"
				:key="item.id"
				type="button"
				role="menuitem"
				class="dt-menu-item dt-nav-menu-item"
				:data-id="item.id"
				:disabled="item.disabled || undefined"
				@click.stop="choose(item)"
			>{{ item.label }}</button>
		</template>
		<form v-else-if="asking.ask === 'text'" class="dt-nav-menu-ask" @submit.prevent="submit">
			<label class="dt-nav-menu-title">{{ asking.label.replace(/…$/, '') }}</label>
			<input
				ref="field"
				class="dt-nav-menu-input"
				type="text"
				:value="text"
				:placeholder="asking.placeholder ?? ''"
				:list="asking.suggestions?.length ? 'dt-nav-menu-suggestions' : undefined"
				spellcheck="false"
				@input="text = ($event.target as HTMLInputElement).value"
				@keydown.enter.prevent="submit"
				@keydown.esc.stop="emit('close')"
			/>
			<datalist v-if="asking.suggestions?.length" id="dt-nav-menu-suggestions">
				<option v-for="s in asking.suggestions" :key="s" :value="s" />
			</datalist>
			<div class="dt-nav-menu-actions">
				<button type="button" class="dt-nav-menu-item" data-id="cancel" @click.stop="emit('close')">Cancel</button>
				<button type="button" class="dt-nav-menu-item dt-nav-menu-ok" data-id="ok" @click.stop="submit">OK</button>
			</div>
		</form>
		<div v-else class="dt-nav-menu-ask">
			<label class="dt-nav-menu-title">{{ asking.label.replace(/…$/, '') }}</label>
			<IconPicker :model-value="asking.value ?? ''" @update:model-value="onIcon" />
			<div class="dt-nav-menu-actions">
				<button type="button" class="dt-nav-menu-item" data-id="clear-icon" @click.stop="emit('pick', { id: asking.id, value: null })">Clear icon</button>
				<button type="button" class="dt-nav-menu-item" data-id="cancel" @click.stop="emit('close')">Cancel</button>
			</div>
		</div>
	</DtMenu>
</template>

<style scoped>
/* the surface and the entries' look are the one menu's (DtMenu, base.css .dt-menu / .dt-menu-item); an ask's two
   buttons are plain text buttons */
.dt-nav-menu-actions .dt-nav-menu-item { padding: 4px 12px; background: none; border: 0; border-radius: var(--dt-radius); color: var(--dt-fg); font: inherit; cursor: pointer; }
.dt-nav-menu-actions .dt-nav-menu-item:hover { background: var(--dt-bg-hover); }
.dt-nav-menu-ask { display: flex; flex-direction: column; gap: 6px; padding: 6px 10px; min-width: 220px; }
.dt-nav-menu-title { color: var(--dt-fg-muted); font-size: var(--dt-label); }
.dt-nav-menu-input { height: var(--dt-control-height); padding: 0 6px; border: 1px solid var(--dt-border); border-radius: var(--dt-radius); background: var(--dt-bg); color: var(--dt-fg); font: inherit; }
.dt-nav-menu-actions { display: flex; justify-content: flex-end; gap: 4px; }
.dt-nav-menu-actions .dt-nav-menu-ok { color: var(--dt-accent); }
</style>
