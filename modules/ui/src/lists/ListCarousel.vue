<!--
	Carousel browse List — one card per record: its title, one text field, and a carousel over the
	images in the folder a `${env:…}/…` field on the record points at (a reference product's frames, a
	meeting's screenshots). Registered as `carousel` in register-defaults.ts, driven by the same
	`state` prop the cards and the kanban consume, holding nothing but the fetched file lists and each
	card's current slide.

	The images are NOT in a field: the record carries a folder TEMPLATE, the host renders it for this
	machine (`GET /folder/:collection/:id?field=…`, api.ts) and lists the files, and `lib/var-roots.ts`
	maps the rendered folder onto the webview uri of the declared-variable root it sits under. A folder
	that cannot be shown says WHY under the card (unset variable, empty folder) instead of drawing an
	empty box — an empty carousel with no reason is indistinguishable from "no screenshots".

	Options: `folder` (default: the first field named `screenshots_folder`, else the first whose
	name ends in `_folder`), `text` (default `description`).
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BrowseState } from '../composables/browse-state';
import { titleOf } from '../lib/record-title';
import { rowContext } from '../lib/vscode-context';
import { uriForPath } from '../lib/var-roots';
import { adapterRequest } from '../api/adapter';
import type { ItemRecord } from '../api/types';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{ state: BrowseState }>();
defineOptions({ inheritAttrs: false });

const options = computed<Record<string, unknown>>(() => props.state.listOptions.value['carousel'] ?? {});

const folderField = computed<string | null>(() => {
	const named = options.value['folder'];
	if (typeof named === 'string' && named.length) return named;
	const fields = props.state.fields.fields.value.map((f) => f.field);
	return fields.find((f) => f === 'screenshots_folder') ?? fields.find((f) => f.endsWith('_folder')) ?? null;
});
const textField = computed<string>(() => {
	const named = options.value['text'];
	return typeof named === 'string' && named.length ? named : 'description';
});

interface Slides { files: string[]; path: string | null; reason: string | null; index: number; loading: boolean }
const slides = ref(new Map<string, Slides>());

async function load(record: ItemRecord): Promise<void> {
	const pk = props.state.pkOf(record);
	const field = folderField.value;
	if (!field) { slides.value.set(pk, { files: [], path: null, reason: 'no folder field on this collection — set the `folder` option', index: 0, loading: false }); return; }
	slides.value.set(pk, { files: [], path: null, reason: null, index: 0, loading: true });
	try {
		const res = await adapterRequest('GET', `/folder/${encodeURIComponent(props.state.collection)}/${pk.split('/').map(encodeURIComponent).join('/')}?field=${encodeURIComponent(field)}`);
		const data = (res.data ?? {}) as { path?: string | null; files?: string[]; reason?: string | null };
		const files = data.files ?? [];
		const folder = data.path ?? null;
		// ⚠ A folder the host listed but no injected root contains is the one case the host cannot see:
		// `localResourceRoots` are computed when the panel is created, so a variable set or changed in
		// `.env` since then renders on the host and maps to no webview uri here. `src()` would answer
		// null for every slide and the card drew an empty stage with no reason — the silence this
		// component exists to end. Say it, and say the fix.
		const unreachable = folder && files.length && uriForPath(folder) === null;
		slides.value.set(pk, {
			files: unreachable ? [] : files,
			path: folder,
			reason: unreachable ? `${folder} is outside every folder this window may read — if a declared variable changed in .env, reload the window` : (data.reason ?? null),
			index: 0,
			loading: false,
		});
	} catch (e) {
		slides.value.set(pk, { files: [], path: null, reason: String((e as Error)?.message ?? e), index: 0, loading: false });
	}
	slides.value = new Map(slides.value);
}

watch(() => [props.state.items.items.value, folderField.value] as const, ([items]) => {
	slides.value = new Map();
	for (const r of items) void load(r);
}, { immediate: true });

function slidesOf(record: ItemRecord): Slides {
	return slides.value.get(props.state.pkOf(record)) ?? { files: [], path: null, reason: null, index: 0, loading: true };
}
function src(s: Slides, i: number): string | null {
	if (!s.path || !s.files[i]) return null;
	return uriForPath(`${s.path}/${s.files[i]}`);
}
function go(record: ItemRecord, delta: number, ev?: Event): void {
	ev?.stopPropagation();
	const pk = props.state.pkOf(record);
	const s = slides.value.get(pk);
	if (!s || !s.files.length) return;
	s.index = (s.index + delta + s.files.length) % s.files.length;
	slides.value = new Map(slides.value);
}
function jump(record: ItemRecord, i: number, ev?: Event): void {
	ev?.stopPropagation();
	const s = slides.value.get(props.state.pkOf(record));
	if (!s) return;
	s.index = i;
	slides.value = new Map(slides.value);
}
function onKey(record: ItemRecord, ev: KeyboardEvent): void {
	if (ev.key === 'ArrowLeft') { go(record, -1); ev.preventDefault(); }
	else if (ev.key === 'ArrowRight') { go(record, 1); ev.preventDefault(); }
}
function text(record: ItemRecord): string {
	const v = record[textField.value];
	return typeof v === 'string' ? v : '';
}
</script>

<template>
	<div class="dt-carousel-list">
		<div v-if="state.items.loading.value && !state.items.items.value.length" class="dt-empty">
			<DtIcon name="loading" />
			<p class="dt-empty__line">Loading…</p>
		</div>
		<div v-else-if="!state.items.loading.value && !state.items.items.value.length" class="dt-empty">
			<DtIcon name="inbox" />
			<p class="dt-empty__line">{{ state.hasActiveQuery.value ? 'No records match your search/filters' : 'No records yet' }}</p>
			<button v-if="!state.hasActiveQuery.value && !state.items.unavailable?.value" type="button" class="dt-btn dt-btn--sm" @click="state.createRecord()">Create record</button>
		</div>

		<article
			v-for="record in state.items.items.value"
			v-else
			:key="state.pkOf(record)"
			class="dt-card dt-carousel-card"
			:data-vscode-context="rowContext(state.collection, state.pkOf(record))"
			tabindex="0"
			@keydown="onKey(record, $event)"
		>
			<header class="dt-carousel-head" @click="state.openRecord(record)">
				<h3 class="dt-card-title dt-carousel-title">{{ titleOf(record) || '—' }}</h3>
				<p v-if="text(record)" class="dt-carousel-text">{{ text(record) }}</p>
			</header>

			<div class="dt-carousel-stage">
				<template v-if="slidesOf(record).files.length">
					<button type="button" class="dt-carousel-nav dt-carousel-nav--prev" title="Previous" @click="go(record, -1, $event)"><DtIcon name="chevron-left" /></button>
					<img :src="src(slidesOf(record), slidesOf(record).index) ?? undefined" alt="" class="dt-carousel-img" />
					<button type="button" class="dt-carousel-nav dt-carousel-nav--next" title="Next" @click="go(record, 1, $event)"><DtIcon name="chevron-right" /></button>
					<span class="dt-carousel-counter">{{ slidesOf(record).index + 1 }} / {{ slidesOf(record).files.length }} · {{ slidesOf(record).files[slidesOf(record).index] }}</span>
				</template>
				<div v-else-if="slidesOf(record).loading" class="dt-carousel-empty"><DtIcon name="loading" /></div>
				<div v-else class="dt-carousel-empty">
					<DtIcon name="device-camera" />
					<span>{{ slidesOf(record).reason ?? 'no images' }}</span>
				</div>
			</div>

			<div v-if="slidesOf(record).files.length > 1" class="dt-carousel-strip">
				<button
					v-for="(f, i) in slidesOf(record).files"
					:key="f"
					type="button"
					class="dt-carousel-thumb"
					:class="{ 'is-current': i === slidesOf(record).index }"
					:title="f"
					@click="jump(record, i, $event)"
				>
					<img :src="src(slidesOf(record), i) ?? undefined" alt="" loading="lazy" />
				</button>
			</div>
		</article>
	</div>
</template>

<style scoped>
.dt-carousel-list { display: flex; flex-direction: column; gap: 16px; padding: 8px 0; }
.dt-carousel-card { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; outline: none; }
.dt-carousel-card:focus-visible { box-shadow: 0 0 0 2px var(--vscode-focusBorder, var(--dt-focus-ring)); }
.dt-carousel-head { cursor: pointer; }
.dt-carousel-title { margin: 0 0 4px; }
.dt-carousel-text { margin: 0; color: var(--vscode-descriptionForeground, var(--dt-fg-subtle)); font-size: 12.5px; line-height: 1.45; }
.dt-carousel-stage { position: relative; display: flex; align-items: center; justify-content: center; min-height: 160px; max-height: 60vh; background: var(--vscode-editorWidget-background, var(--dt-bg-subtle)); border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, var(--dt-border))); border-radius: 6px; overflow: hidden; }
.dt-carousel-img { max-width: 100%; max-height: 60vh; object-fit: contain; display: block; }
.dt-carousel-nav { position: absolute; top: 50%; transform: translateY(-50%); background: var(--vscode-button-secondaryBackground, var(--dt-bg-hover)); color: var(--vscode-button-secondaryForeground, var(--dt-fg)); border: none; border-radius: 999px; width: 30px; height: 30px; display: grid; place-items: center; cursor: pointer; opacity: 0.85; }
.dt-carousel-nav:hover { opacity: 1; }
.dt-carousel-nav--prev { left: 8px; }
.dt-carousel-nav--next { right: 8px; }
.dt-carousel-counter { position: absolute; bottom: 6px; right: 10px; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--vscode-badge-background, var(--dt-accent)); color: var(--vscode-badge-foreground, #ffffff); }
.dt-carousel-empty { display: flex; align-items: center; gap: 8px; padding: 24px; color: var(--vscode-descriptionForeground, var(--dt-fg-subtle)); font-size: 12px; }
.dt-carousel-strip { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; }
.dt-carousel-thumb { flex: 0 0 auto; width: 84px; height: 52px; padding: 0; border: 2px solid transparent; border-radius: 4px; overflow: hidden; background: var(--vscode-editorWidget-background, var(--dt-bg-subtle)); cursor: pointer; }
.dt-carousel-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dt-carousel-thumb.is-current { border-color: var(--vscode-focusBorder, var(--dt-focus-ring)); }
</style>
