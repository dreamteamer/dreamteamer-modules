<!--
	Filter-builder UI (C2 spec item 1): field pill + operator pill + value widget per rule, an
	ALL/ANY group-logic toggle, and add/remove-condition controls. Pure presentation over
	`lib/filter-query.ts`'s `FilterGroup`/`FilterRule` shape — every mutation re-emits a whole new
	group object (`update:modelValue`) rather than touching props in place, so the caller
	(BrowseView) owns the single source of truth and can compile/persist it however it likes.

	Browse-restyle (BROWSE wave): mounted as a popover under the browse header (BrowseView.vue)
	rather than an inline block — restyled onto `.dt-input`/`.dt-select`/`.dt-btn` tokens, no
	remaining hardcoded colors.

	Typed-widget wave (operator ask 2026-07-28, "many filter ui elements are just textbox when they
	can be selectboxes — see Directus, and probably can use the same UI as fields item edit"):
	the value slot no longer switches on `kindOfField` with its own hand-rolled inputs. It renders
	`RenderEdit` over a synthetic per-operator `FieldRow` (`lib/filter-widget.ts`), i.e. the SAME
	registry-resolved Edit component the item form uses — so a relation field filters with the
	record picker, an enum with its real choices, a date with the date control, and any Edit a
	module registers later shows up here for free. Directus does the same thing structurally
	(`interfaces/_system/system-filter/input-group.vue` renders the field's interface component as
	the value input); it derives the filter interface from the field's type rather than reusing
	`meta.interface` verbatim, and `filter-widget.ts` documents why we match that choice.

	Multi-value operators now get real controls too: `_in`/`_nin` render one widget per entry with a
	trailing blank adder (was: type a comma-separated string), and `_between`/`_nbetween` render two
	bounds — both mirroring Directus's `.list` / `and` layouts.
-->
<script setup lang="ts">
import { ref, watch } from 'vue';
import type { FieldRow } from '../api/types';
import { labelOf } from '../lib/format-title';
import { fieldValues } from '../composables/field-values';
import { filterValueField } from '../lib/filter-widget';
import {
	ALL_OPERATORS,
	emptyValueFor,
	kindOfField,
	newRule,
	operatorLabel,
	operatorsForField,
	operatorTakesList,
	operatorTakesPair,
	operatorTakesValue,
	valueList,
	type FilterGroup,
	type FilterRule,
} from '../lib/filter-query';
import RenderEdit from './render/RenderEdit.vue';
import FilterFieldPicker from './FilterFieldPicker.vue';
import DtSelect from './DtSelect.vue';
import { loadFields, loadRelations } from '../composables/fields';
import { collectionsAlongPath, resolvePathTarget } from '../lib/filter-field-tree';
import DtIcon from './DtIcon.vue';

const props = defineProps<{
	modelValue: FilterGroup;
	fields: FieldRow[];
	/** `useFields(collection).relationTargets` — lets the relation picker skip its own lookup. */
	relationTargets?: Map<string, string>;
	/** Which collection is being filtered — needed to look up a field's real value vocabulary. */
	collection?: string;
}>();

const emit = defineEmits<{ 'update:modelValue': [group: FilterGroup] }>();

// ---- resolving a PATH's leaf ------------------------------------------------------------------
//
// ⚠ A condition's field is a PATH now (`person.name`), and EVERYTHING downstream of the field pill
// resolves against its LEAF: the operator list, the value widget, the relation target. Looking
// `person.name` up in this collection's own rows finds nothing, which degrades to "every operator,
// no value widget" — a condition you can neither complete nor see. So the rows of the collections a
// path traverses are fetched on demand and cached here.
const relations = ref<Record<string, string>>({});
const rowsByCollection = ref<Record<string, FieldRow[]>>({});

const relationOf = (collection: string, field: string) => relations.value[`${collection} ${field}`];

void loadRelations().then((list) => {
	const next: Record<string, string> = {};
	for (const r of list) if (r.related_collection) next[`${r.collection} ${r.field}`] = r.related_collection;
	relations.value = next;
});

/** Fetch the rows for every collection the current conditions' paths pass through. */
watch(
	() => [props.collection, props.modelValue.rules.map((r) => r.field).join('|'), Object.keys(relations.value).length] as const,
	async () => {
		if (!props.collection) return;
		const wanted = new Set<string>();
		for (const rule of props.modelValue.rules) {
			if (!rule.field.includes('.')) continue;
			for (const c of collectionsAlongPath(rule.field, props.collection, relationOf)) wanted.add(c);
		}
		const missing = [...wanted].filter((c) => c !== props.collection && !rowsByCollection.value[c]);
		if (!missing.length) return;
		const loaded = await Promise.all(missing.map(async (c) => [c, await loadFields(c)] as const));
		rowsByCollection.value = { ...rowsByCollection.value, ...Object.fromEntries(loaded) };
	},
	{ immediate: true },
);

/** The field row a condition's path actually names — its leaf. */
function fieldRow(path: string): FieldRow | undefined {
	if (!path) return undefined;
	if (!path.includes('.')) return props.fields.find((f) => f.field === path);
	const leaf = resolvePathTarget(path, props.collection ?? '', relationOf);
	if (!leaf) return undefined;
	const rows = leaf.collection === props.collection ? props.fields : rowsByCollection.value[leaf.collection];
	return rows?.find((f: FieldRow) => f.field === leaf.field);
}

/** The operator pill's options — labelled, so the dropdown reads "is any of" not "_in". */
function operatorChoices(rule: FilterRule) {
	return operatorsFor(rule).map((op) => ({ text: operatorLabel(op), value: op }));
}

function operatorsFor(rule: FilterRule): readonly string[] {
	const row = fieldRow(rule.field);
	return row ? operatorsForField(row) : ALL_OPERATORS;
}

/** The synthetic single-value `FieldRow` this rule's value widget(s) render from. */
function valueField(rule: FilterRule): FieldRow | null {
	const row = fieldRow(rule.field);
	if (!row) return null;
	// A plain string field gets the vocabulary its records actually use, so `status` filters with a
	// dropdown instead of a text box you have to know by heart. Reading the ref here makes this
	// computed-reactive: the widget flips from input to select when the fetch resolves.
	// The derived vocabulary comes from the collection the LEAF lives in, asked for the leaf's own
	// field name — `GET /collections/family%2Fpeople/values/name`, not `…/lab-results/values/person.name`,
	// which names no field and would come back empty.
	const leaf = rule.field.includes('.') ? resolvePathTarget(rule.field, props.collection ?? '', relationOf) : null;
	const valuesCollection = leaf?.collection ?? props.collection;
	const valuesField = leaf?.field ?? rule.field;
	const derived = valuesCollection && kindOfField(row) === 'string' ? fieldValues(valuesCollection, valuesField).value : null;
	return filterValueField(row, rule.operator, derived);
}

/**
 * Relation target for the value picker — the collection whose RECORDS this condition compares
 * against. For a path it is the leaf's own target (`person.gp` picks a doctor), which the parent's
 * `relationTargets` map cannot know: that map only covers the root collection's own fields.
 */
function targetFor(rule: FilterRule): string | undefined {
	if (!rule.field.includes('.')) return props.relationTargets?.get(rule.field);
	const leaf = resolvePathTarget(rule.field, props.collection ?? '', relationOf);
	return leaf ? relationOf(leaf.collection, leaf.field) : undefined;
}

function isBlank(value: unknown): boolean {
	return value === '' || value === null || value === undefined;
}

/**
 * A blank starting value for (field, operator). Booleans start at `true` rather than blank: the
 * switch has no third state to show "unset", so a blank boolean rule looks identical to `is false`
 * while silently compiling to nothing.
 */
function startValue(row: FieldRow | undefined, operator: string): unknown {
	if (row && kindOfField(row) === 'boolean' && operator !== '_null' && operator !== '_nnull') return true;
	return emptyValueFor(operator);
}

function setLogic(logic: FilterGroup['logic']): void {
	emit('update:modelValue', { ...props.modelValue, logic });
}

/**
 * The group as it stands, INCLUDING edits emitted this tick that the prop has not caught up with.
 *
 * ⚠ Two updates in one tick used to lose the first. `setPairValue` reads the rule's current value,
 * patches one bound and emits — but a prop does not update synchronously, so a second call in the
 * same tick re-read the ORIGINAL value and clobbered the first bound. `_between` then had one bound
 * blank, and `compileFilter` drops an incomplete pair, so the whole condition vanished with no
 * message: the table showed every row while the panel showed a condition. Found by driving both
 * bounds programmatically; a human typing them a second apart never hits it, which is exactly why it
 * would have survived any amount of manual testing.
 */
const pending = ref<FilterGroup | null>(null);
watch(() => props.modelValue, () => { pending.value = null; });
const groupNow = () => pending.value ?? props.modelValue;

function updateRule(id: string, patch: Partial<FilterRule>): void {
	const current = groupNow();
	const rules = current.rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
	const next = { ...current, rules };
	pending.value = next;
	emit('update:modelValue', next);
}

/** Changing the field resets operator (to the new field's first valid one) and value — an old value/operator pair rarely makes sense for a different field's kind. */
function onFieldChange(rule: FilterRule, field: string): void {
	const row = fieldRow(field);
	const ops = row ? operatorsForField(row) : ALL_OPERATORS;
	const operator = ops.includes(rule.operator) ? rule.operator : (ops[0] ?? '_eq');
	updateRule(rule.id, { field, operator, value: startValue(row, operator) });
}

function onOperatorChange(rule: FilterRule, operator: string): void {
	updateRule(rule.id, { operator, value: startValue(fieldRow(rule.field), operator) });
}

// ---- multi-value plumbing ---------------------------------------------------------------------

/** Entered values plus ONE trailing blank slot — the adder, exactly as Directus's `_in` list does. */
function listSlots(rule: FilterRule): unknown[] {
	return [...valueList(rule.value), null];
}

function setListValue(rule: FilterRule, index: number, value: unknown): void {
	const list = valueList(ruleNow(rule).value);

	if (index >= list.length) {
		// The trailing adder: a real value appends a new entry, a blank one is a no-op.
		if (isBlank(value)) return;
		updateRule(rule.id, { value: [...list, value] });
		return;
	}

	// Clearing an existing entry removes it rather than leaving a hole the compiler has to filter.
	const next = [...list];
	if (isBlank(value)) next.splice(index, 1);
	else next[index] = value;
	updateRule(rule.id, { value: next });
}

/** The rule as it stands right now — see `pending`. */
function ruleNow(rule: FilterRule): FilterRule {
	return groupNow().rules.find((r) => r.id === rule.id) ?? rule;
}

function removeListValue(rule: FilterRule, index: number): void {
	const next = valueList(rule.value);
	next.splice(index, 1);
	updateRule(rule.id, { value: next });
}

function pairAt(rule: FilterRule, index: number): unknown {
	return Array.isArray(rule.value) ? (rule.value[index] ?? '') : '';
}

function setPairValue(rule: FilterRule, index: number, value: unknown): void {
	const live = ruleNow(rule).value;
	const pair: unknown[] = Array.isArray(live) ? [...live] : [];
	while (pair.length < 2) pair.push('');
	pair[index] = value;
	updateRule(rule.id, { value: pair });
}

// ---- rules ------------------------------------------------------------------------------------

function addRule(): void {
	const first = props.fields[0];
	const operator = first ? (operatorsForField(first)[0] ?? '_eq') : '_eq';
	const rule = newRule({ field: first?.field ?? '', operator, value: startValue(first, operator) });
	emit('update:modelValue', { ...props.modelValue, rules: [...props.modelValue.rules, rule] });
}

function removeRule(id: string): void {
	emit('update:modelValue', { ...props.modelValue, rules: props.modelValue.rules.filter((r) => r.id !== id) });
}
</script>

<template>
	<div class="dt-filter-builder">
		<div v-if="modelValue.rules.length > 1" class="dt-filter-logic">
			<span>Match</span>
			<button type="button" class="dt-filter-logic-btn" :class="{ active: modelValue.logic === '_and' }" @click="setLogic('_and')">All</button>
			<button type="button" class="dt-filter-logic-btn" :class="{ active: modelValue.logic === '_or' }" @click="setLogic('_or')">Any</button>
			<span>of the following</span>
		</div>

		<p v-if="!modelValue.rules.length" class="dt-filter-empty">No conditions yet.</p>

		<div v-for="rule in modelValue.rules" :key="rule.id" class="dt-filter-rule">
				<FilterFieldPicker
					class="dt-filter-field"
					:model-value="rule.field"
					:collection="collection ?? ''"
					:fields="fields"
					@update:model-value="onFieldChange(rule, $event)"
				/>

				<DtSelect
					class="dt-filter-op"
					:model-value="rule.operator"
					:choices="operatorChoices(rule)"
					aria-label="Operator"
					@update:model-value="onOperatorChange(rule, String($event))"
				/>


			<template v-if="valueField(rule) && operatorTakesValue(rule.operator)">
				<!-- `_in` / `_nin`: one real widget per entry, plus a blank one to add the next. -->
				<div v-if="operatorTakesList(rule.operator)" class="dt-filter-values">
					<div v-for="(entry, index) in listSlots(rule)" :key="index" class="dt-filter-value-slot">
						<div class="dt-filter-value-control">
							<RenderEdit
								:field="valueField(rule)!"
								:value="entry"
								:target-collection="targetFor(rule)"
								@update:value="setListValue(rule, index, $event)"
							/>
						</div>
						<button
							v-if="index < listSlots(rule).length - 1"
							type="button"
							class="dt-filter-remove"
							aria-label="Remove value"
							@click="removeListValue(rule, index)"
						>
							<DtIcon name="close" />
						</button>
					</div>
				</div>

				<!-- `_between` / `_nbetween`: exactly two bounds. -->
				<div v-else-if="operatorTakesPair(rule.operator)" class="dt-filter-values dt-filter-values--pair">
					<div class="dt-filter-value-slot">
						<div class="dt-filter-value-control">
							<RenderEdit :field="valueField(rule)!" :value="pairAt(rule, 0)" :target-collection="targetFor(rule)" @update:value="setPairValue(rule, 0, $event)" />
						</div>
					</div>
					<span class="dt-filter-and">and</span>
					<div class="dt-filter-value-slot">
						<div class="dt-filter-value-control">
							<RenderEdit :field="valueField(rule)!" :value="pairAt(rule, 1)" :target-collection="targetFor(rule)" @update:value="setPairValue(rule, 1, $event)" />
						</div>
					</div>
				</div>

				<div v-else class="dt-filter-values">
					<div class="dt-filter-value-slot">
						<div class="dt-filter-value-control">
							<RenderEdit
								:field="valueField(rule)!"
								:value="rule.value"
								:target-collection="targetFor(rule)"
								@update:value="updateRule(rule.id, { value: $event })"
							/>
						</div>
					</div>
				</div>
			</template>

			<button type="button" class="dt-filter-remove dt-filter-remove--rule" aria-label="Remove condition" @click="removeRule(rule.id)">
				<DtIcon name="close" />
			</button>
		</div>

		<button type="button" class="dt-btn dt-btn--secondary dt-btn--sm dt-filter-add" @click="addRule">
			<DtIcon name="add" />
			Add condition
		</button>
	</div>
</template>

<style scoped>
.dt-filter-builder {
	display: flex;
	flex-direction: column;
	gap: 10px;
}
.dt-filter-logic {
	display: flex;
	align-items: center;
	gap: 6px;
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
}
.dt-filter-logic-btn {
	border: 1px solid var(--dt-border-strong);
	background: var(--dt-bg);
	color: var(--dt-fg);
	border-radius: 999px;
	padding: 2px 10px;
	font-size: var(--dt-text);
	cursor: pointer;
}
.dt-filter-logic-btn.active {
	background: var(--dt-accent);
	border-color: var(--dt-accent);
	color: #fff;
}
.dt-filter-empty {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
}

/* A rule is two lines — field/operator on top, value(s) below — so a wide control (a relation
   picker, a stack of `_in` entries) has the full panel width instead of being squeezed into the
   tail of a single row. */
/* ONE ROW per rule (operator 2026-07-28: "can keep each filter rule one row"): field,
   operator, value and the remove button sit on a single line. The value column is what flexes —
   `_in` stacks its entries and `_between` lays its two bounds side by side INSIDE that column, so
   a multi-value rule grows taller without ever pushing the field/operator selects onto a second
   row. `align-items: flex-start` keeps the selects pinned to the top when it does. */
.dt-filter-rule {
	display: flex;
	flex-direction: row;
	/* Wraps so the field picker's tree, which is in flow rather than floating (see
	   FilterFieldPicker's header), can take a full row instead of squeezing the pills beside it. */
	flex-wrap: wrap;
	align-items: flex-start;
	gap: var(--dt-space-1);
	padding: var(--dt-space-1);
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
}
.dt-filter-field {
	flex: 0 1 30%;
	min-width: 0;
	min-height: var(--dt-control-height);
}
.dt-filter-op {
	flex: 0 1 26%;
	min-width: 0;
	min-height: var(--dt-control-height);
}
/* the value column absorbs the remaining width */
.dt-filter-rule > .dt-filter-values {
	flex: 1 1 auto;
	min-width: 0;
}
/* pushed to the row end; stays aligned with the selects rather than the tallest value slot */
.dt-filter-remove--rule {
	margin-left: auto;
	height: var(--dt-control-height);
}

.dt-filter-values {
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.dt-filter-values--pair {
	flex-direction: row;
	align-items: center;
}
.dt-filter-values--pair .dt-filter-value-slot {
	flex: 1 1 0;
}
.dt-filter-and {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
}
/* Each slot is the flex row holding one value control next to its remove button. The control gets
   its own plain block wrapper rather than being the flex item itself: `.dt-input`/`.dt-select` are
   `width: 100%` and fill it, while a naturally-narrow Edit keeps its intrinsic size (the boolean
   switch is 44px wide — as a flex item with `flex: 1 1 auto` it stretched across the whole panel). */
.dt-filter-value-slot {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
}
.dt-filter-value-control {
	flex: 1 1 auto;
	min-width: 0;
}

.dt-filter-remove {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	border: none;
	background: none;
	color: var(--dt-fg-subtle);
	cursor: pointer;
	padding: 2px;
}
.dt-filter-remove .codicon {
	font-size: var(--dt-icon);
}
.dt-filter-remove:hover {
	color: var(--dt-danger);
}
.dt-filter-add {
	align-self: flex-start;
}
</style>
