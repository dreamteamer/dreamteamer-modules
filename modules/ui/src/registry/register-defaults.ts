/**
 * Registers the C1 (+ C2, + E) Edit/View/List set (terminology decision 2026-07-23: the old
 * interface/display/layout registries are now `edits`/`views`/`lists`). Ids are exact contracts:
 * resolve.ts's shape defaults (markdown-body, relation-picker, relation, select-dropdown, label,
 * list, tags, nested) depend on these strings verbatim, and a descriptor names them as a field's
 * `display.editor` / `display.viewer`. Imported once, for its side effect, from main.ts.
 *
 * `types` advertises an entry as a candidate default for those display-contract wire types; the
 * actual default lives in one place, `kindDefaultEdits`/`kindDefaultViews`. Entries with
 * `types: []` are reachable only by an authored `editor`/`viewer` id: `file`/`image` (a file-id
 * value is just a string), and `slider`/`color`/`code`/`progress`/`filesize` (a bare number or
 * string defaulting to a slider or a colour swatch would be wrong for nearly every such field).
 * `tags`/`list`/`nested` are reached by SHAPE — `many`, `object` with sub-fields — in resolve.ts.
 */
import EditBoolean from '../edits/EditBoolean.vue';
import EditCode from '../edits/EditCode.vue';
import EditColor from '../edits/EditColor.vue';
import EditDatetime from '../edits/EditDatetime.vue';
import EditDisplayTemplate from '../edits/EditDisplayTemplate.vue';
import EditFieldSelect from '../edits/EditFieldSelect.vue';
import EditFieldMultiSelect from '../edits/EditFieldMultiSelect.vue';
import EditInput from '../edits/EditInput.vue';
import EditJson from '../edits/EditJson.vue';
import EditList from '../edits/EditList.vue';
import EditNested from '../edits/EditNested.vue';
import EditMarkdownBody from '../edits/EditMarkdownBody.vue';
import EditNumber from '../edits/EditNumber.vue';
import EditRelation from '../edits/EditRelation.vue';
import EditSelect from '../edits/EditSelect.vue';
import EditSlider from '../edits/EditSlider.vue';
import EditTags from '../edits/EditTags.vue';
import EditTextarea from '../edits/EditTextarea.vue';

import ViewBoolean from '../views/ViewBoolean.vue';
import ViewColor from '../views/ViewColor.vue';
import ViewDate from '../views/ViewDate.vue';
import ViewFilesize from '../views/ViewFilesize.vue';
import ViewImage from '../views/ViewImage.vue';
import ViewJson from '../views/ViewJson.vue';
import ViewLabel from '../views/ViewLabel.vue';
import ViewList from '../views/ViewList.vue';
import ViewMarkdown from '../views/ViewMarkdown.vue';
import ViewNested from '../views/ViewNested.vue';
import ViewProgress from '../views/ViewProgress.vue';
import ViewRelation from '../views/ViewRelation.vue';
import ViewTags from '../views/ViewTags.vue';
import ViewText from '../views/ViewText.vue';
import ViewSource from '../views/ViewSource.vue';
import ViewStageChecks from '../views/ViewStageChecks.vue';

import ListCards from '../lists/ListCards.vue';
import ListCounts from '../lists/ListCounts.vue';
import ListCarousel from '../lists/ListCarousel.vue';
import ListKanban from '../lists/ListKanban.vue';
import ListCalendar from '../lists/ListCalendar.vue';
import ListMap from '../lists/ListMap.vue';
import ListDiagram from '../lists/ListDiagram.vue';
import ListGantt from '../lists/ListGantt.vue';
import DataTable from '../components/DataTable.vue';
import ItemForm from '../components/ItemForm.vue';
import ItemProperties from '../components/ItemProperties.vue';
import DataModelRecord from '../components/DataModelRecord.vue';

import ContentBrowse from '../pages/ContentBrowse.vue';
// The data-model list and detail are mounted BY THE SCHEMA TAB now (its `collections` surface), not
// by a route of their own — `/settings/data-model*` redirects into the tab. They keep their files and
// their behaviour; only who mounts them changed.
import SchemaTab from '../pages/SchemaTab.vue';

import { apps, edits, lists, optionRows, views, type OptionFieldDef } from './index';
import { ALL, PAGE_SIZE_CHOICES } from '../lib/page-size';
import { DEFAULT_ROW_SIZE, ROW_SIZES, ROW_SIZE_LABELS } from '../lib/row-size';

edits.register({ id: 'input', name: 'Input', component: EditInput, types: ['string', 'url', 'email', 'position'] });
edits.register({ id: 'textarea', name: 'Textarea', component: EditTextarea, types: ['markdown'] });
edits.register({ id: 'input-number', name: 'Number', component: EditNumber, types: ['number', 'integer'] });
edits.register({ id: 'boolean', name: 'Boolean', component: EditBoolean, types: ['boolean'] });
edits.register({ id: 'datetime', name: 'Datetime', component: EditDatetime, types: ['date', 'datetime'] });
edits.register({
	id: 'select-dropdown',
	name: 'Select',
	component: EditSelect,
	types: ['string'],
	recommendedViews: ['label'],
	options: [
		{
			field: 'choices',
			name: 'Choices',
			type: 'object',
			many: true,
			editor: 'list',
			editor_options: {
				fields: optionRows([
					{ field: 'label', name: 'Label', type: 'string' },
					{ field: 'value', name: 'Value', type: 'string' },
				]),
				item_title: '{{ label }}',
			},
		},
	],
});
edits.register({ id: 'markdown-body', name: 'Markdown Body', component: EditMarkdownBody, types: ['markdown'] });
edits.register({ id: 'relation-picker', name: 'Relation Picker', component: EditRelation, types: ['string'] });
edits.register({ id: 'tags', name: 'Tags', component: EditTags, types: [] });
edits.register({ id: 'slider', name: 'Slider', component: EditSlider, types: [] });
edits.register({ id: 'color', name: 'Color', component: EditColor, types: [] });
edits.register({ id: 'code', name: 'Code', component: EditCode, types: [] });
// Repeatable list Edit (contract C5): `types: []` explicit opt-in only — a JSON array is
// indistinguishable by wire type from any other json value, so it must never be kind-inferred.
// Its `editor_options` carry `{ fields: FieldRow[]; item_title?: string }` (see EditList.vue and
// the `select-dropdown` `choices` option above).
edits.register({ id: 'list', name: 'List', component: EditList, types: [] });
// Structured-data wave (operator ask: "no [object Object] on any ui screen"): 'nested' edits one
// declared-shape object via the same OptionsForm contract EditList rows use; 'json' is the SAFE
// kind default for wire-type json (registry/index.ts) — parse-validated text, write-side ViewJson.
edits.register({ id: 'nested', name: 'Nested', component: EditNested, types: [] });
// Two Edits that exist for CONFIGURING things about a collection rather than editing a record's
// value (kanban wave follow-up, 2026-07-29 — operator: "group by - should be a drop down, allow
// selecting from fields"). Both read the ambient field context (lib/field-context.ts) and degrade
// to a plain input where none is provided, so they are safe anywhere an options form is drawn.
// `types: []` — nothing about a wire type implies "this string names a field".
edits.register({ id: 'field-select', name: 'Field', component: EditFieldSelect, types: [] });
// Plural of the above — several fields at once, empty meaning ALL (see EditFieldMultiSelect).
edits.register({ id: 'field-multi-select', name: 'Fields', component: EditFieldMultiSelect, types: [] });
edits.register({ id: 'display-template', name: 'Display Template', component: EditDisplayTemplate, types: [] });
edits.register({ id: 'json', name: 'JSON', component: EditJson, types: ['object', 'map'] });

views.register({ id: 'text', name: 'Text', component: ViewText, types: [] });
// Rendered markdown — reached via resolve.ts's body role (`role: body`), an explicit
// `viewer: markdown`, or the `markdown` type's default, which is what makes a non-body markdown field
// render rather than print its source. `types: []` still: `types` advertises kind-default
// CANDIDACY to the field editor, and the actual default lives in one place — kindDefaultViews.
views.register({ id: 'markdown', name: 'Markdown', component: ViewMarkdown, types: [] });
views.register({ id: 'boolean', name: 'Boolean', component: ViewBoolean, types: ['boolean'] });
views.register({ id: 'date', name: 'Date', component: ViewDate, types: ['date', 'datetime'] });
views.register({ id: 'label', name: 'Label', component: ViewLabel, types: [] });
views.register({ id: 'relation', name: 'Relation', component: ViewRelation, types: [] });
views.register({ id: 'image', name: 'Image', component: ViewImage, types: [] });
views.register({ id: 'tags', name: 'Tags', component: ViewTags, types: [] });
views.register({ id: 'color', name: 'Color', component: ViewColor, types: [] });
views.register({ id: 'progress', name: 'Progress', component: ViewProgress, types: [] });
views.register({ id: 'filesize', name: 'File Size', component: ViewFilesize, types: [] });
// the `$source` column's mark — where a record is read from (`lib/sources.ts`); reached by the
// synthetic row's own `viewer`, never a type default
views.register({ id: 'source', name: 'Source', component: ViewSource, types: [] });
// a tags field's stages as checks (`lib/stage-checks.ts`) — reached only by a field's authored
// `viewer: stage-checks`, which names its stages in `viewer_options`; never a type default
views.register({ id: 'stage-checks', name: 'Stage checks', component: ViewStageChecks, types: [] });
// Polish wave defect 2: safe as a `json`-type kind default (unlike `tags`, see the header comment
// above) — ViewJson branches on the actual value shape rather than assuming one, so a
// `kind: list` field and a `kind: json` object field (both wire type `json`) each render sensibly.
views.register({ id: 'json', name: 'JSON', component: ViewJson, types: ['object', 'map'] });
views.register({ id: 'list', name: 'List', component: ViewList, types: [] });
views.register({ id: 'nested', name: 'Nested', component: ViewNested, types: [] });

// ── options every list shares ────────────────────────────────────────────────────────────────────
// GROUPING IS ONE CONCEPT WITH TWO AXES, NAMED FOR THE AXIS. `group_by` makes horizontal bands and
// every list has it; `lanes_by` makes the kanban's columns. Descriptor v2 (§3.5.1) names an option
// that takes a field for the ROLE the field plays, with no `_field` suffix, and one that takes a
// template for what it labels — so `group_rows_by_field` / `group_columns_by_field` became these two,
// and a view still carrying an old name is named by `UnknownOptionsHint` (`lib/list-options.ts`
// knows each rename) rather than silently ignored. ⚠ The rule binds EVERY option that takes a field,
// not only the ones the design's table listed: the carousel's `folder` / `text`, the cards' `image`
// and the gantt's `bar_label` / `group_icon` kept `_field` names until 0.24.18, and a descriptor that
// already wrote the v2 spelling was reported as unknown. `test/unit/option-names.test.ts` refuses a
// registered `_field` option; a rename goes into RENAMED_OPTIONS in the same commit.
const groupRowsOptions = (): OptionFieldDef[] => [
	{
		field: 'group_by',
		group: 'rows',
		name: 'Group by',
		type: 'string',
		editor: 'field-select',
		// `prefer`, not a filter: a non-enum field is a legal axis too — the bands fall out of the
		// data, and a reference field takes its labels from the records it points at.
		// ⚠ The placeholder is DECLARED because blank means something different here than it does on
		// the column axis: no bands at all, never an inferred field. It read "Auto" until 0.13.0.
		editor_options: { prefer: 'choices', placeholder: 'None — no bands' },
		note: 'horizontal bands, one per value — blank leaves the list ungrouped',
	},
	{
		field: 'show_ungrouped_rows',
		group: 'rows',
		name: 'Show ungrouped band',
		type: 'boolean',
		default: false,
		note: 'a band for records with no value',
		when: (v) => typeof v['group_by'] === 'string' && !!v['group_by'],
	},
	// ⚠ Empty BANDS default to HIDDEN, empty COLUMNS to shown, and the asymmetry is the point: a
	// column is a drop target (an empty "Blocked" is where you drag the thing you just got blocked
	// on), a band is not. A filtered board drawing every declared lane, most of them empty, is what
	// the operator reported on 2026-09-07.
	{
		field: 'show_empty_rows',
		group: 'rows',
		name: 'Show empty bands',
		type: 'boolean',
		default: false,
		note: 'keep a band whose value has no records',
		when: (v) => typeof v['group_by'] === 'string' && !!v['group_by'],
	},
];

// COLOUR, on every list that draws a record as a row or a card. Blank is the collection's own
// `display.record.color_by` — the view's key wins, the collection's is the default (§3.5) — so the
// placeholder says so rather than "None". Read through `lib/collection-display.ts#colorByFor`.
const colorByOption = (group?: string): OptionFieldDef => ({
	field: 'color_by',
	...(group ? { group } : {}),
	name: 'Colour by',
	type: 'string',
	editor: 'field-select',
	editor_options: { prefer: 'choices', placeholder: 'Auto — the collection’s color_by' },
	note: 'tint each record with its value’s enum colour',
});

// PAGE SIZE, on every list. It sets the request's `limit` — paging is server-side — and a grouped
// view DEFAULTS to All, because a band reading "12 of 40" is never a picture anyone wants. A
// default, not a prohibition: an explicit choice here still wins (lib/page-size.ts).
const pageSizeOption = (): OptionFieldDef => ({
	field: 'page_size',
	name: 'Page size',
	type: 'integer',
	editor: 'select-dropdown',
	editor_options: {
		choices: PAGE_SIZE_CHOICES.map((n) => ({ label: n === ALL ? 'All' : String(n), value: n })),
	},
	note: 'defaults to All while rows are grouped, otherwise 25',
});

// ROW DENSITY, on the table alone (Directus's compact · cozy · comfortable). `cozy` is the density
// every table drew before the option existed, so a view that never names it is unchanged; it is
// declared with a default rather than left blank so the drawer shows which one is in force. The
// toolbar's density menu writes the same key, so the two surfaces can never disagree
// (`lib/row-size.ts` is the one reader).
const rowSizeOption = (): OptionFieldDef => ({
	field: 'row_size',
	group: 'density',
	name: 'Row size',
	type: 'string',
	editor: 'select-dropdown',
	editor_options: { choices: ROW_SIZES.map((size) => ({ label: ROW_SIZE_LABELS[size], value: size })) },
	default: DEFAULT_ROW_SIZE,
	note: 'comfortable draws a leading picture at 48px with the title weighted, like a contacts list',
});

// Lists (terminology decision 2026-07-23): built-in browse arrangements re-register through the
// same door module `app` entries use. A List renders a whole collection (table / card grid).
// The table is a fixed frame too (operator 2026-08-08: "header including the columns and footer
// pager static, the vertical scroll area only the data rows"): DataTable owns a scroll box around
// its own <table>, so column headers stay pinned and the pager never walks off the bottom.
lists.register({
	id: 'table',
	name: 'Table',
	component: DataTable,
	fillsHeight: true,
	options: [rowSizeOption(), ...groupRowsOptions(), colorByOption(), pageSizeOption()],
});
// Cards declares self-describing options — a List's settings are an OptionFieldDef[] drawn by the
// ordinary Edit chain, and ListCards reads the chosen values back off `state.listOptions`.
// Aligned with the kanban's vocabulary 2026-07-31 (operator: "cards ui - align with kanban,
// display template etc"): the same `display-template` and `field-select` Edits, the same option
// names where the meaning is the same (`template`), so configuring one board teaches the other.
// A carousel per record over the images in the folder a `${env:…}` field points at — a reference
// product's frames, a meeting's screenshots. The images are not in a field: the host renders the
// template and lists the folder (`GET /folder/…`), and the layout only says WHICH field holds it.
lists.register({
	id: 'carousel',
	name: 'Carousel',
	component: ListCarousel,
	options: [
		{
			field: 'folder',
			group: 'card',
			name: 'Folder',
			type: 'string',
			editor: 'field-select',
			editor_options: { types: ['string'] },
			note: 'the `${env:…}/…` folder template the images live in; defaults to screenshots_folder, else the first *_folder field',
		},
		{
			field: 'text',
			group: 'card',
			name: 'Text',
			type: 'string',
			editor: 'field-select',
			editor_options: { types: ['string'] },
			note: 'shown under the title; defaults to description',
		},
	],
});

lists.register({
	id: 'cards',
	name: 'Cards',
	component: ListCards,
	options: [
		// The card's content, exactly as on a kanban card: markdown with `{{ field }}` tokens that
		// keep their own Views. Blank = the title + selected-columns card the grid has always shown.
		{
			field: 'card_title',
			group: 'card',
			name: 'Card title',
			type: 'string',
			editor: 'display-template',
			note: 'markdown; fields render through their own display. Blank = the record title + visible fields',
		},
		colorByOption('card'),
		// Which field the thumbnail comes from. Blank keeps the old behavior (the first visible field
		// whose View resolves to `image`) — an explicit pick is what makes a second image field, or a
		// plain string field holding an asset id, usable as the cover.
		{
			field: 'image',
			group: 'card',
			name: 'Image',
			type: 'string',
			editor: 'field-select',
			editor_options: { types: ['string'] },
			note: 'defaults to the first image field',
		},
		{
			field: 'image_fit',
			group: 'card',
			name: 'Image fit',
			type: 'string',
			editor: 'select-dropdown',
			editor_options: { choices: [{ label: 'Cover', value: 'cover' }, { label: 'Contain', value: 'contain' }] },
			default: 'cover',
		},
		...groupRowsOptions(),
		pageSizeOption(),
	],
});
// Layouts wave (operator ask 2026-07-27): kanban / calendar / map as core Lists — any collection
// gets a board (first enum field), a month calendar (first date/datetime field) and a map
// (lat/lng fields or {lat,lng} objects). All options overridable via the OptionsForm loop.
lists.register({
	id: 'kanban',
	name: 'Kanban',
	component: ListKanban,
	// A board is a fixed frame with scrolling columns, not a growing list of rows (operator
	// 2026-07-29: "each column should be 100% height … scroll should live inside each column").
	fillsHeight: true,
	options: [
		// A dropdown of the collection's own fields, enum-ish ones first (operator 2026-07-29). A
		// non-enum field is still a legal axis — the board derives those columns from the data — so
		// `prefer`, not a filter.
		{
			field: 'lanes_by',
			group: 'columns',
			name: 'Group columns by field',
			type: 'string',
			editor: 'field-select',
			// Blank really IS automatic on this axis — a board draws columns whether or not anyone
			// chose the field — which is exactly why the row axis may not borrow the same word.
			editor_options: { prefer: 'choices', placeholder: 'Auto — first enum field' },
			note: 'defaults to the first enum field',
		},
		// Directus parity (operator call 2026-07-29): OFF by default, so a record whose group value
		// is empty is not on the board until you ask for it. ListKanban shows a "N records hidden"
		// hint in that case rather than losing them silently, and hides this column entirely when
		// the group field is required (nothing to clear it to).
		{
			field: 'show_ungrouped_columns',
			group: 'columns',
			name: 'Show ungrouped column',
			type: 'boolean',
			default: false,
			note: 'a column for records with no value — drop a card there to clear the field',
			when: (v) => v['lanes_by'] !== '',
		},
		{
			field: 'show_empty_columns',
			group: 'columns',
			name: 'Show empty columns',
			type: 'boolean',
			default: true,
			note: 'a column is a drop target, so an empty one is still somewhere to drag to',
		},
		// The LANE axis. Blank = no lanes at all, and the board renders exactly as it has since it
		// shipped — a single horizontal strip. Any field is legal (an enum, a reference, a plain
		// string): the lane derives from data when the field declares no `choices`, same rule the
		// columns already follow. Presentation-only: dragging a card still patches the group_by
		// field alone, so lanes buy grouping without introducing a two-write gesture.
		...groupRowsOptions(),
		// Same discipline as `show_ungrouped` above, on the lane axis. A record with no lane value is
		// hidden by default (and reported as a hint), because a lane with a blank label reads as an
		// authoring accident.

		// The card's own display template: markdown, with `{{ field }}` tokens rendered through each
		// field's View (same syntax as a descriptor's `x-display`; lib/template.ts is the only
		// parser). Unset = the title + id card the board has always had.
		{
			field: 'card_title',
			group: 'card',
			name: 'Card title',
			type: 'string',
			editor: 'display-template',
			note: 'markdown; fields render through their own display. Blank = the record title + id',
		},
		colorByOption('card'),
		pageSizeOption(),
	],
});
// COUNTS (cr: nested ui-views) — one number per value of `group_by`, each a link to the list filtered
// to it: the at-a-glance panel a page view nests. The bands are `bucketize`'s, so the only options it
// declares are the row-band ones — the field, and whether the ungrouped and the empty values count.
// It SUMMARIZES: every row is counted (a grouped list requests All), and there is no page to turn.
lists.register({
	id: 'counts',
	name: 'Counts',
	component: ListCounts,
	summarizes: true,
	options: groupRowsOptions(),
});
lists.register({
	id: 'calendar',
	name: 'Calendar',
	component: ListCalendar,
	options: [
		// Same picker as the board's group_by, narrowed to the wire types a calendar can plot.
		{
			field: 'start',
			group: 'span',
			name: 'Start',
			type: 'string',
			editor: 'field-select',
			editor_options: { types: ['date', 'datetime'] },
			note: 'defaults to the first date, then datetime field',
		},
	],
});
lists.register({
	id: 'map',
	name: 'Map',
	component: ListMap,
	options: [
		// `object` is in the type list because ListMap also accepts a single `{lat,lng}` object field.
		{ field: 'lat', name: 'Latitude', type: 'string', editor: 'field-select', editor_options: { types: ['number', 'integer', 'string', 'object'] } },
		{ field: 'lng', name: 'Longitude', type: 'string', editor: 'field-select', editor_options: { types: ['number', 'integer', 'string', 'object'] } },
		// ON by default (operator 2026-08-11: the map "opens to show full globe"). A map that opens
		// on the whole world when it knows where its markers are is asking the operator to do the
		// zooming it could have done — so the interesting default is fit, and this switch exists for
		// the case where a fixed view is the point.
		{ field: 'auto_fit', name: 'Fit to markers on open', type: 'boolean', default: true, note: 'zoom to the plotted points; off keeps wherever the map was left' },
	],
});
// ONE diagram layout, not one per subject. What the nodes and edges are made OF is a provider,
// picked from an option — so the schema ERD and the record graph are the same layout with a
// different Source, and a new kind of diagram is a new provider rather than a new layout.
//
// It is a LAYOUT, not a page: `collections` is a collection and its records are the descriptors, so
// the data model draws through the same browse pipeline as everything else and saves as an ordinary
// `ui-view`. It fills height for the same reason the board does — the canvas owns its own panning,
// and a page scrollbar underneath a pannable diagram fights the gesture.
lists.register({
	id: 'diagram',
	name: 'Diagram',
	component: ListDiagram,
	fillsHeight: true,
	// Every control below is CONTEXTUAL — `when` hides what cannot apply to the current choices, so
	// the panel shows the four or five knobs that matter here instead of the twelve that exist
	// (operator 2026-08-11: "controls should be enabled disabled where they are relevant").
	options: [
		{
			field: 'link_by',
			group: 'links',
			name: 'Link by',
			type: 'string',
			editor: 'select-dropdown',
			editor_options: {
				choices: [
					{ label: 'References — typed relations', value: 'references' },
					{ label: 'Shared value — records carrying the same value', value: 'shared' },
					{ label: 'Values — each value becomes a node', value: 'values' },
					{ label: 'Schema — references inside collection descriptors', value: 'schema' },
				],
			},
			default: 'references',
			note: 'what makes an edge',
		},
		// TWO fields, not one with two `when` variants. A shared storage key meant flipping Link by
		// carried the chosen REFERENCE fields over as if they were value fields, silently — and it
		// forced OptionsForm to key rows by index to tolerate the duplicate.
		{
			field: 'ref_fields',
			group: 'links',
			name: 'Link fields',
			type: 'string',
			many: true,
			editor: 'field-multi-select',
			editor_options: { roles: ['reference', 'reference_many'] },
			note: 'which relations to draw — none ticked draws all of them',
			when: (v) => v['link_by'] === 'references',
		},
		{
			field: 'value_fields',
			group: 'links',
			name: 'Link fields',
			type: 'string',
			many: true,
			editor: 'field-multi-select',
			note: 'which fields hold the shared values',
			when: (v) => v['link_by'] === 'shared' || v['link_by'] === 'values',
		},
		{
			field: 'node',
			group: 'nodes',
			name: 'Node',
			type: 'string',
			editor: 'select-dropdown',
			editor_options: {
				choices: [
					{ label: 'Dot — size by connections', value: 'dot' },
					{ label: 'Box — a titled card', value: 'box' },
					{ label: 'Table — a box with field rows', value: 'table' },
				],
			},
			note: 'how a node is drawn',
		},
		{
			field: 'detail',
			group: 'nodes',
			name: 'Rows',
			type: 'string',
			editor: 'select-dropdown',
			editor_options: {
				choices: [
					{ label: 'Reference fields only', value: 'refs' },
					{ label: 'Every field', value: 'all' },
				],
			},
			note: 'a whole schema at every field does not fit a screen — reference-only usually does',
			when: (v) => v['node'] === 'table' && v['link_by'] === 'schema',
		},
		{
			field: 'label_template',
			group: 'nodes',
			name: 'Label',
			type: 'string',
			editor: 'display-template',
			note: 'what a node reads. empty = the collection’s own title template',
			when: (v) => v['link_by'] !== 'schema',
		},
		{
			field: 'hide_leaves',
			group: 'nodes',
			name: 'Hide leaf targets',
			type: 'boolean',
			// `=== true` in ListDiagram, so absent means OFF — declared so the toggle and the
			// behaviour cannot drift apart, the same reason the gantt's two say `true`.
			default: false,
			editor: 'boolean',
			note: 'drop referenced records that nothing else connects to',
			when: (v) => v['link_by'] !== 'schema',
		},
		{
			field: 'show_system',
			group: 'nodes',
			name: 'Engine collections',
			type: 'boolean',
			// `=== true` in ListDiagram, so absent means OFF — declared for the same reason.
			default: false,
			editor: 'boolean',
			note: 'include the engine’s own collections (skills, commands, ui-views…)',
			when: (v) => v['link_by'] === 'schema',
		},
		{
			field: 'show_isolated',
			group: 'nodes',
			name: 'Unconnected collections',
			type: 'boolean',
			// `=== true` in ListDiagram, so absent means OFF — declared for the same reason.
			default: false,
			editor: 'boolean',
			note: 'draw collections with no references either way (hidden by default)',
			when: (v) => v['link_by'] === 'schema',
		},
		{
			field: 'group_by',
			group: 'rows',
			name: 'Group by',
			type: 'string',
			editor: 'field-select',
			note: 'draw a container per distinct value',
			when: (v) => v['link_by'] !== 'schema',
		},
		{
			field: 'page_size',
			name: 'Records to draw',
			type: 'integer',
			editor: 'input-number',
			default: 500,
			note: 'a picture needs a bigger page than a table — narrowing is still the filter’s job',
		},
	],
});
// A GANTT is the calendar's other half: the calendar answers "what is happening on the 14th", this
// answers "what overlaps what, and for how long". Same BrowseState, same band derivation, same
// header component — the only thing new is the time axis, which is a CSS grid of day columns and no
// dependency at all.
//
// It fills height because the horizontal scroll has to live INSIDE the chart: a three-year plan is
// wider than any window, and dragging the whole browse sideways to see August moves the toolbar and
// the pager off screen with it.
lists.register({
	id: 'gantt',
	name: 'Gantt',
	component: ListGantt,
	fillsHeight: true,
	options: [
		// Blank IS automatic here (first date, then datetime) — the same fallback the calendar's
		// `start` makes, and the reason this placeholder may say "Auto" while the two below
		// may not: `test/unit/option-placeholders.test.ts` pins exactly that distinction.
		{
			field: 'start',
			group: 'span',
			name: 'Start',
			type: 'string',
			editor: 'field-select',
			editor_options: { types: ['date', 'datetime'], placeholder: 'Auto — first date field' },
			note: 'the bar’s left edge. A record without one is listed in the undated tail, never dropped',
		},
		// NOT inferred. A second date field is as likely to be `reviewed_on` as an end, and inventing
		// a duration nobody authored is worse than drawing a point.
		{
			field: 'end',
			group: 'span',
			name: 'End',
			type: 'string',
			editor: 'field-select',
			editor_options: { types: ['date', 'datetime'], placeholder: 'None — a point, not a bar' },
			note: 'the bar’s right edge. An end before its start is drawn as a marked point, never hidden',
		},
		// ⚠ DEFAULT TRUE, the same shape and the same argument as `start_collapsed` one axis over. A
		// year-long plan spends most of its width on months in which nothing starts and nothing ends,
		// and the shape of the year is the one thing that width hides. Off restores the uniform axis.
		//
		// No threshold option, deliberately: the budget is 120 wasted pixels at the chart's unfolded
		// scale, which is a constant with a comment in `lib/gantt-axis.ts`. A dropdown here would be a
		// second way to say what the data already says — the same reason the SCALE has no option.
		{
			field: 'fold_gaps',
			group: 'span',
			name: 'Fold dead time',
			type: 'boolean',
			// ⚠ DECLARED, because the component reads `!== false` — so with no `default` here the
			// toggle rendered OFF while the behaviour was ON. Caught in a screenshot of the live panel: "Fold dead time" showed off over a chart that was visibly folded.
			default: true,
			editor: 'boolean',
			note: 'default ON — a long run where nothing starts or ends becomes one narrow column a click opens',
		},
		// The text that rides in the timeline beside or inside each bar. Blank is NOT "no label" — it
		// is the record's own title, because the 180px gutter truncates anything longer than about
		// 24 characters and the chart next to it is mostly empty space. Naming a field here overrides
		// what the bar says without touching what the gutter says; the two are different questions.
		{
			field: 'bar_label',
			group: 'bars',
			name: 'Bar label',
			type: 'string',
			editor: 'field-select',
			editor_options: { placeholder: 'Auto — the record title' },
			note: 'text drawn in the timeline: inside the bar when it fits, beside it when it does not',
		},
		// The same option name, the same Edit and the same syntax the cards and the kanban use for
		// their card body — one template idea, configured one way, wherever a layout draws text from
		// a record. It WINS over `bar_label`, which stays because a one-field label needs no
		// braces and every view that set it keeps working.
		//
		// ⚠ Rendered as PLAIN TEXT here, not markdown-with-Views like a card. A bar label is one line
		// inside a 16px rounded rectangle that may be three pixels wide; a chip or an image in there
		// is not a smaller card, it is a broken bar. Same syntax, same parser, different rendering,
		// chosen by what the surface can hold — ListGantt's `barLabel` carries that argument.
		{
			field: 'template',
			group: 'bars',
			name: 'Bar label template',
			type: 'string',
			editor: 'display-template',
			editor_options: { placeholder: 'Blank — the bar label field, else the record title' },
			note: 'e.g. `{{ name }} — {{ status }}`; plain text, one line. Wins over the field above',
		},
		{
			field: 'color_by',
			group: 'bars',
			name: 'Colour by',
			type: 'string',
			editor: 'field-select',
			// `prefer`, not a filter — colouring by a plain string field is legal, it just takes its
			// colours from the palette instead of from the enum's own.
			editor_options: { prefer: 'choices', placeholder: 'Auto — the collection’s color_by, else one colour' },
			note: 'a value’s own enum colour when it has one, otherwise a stable palette slot',
		},
		// The band axis, shared with every other list. The gantt is the first caller to ask for the
		// MULTI mode: a group field holding a list puts the record in one band per value.
		...groupRowsOptions(),
		// What a BAND is called, when its value is a reference. Blank is not "no label": it is the
		// referenced record rendered through its collection's `record_title` — what a relation CELL
		// for it shows — and only when that is absent does the band fall back to the de-slugged last
		// segment of the path. Setting this overrides both, for this view only. (`lib/group-label.ts`.)
		{
			field: 'group_title',
			group: 'rows',
			name: 'Band title',
			type: 'string',
			editor: 'display-template',
			editor_options: { placeholder: 'Auto — the referenced record’s own display' },
			note: 'rendered against the record a band’s value points at, e.g. `{{ name }}`',
			when: (v) => typeof v['group_by'] === 'string' && !!v['group_by'],
		},
		// What a BAND shows beside its name. Blank is not "no picture": the referenced record is
		// probed for `avatar`, then `icon`, then `image` — the three names a record uses for the same
		// idea — and a resolved face WINS over a codicon the enum declared, because a glyph standing
		// in for a person is exactly what the face replaces.
		{
			field: 'group_icon',
			group: 'rows',
			name: 'Band icon',
			type: 'string',
			editor: 'string',
			editor_options: { placeholder: 'Auto — the record’s avatar, icon or image' },
			note: 'a field on the REFERENCED record holding a picture or a codicon name',
			when: (v) => typeof v['group_by'] === 'string' && !!v['group_by'],
		},
		// What a band SAYS about itself, on the one line beside its name — rendered against the record
		// the band points at, so a project's own rolled-up numbers ("12 activities · 41 decisions ·
		// building") land there without the view computing anything. Blank falls back to the enum's
		// own `description`, which is the same idea authored in the schema instead of in the view.
		{
			field: 'group_summary',
			group: 'rows',
			name: 'Band summary',
			type: 'string',
			editor: 'display-template',
			editor_options: { placeholder: 'Blank — the choice’s own description, if it has one' },
			note: 'one line, rendered against the referenced record — e.g. `{{ status }} · {{ activities_count }} activities`',
			when: (v) => typeof v['group_by'] === 'string' && !!v['group_by'],
		},
		// ⚠ DEFAULT TRUE, and deliberately so. Expanded, a grouped chart of a few hundred records
		// opens as a wall in which the shape of the year is the one thing you cannot see; collapsed,
		// each lane is one row carrying its extent bar and its summary. Only applies when grouped.
		{
			field: 'start_collapsed',
			group: 'rows',
			name: 'Start collapsed',
			type: 'boolean',
			// ⚠ DECLARED, because the component reads `!== false` — so with no `default` here the
			// toggle rendered OFF while the behaviour was ON. Same defect, same cause, one axis over.
			default: true,
			editor: 'boolean',
			note: 'default ON — every lane opens shut, showing its extent bar and summary; a click opens one',
			when: (v) => typeof v['group_by'] === 'string' && !!v['group_by'],
		},
		pageSizeOption(),
	],
});
// Record pages are Edits/Views too (terminology decision 1): the record-scoped built-ins. The old
// `form`/`doc` item-layouts unify here — `form` is the built-in record-scoped Edit, `doc` the
// record-scoped View. ItemForm backs both (it renders read-only in `view`/`doc` mode via its
// existing `readonly` prop — there is no separate rendered-markdown component in the ported studio
// yet, so `doc` currently IS the form presentation in a read-only skin; a module may register a
// richer record-scoped View later).
edits.register({ id: 'form', name: 'Form', component: ItemForm, types: [], scope: 'record' });
views.register({ id: 'doc', name: 'Doc', component: ItemForm, types: [], scope: 'record' });
// The DEFAULT record page since 2026-07-29 (operator: "obsidian layout looks sooo much better,
// lets do the same") — `lib/presets.ts`'s `builtinRenderer` resolves item targets to this id for
// both modes. One id on both registries: it backs view AND edit of the same page, so the pencil
// swaps widgets in place instead of remounting a different component. `form`/`doc` above stay
// registered so a `.schema/presets` record that pinned them keeps the two-column form.
edits.register({ id: 'properties', name: 'Properties', component: ItemProperties, types: [], scope: 'record' });
views.register({ id: 'properties', name: 'Properties', component: ItemProperties, types: [], scope: 'record' });
// The collection designer, as a record renderer. `collections` is a collection and a descriptor is
// one of its records, so field editing is how such a record is DRAWN — not a page you navigate to.
// Registered on both registries like `properties`, so the pencil does not remount a different
// component; which collection uses it is said by that collection's `display.record.layout:
// data-model` (descriptor v2 §3.5), not by code that knows what `collections` is.
edits.register({ id: 'data-model', name: 'Designer', component: DataModelRecord, types: [], scope: 'record' });
views.register({ id: 'data-model', name: 'Designer', component: DataModelRecord, types: [], scope: 'record' });

// Apps (spec §8): Content and Settings are the first two registered apps — the shell dogfoods
// the app API. Their route trees (formerly hardcoded in router.ts) are contributed here; router.ts
// now assembles its route table from the apps registry. Module apps register later (modules.ts)
// and mount under `/a/<id>`; these two keep their absolute paths, so they set `to`/`match`
// explicitly rather than defaulting to `/a/<id>`.
apps.register({
	id: 'content',
	icon: 'database',
	label: 'Content',
	to: '/',
	match: ['/content'],
	routes: [{ path: '/content/:path(.*)', name: 'content', component: ContentBrowse }],
});
apps.register({
	id: 'settings',
	icon: 'settings',
	label: 'Settings',
	to: '/settings/schema',
	match: ['/settings'],
	routes: [
		// THE SCHEMA TAB. One component, three routes, greedy on the tail for the same reason the
		// content route is: a kind's id may carry a slash — a namespaced collection name
		// (`health/doctors`) or a slash-path record id. `SchemaTab` splits kind from id itself
		// (lib/schema-rail.ts#splitSchemaRoute), which keeps that decision testable.
		{ path: '/settings/schema', name: 'schema', component: SchemaTab },
		{ path: '/settings/schema/:path(.*)', name: 'schema-kind', component: SchemaTab },
		// `/settings/data-model[/<name>]` FOLDS IN as a redirect rather than a second mount. Two homes
		// for one thing is how the Data Model page came to exist in two places at once; a redirect keeps
		// every existing link working for free — DataModelList's own row links, the post-create push in
		// CreateCollectionDialog, the designer's breadcrumb and its cancel push, and any tab the
		// operator has pinned. `titles.ts` KEEPS its `/settings/data-model/*` clauses for the same
		// reason: a restored tab must title itself before the app has booted far enough to redirect.
		//
		// ⚠ The query rides along explicitly. A redirect that returns a bare string drops it, and
		// `?field=<name>` is a deep link into ONE field's drawer — the link a generated mirror follows
		// to the field that owns it.
		{ path: '/settings/data-model', redirect: () => ({ path: '/settings/schema/collections' }) },
		{
			path: '/settings/data-model/:path(.*)',
			redirect: (to) => {
				const param = to.params['path'];
				const tail = Array.isArray(param) ? param.join('/') : ((param as string | undefined) ?? '');
				return { path: `/settings/schema/collections/${tail}`, query: to.query };
			},
		},
		// `group: system` collections (workflows, agents, users, …) browse here rather than under
		// /content/* — same ContentBrowse dispatcher, but staying under /settings/* keeps
		// NavSidebar's mode (and its Settings list) from flipping back to Content on row click/create
		// (operator ask 2026-07-26, item 3). `currentContentBasePath` (lib/content-path.ts) recovers
		// this route's '/settings/system/' prefix so browse-state/ContentDetail push links stay here.
		{ path: '/settings/system/:path(.*)', name: 'settings-system', component: ContentBrowse },
	],
});
