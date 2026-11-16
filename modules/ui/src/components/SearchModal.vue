<script setup lang="ts">
/**
 * The browser host's ONE SEARCH (cr-modules-022): Cmd/Ctrl-K opens a centred field and nothing else until you type;
 * then the records whose title (or another field) matches, across every collection the nav lists, best title match
 * first — at most a few per collection, and a "N more in <collection>" line that opens that list searched. ↑↓ move,
 * Enter opens the record in a tab, Escape or a click outside closes. lib/search.ts says how the collections are asked.
 * Typing is debounced; a search overtaken by the next keystroke stops asking and its answers are dropped.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { hostRequest } from '../api/transport';
import { useCollections } from '../composables/collections';
import { recordTitle } from '../lib/record-titles';
import { searchRecords, type SearchHit, type SearchMore, type SearchTarget } from '../lib/search';
import { templateFields } from '../lib/template';
import { seedTitle } from '../lib/tabs';
import DtIcon from './DtIcon.vue';

const router = useRouter();
const { tree } = useCollections();
const open = ref(false);
const term = ref('');
const hits = ref<SearchHit[]>([]);
const more = ref<SearchMore[]>([]);
/** What ↑↓ walk and Enter opens: the hits, then the "more" lines. */
const entries = computed<Array<SearchHit | SearchMore>>(() => [...hits.value, ...more.value]);
const isMore = (e: SearchHit | SearchMore): e is SearchMore => 'count' in e;
const busy = ref(false);
const active = ref(0);
const field = ref<HTMLInputElement | null>(null);
const navCollections = ref<string[] | null>(null);
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
/** How long typing must pause before the collections are asked. */
const SEARCH_DEBOUNCE_MS = 160;

interface NavNode { kind: string; target?: { name?: string }; children?: NavNode[] }
/** The collections the nav lists, in its order (layers' own rows are theirs, not this workspace's). */
async function loadNav() {
	try {
		const nodes = (await hostRequest('GET', '/nav')) as NavNode[];
		const out: string[] = [];
		const walk = (list: NavNode[]) => { for (const n of list) { if (n.kind === 'collection' && n.target?.name && !out.includes(n.target.name)) out.push(n.target.name); if (n.children) walk(n.children); } };
		walk(nodes ?? []);
		navCollections.value = out;
	} catch { navCollections.value = null; }
}

const targets = computed<SearchTarget[]>(() => {
	const rows = tree.value.filter((r) => !r.internal);
	const names = navCollections.value ?? rows.map((r) => r.collection);
	return names.flatMap((name) => {
		const row = rows.find((r) => r.collection === name);
		return row ? [{ collection: name, title: row.title, icon: row.nav?.icon, titleFields: templateFields(row.record_title ?? ''), titleOf: (rec: Record<string, unknown>) => recordTitle(row, rec, String(rec['id'] ?? '')) }] : [];
	});
});

function show() {
	open.value = true;
	term.value = '';
	hits.value = [];
	more.value = [];
	active.value = 0;
	void loadNav();
	void nextTick(() => field.value?.focus());
}
function hide() { open.value = false; seq++; }

watch(term, (t) => {
	if (timer) clearTimeout(timer);
	const mine = ++seq;
	if (t.trim().length < 2) { hits.value = []; more.value = []; busy.value = false; return; }
	busy.value = true;
	timer = setTimeout(async () => {
		const found = await searchRecords(t, targets.value, hostRequest, () => mine !== seq);
		if (mine !== seq) return;
		hits.value = found.hits;
		more.value = found.more;
		active.value = 0;
		busy.value = false;
	}, SEARCH_DEBOUNCE_MS);
});

function go(entry: SearchHit | SearchMore | undefined) {
	if (!entry) return;
	hide();
	// the tab opens already named (lib/tabs.ts): the hit's title, or the list's own title for a "more" line
	if (isMore(entry)) seedTitle(entry.route, entry.collectionTitle, entry.icon);
	else seedTitle(entry.route, entry.title, entry.icon);
	void router.push(entry.route);
}
function onFieldKey(e: KeyboardEvent) {
	if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(active.value + 1, entries.value.length - 1); scrollActive(); }
	else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(active.value - 1, 0); scrollActive(); }
	else if (e.key === 'Enter') { e.preventDefault(); go(entries.value[active.value]); }
	else if (e.key === 'Escape') { e.preventDefault(); hide(); }
}
function scrollActive() { void nextTick(() => document.querySelector('.dt-search__hit.is-active')?.scrollIntoView({ block: 'nearest' })); }

function onKey(e: KeyboardEvent) {
	if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
		e.preventDefault();
		if (open.value) hide(); else show();
	}
}
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); if (timer) clearTimeout(timer); });
defineExpose({ show });
</script>

<template>
	<Transition name="dt-search">
		<div v-if="open" class="dt-search-backdrop" @mousedown.self="hide">
			<div class="dt-search" role="dialog" aria-modal="true" aria-label="Search records">
				<div class="dt-search__field">
					<DtIcon name="search" />
					<input
						ref="field"
						v-model="term"
						class="dt-search__input"
						type="text"
						placeholder="Search records in every collection…"
						aria-label="Search records"
						autocomplete="off"
						spellcheck="false"
						role="combobox"
						aria-controls="dt-search-results"
						:aria-expanded="entries.length ? 'true' : 'false'"
						@keydown="onFieldKey"
					/>
					<DtIcon v-if="busy" name="loading" class="dt-search__spin codicon-modifier-spin" />
					<kbd class="dt-search__kbd">esc</kbd>
				</div>
				<template v-if="term.trim().length >= 2">
					<ul v-if="entries.length" id="dt-search-results" class="dt-search__hits" role="listbox">
						<li
							v-for="(hit, i) in hits"
							:key="`${hit.collection}/${hit.id}`"
							class="dt-search__hit"
							:class="{ 'is-active': i === active }"
							role="option"
							:aria-selected="i === active ? 'true' : 'false'"
							@mousemove="active = i"
							@click="go(hit)"
						>
							<span class="dt-search__icon"><DtIcon :name="hit.icon || 'file'" /></span>
							<span class="dt-search__title">{{ hit.title }}</span>
							<span class="dt-search__where">{{ hit.collectionTitle }}</span>
						</li>
						<li
							v-for="(m, j) in more"
							:key="`more:${m.collection}`"
							class="dt-search__hit dt-search__more"
							:class="{ 'is-active': hits.length + j === active }"
							role="option"
							:data-more="m.collection"
							:aria-selected="hits.length + j === active ? 'true' : 'false'"
							@mousemove="active = hits.length + j"
							@click="go(m)"
						>
							<span class="dt-search__icon"><DtIcon name="list-flat" /></span>
							<span class="dt-search__title">{{ m.count }} more in {{ m.collectionTitle }}</span>
							<span class="dt-search__where">open the list</span>
						</li>
					</ul>
					<p v-else-if="!busy" class="dt-search__none">No record matches “{{ term.trim() }}”.</p>
					<p class="dt-search__foot">Searches the titles in the {{ targets.length }} collections the nav lists · Enter opens in a tab</p>
				</template>
			</div>
		</div>
	</Transition>
</template>

<style scoped>
.dt-search-backdrop {
	position: fixed;
	inset: 0;
	z-index: 300;
	display: flex;
	justify-content: center;
	align-items: flex-start;
	padding-top: 14vh;
	background: var(--dt-backdrop);
}
.dt-search {
	width: min(640px, calc(100vw - 32px));
	max-height: 70vh;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	background: var(--dt-surface);
	border-radius: var(--dt-radius-xl);
	box-shadow: var(--dt-shadow-menu);
}
.dt-search__field {
	flex: none;
	display: flex;
	align-items: center;
	gap: var(--dt-space-3);
	height: 52px;
	padding: 0 var(--dt-space-4);
	color: var(--dt-fg-subtle);
}
.dt-search__input {
	flex: 1;
	min-width: 0;
	height: 100%;
	border: 0;
	outline: none;
	background: transparent;
	color: var(--dt-fg);
	font-size: var(--dt-text-lg);
}
.dt-search__input::placeholder {
	color: var(--dt-fg-muted);
}
.dt-search__kbd {
	flex: none;
	padding: 1px 6px;
	border-radius: var(--dt-radius-sm);
	background: var(--dt-ink-2);
	color: var(--dt-fg-muted);
	font-family: var(--dt-font);
	font-size: var(--dt-label);
}
.dt-search__hits {
	flex: 1 1 auto;
	min-height: 0;
	overflow-y: auto;
	list-style: none;
	margin: 0;
	padding: var(--dt-space-1) var(--dt-space-2) var(--dt-space-2);
	border-top: 1px solid var(--dt-hairline);
}
.dt-search__hit {
	display: flex;
	align-items: center;
	gap: var(--dt-space-3);
	height: 36px;
	padding: 0 var(--dt-space-2);
	border-radius: var(--dt-radius-lg);
	cursor: default;
}
.dt-search__hit.is-active {
	background: var(--dt-accent-tint);
}
.dt-search__icon {
	flex: none;
	display: inline-flex;
	color: var(--dt-fg-subtle);
}
.dt-search__hit.is-active .dt-search__icon {
	color: var(--dt-accent);
}
.dt-search__title {
	flex: 1;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--dt-fg);
}
.dt-search__where {
	flex: none;
	max-width: 40%;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--dt-fg-muted);
	font-size: var(--dt-text-sm);
}
.dt-search__more .dt-search__title {
	color: var(--dt-fg-subtle);
}
.dt-search__none {
	padding: var(--dt-space-4);
	border-top: 1px solid var(--dt-hairline);
	color: var(--dt-fg-subtle);
}
.dt-search__foot {
	flex: none;
	padding: var(--dt-space-2) var(--dt-space-4);
	border-top: 1px solid var(--dt-hairline);
	color: var(--dt-fg-muted);
	font-size: var(--dt-label);
}
.dt-search-enter-active,
.dt-search-leave-active {
	transition: opacity var(--dt-dur-fast) var(--dt-ease);
}
.dt-search-enter-active .dt-search,
.dt-search-leave-active .dt-search {
	transition: transform var(--dt-dur-med) var(--dt-ease);
}
.dt-search-enter-from,
.dt-search-leave-to {
	opacity: 0;
}
.dt-search-enter-from .dt-search {
	transform: translateY(-6px) scale(0.98);
}
</style>
