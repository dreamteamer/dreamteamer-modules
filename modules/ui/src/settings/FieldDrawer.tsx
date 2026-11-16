/**
 * THE FIELD DRAWER (ported from the Vue ui's components/designer/FieldDrawer.vue): the right-hand editor the
 * designer opens on one field, or on a new one. Four tabs — Field (key, type, description, required, the display
 * keys), Edit and View (which registered Edit and View draw it, ★ marking the type's default, and each one's own
 * options drawn by OptionsForm from what it declares), and Relationship for a reference.
 *
 * The Relationship tab asks the ONE question an operator can answer — WHERE THE LINK IS KEPT — and the rest follows
 * from it and the field's type: whether it is two-way, "at most one" (a flag on the key, or this field's own type),
 * the delete rule, the name of the field on the other collection (suggested, checked live against that
 * collection's real fields). Moving the key once it exists would move data, so the side is offered only while
 * declaring. A field DERIVED from a key elsewhere carries no presentation (the engine refuses one), so it opens
 * on its Relationship tab with no Edit or View tab.
 *
 * Everything edits a LOCAL draft (`lib/field-drawer.ts` decides what a change drops); nothing here writes —
 * Apply hands the field back to the designer, which stages it until Save.
 */
import { useMemo, useState } from "react"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Select } from "../components/Select.tsx"
import type { StagedField } from "../lib/designer-state.ts"
import {
  atMostOne,
  farFieldError,
  FIELD_TYPES,
  isRelationType,
  isTwoWay,
  sideOf,
  suggestedFarField,
  targetOf,
  typeOf,
  wireOf,
  withAtMostOne,
  withEditor,
  withOptions,
  withRelation,
  withSide,
  withTwoWay,
  withType,
  withViewer,
} from "../lib/field-drawer.ts"
import { isUserCollection } from "../lib/okf.ts"
import { baseNameOf, deleteRuleTarget, describeLink, singularOf } from "../lib/relation-meta.ts"
import { slugify } from "../lib/slugify.ts"
import { templateFields } from "../lib/template.ts"
import { edits, kindDefaultEdits, kindDefaultViews, views } from "../registry/index.ts"
import { FieldContext } from "../render/FieldContext.tsx"
import { OptionsForm } from "../render/OptionsForm.tsx"
import { button, buttonSize, buttonTone, check, cx, formRow, hint, iconButton, input, mono } from "../styles/classes.ts"
import { FieldDisplayKeys } from "./FieldDisplayKeys.tsx"
import { hintErr, panel } from "./looks.ts"

type Def = Record<string, unknown>
type Tab = "field" | "edit" | "view" | "relationship"

const defaultEditId = (type: string) =>
  type === "relation"
    ? "relation-picker"
    : type === "list" || type === "relation-list"
      ? "list"
      : (kindDefaultEdits[wireOf(type)] ?? "input")
const defaultViewId = (type: string) => (isRelationType(type) ? "relation" : (kindDefaultViews[wireOf(type)] ?? "text"))
const fieldScope = <T extends { scope?: string }>(e: T) => e.scope !== "record"
const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

export function FieldDrawer({
  collection,
  field,
  existingKeys,
  onClose,
  onApply,
}: {
  collection: string
  /** The field being edited; null opens a new one. */
  field: StagedField | null
  /** Every staged key (implicit included) — a new key may not collide with one. */
  existingKeys: string[]
  onClose(): void
  onApply(field: StagedField): void
}) {
  const { schema } = useApp()
  const editing = field !== null
  const derived = field?.mirror !== undefined
  const [key, setKey] = useState(field?.key ?? "")
  const [def, setDef] = useState<Def>(() =>
    field ? (JSON.parse(JSON.stringify(field.def)) as Def) : { type: "string" }
  )
  const [tab, setTab] = useState<Tab>(derived ? "relationship" : "field")
  const [sideTouched, setSideTouched] = useState(false)
  const slug = slugify(key)
  const self = editing ? field.key : slug

  const type = typeOf(def)
  const relation = isRelationType(type)
  const target = targetOf(def)
  const named = target !== "" && target !== "*"
  const side = sideOf(def)
  const twoWay = isTwoWay(def)
  const far = named ? schema.fields(target) : []
  const farError = farFieldError(def, collection, far, self)
  const collision = !editing && slug !== "" && existingKeys.includes(slug)
  const canApply = (editing || slug !== "") && !collision && farError === ""

  // ---- pickers -----------------------------------------------------------------------------------------
  const wire = wireOf(type)
  const defaultEdit = defaultEditId(type)
  const defaultView = defaultViewId(type)
  const editor = typeof def["editor"] === "string" ? def["editor"] : ""
  const viewer = typeof def["viewer"] === "string" ? def["viewer"] : ""
  const chosenEdit = editor || defaultEdit
  const chosenView = viewer || defaultView
  const editChoices = edits
    .all()
    .filter(fieldScope)
    .filter(e => e.types.length === 0 || e.types.includes(wire))
    .map(e => ({ text: `${e.id === defaultEdit ? "★ " : ""}${e.name}`, value: e.id }))
  const recommended = edits.get(chosenEdit)?.recommendedViews ?? []
  const rank = (id: string) => (recommended.includes(id) ? recommended.indexOf(id) : id === defaultView ? 100 : 200)
  const viewChoices = views
    .all()
    .filter(fieldScope)
    .filter(v => v.types.length === 0 || v.types.includes(wire))
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map(v => ({ text: `${v.id === defaultView ? "★ " : ""}${v.name}`, value: v.id }))
  const editOptions = edits.get(chosenEdit)?.options ?? []
  const viewOptions = views.get(chosenView)?.options ?? []
  const contextFields = useMemo(() => schema.fields(collection), [schema, collection])

  const typeChoices = useMemo(() => {
    const list = FIELD_TYPES.map(t => ({ text: t.label, value: t.id }))
    return list.some(t => t.value === type) ? list : [{ text: type, value: type }, ...list]
  }, [type])
  const targetChoices = schema.collections
    .filter(isUserCollection)
    .map(c => ({ text: c.collection, value: c.collection }))
  const sections = (schema.collection(collection)?.form.sections ?? []).map(s => s.title)
  const siblings = existingKeys.filter(k => k !== self)

  const vo = isMap(def["viewer_options"]) ? def["viewer_options"] : {}
  const template = typeof vo["template"] === "string" ? vo["template"] : ""
  const setTemplate = (t: string) => {
    const next = { ...vo }
    if (t) next["template"] = t
    else delete next["template"]
    setDef(d => withOptions(d, "viewer_options", next))
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "field", label: "Field" },
    ...(derived
      ? []
      : [
          { id: "edit" as const, label: "Edit" },
          { id: "view" as const, label: "View" },
        ]),
    ...(relation ? [{ id: "relationship" as const, label: "Relationship" }] : []),
  ]
  const shown: Tab = tabs.some(t => t.id === tab) ? tab : "field"

  const hereOne = singularOf(baseNameOf(collection))
  const targetBase = baseNameOf(target)
  const targetOne = singularOf(targetBase)
  const intent = {
    side,
    target,
    farField: typeof def["far_field"] === "string" ? def["far_field"] : "",
    list: type === "relation-list",
    unique: def["unique"] === true,
    onDelete: "restrict" as const,
  }
  const deleteSubject = singularOf(baseNameOf(deleteRuleTarget(intent, collection)))

  const apply = () => {
    if (!canApply) return
    onApply({
      key: editing ? field.key : slug,
      def: JSON.parse(JSON.stringify({ ...def, type: def["type"] ?? "string" })) as Def,
      implicit: field?.implicit === true,
      ...(field?.mirror ? { mirror: field.mirror } : {}),
    })
  }

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-[rgb(0_0_0/0.24)]"
      onMouseDown={e => e.target === e.currentTarget && onClose()}
    >
      <aside
        className="flex flex-col w-[min(520px,100%)] h-full bg-bg border-l border-border shadow-[-12px_0_32px_rgb(0_0_0/0.18)]"
        role="dialog"
        aria-label={editing ? `Edit field ${field.key}` : "New field"}
        data-field-drawer
      >
        <header className="flex items-center justify-between py-3 px-4 border-b border-border">
          <h2 className="m-0 text-[15px]">{editing ? `Edit field: ${field.key}` : "New field"}</h2>
          <button type="button" className={iconButton} aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <nav className="flex gap-0.5 px-3 border-b border-border" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={shown === t.id}
              className={cx(
                "py-2 px-2.5 border-x-0 border-t-0 border-b-2 border-solid bg-transparent cursor-pointer",
                shown === t.id ? "border-b-accent text-fg font-semibold" : "border-b-transparent text-fg-subtle"
              )}
              data-tab={t.id}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="flex-1 overflow-auto py-3.5 px-4">
          {shown === "field" && (
            <section className={panel}>
              <label className={formRow}>
                <span>Key</span>
                <input
                  className={cx(input, mono)}
                  value={key}
                  disabled={editing}
                  placeholder="due_date"
                  aria-label="Field key"
                  autoFocus={!editing}
                  onChange={e => setKey(e.target.value)}
                />
              </label>
              {!editing && key && slug !== key && (
                <p className={hint}>
                  Will be saved as <code>{slug}</code>
                </p>
              )}
              {editing && <p className={hint}>Rename a field from its ⋯ menu — every record and view is rewritten.</p>}
              {collision && (
                <p className={hintErr}>
                  A field named <code>{slug}</code> already exists.
                </p>
              )}
              <label className={formRow}>
                <span>Type</span>
                <Select
                  value={type}
                  choices={typeChoices}
                  ariaLabel="Type"
                  onChange={v => setDef(d => withType(d, String(v), { editing, sideTouched }))}
                />
              </label>
              <label className={formRow}>
                <span>Description</span>
                <input
                  className={input}
                  value={typeof def["description"] === "string" ? def["description"] : ""}
                  placeholder="What this field means"
                  onChange={e => {
                    const v = e.target.value
                    setDef(d => {
                      const n = { ...d }
                      if (v) n["description"] = v
                      else delete n["description"]
                      return n
                    })
                  }}
                />
              </label>
              {!derived ? (
                <>
                  <label className={check}>
                    <input
                      type="checkbox"
                      checked={def["required"] === true}
                      onChange={e => {
                        const on = e.target.checked
                        setDef(d => {
                          const n = { ...d }
                          if (on) n["required"] = true
                          else delete n["required"]
                          return n
                        })
                      }}
                    />
                    <span>Required</span>
                  </label>
                  <FieldDisplayKeys def={def} onChange={setDef} sections={sections} siblings={siblings} />
                </>
              ) : (
                <p className={hint}>
                  This field's value is kept in step with the link, so it is not typed into a record — width, editor and
                  view settings have nothing to apply to.
                </p>
              )}
            </section>
          )}

          {shown === "edit" && (
            <section className={panel}>
              <label className={formRow}>
                <span>Edit</span>
                <Select
                  value={editor}
                  choices={editChoices}
                  placeholder="Default for type"
                  ariaLabel="Edit"
                  onChange={v => setDef(d => withEditor(d, typeof v === "string" ? v : ""))}
                />
              </label>
              {editOptions.length ? (
                <FieldContext.Provider value={{ collection, fields: contextFields }}>
                  <OptionsForm
                    options={editOptions}
                    value={isMap(def["editor_options"]) ? def["editor_options"] : {}}
                    onChange={v => setDef(d => withOptions(d, "editor_options", v))}
                  />
                </FieldContext.Provider>
              ) : (
                <p className={hint}>This Edit has no options.</p>
              )}
            </section>
          )}

          {shown === "view" && (
            <section className={panel}>
              <label className={formRow}>
                <span>View</span>
                <Select
                  value={viewer}
                  choices={viewChoices}
                  placeholder="Default for type"
                  ariaLabel="View"
                  onChange={v => setDef(d => withViewer(d, typeof v === "string" ? v : ""))}
                />
              </label>
              {viewOptions.length ? (
                <FieldContext.Provider value={{ collection, fields: contextFields }}>
                  <OptionsForm
                    options={viewOptions}
                    value={vo}
                    onChange={v => setDef(d => withOptions(d, "viewer_options", v))}
                  />
                </FieldContext.Provider>
              ) : (
                <p className={hint}>This View has no options.</p>
              )}
            </section>
          )}

          {shown === "relationship" && (
            <section className={panel}>
              <label className={formRow}>
                <span>Target collection</span>
                <Select
                  value={target}
                  choices={targetChoices}
                  disabled={derived}
                  placeholder="Select a collection…"
                  ariaLabel="Target collection"
                  onChange={v =>
                    setDef(d =>
                      withRelation(d, { target: typeof v === "string" && v ? `/${v}` : undefined }, collection)
                    )
                  }
                />
              </label>
              {derived && (
                <p className={hint}>
                  The two collections a link joins are fixed once it exists — a new field is how you point somewhere
                  else.
                </p>
              )}
              {named && (
                <div className={panel}>
                  <fieldset className={formRow}>
                    <legend>Where the link is kept</legend>
                    {(["here", "target"] as const).map(s => (
                      <label key={s} className={check}>
                        <input
                          type="radio"
                          name="dt-link-side"
                          value={s}
                          checked={side === s}
                          disabled={editing}
                          onChange={() => {
                            setSideTouched(true)
                            setDef(d => withSide(d, s, collection))
                          }}
                        />
                        <span>
                          on each <code>{s === "here" ? hereOne : targetOne}</code> —{" "}
                          {s === "here" ? "this field holds it" : "a field there points back here"}
                        </span>
                      </label>
                    ))}
                    {editing && (
                      <p className={hint}>
                        Which side keeps it is where the values physically live, so moving it would move data.
                        Everything else about the link is editable from here.
                      </p>
                    )}
                  </fieldset>
                  {side === "here" && (
                    <label className={check}>
                      <input
                        type="checkbox"
                        checked={twoWay}
                        onChange={e => setDef(d => withTwoWay(d, e.target.checked, collection))}
                      />
                      <span>
                        also show it on each <code>{targetOne}</code>
                      </span>
                    </label>
                  )}
                  {twoWay && (
                    <label className={formRow}>
                      <span>
                        Field on <code>{targetBase}</code>
                      </span>
                      <input
                        className={cx(input, mono)}
                        value={intent.farField}
                        placeholder={suggestedFarField(def, collection) ?? "field name"}
                        aria-label={`Field name on ${target}`}
                        onChange={e => {
                          const v = e.target.value
                          setDef(d => ({ ...d, far_field: v }))
                        }}
                      />
                    </label>
                  )}
                  {farError ? (
                    <p className={hintErr}>{farError}</p>
                  ) : (
                    !twoWay && (
                      <p className={hint}>
                        One-way: a <code>{targetOne}</code> will not show what points at it, and "which {targetBase}{" "}
                        have none" is not a filter.
                      </p>
                    )
                  )}
                  {twoWay && (
                    <>
                      {(side === "target" || type !== "relation-list") && (
                        <label className={check}>
                          <input
                            type="checkbox"
                            checked={atMostOne(def)}
                            onChange={e => setDef(d => withAtMostOne(d, e.target.checked, collection))}
                          />
                          <span>
                            each <code>{side === "target" ? hereOne : targetOne}</code> has at most one{" "}
                            <code>{side === "target" ? targetOne : hereOne}</code>
                          </span>
                        </label>
                      )}
                      <p className={hint}>{describeLink(intent, collection)}</p>
                      <fieldset className={formRow}>
                        <legend>
                          When a <code>{deleteSubject}</code> is deleted
                        </legend>
                        {(
                          [
                            ["restrict", "Refuse — the delete is blocked while anything still points at it"],
                            ["set-null", "Clear the link — the delete goes through and the link is emptied"],
                          ] as const
                        ).map(([rule, text]) => (
                          <label key={rule} className={check}>
                            <input
                              type="radio"
                              name="dt-on-delete"
                              checked={(def["on_delete"] === "set-null" ? "set-null" : "restrict") === rule}
                              onChange={() =>
                                setDef(d => {
                                  const n = { ...d }
                                  if (rule === "set-null") n["on_delete"] = "set-null"
                                  else delete n["on_delete"]
                                  return n
                                })
                              }
                            />
                            <span>{text}</span>
                          </label>
                        ))}
                      </fieldset>
                    </>
                  )}
                </div>
              )}
              <label className={formRow}>
                <span>Display template</span>
                <input
                  className={cx(input, mono)}
                  value={template}
                  placeholder="{{ name }}"
                  onChange={e => setTemplate(e.target.value)}
                />
              </label>
              <p className={hint}>
                A template rendered against the related record, e.g. <code>{"{{ name }}"}</code>. Blank shows the
                record's title.
              </p>
              {template && templateFields(template).length > 0 && (
                <p className={hint}>
                  References:{" "}
                  {templateFields(template).map(f => (
                    <code key={f}>{f} </code>
                  ))}
                </p>
              )}
            </section>
          )}
        </div>
        <footer className="flex justify-end gap-2 py-2.5 px-4 border-t border-border">
          <button type="button" className={cx(button, buttonTone.default, buttonSize.default)} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={cx(button, buttonTone.primary, buttonSize.default)}
            data-action="apply"
            disabled={!canApply}
            onClick={apply}
          >
            Apply
          </button>
        </footer>
      </aside>
    </div>
  )
}
