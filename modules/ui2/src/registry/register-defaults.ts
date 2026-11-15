/**
 * The built-in Edits and Views, registered through the same door a module's `app` entry uses — under
 * @dreamteamer/ui's ids and with its `types` arrays, so a field naming `editor: textarea` or `viewer: label`
 * draws the same kind of thing in either app. Imported once for its side effect, before the first render.
 *
 * `types` advertises an entry as a kind-default CANDIDATE for those wire types; the actual default lives in one
 * place, `kindDefaultEdits`/`kindDefaultViews` (registry/index.ts). `types: []` is reachable only by an authored
 * id (`slider`, `color`, `code`, `progress`, `filesize`, `image`: a bare number or string defaulting to any of
 * those would be wrong for nearly every such field) or by SHAPE in resolve.ts (`tags`, `list`, `nested`,
 * `markdown-body`, `relation-picker`, `select-dropdown`, `label`, `relation`).
 *
 * The Lists — a collection's browse arrangements — register here too: today the built-in `table`, with the
 * options every list shares (grouping, colour, page size) and the table's own density. Board, cards, calendar,
 * map, gantt, diagram, counts and carousel come in later steps; a view naming one draws the table meanwhile.
 *
 * Not here yet: the record-scoped `form`/`doc`, `properties` and `data-model` (record pages, a later step).
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
import { ListTable } from "../lists/ListTable.tsx"
import { ALL, PAGE_SIZE_CHOICES } from "../lib/page-size.ts"
import { DEFAULT_ROW_SIZE, ROW_SIZES, ROW_SIZE_LABELS } from "../lib/row-size.ts"
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

// ── options every list shares ────────────────────────────────────────────────────────────────────────────
// GROUPING IS ONE CONCEPT WITH TWO AXES, NAMED FOR THE AXIS: `group_by` makes horizontal bands and every list has
// it; `lanes_by` makes the kanban's columns. An option that takes a field is named for the role the field plays,
// with no `_field` suffix (descriptor v2 §3.5.1); `lib/list-options.ts` knows the old spellings.
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

// paging is server-side; a grouped view defaults to All (`lib/page-size.ts`), an explicit choice still wins
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

// the table's density; the header's density menu writes the same key (`lib/row-size.ts` is the one reader)
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
