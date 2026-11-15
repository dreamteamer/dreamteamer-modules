/**
 * The app's dropdown (ported from @dreamteamer/ui's DtSelect.vue): a button, a panel, a search box above
 * `SEARCH_THRESHOLD` choices, and full keyboard control. A native `<select>` cannot be searched, cannot wear the
 * theme, and on a long vocabulary (an enum of ~100 values) is a scrolling wall.
 *
 * ⚠ The panel is `position: fixed`, placed from the control's rect (`lib/listbox.ts#placePanel`): an absolute
 * panel is clipped by any scrolling ancestor. So the position is recomputed while anything scrolls — a
 * CAPTURE-phase scroll listener, because an inner scroll container's scroll does not bubble to `window`.
 *
 * `is-active` is the keyboard position, `is-selected` the committed value: a dropdown that conflates them
 * cannot show you where you are while you arrow past your own selection.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { themeColor } from "../lib/collection-display.ts"
import {
  SEARCH_THRESHOLD,
  filterChoices,
  indexOfValue,
  moveActive,
  placePanel,
  sameValue,
  type Choice,
} from "../lib/listbox.ts"
import { Icon } from "./Icon.tsx"

export function Select({
  value,
  choices,
  onChange,
  placeholder = "—",
  disabled,
  searchable,
  id,
  ariaLabel,
}: {
  value: unknown
  choices: Choice[]
  onChange(value: unknown): void
  placeholder?: string
  disabled?: boolean
  /** Forces the search box on or off; omitted, it appears above SEARCH_THRESHOLD choices. */
  searchable?: boolean
  id?: string
  ariaLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(-1)
  const [style, setStyle] = useState<CSSProperties>({})
  const control = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const visible = useMemo(() => filterChoices(choices, query), [choices, query])
  const showSearch = searchable ?? choices.length > SEARCH_THRESHOLD
  const selected = choices.find(c => sameValue(c.value, value))
  const empty = value === null || value === undefined || value === ""
  const label = selected?.text ?? (empty ? placeholder : String(value))

  const reposition = () => {
    const el = control.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const p = placePanel(
      { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
      { width: window.innerWidth, height: window.innerHeight },
      320,
      { minWidth: 200 }
    )
    setStyle({ top: p.top, left: p.left, width: p.width, maxHeight: p.maxHeight })
  }

  const close = () => {
    setOpen(false)
    setQuery("")
    setActive(-1)
  }
  const openPanel = () => {
    if (disabled) return
    reposition()
    setOpen(true)
    setQuery("")
    setActive(indexOfValue(choices, value))
  }
  const choose = (c: Choice) => {
    onChange(c.value)
    close()
    control.current?.focus()
  }

  // focus the search box and bring the active row into view once the panel is drawn
  useLayoutEffect(() => {
    if (!open) return
    if (showSearch) search.current?.focus()
    panel.current?.querySelector<HTMLElement>(".ui2-dd-option.is-active")?.scrollIntoView({ block: "nearest" })
  }, [open, showSearch])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (control.current?.contains(t) || panel.current?.contains(t)) return
      close()
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    }
  }, [open])

  const scrollActive = () =>
    requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLElement>(".ui2-dd-option.is-active")?.scrollIntoView({ block: "nearest" })
    )

  const onKeyDown = (e: KeyboardEvent) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault()
        openPanel()
      }
      return
    }
    switch (e.key) {
      case "Escape":
        // stopped here: a panel behind this one may also close on Escape, and one key must close one layer
        e.stopPropagation()
        e.preventDefault()
        close()
        control.current?.focus()
        break
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault()
        setActive(a => moveActive(a, e.key === "ArrowDown" ? 1 : -1, visible.length))
        scrollActive()
        break
      case "Home":
      case "End":
        e.preventDefault()
        setActive(e.key === "Home" ? 0 : visible.length - 1)
        scrollActive()
        break
      case "Enter": {
        e.preventDefault()
        const pick = visible[active] ?? (visible.length === 1 ? visible[0] : undefined)
        if (pick) choose(pick)
        break
      }
      case "Tab":
        close()
        break
    }
  }

  const glyph = (c: Choice) =>
    c.icon ? (
      <span className="ui2-dd-icon" style={c.color ? { color: themeColor(c.color) } : undefined}>
        <Icon name={c.icon} />
      </span>
    ) : null

  return (
    <div className="ui2-dd">
      <button
        ref={control}
        id={id}
        type="button"
        className={`ui2-dd-control${open ? " is-open" : ""}${!selected && empty ? " is-placeholder" : ""}`}
        disabled={disabled}
        aria-label={ariaLabel}
        title={selected?.title}
        aria-expanded={open}
        aria-haspopup="listbox"
        role="combobox"
        onClick={() => (open ? close() : openPanel())}
        onKeyDown={onKeyDown}
      >
        {selected && glyph(selected)}
        <span className="ui2-dd-label">{label}</span>
        {selected?.hint && <span className="ui2-dd-hint">{selected.hint}</span>}
        <Icon name="chevron-down" className="ui2-dd-caret" />
      </button>
      {open && (
        <div ref={panel} className="ui2-dd-panel" style={style} onKeyDown={onKeyDown}>
          {showSearch && (
            <input
              ref={search}
              type="text"
              value={query}
              placeholder="Search…"
              aria-label="Search options"
              onChange={e => {
                setQuery(e.target.value)
                // after typing, "first match" is the useful default; a stale index would commit an unseen value
                setActive(filterChoices(choices, e.target.value).length ? 0 : -1)
              }}
            />
          )}
          <ul className="ui2-dd-list" role="listbox">
            {!visible.length && <li className="ui2-dd-empty">No match.</li>}
            {visible.map((c, i) => {
              const isSel = sameValue(c.value, value)
              return (
                <li key={String(c.value)}>
                  <button
                    type="button"
                    role="option"
                    className={`ui2-dd-option${i === active ? " is-active" : ""}${isSel ? " is-selected" : ""}`}
                    title={c.title}
                    aria-selected={isSel}
                    onClick={() => choose(c)}
                    onMouseMove={() => setActive(i)}
                  >
                    {glyph(c)}
                    <span className="ui2-dd-label">{c.text}</span>
                    {c.hint && <span className="ui2-dd-hint">{c.hint}</span>}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
