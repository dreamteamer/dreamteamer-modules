/**
 * The browser shell's ONE SEARCH (cr-modules-022): Cmd/Ctrl-K opens a centred field and nothing else until you type;
 * then the records whose title (or another field) matches, across every collection the nav lists, best title match
 * first — at most a few per collection, and a "N more in <collection>" line that opens that list searched. ↑↓ move,
 * Enter opens the record in a tab, Escape or a click outside closes. lib/search.ts says how the collections are asked.
 * Typing is debounced; a search overtaken by the next keystroke stops asking and its answers are dropped. Ported from
 * the Vue ui's SearchModal.vue.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { getNav, request } from "../api/client.ts"
import { useApp } from "../AppContext.tsx"
import type { NavNode } from "../lib/navTree.ts"
import { recordLabel } from "../lib/schema.ts"
import { searchRecords, type SearchHit, type SearchMore, type SearchTarget } from "../lib/search.ts"
import { seedTitle } from "../lib/tabs.ts"
import { templateFields } from "../lib/template.ts"
import { cx } from "../styles/classes.ts"
import { Icon } from "./Icon.tsx"

/** How long typing must pause before the collections are asked. */
const SEARCH_DEBOUNCE_MS = 160

const backdropCls = "fixed inset-0 z-[300] flex justify-center items-start pt-[14vh] bg-backdrop"
const boxCls =
  "w-[min(640px,calc(100vw-32px))] max-h-[70vh] flex flex-col overflow-hidden bg-surface rounded-xl shadow-menu [transition:transform_var(--dt-dur-med)_var(--dt-ease),opacity_var(--dt-dur-fast)_var(--dt-ease)] starting:-translate-y-1.5 starting:scale-[0.98] starting:opacity-0"
const fieldRowCls = "flex-none flex items-center gap-3 h-[52px] px-4 text-fg-subtle"
const inputCls =
  "flex-1 min-w-0 h-full min-h-0 p-0 border-0 outline-none bg-transparent text-fg text-lg placeholder:text-fg-muted focus-visible:outline-none"
const kbdCls = "flex-none px-1.5 py-px rounded-sm bg-ink-2 text-fg-muted font-sans text-small"
const hitsCls = "flex-[1_1_auto] min-h-0 overflow-y-auto list-none m-0 pt-1 px-2 pb-2 border-t border-hairline"
const hitCls = "flex items-center gap-3 h-9 px-2 rounded-lg cursor-default"
const whereCls = "flex-none max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap text-fg-muted text-sm"
const quietCls = "m-0 border-t border-hairline"

const isMore = (e: SearchHit | SearchMore): e is SearchMore => "count" in e

/** The collections the nav lists, in its order. */
function navCollections(nodes: readonly NavNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly NavNode[]) => {
    for (const n of list) {
      const name = n.kind === "collection" && n.target && "name" in n.target ? n.target.name : undefined
      if (name && !out.includes(name)) out.push(name)
      if (n.children) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

export function SearchModal() {
  const { schema, navigate } = useApp()
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [more, setMore] = useState<SearchMore[]>([])
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState(0)
  const [navNames, setNavNames] = useState<string[] | null>(null)
  const field = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const seq = useRef(0)

  /** What ↑↓ walk and Enter opens: the hits, then the "more" lines. */
  const entries = useMemo<Array<SearchHit | SearchMore>>(() => [...hits, ...more], [hits, more])

  const targets = useMemo<SearchTarget[]>(() => {
    const rows = schema.collections.filter(r => !r.internal)
    const names = navNames ?? rows.map(r => r.collection)
    return names.flatMap(name => {
      const row = rows.find(r => r.collection === name)
      return row
        ? [
            {
              collection: name,
              title: row.title,
              icon: row.nav?.icon,
              titleFields: templateFields(row.record_title ?? ""),
              titleOf: (rec: Record<string, unknown>) => recordLabel(row, rec, String(rec["id"] ?? "")),
            },
          ]
        : []
    })
  }, [schema, navNames])

  const show = () => {
    setOpen(true)
    setTerm("")
    setHits([])
    setMore([])
    setActive(0)
    getNav().then(
      nodes => setNavNames(navCollections(nodes ?? [])),
      () => setNavNames(null)
    )
  }
  const hide = () => {
    setOpen(false)
    seq.current++
  }

  // Cmd/Ctrl-K opens and closes it
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen(o => {
          if (o) seq.current++
          return !o
        })
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // opened by the key: start fresh, and the field takes focus
  useEffect(() => {
    if (!open) return
    show()
    requestAnimationFrame(() => field.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open])

  // typing: debounced, and a search overtaken by the next keystroke is dropped
  useEffect(() => {
    const mine = ++seq.current
    if (term.trim().length < 2) {
      setHits([])
      setMore([])
      setBusy(false)
      return
    }
    setBusy(true)
    const timer = setTimeout(async () => {
      const found = await searchRecords(term, targets, request, () => mine !== seq.current)
      if (mine !== seq.current) return
      setHits(found.hits)
      setMore(found.more)
      setActive(0)
      setBusy(false)
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [term, targets])

  // the active entry is never scrolled out of sight
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [active])

  const go = (entry: SearchHit | SearchMore | undefined) => {
    if (!entry) return
    hide()
    // the tab opens already named (lib/tabs.ts): the hit's title, or the list's own title for a "more" line
    if (isMore(entry)) seedTitle(entry.route, entry.collectionTitle, entry.icon)
    else seedTitle(entry.route, entry.title, entry.icon)
    navigate(entry.route)
  }

  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive(a => Math.min(a + 1, entries.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive(a => Math.max(a - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      go(entries[active])
    } else if (e.key === "Escape") {
      e.preventDefault()
      hide()
    }
  }

  if (!open) return null
  const searching = term.trim().length >= 2

  return (
    <div
      className={backdropCls}
      onMouseDown={e => {
        if (e.target === e.currentTarget) hide()
      }}
    >
      <div className={boxCls} role="dialog" aria-modal="true" aria-label="Search records">
        <div className={fieldRowCls}>
          <Icon name="search" />
          <input
            ref={field}
            className={inputCls}
            type="text"
            value={term}
            placeholder="Search records in every collection…"
            aria-label="Search records"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-controls="dt-search-results"
            aria-expanded={entries.length > 0}
            onChange={e => setTerm(e.target.value)}
            onKeyDown={onFieldKey}
          />
          {busy && <Icon name="loading" className="codicon-modifier-spin" />}
          <kbd className={kbdCls}>esc</kbd>
        </div>
        {searching && (
          <>
            {entries.length > 0 ? (
              <ul ref={list} id="dt-search-results" className={hitsCls} role="listbox">
                {hits.map((hit, i) => (
                  <li
                    key={`${hit.collection}/${hit.id}`}
                    className={cx(hitCls, i === active && "bg-accent-tint [&_[data-icon]]:text-accent")}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(hit)}
                  >
                    <span className="flex-none inline-flex text-fg-subtle" data-icon>
                      <Icon name={hit.icon || "file"} />
                    </span>
                    <span className="flex-1 min-w-0 truncate text-fg">{hit.title}</span>
                    <span className={whereCls}>{hit.collectionTitle}</span>
                  </li>
                ))}
                {more.map((m, j) => {
                  const on = hits.length + j === active
                  return (
                    <li
                      key={`more:${m.collection}`}
                      className={cx(hitCls, on && "bg-accent-tint [&_[data-icon]]:text-accent")}
                      role="option"
                      data-more={m.collection}
                      aria-selected={on}
                      onMouseMove={() => setActive(hits.length + j)}
                      onClick={() => go(m)}
                    >
                      <span className="flex-none inline-flex text-fg-subtle" data-icon>
                        <Icon name="list-flat" />
                      </span>
                      <span className="flex-1 min-w-0 truncate text-fg-subtle">
                        {m.count} more in {m.collectionTitle}
                      </span>
                      <span className={whereCls}>open the list</span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              !busy && <p className={cx(quietCls, "p-4 text-fg-subtle")}>No record matches “{term.trim()}”.</p>
            )}
            <p className={cx(quietCls, "flex-none px-4 py-2 text-fg-muted text-small")}>
              Searches the titles in the {targets.length} collections the nav lists · Enter opens in a tab
            </p>
          </>
        )}
      </div>
    </div>
  )
}
