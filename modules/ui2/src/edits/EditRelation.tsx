/**
 * `relation-picker` — a reference to a record of the field's target collection (ported from @dreamteamer/ui's
 * EditRelation.vue). A closed control shows what is picked BY ITS TITLE — the target's `record_title`, the same
 * name a relation cell and the record header give it (`lib/record-cache.ts`) — with a clear button; a list
 * reference shows a removable chip per record. A click opens a popover with a search box: the candidates are the
 * HOST's search (`q`, debounced), not a page filtered here, so a target of thousands still finds its record.
 * Arrow keys move, Enter picks, Escape closes; a click outside closes.
 *
 * Stored as the engine stores a reference: `collection/id`, no leading slash — a list as an array of those. A
 * cleared single reference is null; a list emptied to nothing is null too. A picked value the search page does
 * not hold keeps its title (the cache fetches it once).
 *
 * A reference with no declared target (refs into any collection) has nothing to search, so it is typed: one
 * input, or one chip per reference for a list.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { listRecords } from "../api/client.ts"
import { useApp, useAsync, useSignal } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { isRelationList } from "../lib/field-row.ts"
import { askTitles, knownTitle, referenceTitlesChanged, refStem } from "../lib/record-cache.ts"
import { bareRef, refsOf, toggleRef } from "../lib/edit-values.ts"
import { recordLabel } from "../lib/schema.ts"
import type { EditProps } from "../registry/props.ts"
import { EditInput } from "./EditInput.tsx"
import { EditTags } from "./EditTags.tsx"

const PAGE = 50
const DEBOUNCE_MS = 200

export function EditRelation(props: EditProps) {
  const { field, value, onChange, id } = props
  const { schema, version } = useApp()
  useSignal(referenceTitlesChanged)
  const target = schema.target(field)
  const list = isRelationList(field) || field.many === true || target?.list === true
  const selected = refsOf(value)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [searched, setSearched] = useState("")
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  // the picked records' titles, fetched once each
  useEffect(() => askTitles(selected, schema, version), [selected.join("\n"), schema, version])

  useEffect(() => {
    const t = setTimeout(() => setSearched(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const page = useAsync(
    () =>
      open && target
        ? listRecords(target.collection, { limit: PAGE, ...(searched ? { q: searched } : {}) })
        : Promise.resolve(null),
    [open, target?.collection, searched, version]
  )

  const row = target ? schema.collection(target.collection) : undefined
  const options = useMemo(
    () =>
      (page.data?.records ?? []).map(r => ({
        ref: `${target?.collection}/${r.id}`,
        label: recordLabel(row, r, r.id),
      })),
    [page.data, row, target?.collection]
  )
  const fromPage = new Map(options.map(o => [o.ref, o.label]))
  const labelOf = (ref: string) => fromPage.get(ref) ?? knownTitle(ref) ?? refStem(ref)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    search.current?.focus()
    return () => document.removeEventListener("mousedown", onDown)
  }, [open])
  useEffect(() => setActive(0), [searched, page.data])

  if (!target) {
    return list ? <EditTags {...props} /> : <EditInput {...props} />
  }

  const pick = (ref: string) => {
    if (list) onChange(toggleRef(selected, ref))
    else onChange(ref)
    setOpen(false)
    setQuery("")
  }
  const clear = () => onChange(null)

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation()
      setOpen(false)
      return
    }
    if (!open) return
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const n = options.length
      if (n) setActive(a => (a + (e.key === "ArrowDown" ? 1 : -1) + n) % n)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const o = options[active]
      if (o) pick(o.ref)
    }
  }

  return (
    <div ref={root} className="ui2-relation" onKeyDown={onKeyDown}>
      <div className={`ui2-relation-control${open ? " is-open" : ""}`}>
        <button
          id={id}
          type="button"
          className="ui2-relation-open"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {!selected.length && <span className="ui2-relation-placeholder">Select…</span>}
          {!list && selected[0] && <span className="ui2-relation-text">{labelOf(selected[0])}</span>}
        </button>
        {list && selected.length > 0 && (
          <span className="ui2-relation-chips">
            {selected.map(ref => (
              <span key={ref} className="ui2-chip" title={ref}>
                {labelOf(ref)}
                <button
                  type="button"
                  className="ui2-chip-remove"
                  aria-label={`Remove ${labelOf(ref)}`}
                  onClick={() => onChange(toggleRef(selected, ref))}
                >
                  <Icon name="close" />
                </button>
              </span>
            ))}
          </span>
        )}
        <span className="ui2-relation-actions">
          {selected.length > 0 && (
            <button type="button" className="ui2-icon-button" aria-label="Clear" title="Clear" onClick={clear}>
              <Icon name="close" />
            </button>
          )}
          <button
            type="button"
            className="ui2-icon-button"
            tabIndex={-1}
            aria-label="Open"
            onClick={() => setOpen(o => !o)}
          >
            <Icon name="triangle-down" />
          </button>
        </span>
      </div>

      {open && (
        <div className="ui2-relation-popover">
          <input
            ref={search}
            type="text"
            dir="auto"
            value={query}
            placeholder={`Search ${row?.title ?? target.collection}…`}
            aria-label="Search records"
            onChange={e => setQuery(e.target.value)}
          />
          <ul className="ui2-relation-list" role="listbox" aria-multiselectable={list}>
            {page.loading && !page.data && <li className="ui2-relation-empty">Loading…</li>}
            {page.error && <li className="ui2-relation-empty is-error">{page.error}</li>}
            {!page.loading && !page.error && !options.length && <li className="ui2-relation-empty">No matches</li>}
            {options.map((o, i) => {
              const isSel = selected.includes(bareRef(o.ref))
              return (
                <li
                  key={o.ref}
                  role="option"
                  aria-selected={isSel}
                  className={`ui2-relation-item${isSel ? " is-selected" : ""}${i === active ? " is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(o.ref)}
                >
                  <Icon name={isSel ? "check" : "blank"} className="ui2-relation-check" />
                  <span>{o.label}</span>
                </li>
              )
            })}
          </ul>
          {(page.data?.total ?? 0) > options.length && (
            <p className="ui2-hint">
              {options.length} of {page.data?.total} — type to narrow
            </p>
          )}
        </div>
      )}
    </div>
  )
}
