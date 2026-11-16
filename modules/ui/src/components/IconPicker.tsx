/**
 * THE ICON CHOOSER (ported from the Vue ui's IconPicker.vue): a trigger showing the chosen glyph and its name,
 * and under it a search box over every codicon name (lib/iconNames.ts) with a grid of live previews — a curated
 * shortlist before anything is typed, prefix matches first after, capped so one letter never paints the whole font.
 * The nav's "Set icon…" ask draws the same `IconGrid`.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { ALL_ICONS, COMMON_ICONS } from "../lib/iconNames.ts"
import { usePopover } from "../browse/usePopover.ts"
import { Icon } from "./Icon.tsx"
import { cx, hint, iconButton, input, subtle } from "../styles/classes.ts"

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
    <div
      className="grid grid-cols-[repeat(auto-fill,28px)] gap-0.5 max-h-[180px] overflow-y-auto"
      role="listbox"
      aria-label="Icons"
    >
      {names.map(name => (
        <button
          key={name}
          type="button"
          role="option"
          aria-selected={name === current}
          className={cx(
            "w-7 h-7 inline-flex items-center justify-center border-0 rounded-dt text-fg hover:bg-bg-hover",
            name === current ? "bg-bg-hover outline-1 outline-solid outline-accent" : "bg-transparent"
          )}
          title={name}
          data-icon={name}
          onClick={() => onPick(name)}
        >
          <Icon name={name} />
        </button>
      ))}
      {names.length === 0 && <p className={subtle}>No icon matches.</p>}
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
    <div ref={anchor} className="grid gap-1" data-icon-picker>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex flex-1 items-center gap-1.5 h-[30px] px-2 py-0 border border-input-border rounded-dt bg-input-bg text-fg text-left cursor-pointer [&>span]:flex-1 [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap"
          title={value || placeholder}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon name={value || "symbol-color"} className={value ? "" : subtle} />
          <span className={value ? "" : subtle}>{value || placeholder}</span>
          <Icon name={open ? "chevron-up" : "chevron-down"} className={subtle} />
        </button>
        {value && (
          <button type="button" className={iconButton} title="Clear icon" onClick={() => onChange("")}>
            <Icon name="close" />
          </button>
        )}
      </div>
      {open && (
        <div className="grid gap-1.5 p-1.5 border border-border rounded-dt bg-bg-subtle">
          <input
            ref={search}
            className={input}
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
          {!query && <p className={cx(hint, "m-0")}>Common icons — type to search all {total}</p>}
        </div>
      )}
    </div>
  )
}
