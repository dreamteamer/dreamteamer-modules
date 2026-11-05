<!--
	Core map List (layouts wave): Leaflet + OSM tiles over the SAME BrowseState. Coordinates
	resolve per record from (in order): the `lat`/`lng` list options; numeric fields
	named lat/latitude + lng/lon/longitude; any object field carrying {lat,lng} keys. Records
	without coordinates are simply not plotted (count shown). CircleMarkers only — no icon assets to
	bundle.

	⚠ The empty states are THREE, and collapsing them is the bug this file shipped with: an empty
	collection is not a collection whose records lack coordinates, and telling the operator to add
	fields that already exist sends them to fix a schema that was never broken.
-->
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BrowseState } from '../composables/browse-state';
import { titleOf } from '../lib/record-title';
import type { ItemRecord } from '../api/types';
import DtIcon from '../components/DtIcon.vue';

const props = defineProps<{ state: BrowseState }>();

const LAT_NAMES = ['lat', 'latitude'];
const LNG_NAMES = ['lng', 'lon', 'long', 'longitude'];

function coordOf(r: ItemRecord): [number, number] | null {
	const o = props.state.listOptions.value['map'] ?? {};
	const latF = typeof o['lat'] === 'string' ? (o['lat'] as string) : LAT_NAMES.find((n) => typeof r[n] === 'number');
	const lngF = typeof o['lng'] === 'string' ? (o['lng'] as string) : LNG_NAMES.find((n) => typeof r[n] === 'number');
	if (latF && lngF && typeof r[latF] === 'number' && typeof r[lngF] === 'number')
		return [r[latF] as number, r[lngF] as number];
	for (const v of Object.values(r)) {
		if (v && typeof v === 'object' && !Array.isArray(v)) {
			const vv = v as Record<string, unknown>;
			if (typeof vv['lat'] === 'number' && typeof vv['lng'] === 'number')
				return [vv['lat'] as number, vv['lng'] as number];
		}
	}
	return null;
}

const plotted = computed(() =>
	props.state.items.items.value
		.map((r) => ({ r, coord: coordOf(r) }))
		.filter((x): x is { r: ItemRecord; coord: [number, number] } => x.coord !== null),
);

const mapEl = ref<HTMLElement | null>(null);
let map: L.Map | null = null;
let layer: L.LayerGroup | null = null;

// Default TRUE, and deliberately `!== false` rather than `?? true`: an option the operator has
// never touched is absent from the record, and absent must mean fit.
const autoFit = computed(() => (props.state.listOptions.value['map'] ?? {})['auto_fit'] !== false);

// The marker set we last fitted to. Refitting on EVERY render would yank the operator back to the
// bounding box every time anything re-renders, undoing a pan they just made — so fit when the
// points actually change, not when the component happens to run.
let lastFitKey = '';
// Whether a fit has ever landed at a real size. Until it has, a resize is not the operator adjusting
// the window — it is the container finally arriving — and it should re-drive the fit.
let everFitted = false;
let ro: ResizeObserver | null = null;

function render() {
	if (!map || !layer) return;
	layer.clearLayers();
	const pts = plotted.value;
	for (const { r, coord } of pts) {
		const m = L.circleMarker(coord, { radius: 8, weight: 2, color: '#6644ec', fillColor: '#6644ec', fillOpacity: 0.35 });
		m.bindTooltip(titleOf(r));
		m.on('click', () => props.state.openRecord(r));
		layer.addLayer(m);
	}
	// ⚠ ALWAYS before fitBounds. The container is `v-show`n, so on first paint Leaflet measured it
	// at 0×0 and cached that; fitting a bounding box into a zero-size viewport floors the zoom to 0,
	// which is the whole globe. Leaflet's own resize handler calls this too — but it does not refit,
	// which is why resizing the window produced a correctly-sized map still showing the world.
	map.invalidateSize();
	if (!pts.length) return;
	// ⚠ NEVER fit into a viewport that has not been laid out. Leaflet solves "what zoom shows this
	// box" against its cached size, so a container still at 0×0 — or at the few-pixel intermediate
	// the webview passes through — yields zoom 0, the whole globe. Bail; the ResizeObserver calls
	// us back the moment the element has a real size.
	const size = map.getSize();
	if (size.x < 50 || size.y < 50) return;
	const key = pts.map((p) => `${p.coord[0]},${p.coord[1]}`).join('|');
	if (!autoFit.value || key === lastFitKey) return;
	lastFitKey = key;
	everFitted = true;
	// maxZoom caps the degenerate case: fitting ONE point has no extent, so Leaflet goes to the
	// tile layer's maximum and lands on somebody's roof.
	map.fitBounds(L.latLngBounds(pts.map((p) => p.coord)).pad(0.2), { maxZoom: 14 });
}

onMounted(() => {
	if (!mapEl.value) return;
	map = L.map(mapEl.value, { zoomControl: true }).setView([32.08, 34.78], 8);
	L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '© OpenStreetMap',
	}).addTo(map);
	layer = L.layerGroup().addTo(map);
	render();
	// The load-bearing part. `onMounted` fires before the browser has laid the element out, and
	// switching Table→Map mounts with the records ALREADY loaded — so `plotted` never changes and
	// the watcher below never fires. That left exactly one render(), against a container of the
	// wrong size, which is why the map painted tiles into a small patch and showed the globe
	// (operator, 2026-08-11, with a screenshot). An observer removes the ordering question
	// entirely: whatever sequence mount / layout / data arrive in, the fit happens once the
	// element genuinely has a size.
	ro = new ResizeObserver((entries) => {
		if (!map) return;
		map.invalidateSize();
		const box = entries[0]?.contentRect;
		if (everFitted || !box || box.width < 50 || box.height < 50) return;
		lastFitKey = '';
		render();
	});
	ro.observe(mapEl.value);
});
// ⚠ `flush: 'post'` is load-bearing, not tidiness. A default (pre-flush) watcher runs BEFORE Vue
// applies the DOM update, so on the first tick that data arrives, render() ran while `v-show` still
// had the container at display:none — measuring 0×0 and fitting to the globe. Post-flush means the
// container is visible and has its real size by the time we measure it.
watch(plotted, render, { flush: 'post' });
watch(autoFit, () => { lastFitKey = ''; everFitted = false; render(); });
onBeforeUnmount(() => { ro?.disconnect(); ro = null; map?.remove(); });
</script>

<template>
	<div class="dt-map-wrap">
		<!-- THREE empty states, not one. `!plotted.length` was answering all of them with the
		     coordinates advice, so a collection with NO RECORDS was told to add lat/lng fields it
		     already had and point options it had already pointed — a misdiagnosis that reads as a
		     broken map (operator, 2026-08-11, twice). Same split ListCards/ListKanban already make. -->
		<div v-if="state.items.loading.value && !state.items.items.value.length" class="dt-empty">
			<DtIcon name="loading" />
			<p class="dt-empty__line">Loading…</p>
		</div>
		<div v-else-if="!state.items.items.value.length" class="dt-empty">
			<DtIcon name="inbox" />
			<p class="dt-empty__line">{{ state.hasActiveQuery.value ? 'No records match your search/filters' : 'No records yet' }}</p>
			<button v-if="!state.hasActiveQuery.value && !state.items.unavailable?.value" type="button" class="dt-btn dt-btn--sm" @click="state.createRecord()">Create record</button>
		</div>
		<!-- Only NOW is the coordinates advice true: records exist and none of them carry a position. -->
		<div v-else-if="!plotted.length" class="dt-empty">
			<DtIcon name="circle-slash" />
			<p class="dt-empty__line">
				{{ state.items.items.value.length }} records, none with coordinates — add numeric lat/lng fields
				(or an object field with lat+lng keys), or point Layout options (lat / lng) at yours
			</p>
		</div>
		<div v-show="plotted.length" ref="mapEl" class="dt-map"></div>
		<div v-if="plotted.length" class="dt-map-note">{{ plotted.length }} of {{ state.items.items.value.length }} records plotted</div>
	</div>
</template>

<style scoped>
.dt-map-wrap { display: flex; flex-direction: column; gap: 6px; }
.dt-map { height: 68vh; border: 1px solid var(--dt-border); border-radius: var(--dt-radius); }
.dt-map-note { font-size: var(--dt-text); color: var(--dt-fg-subtle); }
</style>
