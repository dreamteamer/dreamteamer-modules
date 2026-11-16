/**
 * A filter condition's FIELD picker — a tree, because a condition may name a field of a record this one
 * references (`project.status`), not only its own: the engine treats any non-operator key as a hop to the
 * referenced record (ported from the Vue ui's FilterFieldPicker.vue).
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
import { useApp } from "../AppContext.tsx"
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
import { formatTitle } from "../lib/formatTitle.ts"
import { usePopover } from "./usePopover.ts"
import { ddControl } from "../components/looks.ts"
import { cx, iconButton, subtle } from "../styles/classes.ts"

/** The open tree: a tinted box under the control, its search full width, its rows scrolling. */
const panelCls =
  "mt-1 p-1.5 border border-border rounded-dt bg-bg-subtle [&_input]:w-full [&_ul]:list-none [&_ul]:mt-1.5 [&_ul]:mx-0 [&_ul]:mb-0 [&_ul]:p-0 [&_ul]:max-h-[240px] [&_ul]:overflow-y-auto"
const optionCls = "flex-1 flex justify-between gap-2 py-1 px-1.5 border-0 rounded text-fg text-left cursor-pointer"

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
    <div ref={anchor} className={open ? "w-full -order-1" : "w-[180px]"} onKeyDown={onKey}>
      <button type="button" className={cx(ddControl, "border-input-border")} onClick={toggle}>
        <span className={value ? undefined : subtle}>
          {value ? labelForPath(value, fields, formatTitle) : "Field…"}
        </span>
        <Icon name="chevron-down" />
      </button>
      {open && (
        <div className={panelCls}>
          <input
            ref={search}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search fields…"
            aria-label="Search fields"
          />
          <ul role="listbox">
            {!rows.length && <li className={subtle}>No matching field.</li>}
            {rows.map(n => (
              <li key={n.path} className="flex items-center">
                <span
                  className="inline-flex flex-none w-6"
                  style={searching ? undefined : { marginLeft: n.depth * 14 }}
                >
                  {n.expandable && !searching && (
                    <button
                      type="button"
                      className={iconButton}
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
                  className={cx(optionCls, n.path === value ? "bg-bg-active" : "bg-transparent hover:bg-bg-hover")}
                  onClick={() => choose(n)}
                >
                  <span>{searching ? joinLabels(n.labels) : n.label}</span>
                  {n.target && <span className={subtle}>{n.target}</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
