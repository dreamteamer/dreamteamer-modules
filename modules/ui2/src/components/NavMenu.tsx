/**
 * A nav row's menu (cr-dt-008), ported from @dreamteamer/ui's NavMenu.vue: a short list of entries drawn where the
 * right click was. An entry that needs a value — a folder label, a hidden name, an icon — asks for it in place before
 * it is picked. What an entry DOES is lib/nav-tree.ts's: this component only says which entry, and with what value.
 * A toolbar button that IS one entry (New folder, Show hidden…) opens the menu straight at that entry's ask (`start`).
 *
 * ui asks for an icon with its IconPicker; ui2 has none yet, so the ask here is a small searchable grid over the
 * codicon names (lib/icon-names.ts) — the same names, the same Clear icon.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { ALL_ICONS, COMMON_ICONS } from "../lib/icon-names.ts"
import type { NavMenuItem } from "../lib/nav-tree.ts"
import { Icon } from "./Icon.tsx"

/** At most this many icons are drawn for a search, so one letter never paints the whole font. */
const MAX_ICONS = 96

export function NavMenu({
  x,
  y,
  items,
  start,
  onPick,
  onClose,
}: {
  x: number
  y: number
  items: NavMenuItem[]
  start?: string
  onPick: (p: { id: string; value?: string | null }) => void
  onClose: () => void
}) {
  const first = start ? (items.find(i => i.id === start && i.ask && !i.disabled) ?? null) : null
  const [asking, setAsking] = useState<NavMenuItem | null>(first)
  const [text, setText] = useState(first?.value ?? "")
  const field = useRef<HTMLInputElement>(null)
  // the text field of an ask is focused the moment the ask opens (from a toolbar button, or from an entry)
  useEffect(() => {
    if (asking) field.current?.focus()
  }, [asking])

  const choose = (item: NavMenuItem) => {
    if (item.disabled) return
    if (item.ask) {
      setAsking(item)
      setText(item.ask === "text" ? (item.value ?? "") : "")
      return
    }
    onPick({ id: item.id })
  }
  const submit = () => {
    if (!asking || !text.trim()) return
    onPick({ id: asking.id, value: text.trim() })
  }
  const title = asking?.label.replace(/…$/, "")

  return (
    <div
      className="ui2-nav-menu"
      role="menu"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      {!asking &&
        items.map(item => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="ui2-nav-menu-item"
            data-id={item.id}
            disabled={item.disabled}
            onClick={() => choose(item)}
          >
            {item.label}
          </button>
        ))}
      {asking?.ask === "text" && (
        <form
          className="ui2-nav-menu-ask"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="ui2-nav-menu-title">{title}</label>
          <input
            ref={field}
            className="ui2-input"
            type="text"
            value={text}
            placeholder={asking.placeholder ?? ""}
            list={asking.suggestions?.length ? "ui2-nav-menu-suggestions" : undefined}
            spellCheck={false}
            onChange={e => setText(e.target.value)}
          />
          {!!asking.suggestions?.length && (
            <datalist id="ui2-nav-menu-suggestions">
              {asking.suggestions.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          <div className="ui2-nav-menu-actions">
            <button type="button" className="ui2-nav-menu-item" data-id="cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="ui2-nav-menu-item is-ok" data-id="ok">
              OK
            </button>
          </div>
        </form>
      )}
      {asking?.ask === "icon" && (
        <div className="ui2-nav-menu-ask">
          <label className="ui2-nav-menu-title">{title}</label>
          <input
            ref={field}
            className="ui2-input"
            type="search"
            value={text}
            placeholder="Search icons"
            spellCheck={false}
            onChange={e => setText(e.target.value)}
          />
          <IconGrid query={text} current={asking.value} onPick={name => onPick({ id: asking.id, value: name })} />
          <div className="ui2-nav-menu-actions">
            <button
              type="button"
              className="ui2-nav-menu-item"
              data-id="clear-icon"
              onClick={() => onPick({ id: asking.id, value: null })}
            >
              Clear icon
            </button>
            <button type="button" className="ui2-nav-menu-item" data-id="cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function IconGrid({ query, current, onPick }: { query: string; current?: string; onPick: (name: string) => void }) {
  const names = useMemo(() => {
    const q = query
      .trim()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
    if (!q) return COMMON_ICONS
    // prefix matches first — "cal" leads with `calendar`
    const starts = ALL_ICONS.filter(n => n.startsWith(q))
    const contains = ALL_ICONS.filter(n => !n.startsWith(q) && n.includes(q))
    return [...starts, ...contains].slice(0, MAX_ICONS)
  }, [query])
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
