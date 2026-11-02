<!--
	The `stage-checks` View: a many-valued tags field whose collection declared its stages
	(`viewer_options.stages`, read by `lib/stage-checks.ts`). One slot per stage, in declared order, of
	one width so the stages line up down a column — empty while the stage is not tagged, one check when
	it is, two once a review of the stage exists, green when it approves with no open finding, orange
	when it left remarks — the review's description in the hover, which is also the slot's accessible
	name. Tags that are not a stage follow as chips, as ViewTags draws them.

	It needs the ROW to place a review (`self`, the subject fields, the dates): RenderView hands
	`record` to a View that declares it. Without one it draws tag-only and asks the host nothing. The
	reviews come through `lib/stage-reviews.ts` — one batched request per list, re-read whenever the
	host invalidates.
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FieldRow } from '../api/types';
import DtIcon from '../components/DtIcon.vue';
import { bareRef, candidateSubjects, freeTags, stageCheck, stageChecksSpec, type Review, type StageCheck } from '../lib/stage-checks';
import { openFindingsFor, reviewsFor, stageReviewsRevision } from '../lib/stage-reviews';

const props = defineProps<{
	value: unknown;
	field: FieldRow;
	options?: Record<string, unknown>;
	record?: Record<string, unknown> | null;
	context?: 'cell' | 'record';
}>();

const MAX_CHIPS = 3;
const spec = computed(() => stageChecksSpec(props.options ?? props.field.viewer_options));
const self = computed(() => {
	const id = props.record?.['id'];
	return props.record && props.field.collection && id != null && id !== '' ? `${props.field.collection}/${bareRef(String(id))}` : null;
});

const reviews = ref<Review[]>([]);
const openFindings = ref(new Map<string, number>());
const unread = ref(false);
let seq = 0;

async function load(): Promise<void> {
	const mine = ++seq;
	const s = spec.value;
	const tagged = s?.stages.some((st) => Array.isArray(props.value) && props.value.includes(st.tag));
	if (!s || !s.reviewsFrom || !props.record || !self.value || !tagged) {
		reviews.value = [];
		openFindings.value = new Map();
		return;
	}
	try {
		const found = await reviewsFor(s.reviewsFrom, candidateSubjects(s, props.record, self.value));
		const counts = s.findingsFrom ? await openFindingsFor(s.findingsFrom, s.reviewsFrom, found.map((r) => r.id)) : new Map<string, number>();
		if (mine !== seq) return;
		reviews.value = found;
		openFindings.value = counts;
		unread.value = false;
	} catch {
		if (mine !== seq) return;
		reviews.value = [];
		openFindings.value = new Map();
		unread.value = true;
	}
}
watch([() => props.value, () => props.record, spec, stageReviewsRevision], () => void load(), { immediate: true });

const checks = computed<StageCheck[]>(() => {
	const s = spec.value;
	if (!s) return [];
	const readable = !!s.reviewsFrom && !unread.value;
	return s.stages.map((st) => {
		const c = stageCheck(st, props.value, readable ? (props.record ?? null) : null, readable ? self.value : null, reviews.value, openFindings.value);
		return unread.value && c.state !== 'none' ? { ...c, label: `${st.title} — tagged (reviews could not be read)` } : c;
	});
});
const chips = computed(() => (spec.value ? freeTags(props.value, spec.value) : []));
const visibleChips = computed(() => chips.value.slice(0, MAX_CHIPS));
const overflow = computed(() => Math.max(0, chips.value.length - MAX_CHIPS));
const iconOf = (c: StageCheck) => (c.state === 'none' ? null : c.state === 'done' ? 'check' : 'check-all');
</script>

<template>
	<span class="dt-stage-checks">
		<span
			v-for="c in checks"
			:key="c.stage.tag"
			class="dt-stage-check"
			:class="{ 'is-approved': c.state === 'approved', 'is-remarks': c.state === 'remarks' }"
			:data-stage="c.stage.tag"
			:data-state="c.state"
			:role="c.state === 'none' ? undefined : 'img'"
			:title="c.label || undefined"
			:aria-label="c.label || undefined"
			:aria-hidden="c.state === 'none' ? 'true' : undefined"
		><DtIcon v-if="iconOf(c)" :name="iconOf(c)" /></span>
		<span v-for="tag in visibleChips" :key="tag" class="dt-chip dt-chip--sm">{{ tag }}</span>
		<span v-if="overflow > 0" class="dt-stage-checks-overflow">+{{ overflow }}</span>
	</span>
</template>

<style scoped>
.dt-stage-checks {
	display: inline-flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 4px;
}
/* one width per slot, so the stages line up down a column whatever is reached */
.dt-stage-check {
	display: inline-flex;
	justify-content: center;
	width: 16px;
	color: var(--vscode-descriptionForeground, var(--dt-fg-subtle));
}
.dt-stage-check.is-approved {
	color: var(--vscode-charts-green, var(--dt-color-charts-green, var(--dt-unknown-color)));
}
.dt-stage-check.is-remarks {
	color: var(--vscode-charts-orange, var(--dt-color-charts-orange, var(--dt-unknown-color)));
}
.dt-stage-checks-overflow {
	font-size: var(--dt-label);
	color: var(--dt-fg-subtle);
}
</style>
