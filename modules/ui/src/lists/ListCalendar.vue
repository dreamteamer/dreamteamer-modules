<!--
	Core calendar List (layouts wave): month grid over the SAME BrowseState the table renders.
	date field = the `start` list option, defaulting to the first `date` field, then the first
	`datetime` (every collection has `last_modified`, so the layout always renders something).
	Chips are records on that day; click opens the record. Month navigation is local state only —
	it never touches the shared browse query.
-->
<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BrowseState } from '../composables/browse-state';
import { titleOf } from '../lib/record-title';
import { rowContext } from '../lib/vscode-context';
import type { ItemRecord } from '../api/types';

const props = defineProps<{ state: BrowseState }>();

const dateField = computed<string | null>(() => {
	const opt = props.state.listOptions.value['calendar']?.['start'];
	if (typeof opt === 'string' && opt.length) return opt;
	const fields = props.state.fields.visibleFields.value;
	return (
		fields.find((f) => f.type === 'date')?.field ??
		fields.find((f) => f.type === 'datetime')?.field ??
		null
	);
});

const cursor = ref(startOfMonth(new Date()));

function startOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
	return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function dayKey(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const monthLabel = computed(() =>
	cursor.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
);

const byDay = computed<Map<string, ItemRecord[]>>(() => {
	const df = dateField.value;
	const out = new Map<string, ItemRecord[]>();
	if (!df) return out;
	for (const r of props.state.items.items.value) {
		const raw = r[df];
		if (typeof raw !== 'string' || raw.length < 10) continue;
		const key = raw.slice(0, 10);
		if (!out.has(key)) out.set(key, []);
		out.get(key)!.push(r);
	}
	return out;
});

interface Cell {
	key: string;
	day: number;
	inMonth: boolean;
	isToday: boolean;
	records: ItemRecord[];
}

const weeks = computed<Cell[][]>(() => {
	const first = cursor.value;
	// Monday-first grid
	const startOffset = (first.getDay() + 6) % 7;
	const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - startOffset);
	const todayKey = dayKey(new Date());
	const out: Cell[][] = [];
	for (let w = 0; w < 6; w++) {
		const row: Cell[] = [];
		for (let d = 0; d < 7; d++) {
			const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + w * 7 + d);
			const key = dayKey(date);
			row.push({
				key,
				day: date.getDate(),
				inMonth: date.getMonth() === first.getMonth(),
				isToday: key === todayKey,
				records: byDay.value.get(key) ?? [],
			});
		}
		out.push(row);
	}
	return out;
});

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
</script>

<template>
	<div v-if="!dateField" class="dt-empty">no date field to place records on — set one in Layout options (start)</div>
	<div v-else class="dt-cal">
		<div class="dt-cal-bar">
			<button class="dt-cal-nav" @click="cursor = addMonths(cursor, -1)">‹</button>
			<button class="dt-cal-nav" @click="cursor = startOfMonth(new Date())">today</button>
			<button class="dt-cal-nav" @click="cursor = addMonths(cursor, 1)">›</button>
			<span class="dt-cal-month">{{ monthLabel }}</span>
			<span class="dt-cal-field">on {{ dateField }}</span>
		</div>
		<div class="dt-cal-grid">
			<div v-for="wd in WEEKDAYS" :key="wd" class="dt-cal-weekday">{{ wd }}</div>
			<template v-for="(row, i) in weeks" :key="i">
				<div
					v-for="cell in row"
					:key="cell.key"
					class="dt-cal-cell"
					:class="{ 'is-out': !cell.inMonth, 'is-today': cell.isToday }"
				>
					<div class="dt-cal-day">{{ cell.day }}</div>
					<div
						v-for="r in cell.records.slice(0, 4)"
						:key="state.pkOf(r)"
						class="dt-cal-chip"
						:data-vscode-context="rowContext(state.collection, state.pkOf(r))"
						:title="titleOf(r)"
						@click="state.openRecord(r)"
					>
						{{ titleOf(r) }}
					</div>
					<div v-if="cell.records.length > 4" class="dt-cal-more">+{{ cell.records.length - 4 }} more</div>
				</div>
			</template>
		</div>
	</div>
</template>

<style scoped>
.dt-cal { display: flex; flex-direction: column; gap: 10px; }
.dt-cal-bar { display: flex; align-items: center; gap: 8px; }
.dt-cal-nav { background: var(--dt-bg-subtle); border: 1px solid var(--dt-border); border-radius: var(--dt-radius); color: var(--dt-fg); padding: 4px 12px; cursor: pointer; font-size: var(--dt-text); }
.dt-cal-nav:hover { border-color: var(--dt-border-strong); }
.dt-cal-month { font-size: var(--dt-text); font-weight: 600; margin-left: 6px; }
.dt-cal-field { color: var(--dt-fg-subtle); font-size: var(--dt-text); }
.dt-cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); border: 1px solid var(--dt-border); border-radius: var(--dt-radius); overflow: hidden; background: var(--dt-border); gap: 1px; }
.dt-cal-weekday { background: var(--dt-bg-subtle); padding: 6px 8px; font-size: var(--dt-label); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dt-fg-subtle); }
.dt-cal-cell { background: var(--dt-bg); min-height: 96px; padding: 6px; }
.dt-cal-cell.is-out { background: var(--dt-bg-subtle); opacity: 0.6; }
.dt-cal-cell.is-today .dt-cal-day { background: var(--dt-accent); color: #fff; }
.dt-cal-day { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 999px; font-size: var(--dt-text); margin-bottom: 4px; }
.dt-cal-chip { background: var(--dt-bg-subtle); border: 1px solid var(--dt-border); border-radius: 4px; padding: 2px 6px; margin-bottom: 3px; font-size: var(--dt-label); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dt-cal-chip:hover { border-color: var(--dt-accent); }
.dt-cal-more { font-size: var(--dt-label); color: var(--dt-fg-subtle); }
</style>
