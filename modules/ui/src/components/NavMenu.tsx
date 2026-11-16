/**
 * A nav row's menu (cr-dt-008), ported from the Vue ui's NavMenu.vue: a short list of entries drawn where the
 * right click was. An entry that needs a value — a folder label, a hidden name, an icon — asks for it in place before
 * it is picked. What an entry DOES is lib/nav-tree.ts's: this component only says which entry, and with what value.
 * A toolbar button that IS one entry (New folder, Show hidden…) opens the menu straight at that entry's ask (`start`).
 *
 * The icon ask is a search box over components/IconPicker.tsx's `IconGrid` — the grid the IconPicker draws.
 */
import { useEffect, useRef, useState } from "react"
import type { NavMenuItem } from "../lib/nav-tree.ts"
import { IconGrid } from "./IconPicker.tsx"

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
      className="dt-nav-menu"
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
            className="dt-nav-menu-item"
            data-id={item.id}
            disabled={item.disabled}
            onClick={() => choose(item)}
          >
            {item.label}
          </button>
        ))}
      {asking?.ask === "text" && (
        <form
          className="dt-nav-menu-ask"
          onSubmit={e => {
            e.preventDefault()
            submit()
          }}
        >
          <label className="dt-nav-menu-title">{title}</label>
          <input
            ref={field}
            className="dt-input"
            type="text"
            value={text}
            placeholder={asking.placeholder ?? ""}
            list={asking.suggestions?.length ? "dt-nav-menu-suggestions" : undefined}
            spellCheck={false}
            onChange={e => setText(e.target.value)}
          />
          {!!asking.suggestions?.length && (
            <datalist id="dt-nav-menu-suggestions">
              {asking.suggestions.map(s => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
          <div className="dt-nav-menu-actions">
            <button type="button" className="dt-nav-menu-item" data-id="cancel" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="dt-nav-menu-item is-ok" data-id="ok">
              OK
            </button>
          </div>
        </form>
      )}
      {asking?.ask === "icon" && (
        <div className="dt-nav-menu-ask">
          <label className="dt-nav-menu-title">{title}</label>
          <input
            ref={field}
            className="dt-input"
            type="search"
            value={text}
            placeholder="Search icons"
            spellCheck={false}
            onChange={e => setText(e.target.value)}
          />
          <IconGrid query={text} current={asking.value} onPick={name => onPick({ id: asking.id, value: name })} />
          <div className="dt-nav-menu-actions">
            <button
              type="button"
              className="dt-nav-menu-item"
              data-id="clear-icon"
              onClick={() => onPick({ id: asking.id, value: null })}
            >
              Clear icon
            </button>
            <button type="button" className="dt-nav-menu-item" data-id="cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
