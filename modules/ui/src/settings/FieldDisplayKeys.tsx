/**
 * The field drawer's DISPLAY keys (descriptor v2, §3.4.2; ported from the Vue ui's FieldDisplayKeys.vue): whether
 * a control is offered (`editable`), the surfaces it is hidden from, its form section, placeholder, unit (and the
 * currency field), the direction of its values, and its list column width in characters. Each control goes
 * through `lib/fieldDisplayKeys.ts` on a copy of the draft, so an untouched control writes nothing the field did
 * not already say.
 */
import { Select } from "../components/Select.tsx"
import {
  editableOf,
  isHiddenOn,
  setDirection,
  setEditable,
  setHiddenOn,
  setText,
  setWidth,
  unitFieldApplies,
  widthOf,
  type Editable,
  type Surface,
} from "../lib/fieldDisplayKeys.ts"
import { check, formRow, input } from "../styles/classes.ts"
import { checks, formPair, panel } from "./looks.ts"

type Def = Record<string, unknown>

const EDITABLE = [
  { text: "Yes", value: "true" },
  { text: "No — never offer a control", value: "false" },
  { text: "Only on the create form", value: "create" },
]
const DIRECTION = [
  { text: "Left to right", value: "ltr" },
  { text: "Right to left", value: "rtl" },
]
const SURFACES: Array<{ id: Surface; label: string }> = [
  { id: "list", label: "Lists" },
  { id: "form", label: "Form" },
  { id: "record", label: "Record page" },
]

export function FieldDisplayKeys({
  def,
  onChange,
  sections,
  siblings,
}: {
  def: Def
  onChange(next: Def): void
  /** The collection's `display.form.sections` titles — what `form_section` may name. */
  sections: string[]
  /** The collection's other field names — what `unit_field` may name. */
  siblings: string[]
}) {
  const edit = (fn: (d: Def) => void) => {
    const next = { ...def }
    fn(next)
    onChange(next)
  }
  const text = (key: "form_section" | "placeholder" | "unit" | "unit_field") =>
    typeof def[key] === "string" ? (def[key] as string) : ""
  return (
    <div className={panel}>
      <label className={formRow}>
        <span>Editable</span>
        <Select
          value={editableOf(def)}
          choices={EDITABLE}
          ariaLabel="Editable"
          onChange={v => edit(d => setEditable(d, v as Editable))}
        />
      </label>
      <fieldset className={formRow}>
        <legend>Hidden on</legend>
        <div className={checks}>
          {SURFACES.map(s => (
            <label key={s.id} className={check}>
              <input
                type="checkbox"
                data-surface={s.id}
                checked={isHiddenOn(def, s.id)}
                onChange={e => edit(d => setHiddenOn(d, s.id, e.target.checked))}
              />
              <span>{s.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={formRow}>
        <span>Form section</span>
        <input
          className={input}
          list="dt-form-sections"
          value={text("form_section")}
          placeholder="none"
          onChange={e => edit(d => setText(d, "form_section", e.target.value))}
        />
        <datalist id="dt-form-sections">
          {sections.map(s => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </label>
      <label className={formRow}>
        <span>Placeholder</span>
        <input
          className={input}
          value={text("placeholder")}
          onChange={e => edit(d => setText(d, "placeholder", e.target.value))}
        />
      </label>
      <div className={formPair}>
        <label className={formRow}>
          <span>Unit</span>
          <input
            className={input}
            value={text("unit")}
            placeholder="currency · percent · bytes · kg"
            onChange={e => edit(d => setText(d, "unit", e.target.value))}
          />
        </label>
        {unitFieldApplies(def) && (
          <label className={formRow}>
            <span>Currency field</span>
            <Select
              value={text("unit_field")}
              choices={siblings.map(s => ({ text: s, value: s }))}
              placeholder="none"
              ariaLabel="Currency field"
              onChange={v => edit(d => setText(d, "unit_field", typeof v === "string" ? v : ""))}
            />
          </label>
        )}
      </div>
      <div className={formPair}>
        <label className={formRow}>
          <span>Direction</span>
          <Select
            value={def["direction"] === "rtl" ? "rtl" : "ltr"}
            choices={DIRECTION}
            ariaLabel="Direction"
            onChange={v => edit(d => setDirection(d, String(v)))}
          />
        </label>
        <label className={formRow}>
          <span>Width (characters)</span>
          <input
            className={input}
            inputMode="numeric"
            value={widthOf(def)}
            onChange={e => edit(d => setWidth(d, e.target.value))}
          />
        </label>
      </div>
    </div>
  )
}
