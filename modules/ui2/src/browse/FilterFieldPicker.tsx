/**
 * A filter condition's FIELD picker — a tree, because a condition may name a field of a record this one
 * references (`project.status`), not only its own: the engine treats any non-operator key as a hop to the
 * referenced record (ported from @dreamteamer/ui's FilterFieldPicker.vue).
 *
 * One list, expanding INLINE and in flow — a disclosure, not a popover: the filter panel already floats over the
 * table, and a floating layer inside it would be clipped by the panel's own scroll box. Search FLATTENS: typing
 * `status` surfaces `Project › Status` without expanding Project first, because what is half-remembered is the
 * leaf. Picking a relation commits it (filtering BY the reference is legitimate); the twistie expands it.
 *
 * Every collection's field rows are already in the schema, so a branch opens without a request.
 */
import { useRef, useState, type KeyboardEvent } from "react"
import type { FieldRow } from "../api/types.ts"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import {
  childNodes,
  joinLabels,
  labelForPath,
  searchNodes,
  visitedAlong,
  type FieldNode,
  type RelationLookup,
} from "../lib/filter-field-tree.ts"
import { formatTitle } from "../lib/format-title.ts"
import { usePopover } from "./use-popover.ts"

export function FilterFieldPicker({
  value,
  collection,
  fields,
  relationOf,
  onChange,
}: {
  value: string
  collection: string
  fields: FieldRow[]
  relationOf: RelationLookup
  onChange(path: string): void
}) {
  const { schema } = useApp()
  const { open, setOpen, anchor } = usePopover()
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const search = useRef<HTMLInputElement>(null)

  const roots = childNodes(fields, collection, relationOf)
  const children = (node: FieldNode) =>
    node.expandable && node.target
      ? childNodes(schema.fields(node.target), node.target, relationOf, node, visitedAlong(node, collection))
      : []

  const visible: FieldNode[] = []
  const walk = (nodes: FieldNode[]) => {
    for (const n of nodes) {
      visible.push(n)
      if (expanded.has(n.path)) walk(children(n))
    }
  }
  walk(roots)

  // search looks one hop down from the root without anything expanded — the common case, at no cost
  const searchable: FieldNode[] = []
  for (const n of roots) {
    searchable.push(n)
    for (const c of children(n)) searchable.push(c)
  }
  for (const n of visible) if (!searchable.includes(n)) searchable.push(n)
  const searching = query.trim() !== ""
  const rows = searching ? searchNodes(searchable, query) : visible

  const toggle = () => {
    setOpen(!open)
    setQuery("")
    setTimeout(() => search.current?.focus(), 0)
  }
  const choose = (n: FieldNode) => {
    onChange(n.path)
    setOpen(false)
  }
  const expand = (n: FieldNode) =>
    setExpanded(e => {
      const next = new Set(e)
      if (!next.delete(n.path)) next.add(n.path)
      return next
    })
  // Escape closes the picker, not the whole filter panel behind it
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation()
      e.nativeEvent.stopImmediatePropagation()
      setOpen(false)
    }
  }

  return (
    <div ref={anchor} className={`ui2-fieldpicker${open ? " is-open" : ""}`} onKeyDown={onKey}>
      <button type="button" className="ui2-dd-control" onClick={toggle}>
        <span className={value ? undefined : "ui2-subtle"}>
          {value ? labelForPath(value, fields, formatTitle) : "Field…"}
        </span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className="ui2-fieldpicker-panel">
          <input
            ref={search}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search fields…"
            aria-label="Search fields"
          />
          <ul role="listbox">
            {!rows.length && <li className="ui2-subtle">No matching field.</li>}
            {rows.map(n => (
              <li key={n.path} className="ui2-fieldpicker-row">
                <span className="ui2-fieldpicker-twisty" style={searching ? undefined : { marginLeft: n.depth * 14 }}>
                  {n.expandable && !searching && (
                    <button
                      type="button"
                      className="ui2-icon-button"
                      aria-label={`${expanded.has(n.path) ? "Collapse" : "Expand"} ${n.label}`}
                      onClick={e => {
                        e.stopPropagation()
                        expand(n)
                      }}
                    >
                      <Icon name={expanded.has(n.path) ? "chevron-down" : "chevron-right"} />
                    </button>
                  )}
                </span>
                <button
                  type="button"
                  className={`ui2-fieldpicker-option${n.path === value ? " is-current" : ""}`}
                  onClick={() => choose(n)}
                >
                  <span>{searching ? joinLabels(n.labels) : n.label}</span>
                  {n.target && <span className="ui2-subtle">{n.target}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
