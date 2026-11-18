<!--
	Field drawer (contract C3, schema-designer facelift). The right-drawer field editor mounted by
	the Designer (Agent D's DataModelDetail) on the DtDrawer primitive (C4). Four tabs —

	The Relationship tab authors BOTH SIDES of a two-way link, from whichever side is open. It asks
	one question the operator can actually answer — WHERE THE LINK IS KEPT, on each <this> or on each
	<target> — and everything else follows from it and from the field's own type:

	    Where the link is kept
	      ( ) on each meeting — this field holds it
	      (o) on each summary — a field on summaries points back here
	          Field on summaries  [ meeting ]
	    Each meeting has at most one summary, and each summary at most one meeting.
	    When a meeting is deleted   (o) Refuse   ( ) Clear the link

	There is no cardinality picker, because cardinality is not a separate question: with the key
	here, a scalar is many-to-one (unique makes it one-to-one) and a list is many-to-many; with the
	key on the target, a list here is one-to-many and a single reference is one-to-one. The default
	side follows the type (`defaultLinkSide`), so declaring the common shape is one field and a name.

	⚠ NOTHING HERE NAMES A DESCRIPTOR KEYWORD, and no control says which side "owns" the relation.
	Storage ownership is the engine's business: lib/field-def.ts turns `link_side`/`far_field`/
	`unique`/`on_delete` into the one v2 relation spelling (`mirror_of` on the far side, `unique` on
	the key), and composables/designer-state.ts writes the far side too.

	Field / Edit / View / Relationship — all mutate a LOCAL draft (a deep copy of the field's `def`
	taken on open; fresh `{ type: 'string' }` for a new field). NOTHING here hits the server: the
	footer's Apply emits `('apply', StagedField)` for the Designer to stage into `useDesignerState`,
	and Cancel just closes. This mirrors FieldEditorDialog's old type-filter + kind-default logic
	(that component is deleted by this task) but stages instead of POST/PATCHing, and adds the View
	`recommendedViews` sort and the relation display-template surface.

	Picker filtering (ported from FieldEditorDialog `optionsFor`): a registry entry is offered when
	its `types` array includes the field type's compiled WIRE type, or is empty (opt-in-only entries
	like `list`/`relation-picker`/`file` are never excluded by type). The kind default (from the
	registry's `kindDefaultEdits`/`kindDefaultViews` maps, with relation/list overrides) is marked
	with a ★; the View picker additionally sorts the chosen Edit's `recommendedViews` to the top.
	Every per-Edit / per-View option panel is drawn by the shared OptionsForm from the entry's
	declared `options: OptionFieldDef[]` — never hand-built.
-->
<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRaw, watch } from 'vue';
import DtDrawer from '../DtDrawer.vue';
import OptionsForm from '../render/OptionsForm.vue';
import { edits, views, kindDefaultEdits, kindDefaultViews, type OptionFieldDef } from '../../registry/index';
import { useCollections } from '../../composables/collections';
import { loadAllFields } from '../../composables/fields';
import { isUserCollection } from '../../lib/okf';
import { slugify } from '../../lib/slugify';
import { templateFields as fieldsNamedIn } from '../../lib/template';
import {
	baseNameOf,
	cardinalityOf,
	defaultForeignKeyName,
	defaultInverseName,
	defaultLinkSide,
	deleteRuleTarget,
	describeLink,
	isMirrorField,
	singularOf,
	type LinkSide,
} from '../../lib/relation-meta';
import type { FieldRow } from '../../api/types';
import { isRelationField, isRelationList } from '../../lib/field-row';
import type { StagedField } from '../../composables/designer-state';
import DtSelect from '../DtSelect.vue';
import FieldDisplayKeys from './FieldDisplayKeys.vue';

const props = defineProps<{
	collection: string;
	/** The field being edited; `null` = "new field" mode. */
	field: StagedField | null;
	/** All staged field keys (incl. implicit) — new-field mode blocks Apply on a collision. */
	existingKeys?: string[];
	open: boolean;
}>();

const emit = defineEmits<{
	close: [];
	/** Stage into designer-state — NEVER hits the server (C3). */
	apply: [field: StagedField];
}>();

// ---- descriptor type vocabulary ----------------------------------------------------------------
// The descriptor `type`s the drawer offers (descriptor v2 §3.4.1), with display labels.
const TYPES: { id: string; label: string }[] = [
	{ id: 'string', label: 'String' },
	{ id: 'markdown', label: 'Markdown' },
	{ id: 'number', label: 'Number' },
	{ id: 'integer', label: 'Integer' },
	{ id: 'boolean', label: 'Boolean' },
	{ id: 'date', label: 'Date' },
	{ id: 'datetime', label: 'Datetime' },
	{ id: 'relation', label: 'Relation' },
	// ⚠ A LIST OF REFERENCES NEEDS ITS OWN ENTRY, and its absence was a hole in the drawer rather than
	// a styling nit: `list` alone stages `{type: 'list'}` with no `of`, which is a list of STRINGS, and
	// the Relationship tab keys off `of: 'relation'` — so the tab never appeared and no list-shaped
	// relation could be authored here at all. Every one of this vault's ten relations has a list on one
	// side. It is a DISPLAY id only: the staged def stays `{type: 'list', of: 'relation'}`, which is
	// what `lib/field-def.ts` reads.
	{ id: 'relation-list', label: 'Relation (many)' },
	{ id: 'list', label: 'List' },
	{ id: 'object', label: 'Object' },
];

// descriptor type -> the display contract's WIRE type, used to pick which registered Edits/Views
// are kind-appropriate (matches register-defaults.ts's `types` arrays). Only the drawer's own display
// ids need an entry — a relation travels as a string, and so does each item of a list of strings;
// every authored type name falls through to itself via `wireOf`.
const TYPE_WIRE: Record<string, string> = {
	relation: 'string',
	'relation-list': 'string',
	list: 'string',
	tags: 'string',
};
function wireOf(type: string): string {
	return TYPE_WIRE[type] ?? type;
}


// Literal mustache example shown in the Relationship-tab hint. Kept in script (not inline in the
// template) because `{{ '{{ name }}' }}` trips the Vue template parser (unterminated-string).
const TEMPLATE_EXAMPLE = '{{ name }}';

// ---- local draft --------------------------------------------------------------------------------
// `def` holds the C1 entry shape (descriptor def minus "field"). Deep-cloned on open so nothing
// mutates the caller's StagedField until Apply.
const draft = reactive<{ key: string; def: Record<string, unknown> }>({ key: '', def: { type: 'string' } });
const activeTab = ref<'field' | 'edit' | 'view' | 'relationship'>('field');

// Guards the option-pruning watchers below against firing during drawer open / draft init (a fresh
// draft legitimately carries option keys that must NOT be wiped). Cleared after the reset's reactive
// fallout has flushed. Only genuine user-driven picker/type changes prune.
let initializing = false;

function reset(): void {
	initializing = true;
	if (props.field) {
		draft.key = props.field.key;
		draft.def = structuredClone(toRaw(props.field.def));
	} else {
		draft.key = '';
		draft.def = { type: 'string' };
	}
	activeTab.value = 'field';
	void nextTick(() => {
		initializing = false;
	});
}

watch(
	() => props.open,
	(open) => {
		if (open) reset();
	},
	{ immediate: true },
);

const isEditing = computed(() => props.field !== null);
const drawerTitle = computed(() => (isEditing.value ? `Edit field: ${props.field?.key}` : 'New field'));
const keySlug = computed(() => slugify(draft.key));

// ---- def property proxies (empty/false -> delete key, keeping the descriptor minimal) ----------
function defStr(key: string) {
	return computed<string>({
		get: () => (typeof draft.def[key] === 'string' ? (draft.def[key] as string) : ''),
		set: (v) => {
			if (v === '' || v == null) delete draft.def[key];
			else draft.def[key] = v;
		},
	});
}
function defBool(key: string) {
	return computed<boolean>({
		get: () => draft.def[key] === true,
		set: (v) => {
			if (v) draft.def[key] = true;
			else delete draft.def[key];
		},
	});
}

/** Does the staged def say "a list of references"? `of` arrives as `'relation'` from the drawer and as
 *  `{type: 'relation'}` from some registry round-trips, so both spellings answer yes. */
function holdsRelations(def: Record<string, unknown>): boolean {
	const of = def['of'];
	return of === 'relation' || (of !== null && typeof of === 'object' && (of as Record<string, unknown>)['type'] === 'relation');
}

const typeModel = computed<string>({
	get: () => {
		const raw = typeof draft.def['type'] === 'string' ? (draft.def['type'] as string) : 'string';
		if (raw === 'list' && holdsRelations(draft.def)) return 'relation-list';
		return raw;
	},
	set: (v) => {
		// `relation-list` is a display id; the def keeps the shape `lib/field-def.ts` reads.
		if (v === 'relation-list') {
			draft.def['type'] = 'list';
			draft.def['of'] = 'relation';
			return;
		}
		draft.def['type'] = v;
		if (v !== 'list') delete draft.def['of'];
	},
});
const requiredModel = defBool('required');
const descriptionModel = defStr('description');

// ---- display keys (§3.4.2) ------------------------------------------------------------------------
// What `form_section` may name — the collection's own `display.form.sections` — and what
// `unit_field` may name: the collection's other fields.
const formSections = computed(() => (tree.value.find((r) => r.collection === props.collection)?.form.sections ?? []).map((s) => s.title));
const siblingFields = computed(() => (props.existingKeys ?? []).filter((k) => k !== (props.field?.key ?? keySlug.value)));
const editModel = defStr('editor');
const viewModel = defStr('viewer');

// ---- kind defaults ------------------------------------------------------------------------------
function defaultEditId(type: string): string {
	if (type === 'relation') return 'relation-picker';
	if (type === 'list' || type === 'relation-list') return 'list';
	return kindDefaultEdits[wireOf(type)] ?? 'input';
}
function defaultViewId(type: string): string {
	if (type === 'relation' || type === 'relation-list') return 'relation';
	return kindDefaultViews[wireOf(type)] ?? 'text';
}

const wireType = computed(() => wireOf(typeModel.value));

// The 10 offered types, plus the field's CURRENT type if designer-state handed back a wire form
// outside the list (a loaded `timestamp`/`uuid` field) — so the select never renders blank.
const typeOptions = computed(() => {
	const list = [...TYPES];
	if (typeModel.value && !list.some((t) => t.id === typeModel.value)) {
		list.unshift({ id: typeModel.value, label: typeModel.value });
	}
	return list;
});

const defaultEdit = computed(() => defaultEditId(typeModel.value));
const defaultView = computed(() => defaultViewId(typeModel.value));

/** The Edit actually in effect (explicit choice, else the kind default) — drives the View
 *  picker's `recommendedViews` sort and the option panel below each picker. */
const chosenEditId = computed(() => editModel.value || defaultEdit.value);
const chosenViewId = computed(() => viewModel.value || defaultView.value);

// ---- stale option-key pruning (only on genuine user-driven change; see `initializing`) ----------
// A different Edit panel owns a different option shape, so switching Edits drops the old panel's keys.
watch(chosenEditId, (next, prev) => {
	if (initializing || next === prev) return;
	delete draft.def['editor_options'];
});
// Switching Views likewise drops the old View panel's keys — but `template` lives in view_options and
// belongs to the Relationship tab, not the View panel, so it survives.
watch(chosenViewId, (next, prev) => {
	if (initializing || next === prev) return;
	const vo = draft.def['viewer_options'] as Record<string, unknown> | undefined;
	const template = vo?.['template'];
	if (typeof template === 'string' && template) draft.def['viewer_options'] = { template };
	else delete draft.def['viewer_options'];
});
// Leaving relation/list drops the now-meaningless relationship keys (target / of / the display template).
watch(typeModel, (next, prev) => {
	if (initializing || next === prev) return;
	if (next === 'relation' || next === 'relation-list' || next === 'list') return;
	delete draft.def['target'];
	delete draft.def['of'];
	const vo = draft.def['viewer_options'] as Record<string, unknown> | undefined;
	if (vo && 'template' in vo) {
		const rest = { ...vo };
		delete rest['template'];
		if (Object.keys(rest).length) draft.def['viewer_options'] = rest;
		else delete draft.def['viewer_options'];
	}
});

// ---- Edit picker + option panel ----------------------------------------------------------------
const editEntries = computed(() =>
	edits
		.all()
		.filter((e) => e.types.length === 0 || e.types.includes(wireType.value))
		.map((e) => ({ id: e.id, name: e.name, star: e.id === defaultEdit.value })),
);
const editOptionDefs = computed<OptionFieldDef[]>(() => edits.get(chosenEditId.value)?.options ?? []);
const editOptionsModel = computed<Record<string, unknown>>(() => (draft.def['editor_options'] as Record<string, unknown>) ?? {});
function setEditOptions(value: Record<string, unknown>): void {
	if (Object.keys(value).length) draft.def['editor_options'] = value;
	else delete draft.def['editor_options'];
}

// ---- View picker + option panel ----------------------------------------------------------------
const recommendedViews = computed(() => edits.get(chosenEditId.value)?.recommendedViews ?? []);
function viewRank(id: string): number {
	const ri = recommendedViews.value.indexOf(id);
	if (ri >= 0) return ri; // recommended first, in declared order
	if (id === defaultView.value) return 100; // then the kind default
	return 200; // then the rest
}
const viewEntries = computed(() =>
	views
		.all()
		.filter((v) => v.types.length === 0 || v.types.includes(wireType.value))
		.map((v) => ({ id: v.id, name: v.name, star: v.id === defaultView.value, rank: viewRank(v.id) }))
		.sort((a, b) => a.rank - b.rank),
);
const viewOptionDefs = computed<OptionFieldDef[]>(() => views.get(chosenViewId.value)?.options ?? []);
const viewOptionsModel = computed<Record<string, unknown>>(() => (draft.def['viewer_options'] as Record<string, unknown>) ?? {});
function setViewOptions(value: Record<string, unknown>): void {
	if (Object.keys(value).length) draft.def['viewer_options'] = value;
	else delete draft.def['viewer_options'];
}

// ---- Relationship tab ---------------------------------------------------------------------------
const isRelationLike = computed(() => typeModel.value === 'relation' || typeModel.value === 'relation-list');

const { tree } = useCollections();
// Data collections only — exclude `.schema/*` system plumbing (isUserCollection).
const targetOptions = computed(() => tree.value.filter(isUserCollection).map((r) => r.collection));

// Targets are stored with a leading slash (e.g. '/companies'); the select works in slashless ids.
const targetModel = computed<string>({
	get: () => {
		const t = draft.def['target'];
		return typeof t === 'string' ? t.replace(/^\//, '') : '';
	},
	set: (v) => {
		if (v) draft.def['target'] = v.startsWith('/') ? v : `/${v}`;
		else delete draft.def['target'];
	},
});

// Display template lives at def.view_options.template (merged in with any View-tab option values).
const templateModel = computed<string>({
	get: () => {
		const vo = draft.def['viewer_options'] as Record<string, unknown> | undefined;
		const t = vo?.['template'];
		return typeof t === 'string' ? t : '';
	},
	set: (v) => {
		const vo = { ...((draft.def['viewer_options'] as Record<string, unknown>) ?? {}) };
		if (v) vo['template'] = v;
		else delete vo['template'];
		if (Object.keys(vo).length) draft.def['viewer_options'] = vo;
		else delete draft.def['viewer_options'];
	},
});
const templateFields = computed(() => (templateModel.value ? fieldsNamedIn(templateModel.value) : []));

// ---- the relation, authored from THIS side ------------------------------------------------------
//
// ONE question decides everything: WHERE THE LINK IS KEPT. Both answers are authorable from here —
// designer-state writes the other collection's field itself — so the drawer never sends anybody to
// the other side, and never mentions which side the engine considers the owner.
//
// CARDINALITY IS NOT A SEPARATE QUESTION. It falls out of the answer plus this field's own type:
//   kept here   scalar → many-to-one · scalar + "at most one" → one-to-one · list → many-to-many
//   kept there  list here → one-to-many · single here → one-to-one (compile closes it backwards)
// So "at most one" is one checkbox whose MECHANISM differs by side — a flag on the key when the key
// is here, this field's own type when it is not — and whose SENTENCE is the same either way.

const isListRelation = computed(() => typeModel.value === 'relation-list');

/** A named target. `''`/`'*'` is polymorphic — a link needs one collection on the other end, so the
 *  whole block is hidden rather than offered and then refused by the compile gate. */
const hasNamedTarget = computed(() => targetModel.value !== '' && targetModel.value !== '*');

/** This field is DERIVED from a key on another collection — the shape the engine generates. Its
 *  presentation is locked (the engine refuses a width or a hide on it); its RELATION is not. */
const isDerived = computed(() => props.field?.mirror !== undefined);

const linkSideModel = computed<LinkSide>({
	get: () => (draft.def['link_side'] === 'target' ? 'target' : 'here'),
	set: (v) => {
		draft.def['link_side'] = v;
		sideTouched = true;
		// The two sides mean different things by the far field's name and by "at most one", so a
		// switch re-prefills rather than carrying the other side's answer across.
		draft.def['far_field'] = suggestedFarField.value ?? '';
		if (v === 'target') delete draft.def['unique'];
	},
});

/**
 * Which side to OFFER. A single reference is one slot and holds its own key; a LIST of references is
 * far more often the many end of a one-to-many than a genuine many-to-many, so it starts with the
 * key on the target. It re-applies while the operator has not moved the radio themselves.
 *
 * ⚠ MOVING THE KEY IS A DATA MIGRATION, not an edit — the values live in whichever field holds it —
 * so the radio is offered while DECLARING and stated rather than offered afterwards.
 */
let sideTouched = false;
const canChooseSide = computed(() => !isEditing.value);
watch([typeModel, () => props.open], () => {
	if (initializing || sideTouched || isEditing.value) return;
	if (!isRelationLike.value) return;
	draft.def['link_side'] = defaultLinkSide(isListRelation.value);
});

const hereBase = computed(() => baseNameOf(props.collection));
const targetBase = computed(() => baseNameOf(targetModel.value));
// Every sentence about a link is about ONE record of a collection — "on each meeting", not "on each
// meetings". The plural read like a placeholder somebody forgot to fill in.
const hereOne = computed(() => singularOf(hereBase.value));
const targetOne = computed(() => singularOf(targetBase.value));

const uniqueModel = computed<boolean>({
	get: () => draft.def['unique'] === true,
	set: (v) => {
		if (v) draft.def['unique'] = true;
		else delete draft.def['unique'];
	},
});

/**
 * "at most one", one checkbox, two mechanisms — and neither is a keyword the operator types.
 * With the key HERE it is a property of the key. With the key on the target it IS this field's
 * type: one record cannot hold a list and be at most one.
 */
const atMostOneModel = computed<boolean>({
	get: () => (linkSideModel.value === 'target' ? !isListRelation.value : uniqueModel.value),
	set: (v) => {
		if (linkSideModel.value === 'target') {
			typeModel.value = v ? 'relation' : 'relation-list';
		} else {
			uniqueModel.value = v;
		}
	},
});

/** Offered on every shape except a list that holds the key — a list of references cannot promise a
 *  single anything, and compile refuses the keyword that would say it does. */
const canBeAtMostOne = computed(() => linkSideModel.value === 'target' || !isListRelation.value);

/** The name to prefill for the field on the other collection. Two different names, because the two
 *  sides are two different fields: the DERIVED one takes this collection's name (what a mirror is
 *  conventionally called, so the drawer suggests what an author would have chosen), and the
 *  KEY takes this collection's singular, because that is what it is about. */
const suggestedFarField = computed(() => {
	if (!hasNamedTarget.value) return null;
	if (linkSideModel.value === 'target') return defaultForeignKeyName(props.collection, targetModel.value);
	return defaultInverseName(props.collection, targetModel.value, uniqueModel.value);
});

const farFieldModel = computed<string>({
	get: () => (typeof draft.def['far_field'] === 'string' ? (draft.def['far_field'] as string) : ''),
	set: (v) => {
		draft.def['far_field'] = v;
	},
});

/** With the key HERE, the relation can simply not exist — a plain one-way reference is a legitimate
 *  field. With the key on the TARGET, this field only exists because of the link, so there is
 *  nothing to switch off. */
const twoWayModel = computed<boolean>({
	get: () => linkSideModel.value === 'target' || typeof draft.def['far_field'] === 'string',
	set: (v) => {
		if (v) draft.def['far_field'] = suggestedFarField.value ?? '';
		else {
			// `unique` and the delete rule only mean anything ON a link, so they go with the toggle
			// that gave them meaning rather than sitting in the source unread.
			delete draft.def['far_field'];
			delete draft.def['unique'];
			delete draft.def['on_delete'];
		}
	},
});
const canBeOneWay = computed(() => linkSideModel.value === 'here');

const onDeleteModel = computed<string>({
	get: () => (draft.def['on_delete'] === 'set-null' ? 'set-null' : 'restrict'),
	set: (v) => {
		if (v === 'set-null') draft.def['on_delete'] = 'set-null';
		else delete draft.def['on_delete'];
	},
});

watch(isListRelation, (list) => {
	if (list && linkSideModel.value === 'here') uniqueModel.value = false;
});

/** The relation as the operator's own two collection names, which is the only "cardinality" anything
 *  here shows: `m2o` is a word out of the engine's log, not out of this vault. */
const linkSentence = computed(() =>
	describeLink(
		{
			side: linkSideModel.value,
			target: targetModel.value,
			farField: farFieldModel.value,
			list: isListRelation.value,
			unique: uniqueModel.value,
			onDelete: 'restrict',
		},
		props.collection,
	),
);

/** Whose deletion the rule is about — the collection the KEY points at. */
const deleteSubject = computed(() =>
	singularOf(
		baseNameOf(
		deleteRuleTarget(
				{ side: linkSideModel.value, target: targetModel.value, farField: '', list: false, unique: false, onDelete: 'restrict' },
				props.collection,
			),
		),
	),
);

// Re-prefill the far field's name while the operator has not typed one of their own: switching
// target, or ticking "at most one" (which singularizes a derived name — `summaries` → `summary`),
// should move the suggestion with it.
let lastSuggestion: string | null = null;
watch(
	suggestedFarField,
	(next) => {
		const previous = lastSuggestion;
		lastSuggestion = next;
		if (initializing || !twoWayModel.value) return;
		if (farFieldModel.value === '' || farFieldModel.value === previous) farFieldModel.value = next ?? '';
	},
	{ immediate: true },
);
// Leaving relation/list drops the link with the target it described.
watch(typeModel, (next, prev) => {
	if (initializing || next === prev) return;
	if (next === 'relation' || next === 'relation-list' || next === 'list') return;
	delete draft.def['far_field'];
	delete draft.def['unique'];
	delete draft.def['on_delete'];
	delete draft.def['link_side'];
});

// ---- live validation of the far field, against the OTHER collection's real fields ---------------
// A collision (or a key that points somewhere else) is an inline error here rather than a
// compile-gate 400 after Save — the save is batched, and a refusal costs a round trip.
const targetFields = ref<FieldRow[]>([]);
watch(
	() => (hasNamedTarget.value ? targetModel.value : ''),
	async (target) => {
		if (!target) {
			targetFields.value = [];
			return;
		}
		targetFields.value = await loadAllFields(target);
	},
	{ immediate: true },
);

/** The far field as it exists TODAY on the other collection, or undefined. */
const existingFarField = computed(() => targetFields.value.find((f) => f.field === farFieldModel.value.trim()));

/** Names already taken on the target — minus the field THIS one derives over there, which is not a
 *  collision with itself. */
const takenOnTarget = computed(() => {
	// A mirror on the target whose `mirror_of` names THIS field is this field's own far side.
	const mine = isEditing.value ? (props.field?.key ?? '') : keySlug.value;
	return new Set(targetFields.value.filter((f) => !(isMirrorField(f) && f.mirror_of === mine)).map((f) => f.field));
});

const farFieldError = computed(() => {
	if (!isRelationLike.value || !hasNamedTarget.value || !twoWayModel.value) return '';
	const name = farFieldModel.value.trim();
	const T = targetBase.value;
	if (name === '') {
		return linkSideModel.value === 'target'
			? `Name the field on ${T} that points back here.`
			: `Name the field this adds on ${T}.`;
	}
	// A field is addressed as `<collection>.<field>`, split at the last dot — a dot, a slash or a
	// space in the name makes that address unreadable.
	if (/[.\/\s]/.test(name)) return 'A field name carries no dots, slashes or spaces.';

	if (linkSideModel.value === 'here') {
		if (takenOnTarget.value.has(name)) return `${T} already has a field called ${name}.`;
		return '';
	}
	// The key may already exist — that is the ordinary case for an existing relation — but it has to
	// be a single reference to THIS collection, or it is not a key this field can be derived from.
	const existing = existingFarField.value;
	if (!existing) return '';
	if (!isRelationField(existing)) {
		return `${T}.${name} already exists and is not a reference — pick another name.`;
	}
	if (isRelationList(existing) && !isListRelation.value) {
		return `${T}.${name} holds a list, so it cannot point at just one ${hereOne.value}.`;
	}
	if (isMirrorField(existing)) return `${T}.${name} is itself derived from another link — pick another name.`;
	return '';
});

// ---- tabs ---------------------------------------------------------------------------------------
const tabs = computed(() => {
	const base: { id: typeof activeTab.value; label: string }[] = [{ id: 'field', label: 'Field' }];
	// A DERIVED field carries no presentation of its own — the engine refuses a width, an editor or a
	// view on it — so those two tabs would be controls whose every setting is discarded on save. Its
	// RELATIONSHIP is fully editable, which is the tab that matters here.
	if (!isDerived.value) base.push({ id: 'edit', label: 'Edit' }, { id: 'view', label: 'View' });
	if (isRelationLike.value) base.push({ id: 'relationship', label: 'Relationship' });
	return base;
});
// A derived field opens on the tab it exists for.
watch(
	() => props.open,
	(open) => {
		if (open && isDerived.value) activeTab.value = 'relationship';
	},
);
// If the type change hides the Relationship tab while it's active, fall back to Field.
watch(isRelationLike, (rel) => {
	if (!rel && activeTab.value === 'relationship') activeTab.value = 'field';
});

// ---- apply / cancel -----------------------------------------------------------------------------
// New-field mode: block Apply when the (slugified) key already names a staged or implicit field, so
// Apply can't silently clobber/merge an existing field.
const keyCollision = computed(
	() => !isEditing.value && keySlug.value.length > 0 && (props.existingKeys ?? []).includes(keySlug.value),
);
const canApply = computed(
	() => (isEditing.value || keySlug.value.length > 0) && !keyCollision.value && farFieldError.value === '',
);

// Deep-clone the draft def for the emit. `structuredClone(toRaw(...))` only unwraps the TOP-level
// reactive proxy, so nested proxies introduced by the OptionsForm/EditList round-trip (e.g. a
// select-dropdown's `edit_options.choices` rows) trip DataCloneError. Descriptor defs are always
// JSON-serializable (the C1 entry shape — scalars, arrays, plain objects), so a JSON round-trip is
// both safe and fully strips reactivity.
function cloneDef(def: Record<string, unknown>): Record<string, unknown> {
	return JSON.parse(JSON.stringify(def)) as Record<string, unknown>;
}

function apply(): void {
	if (!canApply.value) return;
	const key = isEditing.value ? props.field!.key : keySlug.value;
	if (!draft.def['type']) draft.def['type'] = 'string';
	// `implicit`/`mirror` are the ROW's own facts, not the draft's — designer-state.replace() keeps
	// them, so a derived field stays in the locked block after an edit rather than jumping the grid.
	emit('apply', { key, def: cloneDef(draft.def), implicit: props.field?.implicit === true, ...(props.field?.mirror ? { mirror: props.field.mirror } : {}) });
	emit('close');
}

// ---- dropdown choices -------------------------------------------------------------------------
// Adapters onto DtSelect's `{text, value}` shape. Every one of these was a native <select>: the Edit
// and View lists are long and the target-collection list is every collection in the workspace, which
// is precisely where being able to TYPE at a dropdown stops mattering as polish and starts mattering
// as whether you can find the thing at all.
const typeChoices = computed(() => typeOptions.value.map((t) => ({ text: t.label, value: t.id })));
const editChoices = computed(() => editEntries.value.map((e) => ({ text: `${e.star ? '★ ' : ''}${e.name}`, value: e.id })));
const viewChoices = computed(() => viewEntries.value.map((v) => ({ text: `${v.star ? '★ ' : ''}${v.name}`, value: v.id })));
const targetChoices = computed(() => targetOptions.value.map((c) => ({ text: c, value: c })));
</script>

<template>
	<DtDrawer :open="open" :title="drawerTitle" width="520px" @close="emit('close')">
		<nav class="dt-field-tabs" role="tablist">
			<button
				v-for="tab in tabs"
				:key="tab.id"
				type="button"
				class="dt-field-tab"
				:class="{ 'is-active': activeTab === tab.id }"
				role="tab"
				:aria-selected="activeTab === tab.id"
				@click="activeTab = tab.id"
			>
				{{ tab.label }}
			</button>
		</nav>

		<!-- Field tab -->
		<section v-show="activeTab === 'field'" class="dt-field-panel">
			<label class="dt-field-row">
				<span class="dt-field-label">Key</span>
				<input v-model="draft.key" class="dt-input" :disabled="isEditing" placeholder="due_date" />
			</label>
			<p v-if="!isEditing && draft.key && keySlug !== draft.key" class="dt-field-hint">
				Will be saved as <code>{{ keySlug }}</code>
			</p>
			<p v-if="keyCollision" class="dt-field-error">A field named <code>{{ keySlug }}</code> already exists.</p>

			<label class="dt-field-row">
				<span class="dt-field-label">Type</span>
				<DtSelect v-model="typeModel" :choices="typeChoices" aria-label="Type" />
			</label>

			<label class="dt-field-row">
				<span class="dt-field-label">Description</span>
				<input v-model="descriptionModel" class="dt-input" placeholder="What this field means" />
			</label>

			<template v-if="!isDerived">
				<label class="dt-field-check">
					<input v-model="requiredModel" type="checkbox" class="dt-checkbox" />
					<span>Required</span>
				</label>

				<FieldDisplayKeys :def="draft.def" :sections="formSections" :siblings="siblingFields" />
			</template>
			<p v-else class="dt-field-hint">
				This field's value is kept in step with the link, so it is not typed into a record — width,
				editor and view settings have nothing to apply to.
			</p>
		</section>

		<!-- Edit tab -->
		<section v-show="activeTab === 'edit'" class="dt-field-panel">
			<label class="dt-field-row">
				<span class="dt-field-label">Edit</span>
				<DtSelect v-model="editModel" :choices="editChoices" placeholder="Default for type" aria-label="Edit" />
			</label>
			<div v-if="editOptionDefs.length" class="dt-field-options">
				<OptionsForm :options="editOptionDefs" :model-value="editOptionsModel" @update:model-value="setEditOptions" />
			</div>
			<p v-else class="dt-field-hint">This Edit has no options.</p>
		</section>

		<!-- View tab -->
		<section v-show="activeTab === 'view'" class="dt-field-panel">
			<label class="dt-field-row">
				<span class="dt-field-label">View</span>
				<DtSelect v-model="viewModel" :choices="viewChoices" placeholder="Default for type" aria-label="View" />
			</label>
			<div v-if="viewOptionDefs.length" class="dt-field-options">
				<OptionsForm :options="viewOptionDefs" :model-value="viewOptionsModel" @update:model-value="setViewOptions" />
			</div>
			<p v-else class="dt-field-hint">This View has no options.</p>
		</section>

		<!-- Relationship tab (relation / list-of-relation only) -->
		<section v-show="activeTab === 'relationship'" class="dt-field-panel">
			<label class="dt-field-row">
				<span class="dt-field-label">Target collection</span>
				<DtSelect
					v-model="targetModel"
					:choices="targetChoices"
					:disabled="isDerived"
					placeholder="Select a collection…"
					aria-label="Target collection"
				/>
			</label>
			<p v-if="isDerived" class="dt-field-hint">
				The two collections a link joins are fixed once it exists — a new field is how you point
				somewhere else.
			</p>

			<!-- Hidden entirely without a named target: a link needs one collection on the other end. -->
			<div v-if="hasNamedTarget" class="dt-rel-block">
				<fieldset class="dt-field-row dt-rel-fieldset">
					<legend class="dt-field-label">Where the link is kept</legend>
					<label class="dt-field-check">
						<input v-model="linkSideModel" type="radio" value="here" class="dt-checkbox dt-radio" :disabled="!canChooseSide" />
						<span>on each <code>{{ hereOne }}</code> — this field holds it</span>
					</label>
					<label class="dt-field-check">
						<input v-model="linkSideModel" type="radio" value="target" class="dt-checkbox dt-radio" :disabled="!canChooseSide" />
						<span>on each <code>{{ targetOne }}</code> — a field there points back here</span>
					</label>
					<p v-if="!canChooseSide" class="dt-field-hint">
						Which side keeps it is where the values physically live, so moving it would move data.
						Everything else about the link is editable from here.
					</p>
				</fieldset>

				<!-- One-way is only a choice when this field is the one holding the link. -->
				<label v-if="canBeOneWay" class="dt-field-check">
					<input v-model="twoWayModel" type="checkbox" class="dt-checkbox" />
					<span>also show it on each <code>{{ targetOne }}</code></span>
				</label>

				<label v-if="twoWayModel" class="dt-field-row">
					<span class="dt-field-label">Field on <code>{{ targetBase }}</code></span>
					<input
						v-model="farFieldModel"
						class="dt-input"
						:placeholder="suggestedFarField ?? 'field name'"
						:aria-label="`Field name on ${targetModel}`"
					/>
				</label>
				<p v-if="farFieldError" class="dt-field-error">{{ farFieldError }}</p>
				<p v-else-if="!twoWayModel" class="dt-field-hint">
					One-way: a <code>{{ targetOne }}</code> will not show what points at it, and "which
					<code>{{ targetBase }}</code> have none" is not a filter.
				</p>

				<template v-if="twoWayModel">
					<label v-if="canBeAtMostOne" class="dt-field-check">
						<input v-model="atMostOneModel" type="checkbox" class="dt-checkbox" />
						<span v-if="linkSideModel === 'target'">each <code>{{ hereOne }}</code> has at most one <code>{{ targetOne }}</code></span>
						<span v-else>each <code>{{ targetOne }}</code> has at most one <code>{{ hereOne }}</code></span>
					</label>
					<p class="dt-field-hint">{{ linkSentence }}</p>

					<fieldset class="dt-field-row dt-rel-fieldset">
						<legend class="dt-field-label">When a <code>{{ deleteSubject }}</code> is deleted</legend>
						<label class="dt-field-check">
							<input v-model="onDeleteModel" type="radio" value="restrict" class="dt-checkbox dt-radio" />
							<span>Refuse — the delete is blocked while anything still points at it</span>
						</label>
						<label class="dt-field-check">
							<input v-model="onDeleteModel" type="radio" value="set-null" class="dt-checkbox dt-radio" />
							<span>Clear the link — the delete goes through and the link is emptied</span>
						</label>
					</fieldset>
				</template>
			</div>

			<label class="dt-field-row">
				<span class="dt-field-label">Display template</span>
				<input v-model="templateModel" class="dt-input" placeholder="{{ name }}" />
			</label>
			<p class="dt-field-hint">
				A mustache template rendered against the related record, e.g. <code>{{ TEMPLATE_EXAMPLE }}</code>. Leave blank to show the
				record's title.
			</p>
			<p v-if="templateFields.length" class="dt-field-hint">
				References: <code v-for="f in templateFields" :key="f" class="dt-field-tokchip">{{ f }}</code>
			</p>
		</section>

		<template #footer>
			<button type="button" class="dt-btn dt-btn--secondary" @click="emit('close')">Cancel</button>
			<button type="button" class="dt-btn" :disabled="!canApply" @click="apply">Apply</button>
		</template>
	</DtDrawer>
</template>

<style scoped>
.dt-field-tabs {
	display: flex;
	gap: 2px;
	border-bottom: 1px solid var(--dt-border);
	margin: -8px -8px 20px;
	padding: 0 8px;
}
.dt-field-tab {
	border: none;
	background: transparent;
	padding: 10px 14px;
	font: inherit;
	font-size: var(--dt-text);
	font-weight: 500;
	color: var(--dt-fg-subtle);
	cursor: pointer;
	border-bottom: 2px solid transparent;
	margin-bottom: -1px;
	transition:
		color 0.12s ease,
		border-color 0.12s ease;
}
.dt-field-tab:hover {
	color: var(--dt-fg);
}
.dt-field-tab.is-active {
	color: var(--dt-accent);
	border-bottom-color: var(--dt-accent);
}
.dt-field-panel {
	display: flex;
	flex-direction: column;
	gap: 16px;
}
.dt-field-row {
	display: flex;
	flex-direction: column;
	gap: 8px;
}
.dt-field-label {
	font-size: var(--dt-text);
	font-weight: 600;
	color: var(--dt-fg);
}
.dt-field-check {
	display: flex;
	align-items: center;
	gap: 8px;
	font-size: var(--dt-text);
	color: var(--dt-fg);
}
.dt-field-hint {
	font-size: var(--dt-text);
	color: var(--dt-fg-subtle);
	margin: -8px 0 0;
}
.dt-field-hint code {
	color: var(--dt-fg);
	font-family: var(--dt-font-mono);
}
.dt-field-error {
	font-size: var(--dt-text);
	color: var(--dt-danger);
	margin: -8px 0 0;
}
.dt-field-error code {
	font-family: var(--dt-font-mono);
}
.dt-rel-block {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 14px;
	border: 1px solid var(--dt-border);
	border-radius: var(--dt-radius);
	background: var(--dt-bg-subtle);
}
.dt-rel-block .dt-field-check code,
.dt-field-hint code {
	font-family: var(--dt-font-mono);
	color: var(--dt-fg);
}
.dt-rel-block .dt-field-hint {
	margin: -10px 0 0;
}
.dt-rel-block .dt-field-error {
	margin: -10px 0 0;
}
.dt-rel-name {
	flex: 1 1 auto;
	min-width: 0;
	max-width: 220px;
}
.dt-rel-fieldset {
	border: none;
	margin: 0;
	padding: 0;
	gap: 8px;
}
.dt-rel-fieldset legend {
	padding: 0;
	margin-bottom: 4px;
}
.dt-field-tokchip {
	display: inline-block;
	background: var(--dt-bg-subtle);
	border-radius: 4px;
	padding: 1px 5px;
	margin-right: 4px;
}
.dt-field-options {
	padding-top: 4px;
	border-top: 1px solid var(--dt-border);
}
/* A RADIO has to look like one. The shared `.dt-checkbox` skin was on both, so two exclusive groups
   — where the link is kept, and the delete rule — rendered as square checkboxes, which reads as
   "tick any of these" for a question that has exactly one answer. */
.dt-radio {
	border-radius: 50%;
}
.dt-field-check:has(.dt-radio:disabled),
.dt-field-check:has(.dt-checkbox:disabled) {
	opacity: 0.6;
}

.dt-input:disabled,
.dt-select:disabled {
	background: var(--dt-bg-subtle);
	color: var(--dt-fg-subtle);
}
</style>
