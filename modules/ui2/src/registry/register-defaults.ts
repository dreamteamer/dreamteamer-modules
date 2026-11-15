/**
 * The built-in Edits and Views, registered through the same door a module's `app` entry uses — the ids are
 * @dreamteamer/ui's, so a field naming `editor: textarea` or `viewer: label` draws the same kind of thing in
 * either app. Imported once for its side effect, before the first render.
 */
import {
  EditBoolean,
  EditDatetime,
  EditInput,
  EditJson,
  EditMarkdownBody,
  EditNumber,
  EditRelation,
  EditSelect,
  EditTags,
  EditTextarea,
} from "../edits/basic.tsx"
import {
  ViewBoolean,
  ViewDate,
  ViewJson,
  ViewLabel,
  ViewMarkdown,
  ViewRelation,
  ViewTags,
  ViewText,
} from "../views/basic.tsx"
import { edits, views } from "./index.ts"

edits.register({ id: "input", name: "Input", component: EditInput, types: ["string", "url", "email", "position"] })
edits.register({ id: "input-number", name: "Number", component: EditNumber, types: ["integer", "number"] })
edits.register({ id: "textarea", name: "Textarea", component: EditTextarea, types: ["markdown", "string"] })
edits.register({ id: "markdown-body", name: "Markdown body", component: EditMarkdownBody, types: [] })
edits.register({ id: "boolean", name: "Toggle", component: EditBoolean, types: ["boolean"] })
edits.register({ id: "datetime", name: "Date and time", component: EditDatetime, types: ["date", "datetime"] })
edits.register({ id: "select-dropdown", name: "Dropdown", component: EditSelect, types: [] })
edits.register({ id: "relation-picker", name: "Relation", component: EditRelation, types: [] })
edits.register({ id: "tags", name: "Tags", component: EditTags, types: [] })
edits.register({ id: "json", name: "JSON", component: EditJson, types: ["object", "map"] })

views.register({
  id: "text",
  name: "Text",
  component: ViewText,
  types: ["string", "url", "email", "integer", "number"],
})
views.register({ id: "label", name: "Label", component: ViewLabel, types: [] })
views.register({ id: "boolean", name: "Check", component: ViewBoolean, types: ["boolean"] })
views.register({ id: "date", name: "Date", component: ViewDate, types: ["date", "datetime"] })
views.register({ id: "relation", name: "Relation", component: ViewRelation, types: [] })
views.register({ id: "markdown", name: "Markdown", component: ViewMarkdown, types: ["markdown"] })
views.register({ id: "tags", name: "Tags", component: ViewTags, types: [] })
views.register({ id: "json", name: "JSON", component: ViewJson, types: ["object", "map"] })
