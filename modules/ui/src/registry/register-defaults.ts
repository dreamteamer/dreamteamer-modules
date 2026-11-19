/**
 * The built-in Edits and Views, registered through the same door a module's `app` entry uses — under
 * the Vue ui's ids and with its `types` arrays, so a field naming `editor: textarea` or `viewer: label`
 * draws the same kind of thing in either app. Imported once for its side effect, before the first render.
 *
 * `types` advertises an entry as a kind-default CANDIDATE for those wire types; the actual default lives in one
 * place, `kindDefaultEdits`/`kindDefaultViews` (registry/index.ts). `types: []` is reachable only by an authored
 * id (`slider`, `color`, `code`, `progress`, `filesize`, `image`: a bare number or string defaulting to any of
 * those would be wrong for nearly every such field) or by SHAPE in resolve.ts (`tags`, `list`, `nested`,
 * `markdown-body`, `relation-picker`, `select-dropdown`, `label`, `relation`).
 *
 * The Lists — a collection's browse arrangements — register here too, under the Vue ui's ids and option keys: `table`,
 * `cards`, `kanban`, `calendar`, `gantt`, `carousel`, `counts`, `map` and `diagram`, with the options every list
 * shares (grouping, colour, page size) and each one's own. A view naming any other id is drawn as a table, and the
 * browse says so.
 *
 * The RECORD-SCOPED entries draw a whole record page (`RecordLayoutProps`): `properties` (the built-in, both an
 * Edit and a View, so the pencil flips it in place), `form` (an Edit) and `doc` (its read-only View). A
 * collection's `display.record.layout` names one; `page` means the built-in. Not here yet: `data-model`.
 */
import { EditBoolean } from "../edits/EditBoolean.tsx"
import { EditCode } from "../edits/EditCode.tsx"
import { EditColor } from "../edits/EditColor.tsx"
import { EditDatetime } from "../edits/EditDatetime.tsx"
import { EditDisplayTemplate } from "../edits/EditDisplayTemplate.tsx"
import { EditFieldMultiSelect } from "../edits/EditFieldMultiSelect.tsx"
import { EditFieldSelect } from "../edits/EditFieldSelect.tsx"
import { EditInput } from "../edits/EditInput.tsx"
import { EditJson } from "../edits/EditJson.tsx"
import { EditList } from "../edits/EditList.tsx"
import { EditMarkdownBody } from "../edits/EditMarkdownBody.tsx"
import { EditNested } from "../edits/EditNested.tsx"
import { EditNumber } from "../edits/EditNumber.tsx"
import { EditRelation } from "../edits/EditRelation.tsx"
import { EditSelect } from "../edits/EditSelect.tsx"
import { EditSlider } from "../edits/EditSlider.tsx"
import { EditTags } from "../edits/EditTags.tsx"
import { EditTextarea } from "../edits/EditTextarea.tsx"
import { DataModelRecord } from "../record/DataModelRecord.tsx"
import { RecordForm } from "../record/RecordForm.tsx"
import { RecordProperties } from "../record/RecordProperties.tsx"
import { ViewBoolean } from "../views/ViewBoolean.tsx"
import { ViewColor } from "../views/ViewColor.tsx"
import { ViewDate } from "../views/ViewDate.tsx"
import { ViewFilesize } from "../views/ViewFilesize.tsx"
import { ViewImage } from "../views/ViewImage.tsx"
import { ViewJson } from "../views/ViewJson.tsx"
import { ViewLabel } from "../views/ViewLabel.tsx"
import { ViewList } from "../views/ViewList.tsx"
import { ViewMarkdown } from "../views/ViewMarkdown.tsx"
import { ViewNested } from "../views/ViewNested.tsx"
import { ViewProgress } from "../views/ViewProgress.tsx"
import { ViewRelation } from "../views/ViewRelation.tsx"
import { ViewSource } from "../views/ViewSource.tsx"
import { ViewStageChecks } from "../views/ViewStageChecks.tsx"
import { ViewTags } from "../views/ViewTags.tsx"
import { ViewText } from "../views/ViewText.tsx"
import { ListCalendar } from "../lists/ListCalendar.tsx"
import { ListCards } from "../lists/ListCards.tsx"
import { ListCarousel } from "../lists/ListCarousel.tsx"
import { ListCounts } from "../lists/ListCounts.tsx"
import { ListDiagram } from "../lists/ListDiagram.tsx"
import { ListGantt } from "../lists/ListGantt.tsx"
import { ListKanban } from "../lists/ListKanban.tsx"
import { ListMap } from "../lists/ListMap.tsx"
import { ListTable } from "../lists/ListTable.tsx"
import { ALL, PAGE_SIZE_CHOICES } from "../lib/pageSize.ts"
import { DEFAULT_ROW_SIZE, ROW_SIZES, ROW_SIZE_LABELS } from "../lib/rowSize.ts"
import { edits, lists, optionRows, views, type OptionFieldDef } from "./index.ts"

edits.register({ id: "input", name: "Input", component: EditInput, types: ["string", "url", "email", "position"] })
edits.register({ id: "textarea", name: "Textarea", component: EditTextarea, types: ["markdown"] })
edits.register({ id: "input-number", name: "Number", component: EditNumber, types: ["number", "integer"] })
edits.register({ id: "boolean", name: "Boolean", component: EditBoolean, types: ["boolean"] })
edits.register({ id: "datetime", name: "Datetime", component: EditDatetime, types: ["date", "datetime"] })
edits.register({
  id: "select-dropdown",
  name: "Select",
  component: EditSelect,
  types: ["string"],
  recommendedViews: ["label"],
  options: [
    {
      field: "choices",
      name: "Choices",
      type: "object",
      many: true,
      editor: "list",
      editor_options: {
        fields: optionRows([
          { field: "label", name: "Label", type: "string" },
          { field: "value", name: "Value", type: "string" },
        ]),
        item_title: "{{ label }}",
      },
    },
  ],
})
edits.register({ id: "markdown-body", name: "Markdown Body", component: EditMarkdownBody, types: ["markdown"] })
edits.register({ id: "relation-picker", name: "Relation Picker", component: EditRelation, types: ["string"] })
edits.register({ id: "tags", name: "Tags", component: EditTags, types: [] })
edits.register({ id: "slider", name: "Slider", component: EditSlider, types: [] })
edits.register({ id: "color", name: "Color", component: EditColor, types: [] })
edits.register({ id: "code", name: "Code", component: EditCode, types: [] })
// a JSON array is indistinguishable by wire type from any other json value, so `list` is never kind-inferred
edits.register({ id: "list", name: "List", component: EditList, types: [] })
edits.register({ id: "nested", name: "Nested", component: EditNested, types: [] })
// two Edits for CONFIGURING a collection rather than editing a record's value — they read the ambient field
// context (render/FieldContext.tsx) and degrade to a plain input where none is provided
edits.register({ id: "field-select", name: "Field", component: EditFieldSelect, types: [] })
edits.register({ id: "field-multi-select", name: "Fields", component: EditFieldMultiSelect, types: [] })
edits.register({ id: "display-template", name: "Display Template", component: EditDisplayTemplate, types: [] })
edits.register({ id: "json", name: "JSON", component: EditJson, types: ["object", "map"] })

views.register({ id: "text", name: "Text", component: ViewText, types: [] })
views.register({ id: "markdown", name: "Markdown", component: ViewMarkdown, types: [] })
views.register({ id: "boolean", name: "Boolean", component: ViewBoolean, types: ["boolean"] })
views.register({ id: "date", name: "Date", component: ViewDate, types: ["date", "datetime"] })
views.register({ id: "label", name: "Label", component: ViewLabel, types: [] })
views.register({ id: "relation", name: "Relation", component: ViewRelation, types: [] })
views.register({ id: "image", name: "Image", component: ViewImage, types: [] })
views.register({ id: "tags", name: "Tags", component: ViewTags, types: [] })
views.register({ id: "color", name: "Color", component: ViewColor, types: [] })
views.register({ id: "progress", name: "Progress", component: ViewProgress, types: [] })
views.register({ id: "filesize", name: "File Size", component: ViewFilesize, types: [] })
// the `$source` column's mark — reached by the synthetic row's own `viewer`, never a type default
views.register({ id: "source", name: "Source", component: ViewSource, types: [] })
// a tags field's stages as checks — reached only by an authored `viewer: stage-checks`
views.register({ id: "stage-checks", name: "Stage checks", component: ViewStageChecks, types: [] })
// safe as the json kind default: ViewJson branches on the value's actual shape
views.register({ id: "json", name: "JSON", component: ViewJson, types: ["object", "map"] })
views.register({ id: "list", name: "List", component: ViewList, types: [] })
views.register({ id: "nested", name: "Nested", component: ViewNested, types: [] })

// ── record pages ────────────────────────────────────────────────────────────────────────────────────────────
edits.register({ id: "properties", name: "Properties", component: RecordProperties, types: [], scope: "record" })
views.register({ id: "properties", name: "Properties", component: RecordProperties, types: [], scope: "record" })
edits.register({ id: "form", name: "Form", component: RecordForm, types: [], scope: "record" })
views.register({ id: "doc", name: "Doc", component: RecordForm, types: [], scope: "record" })
// a record of `collections` drawn as its designer (`display.record.layout: data-model`)
edits.register({ id: "data-model", name: "Data model", component: DataModelRecord, types: [], scope: "record" })
views.register({ id: "data-model", name: "Data model", component: DataModelRecord, types: [], scope: "record" })

// ── options every list shares ────────────────────────────────────────────────────────────────────────────
// GROUPING IS ONE CONCEPT WITH TWO AXES, NAMED FOR THE AXIS: `group_by` makes horizontal bands and every list has
// it; `lanes_by` makes the kanban's columns. An option that takes a field is named for the role the field plays,
// with no `_field` suffix (descriptor v2 §3.5.1); `lib/listOptions.ts` knows the old spellings.
const groupRowsOptions = (): OptionFieldDef[] => [
  {
    field: "group_by",
    group: "rows",
    name: "Group by",
    type: "string",
    editor: "field-select",
    // `prefer`, not a filter: a non-enum field is a legal axis too, and blank means no bands at all
    editor_options: { prefer: "choices", placeholder: "None — no bands" },
    note: "horizontal bands, one per value — blank leaves the list ungrouped",
  },
  {
    field: "show_ungrouped_rows",
    group: "rows",
    name: "Show ungrouped band",
    type: "boolean",
    default: false,
    note: "a band for records with no value",
    when: v => typeof v["group_by"] === "string" && !!v["group_by"],
  },
  // empty BANDS default to hidden (a band is not a drop target), empty kanban COLUMNS to shown (a column is)
  {
    field: "show_empty_rows",
    group: "rows",
    name: "Show empty bands",
    type: "boolean",
    default: false,
    note: "keep a band whose value has no records",
    when: v => typeof v["group_by"] === "string" && !!v["group_by"],
  },
]

// blank is the collection's own `display.record.color_by` — the view's key wins, the collection's is the default
const colorByOption = (group?: string): OptionFieldDef => ({
  field: "color_by",
  ...(group ? { group } : {}),
  name: "Colour by",
  type: "string",
  editor: "field-select",
  editor_options: { prefer: "choices", placeholder: "Auto — the collection’s color_by" },
  note: "tint each record with its value’s enum colour",
})

// paging is server-side; a grouped view defaults to All (`lib/pageSize.ts`), an explicit choice still wins
const pageSizeOption = (): OptionFieldDef => ({
  field: "page_size",
  name: "Page size",
  type: "integer",
  editor: "select-dropdown",
  editor_options: {
    choices: PAGE_SIZE_CHOICES.map(n => ({ label: n === ALL ? "All" : String(n), value: n })),
  },
  note: "defaults to All while rows are grouped, otherwise 25",
})

// the table's density; the header's density menu writes the same key (`lib/rowSize.ts` is the one reader)
const rowSizeOption = (): OptionFieldDef => ({
  field: "row_size",
  group: "density",
  name: "Row size",
  type: "string",
  editor: "select-dropdown",
  editor_options: { choices: ROW_SIZES.map(size => ({ label: ROW_SIZE_LABELS[size], value: size })) },
  default: DEFAULT_ROW_SIZE,
  note: "comfortable draws a leading picture at 48px with the title weighted, like a contacts list",
})

lists.register({
  id: "table",
  name: "Table",
  component: ListTable,
  fillsHeight: true,
  options: [rowSizeOption(), ...groupRowsOptions(), colorByOption(), pageSizeOption()],
})

// a card's content, the same option on the grid and the board: markdown whose `{{ field }}` tokens keep their Views
const cardTitleOption = (blank: string): OptionFieldDef => ({
  field: "card_title",
  group: "card",
  name: "Card title",
  type: "string",
  editor: "display-template",
  note: `markdown; fields render through their own display. Blank = ${blank}`,
})

lists.register({
  id: "cards",
  name: "Cards",
  component: ListCards,
  options: [
    cardTitleOption("the record title + visible fields"),
    colorByOption("card"),
    // blank keeps the auto-pick (the first field whose View is `image`) — an explicit pick makes a second image
    // field, or a plain string holding a file reference, usable as the cover
    {
      field: "image",
      group: "card",
      name: "Image",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["string"] },
      note: "defaults to the first image field",
    },
    {
      field: "image_fit",
      group: "card",
      name: "Image fit",
      type: "string",
      editor: "select-dropdown",
      editor_options: {
        choices: [
          { label: "Cover", value: "cover" },
          { label: "Contain", value: "contain" },
        ],
      },
      default: "cover",
    },
    ...groupRowsOptions(),
    pageSizeOption(),
  ],
})

// a board is a fixed frame with columns that each scroll their own cards — it fills the page
lists.register({
  id: "kanban",
  name: "Kanban",
  component: ListKanban,
  fillsHeight: true,
  options: [
    // `prefer`, not a filter: a non-enum field is a legal column axis too, its columns drawn from the data
    {
      field: "lanes_by",
      group: "columns",
      name: "Group columns by field",
      type: "string",
      editor: "field-select",
      editor_options: { prefer: "choices", placeholder: "Auto — first enum field" },
      note: "defaults to the first enum field",
    },
    {
      field: "show_ungrouped_columns",
      group: "columns",
      name: "Show ungrouped column",
      type: "boolean",
      default: false,
      note: "a column for records with no value — drop a card there to clear the field",
      when: v => v["lanes_by"] !== "",
    },
    {
      field: "show_empty_columns",
      group: "columns",
      name: "Show empty columns",
      type: "boolean",
      default: true,
      note: "a column is a drop target, so an empty one is still somewhere to drag to",
    },
    // the LANE axis: blank is the single strip; a drag still writes the column field alone
    ...groupRowsOptions(),
    cardTitleOption("the record title + id"),
    colorByOption("card"),
    pageSizeOption(),
  ],
})

// ── the other layouts (step 8): under the Vue ui's ids, with the Vue ui's options ────────────────────────────────────────────
// A carousel per record over the images in the folder a `${env:…}` field points at — the host renders the template
// and lists the folder (`GET /folder/…`); the layout only says WHICH field holds it.
lists.register({
  id: "carousel",
  name: "Carousel",
  component: ListCarousel,
  options: [
    {
      field: "folder",
      group: "card",
      name: "Folder",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["string"] },
      note: "the `${env:…}/…` folder template the images live in; defaults to screenshots_folder, else the first *_folder field",
    },
    {
      field: "text",
      group: "card",
      name: "Text",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["string"] },
      note: "shown under the title; defaults to description",
    },
  ],
})

lists.register({
  id: "counts",
  name: "Counts",
  component: ListCounts,
  summarizes: true,
  options: groupRowsOptions(),
})

lists.register({
  id: "calendar",
  name: "Calendar",
  component: ListCalendar,
  options: [
    // Same picker as the board's group_by, narrowed to the wire types a calendar can plot.
    {
      field: "start",
      group: "span",
      name: "Start",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["date", "datetime"] },
      note: "defaults to the first date, then datetime field",
    },
  ],
})

lists.register({
  id: "map",
  name: "Map",
  component: ListMap,
  options: [
    // `object` is in the type list because ListMap also accepts a single `{lat,lng}` object field.
    {
      field: "lat",
      name: "Latitude",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["number", "integer", "string", "object"] },
    },
    {
      field: "lng",
      name: "Longitude",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["number", "integer", "string", "object"] },
    },
    // ON by default (operator 2026-08-11: the map "opens to show full globe"). A map that opens
    // on the whole world when it knows where its markers are is asking the operator to do the
    // zooming it could have done — so the interesting default is fit, and this switch exists for
    // the case where a fixed view is the point.
    {
      field: "auto_fit",
      name: "Fit to markers on open",
      type: "boolean",
      default: true,
      note: "zoom to the plotted points; off keeps wherever the map was left",
    },
  ],
})

lists.register({
  id: "diagram",
  name: "Diagram",
  component: ListDiagram,
  fillsHeight: true,
  // Every control below is CONTEXTUAL — `when` hides what cannot apply to the current choices, so
  // the panel shows the four or five knobs that matter here instead of the twelve that exist
  // (operator 2026-08-11: "controls should be enabled disabled where they are relevant").
  options: [
    {
      field: "link_by",
      group: "links",
      name: "Link by",
      type: "string",
      editor: "select-dropdown",
      editor_options: {
        choices: [
          { label: "References — typed relations", value: "references" },
          { label: "Shared value — records carrying the same value", value: "shared" },
          { label: "Values — each value becomes a node", value: "values" },
          { label: "Schema — references inside collection descriptors", value: "schema" },
        ],
      },
      default: "references",
      note: "what makes an edge",
    },
    // TWO fields, not one with two `when` variants. A shared storage key meant flipping Link by
    // carried the chosen REFERENCE fields over as if they were value fields, silently — and it
    // forced OptionsForm to key rows by index to tolerate the duplicate.
    {
      field: "ref_fields",
      group: "links",
      name: "Link fields",
      type: "string",
      many: true,
      editor: "field-multi-select",
      editor_options: { roles: ["reference", "reference_many"] },
      note: "which relations to draw — none ticked draws all of them",
      when: v => v["link_by"] === "references",
    },
    {
      field: "value_fields",
      group: "links",
      name: "Link fields",
      type: "string",
      many: true,
      editor: "field-multi-select",
      note: "which fields hold the shared values",
      when: v => v["link_by"] === "shared" || v["link_by"] === "values",
    },
    {
      field: "node",
      group: "nodes",
      name: "Node",
      type: "string",
      editor: "select-dropdown",
      editor_options: {
        choices: [
          { label: "Dot — size by connections", value: "dot" },
          { label: "Box — a titled card", value: "box" },
          { label: "Table — a box with field rows", value: "table" },
        ],
      },
      note: "how a node is drawn",
    },
    {
      field: "detail",
      group: "nodes",
      name: "Rows",
      type: "string",
      editor: "select-dropdown",
      editor_options: {
        choices: [
          { label: "Reference fields only", value: "refs" },
          { label: "Every field", value: "all" },
        ],
      },
      note: "a whole schema at every field does not fit a screen — reference-only usually does",
      when: v => v["node"] === "table" && v["link_by"] === "schema",
    },
    {
      field: "label_template",
      group: "nodes",
      name: "Label",
      type: "string",
      editor: "display-template",
      note: "what a node reads. empty = the collection’s own title template",
      when: v => v["link_by"] !== "schema",
    },
    {
      field: "hide_leaves",
      group: "nodes",
      name: "Hide leaf targets",
      type: "boolean",
      // `=== true` in ListDiagram, so absent means OFF — declared so the toggle and the
      // behaviour cannot drift apart, the same reason the gantt's two say `true`.
      default: false,
      editor: "boolean",
      note: "drop referenced records that nothing else connects to",
      when: v => v["link_by"] !== "schema",
    },
    {
      field: "show_system",
      group: "nodes",
      name: "Engine collections",
      type: "boolean",
      // `=== true` in ListDiagram, so absent means OFF — declared for the same reason.
      default: false,
      editor: "boolean",
      note: "include the engine’s own collections (skills, commands, ui-views…)",
      when: v => v["link_by"] === "schema",
    },
    {
      field: "show_isolated",
      group: "nodes",
      name: "Unconnected collections",
      type: "boolean",
      // `=== true` in ListDiagram, so absent means OFF — declared for the same reason.
      default: false,
      editor: "boolean",
      note: "draw collections with no references either way (hidden by default)",
      when: v => v["link_by"] === "schema",
    },
    {
      field: "group_by",
      group: "rows",
      name: "Group by",
      type: "string",
      editor: "field-select",
      note: "draw a container per distinct value",
      when: v => v["link_by"] !== "schema",
    },
    {
      field: "page_size",
      name: "Records to draw",
      type: "integer",
      editor: "input-number",
      default: 500,
      note: "a picture needs a bigger page than a table — narrowing is still the filter’s job",
    },
  ],
})

lists.register({
  id: "gantt",
  name: "Gantt",
  component: ListGantt,
  fillsHeight: true,
  options: [
    // Blank IS automatic here (first date, then datetime) — the same fallback the calendar's
    // `start` makes, and the reason this placeholder may say "Auto" while the two below
    // may not (the Vue ui's option-placeholders test pins that distinction).
    {
      field: "start",
      group: "span",
      name: "Start",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["date", "datetime"], placeholder: "Auto — first date field" },
      note: "the bar’s left edge. A record without one is listed in the undated tail, never dropped",
    },
    // NOT inferred. A second date field is as likely to be `reviewed_on` as an end, and inventing
    // a duration nobody authored is worse than drawing a point.
    {
      field: "end",
      group: "span",
      name: "End",
      type: "string",
      editor: "field-select",
      editor_options: { types: ["date", "datetime"], placeholder: "None — a point, not a bar" },
      note: "the bar’s right edge. An end before its start is drawn as a marked point, never hidden",
    },
    // ⚠ DEFAULT TRUE, the same shape and the same argument as `start_collapsed` one axis over. A
    // year-long plan spends most of its width on months in which nothing starts and nothing ends,
    // and the shape of the year is the one thing that width hides. Off restores the uniform axis.
    //
    // No threshold option, deliberately: the budget is 120 wasted pixels at the chart's unfolded
    // scale, which is a constant with a comment in `lib/ganttAxis.ts`. A dropdown here would be a
    // second way to say what the data already says — the same reason the SCALE has no option.
    {
      field: "fold_gaps",
      group: "span",
      name: "Fold dead time",
      type: "boolean",
      // ⚠ DECLARED, because the component reads `!== false` — so with no `default` here the
      // toggle rendered OFF while the behaviour was ON. Caught in a screenshot of the live panel: "Fold dead time" showed off over a chart that was visibly folded.
      default: true,
      editor: "boolean",
      note: "default ON — a long run where nothing starts or ends becomes one narrow column a click opens",
    },
    // The text that rides in the timeline beside or inside each bar. Blank is NOT "no label" — it
    // is the record's own title, because the 180px gutter truncates anything longer than about
    // 24 characters and the chart next to it is mostly empty space. Naming a field here overrides
    // what the bar says without touching what the gutter says; the two are different questions.
    {
      field: "bar_label",
      group: "bars",
      name: "Bar label",
      type: "string",
      editor: "field-select",
      editor_options: { placeholder: "Auto — the record title" },
      note: "text drawn in the timeline: inside the bar when it fits, beside it when it does not",
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
      field: "template",
      group: "bars",
      name: "Bar label template",
      type: "string",
      editor: "display-template",
      editor_options: { placeholder: "Blank — the bar label field, else the record title" },
      note: "e.g. `{{ name }} — {{ status }}`; plain text, one line. Wins over the field above",
    },
    {
      field: "color_by",
      group: "bars",
      name: "Colour by",
      type: "string",
      editor: "field-select",
      // `prefer`, not a filter — colouring by a plain string field is legal, it just takes its
      // colours from the palette instead of from the enum's own.
      editor_options: { prefer: "choices", placeholder: "Auto — the collection’s color_by, else one colour" },
      note: "a value’s own enum colour when it has one, otherwise a stable palette slot",
    },
    // The band axis, shared with every other list. The gantt is the first caller to ask for the
    // MULTI mode: a group field holding a list puts the record in one band per value.
    ...groupRowsOptions(),
    // What a BAND is called, when its value is a reference. Blank is not "no label": it is the
    // referenced record rendered through its collection's `record_title` — what a relation CELL
    // for it shows — and only when that is absent does the band fall back to the de-slugged last
    // segment of the path. Setting this overrides both, for this view only. (`lib/groupLabel.ts`.)
    {
      field: "group_title",
      group: "rows",
      name: "Band title",
      type: "string",
      editor: "display-template",
      editor_options: { placeholder: "Auto — the referenced record’s own display" },
      note: "rendered against the record a band’s value points at, e.g. `{{ name }}`",
      when: v => typeof v["group_by"] === "string" && !!v["group_by"],
    },
    // What a BAND shows beside its name. Blank is not "no picture": the referenced record is
    // probed for `avatar`, then `icon`, then `image` — the three names a record uses for the same
    // idea — and a resolved face WINS over a codicon the enum declared, because a glyph standing
    // in for a person is exactly what the face replaces.
    {
      field: "group_icon",
      group: "rows",
      name: "Band icon",
      type: "string",
      // ui names an `editor: string` no registry has (it falls back with a warning); the plain input is meant
      editor: "input",
      editor_options: { placeholder: "Auto — the record’s avatar, icon or image" },
      note: "a field on the REFERENCED record holding a picture or a codicon name",
      when: v => typeof v["group_by"] === "string" && !!v["group_by"],
    },
    // What a band SAYS about itself, on the one line beside its name — rendered against the record
    // the band points at, so a project's own rolled-up numbers ("12 activities · 41 decisions ·
    // building") land there without the view computing anything. Blank falls back to the enum's
    // own `description`, which is the same idea authored in the schema instead of in the view.
    {
      field: "group_summary",
      group: "rows",
      name: "Band summary",
      type: "string",
      editor: "display-template",
      editor_options: { placeholder: "Blank — the choice’s own description, if it has one" },
      note: "one line, rendered against the referenced record — e.g. `{{ status }} · {{ activities_count }} activities`",
      when: v => typeof v["group_by"] === "string" && !!v["group_by"],
    },
    // ⚠ DEFAULT TRUE, and deliberately so. Expanded, a grouped chart of a few hundred records
    // opens as a wall in which the shape of the year is the one thing you cannot see; collapsed,
    // each lane is one row carrying its extent bar and its summary. Only applies when grouped.
    {
      field: "start_collapsed",
      group: "rows",
      name: "Start collapsed",
      type: "boolean",
      // ⚠ DECLARED, because the component reads `!== false` — so with no `default` here the
      // toggle rendered OFF while the behaviour was ON. Same defect, same cause, one axis over.
      default: true,
      editor: "boolean",
      note: "default ON — every lane opens shut, showing its extent bar and summary; a click opens one",
      when: v => typeof v["group_by"] === "string" && !!v["group_by"],
    },
    pageSizeOption(),
  ],
})
