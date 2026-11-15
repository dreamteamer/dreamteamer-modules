/**
 * THE ICON CHOOSER (ported from @dreamteamer/ui's IconPicker.vue): a trigger showing the chosen glyph and its name,
 * and under it a search box over every codicon name (lib/icon-names.ts) with a grid of live previews — a curated
 * shortlist before anything is typed, prefix matches first after, capped so one letter never paints the whole font.
 * The nav's "Set icon…" ask draws the same `IconGrid`.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { ALL_ICONS, COMMON_ICONS } from "../lib/icon-names.ts"
import { usePopover } from "../browse/use-popover.ts"
import { Icon } from "./Icon.tsx"

/** At most this many icons are drawn for a search. */
export const MAX_ICONS = 120
/** The shortlist, each name once (the generated list repeats a few). */
const COMMON = [...new Set(COMMON_ICONS)]

/** The names a query shows: the shortlist for none, else prefix matches, then the rest that contain it. */
export function iconMatches(query: string, max = MAX_ICONS): string[] {
  const q = query
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
  if (!q) return COMMON
  const starts = ALL_ICONS.filter(n => n.startsWith(q))
  const contains = ALL_ICONS.filter(n => !n.startsWith(q) && n.includes(q))
  return [...starts, ...contains].slice(0, max)
}

export function IconGrid({
  query,
  current,
  onPick,
}: {
  query: string
  current?: string
  onPick: (name: string) => void
}) {
  const names = useMemo(() => iconMatches(query), [query])
  return (
    <div className="ui2-icon-grid" role="listbox" aria-label="Icons">
      {names.map(name => (
        <button
          key={name}
          type="button"
          role="option"
          aria-selected={name === current}
          className={`ui2-icon-grid-cell${name === current ? " is-current" : ""}`}
          title={name}
          data-icon={name}
          onClick={() => onPick(name)}
        >
          <Icon name={name} />
        </button>
      ))}
      {names.length === 0 && <p className="ui2-subtle">No icon matches.</p>}
    </div>
  )
}

export function IconPicker({
  value,
  onChange,
  placeholder = "Pick an icon",
}: {
  value: string
  onChange(name: string): void
  placeholder?: string
}) {
  const { open, setOpen, anchor } = usePopover()
  const [query, setQuery] = useState("")
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (open) {
      setQuery("")
      search.current?.focus()
    }
  }, [open])
  const total = ALL_ICONS.length.toLocaleString("en")
  return (
    <div ref={anchor} className="ui2-iconpick" data-icon-picker>
      <div className="ui2-iconpick-trigger">
        <button
          type="button"
          className="ui2-iconpick-open"
          title={value || placeholder}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={value || "symbol-color"} className={value ? "" : "ui2-subtle"} />
          <span className={value ? "" : "ui2-subtle"}>{value || placeholder}</span>
          <Icon name={open ? "chevron-up" : "chevron-down"} className="ui2-subtle" />
        </button>
        {value && (
          <button type="button" className="ui2-icon-button" title="Clear icon" onClick={() => onChange("")}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {open && (
        <div className="ui2-iconpick-pop">
          <input
            ref={search}
            className="ui2-input"
            type="search"
            value={query}
            placeholder={`Search ${total} icons…`}
            spellCheck={false}
            onChange={e => setQuery(e.target.value)}
          />
          <IconGrid
            query={query}
            current={value}
            onPick={name => {
              onChange(name === value ? "" : name)
              setOpen(false)
            }}
          />
          {!query && <p className="ui2-hint">Common icons — type to search all {total}</p>}
        </div>
      )}
    </div>
  )
}
