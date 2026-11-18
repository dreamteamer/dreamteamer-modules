/**
 * Extension registries (terminology decision 2026-07-23): `edits` (field editors + record-scoped
 * Edit pages), `views` (field read-renderers + record-scoped View pages), `lists` (collection
 * browse arrangements), `panels`, `apps`, and flow `operations` all register here — "code
 * registers everything renderable; yaml records configure and assemble". Built-ins register
 * through the same door module `app` entries use (see register-defaults.ts and modules.ts), so the
 * shell dogfoods the extension API.
 *
 * An `ExtensionDefinition` (used by both `edits` and `views`) carries the Vue component to render,
 * the field `type`s it is a kind-default candidate for, and a `scope`: a `'field'` entry renders
 * one value; a `'record'` entry renders a whole record page (the old `form`/`doc` item-layouts —
 * terminology decision 1: "a record page is an Edit/View too"). See lib/presets.ts for how a
 * `.schema/presets` record picks a List (for a browse) or a record-scoped Edit/View (for a record
 * page).
 *
 * `apps` back the ModuleBar: `registerApp({ id, icon, label, routes })` contributes a router
 * subtree + a nav icon. Content and Settings are the first two registered apps (the shell
 * dogfoods the app API); module apps mount under `/a/<id>`.
 */
import type { Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import type { FieldComponentOptions, FieldRow, FieldType } from '../api/types';
import { formatTitle } from '../lib/format-title';

/**
 * One option an extension exposes, declared as a field definition (Directus research item 1:
 * "the settings form for an extension is drawn by the same machinery that draws a record").
 * Rendered by OptionsForm via the ordinary Edit resolution chain — an extension never builds
 * bespoke settings UI.
 */
export interface OptionFieldDef {
	field: string;
	name?: string;
	type: FieldType;                               // a display-contract wire type
	many?: true;                                   // a list of `type`
	editor?: string;                               // explicit Edit id; omitted → the type's default
	editor_options?: FieldComponentOptions;
	note?: string;
	default?: unknown;
	/**
	 * Render this option only when the extension's CURRENT values say it is relevant — e.g. the
	 * diagram's "which field" control appears only once you have chosen to link by a shared value.
	 *
	 * A flat list of every option an extension could ever want is what makes a settings panel read
	 * as noise: half of it is inert at any moment and nothing says which half (operator 2026-08-11:
	 * "controls should be enabled disabled where they are relevant and generally contextual
	 * otherwise this is confusing"). Hidden beats disabled here — a disabled control still occupies
	 * the eye with a question it cannot answer.
	 */
	when?: (values: Record<string, unknown>) => boolean;
	/** Options sharing a `group` are drawn as ONE block, tight inside and spaced outside, UNDER THE
	 *  HEADING `OPTION_GROUPS` gives that id. Grouping here is presentational only — it changes no
	 *  value and no storage key. It exists because a "group by" dropdown and its two qualifying
	 *  toggles are ONE decision the reader makes once, and rendering them as three peers in a flat
	 *  stack is what made a six-control panel read as six unrelated verbs.
	 *
	 *  ⚠ ONLY CONSECUTIVE options are merged (see `OptionsForm`), so options sharing a group MUST be
	 *  declared next to each other — split them and the same heading appears twice.
	 *
	 *  ⚠ An UNGROUPED option keeps its own headingless block, which is right for a lone trailing
	 *  control like page size and wrong for anything else: three ungrouped controls wedged between
	 *  two headed sections is what the operator called the layout panel sucking (2026-09-10). If an
	 *  option belongs with its neighbours, give it their group; if it starts a new idea, give it a
	 *  NEW group and a heading. Do not leave it floating. */
	group?: string;
}

/**
 * One registry option as a FIELD ROW of the display contract, so the form that draws a record draws
 * an extension's settings too (Directus research item 1). The option's `name` is its label, its
 * `note` its description; it is never required, always editable and drawn on every surface.
 */
export function optionRow(def: OptionFieldDef): FieldRow {
	return {
		field: def.field,
		type: def.type,
		...(def.many ? { many: true as const } : {}),
		title: def.name ?? formatTitle(def.field),
		...(def.note ? { description: def.note } : {}),
		required: false,
		editable: true,
		nullable: true,
		...(def.editor ? { editor: def.editor } : {}),
		...(def.editor_options ? { editor_options: def.editor_options, viewer_options: def.editor_options } : {}),
		...(def.default !== undefined ? { default: def.default } : {}),
	};
}

/** Several option defs as rows — the sub-field rows of an option whose editor is `list`/`nested`. */
export function optionRows(defs: OptionFieldDef[]): FieldRow[] {
	return defs.map(optionRow);
}

/**
 * The heading each `group` id is drawn under — ONE map, deliberately, because the ids are shared
 * across layouts and the whole point is that they mean the same thing everywhere. `rows` is the
 * band axis on the table, the cards, the kanban and the gantt; `span` is the time axis on the
 * calendar and the gantt. A reader who has configured one board has learnt the next.
 *
 * ⚠ ADD THE ID HERE, NOT A LABEL TO THE OPTION. A per-option group name would let two layouts spell
 * the same section differently, which is the drift this map exists to make impossible — the same
 * argument the engine makes about a collection's `description` living in one place.
 *
 * An id with no entry renders as an unheaded block rather than showing a raw id, so a new group is
 * never worse than no group.
 */
export const OPTION_GROUPS: Record<string, string> = {
	density: 'Density',
	span: 'Time axis',
	bars: 'Bars',
	rows: 'Row bands',
	columns: 'Columns',
	card: 'Card',
	nodes: 'Nodes',
	links: 'Links',
};

export interface ExtensionDefinition {
	id: string;
	name: string;
	component: Component;
	/** Wire types this entry is a kind-default candidate for ([] = explicit opt-in only). */
	types: string[];
	/** 'field' (default) renders one value; 'record' renders a whole record page. */
	scope?: 'field' | 'record';
	/** Self-describing settings, drawn by OptionsForm through the Edit resolution chain. */
	options?: OptionFieldDef[];
	/** Views that pair well with this Edit, best first — a hint the future field editor surfaces
	 *  when a field uses this Edit (no runtime consumer yet; contract-only for now). */
	recommendedViews?: string[];
}

/**
 * List registry entry (terminology decision 2026-07-23): a browse arrangement that renders a whole
 * collection (table / cards / …). Built-ins wrap the existing browse-table / card-grid components
 * (register-defaults.ts) and, for compatibility with those, ALSO accept the studio-internal
 * `state` prop — module-authored Lists use the documented `(collection, query, options)` props
 * instead.
 */
export interface ListDefinition {
	id: string;
	name: string;
	component: Component;
	/** Self-describing settings, drawn by OptionsForm through the Edit resolution chain. */
	options?: OptionFieldDef[];
	/**
	 * "I fill the page and own my own scrolling." A List that says so gets a height-constrained
	 * box (BrowseView adds `--fill` modifiers down the chain) instead of growing the page: the
	 * page's vertical scrollbar goes away and the List is responsible for scrolling its own
	 * innards. The kanban needs it — full-height columns that each scroll their own cards, with
	 * the column header pinned — and so does the table (2026-08-08): a sticky `<thead>` is only
	 * sticky against a scroll box the List owns, and it's what keeps the pager on screen instead
	 * of a page-scroll away. Cards/calendar/map deliberately DON'T set it: they grow and let the
	 * page scroll, which is what they already did.
	 */
	fillsHeight?: boolean;
	/**
	 * "I am a summary of every row, not a page of them" — the `counts` layout. The browse draws no
	 * pager and no `1–25 of 40` under it: there is no next page of a number.
	 */
	summarizes?: boolean;
}

/**
 * App registry entry (spec §8). `routes` is a vue-router subtree; for module apps it is mounted
 * under `/a/<id>` (see modules.ts). `to`/`match` describe the ModuleBar nav target and the
 * route-prefixes that light its icon active — built-in apps (content/settings) override these
 * because their routes live at absolute paths (`/content`, `/settings`), not under `/a/<id>`.
 */
export interface AppDefinition {
	id: string;
	icon: string;
	label: string;
	routes: RouteRecordRaw[];
	/** Nav target for the ModuleBar icon. Defaults to `/a/<id>`. */
	to?: string;
	/** Route-path prefixes that mark this app active. Defaults to `[to]`. */
	match?: string[];
}

export function defineRegistry<T extends { id: string }>(kind: string) {
	const entries = new Map<string, T>();

	return {
		kind,
		register(definition: T): void {
			entries.set(definition.id, definition);
		},
		get(id: string): T | undefined {
			return entries.get(id);
		},
		all(): T[] {
			return [...entries.values()];
		},
	};
}

export const edits = defineRegistry<ExtensionDefinition>('edit');
export const views = defineRegistry<ExtensionDefinition>('view');
export const lists = defineRegistry<ListDefinition>('list');
export const panels = defineRegistry<ExtensionDefinition>('panel');
export const operations = defineRegistry<ExtensionDefinition>('operation');
export const apps = defineRegistry<AppDefinition>('app');

/**
 * Wire type → default Edit id, used by resolve.ts when a field names no (registered) `editor`. Keyed
 * on the display contract's AUTHORED type names (§4.3). Mutable and exported so a module can
 * override/extend a type's default without touching core (`registerKindDefault('edit', 'map',
 * 'map-editor')`). The SHAPE overrides — a body, a reference, an enum, a list, an object with
 * declared sub-fields — are decided in resolve.ts before this map is consulted.
 */
export const kindDefaultEdits: Record<string, string> = {
	string: 'input',
	markdown: 'textarea',
	integer: 'input-number',
	number: 'input-number',
	boolean: 'boolean',
	date: 'datetime',
	datetime: 'datetime',
	url: 'input',
	email: 'input',
	position: 'input',
	// object and map default to the parse-validated EditJson, NOT 'input' — EditInput's String(value)
	// is the write-side "[object Object]" bug for any real object.
	object: 'json',
	map: 'json',
};

/**
 * Wire type → default View id, used by resolve.ts. Everything not listed falls through to 'text'.
 * `markdown` is the rendered markdown View in BOTH contexts (ViewMarkdown collapses a cell to one
 * stripped line; the record page gets the document) — a markdown field printing its SOURCE is what
 * this entry exists to prevent.
 */
export const kindDefaultViews: Record<string, string> = {
	markdown: 'markdown',
	boolean: 'boolean',
	date: 'date',
	datetime: 'date',
	object: 'json',
	map: 'json',
};

/** Register (or override) the kind default for a wire `type` on the Edit or View axis. */
export function registerKindDefault(kind: 'edit' | 'view', type: string, id: string): void {
	(kind === 'edit' ? kindDefaultEdits : kindDefaultViews)[type] = id;
}
