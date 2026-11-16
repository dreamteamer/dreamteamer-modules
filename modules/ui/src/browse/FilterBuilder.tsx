/**
 * THE FILTER BUILDER — per condition a field (a tree, `FilterFieldPicker`), an operator and a value; an All/Any
 * toggle over them; add and remove (ported from the Vue ui's FilterBuilder.vue). Pure presentation over
 * `lib/filter-query.ts`'s group: the browse owns the one copy, compiles it and sends it to the host as `filter`.
 *
 * The value control is the RECORD FORM'S OWN Edit, resolved through the registry over a synthetic per-operator
 * field row (`lib/filter-widget.ts`): a reference filters with the record picker, an enum with its choices, a
 * date with the date control, a plain string with the values its records actually hold (`field-values.ts`), and
 * a text operator (`contains`) with free text whatever the field. `_in` draws one control per entry plus a blank
 * one to add the next; `_between` draws two bounds.
 *
 * Every change goes through an updater over the CURRENT group, never a copy read at render: two updates in one
 * tick (both bounds of a range) would otherwise lose the first, and an incomplete pair compiles to nothing — a
 * condition on screen, every row in the table.
 */
import type { Dispatch, SetStateAction } from "react"
import type { FieldRow } from "../api/types.ts"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Select } from "../components/Select.tsx"
import { resolvePathTarget, type RelationLookup } from "../lib/filter-field-tree.ts"
import {
  ALL_OPERATORS,
  emptyValueFor,
  kindOfField,
  newRule,
  operatorLabel,
  operatorTakesList,
  operatorTakesPair,
  operatorTakesValue,
  operatorsForField,
  valueList,
  type FilterGroup,
  type FilterRule,
} from "../lib/filter-query.ts"
import { filterValueField } from "../lib/filter-widget.ts"
import { RenderEdit } from "../render/Render.tsx"
import { useFieldValues } from "./field-values.ts"
import { FilterFieldPicker } from "./FilterFieldPicker.tsx"
import { button, buttonActive, buttonSmall, cx, iconButton, subtle } from "../styles/classes.ts"

/** A value control's box; a text input in it fills it. (was dt-filter-value) */
const valueCls = "flex-1 min-w-0 [&_input:not([type=checkbox])]:w-full"
/** The values of one condition: stacked, or side by side for a pair. (was dt-filter-values) */
const valuesCls = (pair = false) =>
  cx("flex-[1_1_200px] min-w-0 flex gap-1", pair ? "flex-row items-center" : "flex-col")

const isBlank = (v: unknown) => v === "" || v === null || v === undefined

/** A blank start for (field, operator); a boolean starts at true — its switch has no "unset" to show. */
function startValue(row: FieldRow | undefined, operator: string): unknown {
  if (row && kindOfField(row) === "boolean" && operator !== "_null" && operator !== "_nnull") return true
  return emptyValueFor(operator)
}

export function FilterBuilder({
  value: group,
  setValue,
  collection,
  fields,
}: {
  value: FilterGroup
  setValue: Dispatch<SetStateAction<FilterGroup>>
  collection: string
  fields: FieldRow[]
}) {
  const { schema } = useApp()
  const relationOf: RelationLookup = (c, f) => {
    const row = schema.field(c, f)
    return row ? schema.target(row)?.collection : undefined
  }

  /** The row a condition's path names — its LEAF, in whichever collection the path ends. */
  const leafOf = (path: string) => (path.includes(".") ? resolvePathTarget(path, collection, relationOf) : null)
  const fieldRow = (path: string): FieldRow | undefined => {
    if (!path) return undefined
    const leaf = leafOf(path)
    if (!leaf) return fields.find(f => f.field === path)
    return leaf.collection === collection
      ? fields.find(f => f.field === leaf.field)
      : schema.field(leaf.collection, leaf.field)
  }

  // the vocabularies of the plain-string leaves on screen, asked from the collection the leaf lives in
  const vocabKey = (rule: FilterRule) => {
    const row = fieldRow(rule.field)
    if (!row || kindOfField(row) !== "string") return null
    const leaf = leafOf(rule.field)
    return `${leaf?.collection ?? collection}::${leaf?.field ?? rule.field}`
  }
  const vocab = useFieldValues(group.rules.map(vocabKey).filter((k): k is string => k !== null))

  const valueField = (rule: FilterRule): FieldRow | null => {
    const row = fieldRow(rule.field)
    if (!row) return null
    const key = vocabKey(rule)
    return filterValueField(row, rule.operator, key ? (vocab.get(key) ?? null) : null)
  }
  const operatorsFor = (rule: FilterRule) => {
    const row = fieldRow(rule.field)
    return row ? operatorsForField(row) : ALL_OPERATORS
  }

  const updateRule = (id: string, patch: (rule: FilterRule) => Partial<FilterRule>) =>
    setValue(g => ({ ...g, rules: g.rules.map(r => (r.id === id ? { ...r, ...patch(r) } : r)) }))

  const onField = (rule: FilterRule, path: string) => {
    const row = fieldRow(path)
    const ops = row ? operatorsForField(row) : ALL_OPERATORS
    const operator = ops.includes(rule.operator) ? rule.operator : (ops[0] ?? "_eq")
    updateRule(rule.id, () => ({ field: path, operator, value: startValue(row, operator) }))
  }

  const setListValue = (rule: FilterRule, index: number, v: unknown) =>
    updateRule(rule.id, r => {
      const list = valueList(r.value)
      // the trailing blank adds; clearing an entry removes it rather than leaving a hole
      if (index >= list.length) return isBlank(v) ? {} : { value: [...list, v] }
      const next = [...list]
      if (isBlank(v)) next.splice(index, 1)
      else next[index] = v
      return { value: next }
    })

  const setPairValue = (rule: FilterRule, index: number, v: unknown) =>
    updateRule(rule.id, r => {
      const pair: unknown[] = Array.isArray(r.value) ? [...r.value] : []
      while (pair.length < 2) pair.push("")
      pair[index] = v
      return { value: pair }
    })

  const addRule = () => {
    const first = fields[0]
    const operator = first ? (operatorsForField(first)[0] ?? "_eq") : "_eq"
    setValue(g => ({
      ...g,
      rules: [...g.rules, newRule({ field: first?.field ?? "", operator, value: startValue(first, operator) })],
    }))
  }

  const control = (rule: FilterRule, row: FieldRow, value: unknown, onChange: (v: unknown) => void, slot: string) => (
    <div className={valueCls}>
      <RenderEdit id={`filter-${rule.id}-${slot}`} field={row} value={value} onChange={onChange} />
    </div>
  )

  return (
    <div className="flex flex-col gap-2 items-start [&>p]:m-0">
      {group.rules.length > 1 && (
        <div className="flex items-center gap-1.5 text-fg-subtle">
          <span>Match</span>
          {(["_and", "_or"] as const).map(logic => (
            <button
              key={logic}
              type="button"
              className={cx(button, buttonSmall, group.logic === logic && buttonActive)}
              onClick={() => setValue(g => ({ ...g, logic }))}
            >
              {logic === "_and" ? "All" : "Any"}
            </button>
          ))}
          <span>of the following</span>
        </div>
      )}
      {!group.rules.length && <p className={subtle}>No conditions yet.</p>}
      {group.rules.map(rule => {
        const row = valueField(rule)
        const takes = row && operatorTakesValue(rule.operator)
        return (
          <div key={rule.id} className="flex flex-wrap items-start gap-1.5 w-full">
            <FilterFieldPicker
              value={rule.field}
              collection={collection}
              fields={fields}
              relationOf={relationOf}
              onChange={path => onField(rule, path)}
            />
            <div className="w-[140px]">
              <Select
                value={rule.operator}
                choices={operatorsFor(rule).map(op => ({ text: operatorLabel(op), value: op }))}
                ariaLabel="Operator"
                onChange={op =>
                  updateRule(rule.id, () => ({
                    operator: String(op),
                    value: startValue(fieldRow(rule.field), String(op)),
                  }))
                }
              />
            </div>
            {takes && operatorTakesList(rule.operator) && (
              <div className={valuesCls()}>
                {[...valueList(rule.value), null].map((entry, i, all) => (
                  <div key={i} className="flex gap-1 items-center">
                    {control(rule, row, entry, v => setListValue(rule, i, v), String(i))}
                    {i < all.length - 1 && (
                      <button
                        type="button"
                        className={iconButton}
                        aria-label="Remove value"
                        onClick={() => setListValue(rule, i, null)}
                      >
                        <Icon name="close" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {takes && operatorTakesPair(rule.operator) && (
              <div className={valuesCls(true)}>
                {control(
                  rule,
                  row,
                  Array.isArray(rule.value) ? (rule.value[0] ?? "") : "",
                  v => setPairValue(rule, 0, v),
                  "a"
                )}
                <span className={subtle}>and</span>
                {control(
                  rule,
                  row,
                  Array.isArray(rule.value) ? (rule.value[1] ?? "") : "",
                  v => setPairValue(rule, 1, v),
                  "b"
                )}
              </div>
            )}
            {takes && !operatorTakesList(rule.operator) && !operatorTakesPair(rule.operator) && (
              <div className={valuesCls()}>
                {control(rule, row, rule.value, v => updateRule(rule.id, () => ({ value: v })), "v")}
              </div>
            )}
            <button
              type="button"
              className={iconButton}
              aria-label="Remove condition"
              title="Remove condition"
              onClick={() => setValue(g => ({ ...g, rules: g.rules.filter(r => r.id !== rule.id) }))}
            >
              <Icon name="trash" />
            </button>
          </div>
        )
      })}
      <button type="button" className={cx(button, buttonSmall)} onClick={addRule}>
        <Icon name="add" /> Add condition
      </button>
    </div>
  )
}
