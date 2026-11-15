/**
 * ONE BROWSE'S STATE — search, filter, columns and their order, sort, layout, layout options, paging and the
 * row selection — owned once by the browse frame (`Browse.tsx`) and handed to whichever List draws the rows as
 * a plain `state` prop, so switching layout never re-fetches or loses a half-built filter. Ported from
 * @dreamteamer/ui's composables/browse-state.ts.
 *
 * WHERE IT STARTS (descriptor v2 §3.5): the governing ui-view's `display.list` merged key by key over the
 * collection's own (`lib/list-seed.ts`), the view's filter decompiled into editable conditions
 * (`lib/view-filter.ts`), and the URL's `?search`, `?filter`, `?layout` over both — the URL is the operator
 * having already edited this session. The schema is loaded before any page mounts, so all of it is decided once,
 * on the first render; the browse is remounted (keyed by its caller) when the view or the collection's list
 * block changes underneath it.
 *
 * WHAT THE RECORD SAYS is kept beside it as `baseline`: `dirty` compares the screen with it, Reset returns to it,
 * Save makes the record say what the screen says. Unsaved tweaks live in an in-memory scratch pad per collection
 * and view — never localStorage: a reload returns to what git says, so "what I see" and "what is committed"
 * cannot drift apart across sessions. A tweak never carries a SOURCE selection to the next mount: which sources a
 * list shows is the navigation's fact.
 *
 * Paging is server-side (`limit`/`offset`); a grouped table defaults to every row (`lib/page-size.ts`). Any
 * change to what is asked — search, filter, sort, page size — starts again at page 1, and drops the selection,
 * which is scoped to the rows on screen.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { listRecords, removeRecord, type Row } from "../api/client.ts"
import type { FieldRow, SourceEntry } from "../api/types.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { browseFields, moveItem, seedColumns, toggledSort } from "../lib/browse-fields.ts"
import { DEFAULT_SORT } from "../lib/builtin-fields.ts"
import { colorByFor, tintOf as tintFor, tintStyle } from "../lib/collection-display.ts"
import { SOURCES_QUERY, TARGET_QUERY, takeCreated, widenedFor, type CreatedNote } from "../lib/created-visibility.ts"
import { compileFilter, emptyFilterGroup, serializeFilterGroup, type FilterGroup } from "../lib/filter-query.ts"
import { normalizeFilterRefs } from "../lib/filter-wire.ts"
import { listSeed, scratchKey as scratchKeyFor } from "../lib/list-seed.ts"
import { effectiveLimit } from "../lib/page-size.ts"
import { createRoute, pathOf, queryOf, recordRoute, withQuery } from "../lib/route.ts"
import { recordLabel } from "../lib/schema.ts"
import { resolveView } from "../registry/resolve.ts"
import {
  SOURCE_FIELD,
  isOwnSource,
  selectedSources,
  sourceEntry,
  targetChoice,
  withSourceSelection,
  type SourceMarkProps,
  type TargetChoice,
} from "../lib/sources.ts"
import { templateFields } from "../lib/template.ts"
import { filterFromUrl, seedFilter } from "../lib/view-filter.ts"

/** What a governing ui-view pins (`lib/ui-views.ts#viewToConfig`); empty for a bare collection. */
export interface BrowseConfig {
  layout?: string
  /** The view's filter, in the engine's shape — decompiled into the builder where it can be. */
  baseFilter?: Record<string, unknown>
  columns?: string[]
  /** `''` is a view saying "unsorted", and it wins. */
  sort?: string
  listOptions?: Record<string, Record<string, unknown>>
  /** The governing view record — what Save writes back to. Absent: the collection's own display. */
  viewId?: string
  /**
   * A browse EMBEDDED in another page — a relation field's records on a record page (`record/RelationField.tsx`).
   * It neither reads nor writes the route's `?search=`/`?filter=`/`?layout=` (they are the page's, and three
   * relation fields would fight over them), keeps its unsaved tweaks apart from the collection's own browse page,
   * and treats `baseFilter` as SCOPE: applied under everything, never decompiled into an editable rule (a ✕ on
   * it would widen the relation to the whole collection).
   */
  embedded?: boolean
}

/** Everything a view record stores. `filter: null` — the stored filter is not the builder's to speak for. */
export interface Snapshot {
  layout: string
  columns: string[]
  sort: string
  listOptions: Record<string, Record<string, unknown>>
  filter: FilterGroup | null
}

const scratchByView = new Map<string, Snapshot>()

/** A snapshot as `dirty` compares it: the filter by what it ASKS, not by its rules' ids — the URL's copy of a
 *  view's own filter re-mints every id, and must not read as an edit. */
function compareKey(s: Snapshot): string {
  return JSON.stringify({ ...s, filter: s.filter ? (compileFilter(s.filter) ?? null) : null })
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export function useBrowseState(collection: string, config: BrowseConfig = {}) {
  const { schema, route, navigate, version } = useApp()
  const row = schema.collection(collection)
  const sources = row?.sources
  const fields = useMemo(
    () => browseFields(schema.fields(collection), collection, sources),
    [schema, collection, sources]
  )
  const fieldByName = useMemo(() => new Map(fields.map(f => [f.field, f])), [fields])

  // ---- the start, decided once ------------------------------------------------------------------------
  const scratchKey = `${scratchKeyFor(collection, config.viewId)}${config.embedded ? "::embedded" : ""}`
  const start = useRef<ReturnType<typeof initial> | null>(null)
  if (!start.current) start.current = initial()
  function initial() {
    const q = config.embedded ? {} : queryOf(route)
    const urlFilter = q["filter"] ?? null
    const seeded = seedFilter(config.baseFilter, urlFilter, config.embedded)
    const seed = listSeed(config, row?.list)
    const known = new Set(fields.map(f => f.field))
    // what the RECORD resolves to — a column the schema no longer has drops out here, so a fresh page is clean
    const baseline: Snapshot = {
      layout: seed.layout,
      columns: seedColumns(seed.columns, fields, sources).filter(c => known.has(c)),
      sort: seed.sort ?? DEFAULT_SORT,
      listOptions: clone(seed.listOptions),
      filter: seeded.opaque ? null : seeded.record,
    }
    let live: Snapshot & { filter: FilterGroup } = {
      ...clone(baseline),
      layout: q["layout"] || seed.layout,
      filter: seeded.initial,
    }
    const scratch = scratchByView.get(scratchKey)
    if (scratch) {
      const filter = urlFilter !== null || !scratch.filter ? live.filter : withSourceSelection(scratch.filter, null)
      live = { ...clone(scratch), filter: clone(filter) }
    }
    return { baseline, live, opaque: seeded.opaque, search: q["search"] ?? "", defaultLayout: seed.layout }
  }
  const init = start.current
  const opaque = init.opaque

  const [layout, setLayout] = useState(init.live.layout)
  const [columnNames, setColumnNames] = useState<string[]>(init.live.columns)
  const [sort, setSortRaw] = useState(init.live.sort)
  const [listOptions, setListOptionsAll] = useState(init.live.listOptions)
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(init.live.filter)
  const [baseline, setBaseline] = useState<Snapshot>(init.baseline)
  const [searchInput, setSearchInput] = useState(init.search)
  const [search, setSearch] = useState(init.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [reloads, setReloads] = useState(0)

  // the search is sent once typing pauses
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300)
    return () => clearTimeout(t)
  }, [searchInput])

  // ---- columns ----------------------------------------------------------------------------------------
  const columns = useMemo(
    () => columnNames.map(n => fieldByName.get(n)).filter((f): f is FieldRow => f !== undefined),
    [columnNames, fieldByName]
  )
  const hiddenFields = useMemo(() => fields.filter(f => !columnNames.includes(f.field)), [fields, columnNames])

  const snapshot = (): Snapshot => ({
    layout,
    columns: columns.map(f => f.field),
    sort,
    listOptions: clone(listOptions),
    filter: opaque ? null : clone(filterGroup),
  })
  const snap = JSON.stringify(snapshot())
  const dirty = compareKey(JSON.parse(snap) as Snapshot) !== compareKey(baseline)

  // unsaved tweaks outlive the mount, for this session only
  useEffect(() => {
    const now = JSON.parse(snap) as Snapshot
    if (compareKey(now) === compareKey(baseline)) scratchByView.delete(scratchKey)
    else scratchByView.set(scratchKey, now)
  }, [snap, baseline, scratchKey])

  function apply(next: Snapshot): void {
    setLayout(next.layout)
    setColumnNames([...next.columns])
    setSortRaw(next.sort)
    setListOptionsAll(clone(next.listOptions))
    if (next.filter) setFilterGroup(clone(next.filter))
  }

  // ---- the query --------------------------------------------------------------------------------------
  const activeOptions = listOptions[layout] ?? {}
  const grouped = typeof activeOptions["group_by"] === "string" && !!activeOptions["group_by"]
  const limit = effectiveLimit(activeOptions["page_size"], grouped)

  /** The filter sent: the builder's, compiled — with an opaque stored filter anded underneath, the one case the
   *  builder never held it — and every reference compared in the engine's `collection/id` form. */
  const filter = useMemo(() => {
    const compiled = compileFilter(filterGroup)
    const base = opaque ? config.baseFilter : undefined
    const both = base && compiled ? { _and: [base, compiled] } : (base ?? compiled)
    if (!both) return undefined
    return normalizeFilterRefs(both, collection, (c, f) => {
      const field = schema.field(c, f)
      return field ? schema.target(field)?.collection : undefined
    }) as Record<string, unknown>
  }, [filterGroup, opaque, config.baseFilter, collection, schema])

  // page 1 again whenever what is asked changes — staying on page 7 of a new question shows rows that have
  // nothing to do with it
  const queryKey = JSON.stringify([search, filter ?? null, sort, limit])
  const [paging, setPaging] = useState({ key: queryKey, page: 1 })
  const page = paging.key === queryKey ? paging.page : 1
  const setPage = (p: number) => setPaging({ key: queryKey, page: p })

  const answer = useAsync(
    () =>
      listRecords(collection, {
        limit,
        offset: (page - 1) * limit,
        sort: sort || undefined,
        q: search || undefined,
        filter,
      }),
    [collection, queryKey, page, version, reloads]
  )
  const records: Row[] = answer.data?.records ?? []
  const total = answer.data?.total ?? 0
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  // ---- the URL: search, filter and layout ride on it ------------------------------------------------------
  const routeNow = useRef(route)
  routeNow.current = route
  /** Every `?filter=` this browse wrote: its own echoes, never a navigation to re-seed from. */
  const written = useRef(new Set<string>())
  const serialized = serializeFilterGroup(filterGroup)
  useEffect(() => {
    const current = routeNow.current
    const rest = queryOf(current)
    delete rest["search"]
    delete rest["filter"]
    delete rest["layout"]
    const next = withQuery(pathOf(current), {
      ...rest,
      search,
      filter: serialized,
      layout: layout !== init.defaultLayout ? layout : undefined,
    })
    if (config.embedded) return
    if (next === current) return
    written.current.add(serialized ?? "")
    navigate(next)
  }, [search, serialized, layout, navigate, init.defaultLayout, config.embedded])

  // A record just created from this list under a Sources selection that leaves out the root it was saved to: WIDEN
  // the selection to that root, so the record is in the list the person comes back to, and say so (`createdNotice`).
  // Taken in an effect, not during render: the note is consumed once, and a render may run twice.
  const [createdNotice, setCreatedNotice] = useState<CreatedNote | null>(null)
  useEffect(() => {
    if (config.embedded) return
    const note = takeCreated(collection)
    if (!note) return
    const widened = widenedFor(filterGroup, note.source)
    if (!widened) return
    setFilterGroup(widened)
    setCreatedNotice(note)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on the mount the note was meant for
  }, [])

  // a navigation that changes only `?filter=` (a layer's nav row, a nav row with none) reaches a mounted browse:
  // re-seed the builder from it. Only a CHANGE re-seeds (compared with the last one seen, so StrictMode's second run
  // cannot undo a change made on mount), and never to a filter this browse wrote itself: a write the route has not
  // caught up with yet (the id re-mint on mount, then the created-here widening) would otherwise undo the next one.
  const urlFilter = config.embedded ? null : (queryOf(route)["filter"] ?? null)
  const lastUrl = useRef(urlFilter)
  useEffect(() => {
    if (config.embedded || lastUrl.current === urlFilter) return
    lastUrl.current = urlFilter
    if (urlFilter !== null && written.current.has(urlFilter)) return
    setFilterGroup(current => filterFromUrl(urlFilter, current, config.baseFilter) ?? current)
  }, [urlFilter, config.baseFilter])

  // ---- selection: the rows on screen -------------------------------------------------------------------------
  const selectionKey = `${queryKey}|${page}|${layout}`
  const [selection, setSelection] = useState<{ key: string; ids: Set<string> }>({ key: selectionKey, ids: new Set() })
  const selectedIds = selection.key === selectionKey ? selection.ids : new Set<string>()
  const setSelected = (ids: Set<string>) => setSelection({ key: selectionKey, ids })
  const allVisibleSelected = records.length > 0 && records.every(r => selectedIds.has(r.id))
  const [deleting, setDeleting] = useState(false)

  // ---- sources ----------------------------------------------------------------------------------------------
  /** The picker's rows: the host's per-query counts once an answer landed, the collection's before. */
  const sourceFacets: SourceEntry[] = answer.data?.sources?.length ? answer.data.sources : (sources ?? [])

  // ---- creating ---------------------------------------------------------------------------------------------
  const [pendingCreate, setPendingCreate] = useState<{
    prefill: Record<string, unknown> | undefined
    choice: Extract<TargetChoice, { mode: "choose" }>
  } | null>(null)

  function openCreateForm(prefill: Record<string, unknown> | undefined, target: string | undefined): void {
    const picked = selectedSources(filterGroup)
    navigate(
      withQuery(createRoute(collection), {
        prefill: prefill && Object.keys(prefill).length ? JSON.stringify(prefill) : undefined,
        [SOURCES_QUERY]: picked.length ? picked.join(",") : undefined,
        [TARGET_QUERY]: target,
      })
    )
  }

  // ---- the collection's display -------------------------------------------------------------------------------
  /** The column that names a record: the first visible field its `record_title` reads, else `title`/`name`. */
  const titleField = useMemo(() => {
    const known = new Set(fields.map(f => f.field))
    return (
      templateFields(row?.record_title ?? "").find(f => known.has(f)) ??
      ["title", "name"].find(f => known.has(f)) ??
      null
    )
  }, [fields, row?.record_title])
  const colorBy = colorByFor(row, listOptions[layout])

  // ---- hand-set order and card pictures ---------------------------------------------------------------------
  // A drag writes the collection's `position_field` — offered only while the list is SORTED by it: a drag on a
  // list sorted by anything else would write a position the reader cannot see take effect.
  const positionField = row?.position_field ?? null
  const manualOrder = !!positionField && sort.replace(/^-/, "") === positionField
  // a card's picture: the first field whose View is `image` (opt-in only); up to three other chosen columns are
  // its subtitle lines — the table's own column choice, so switching layout needs no second "which fields"
  const imageField = useMemo(() => fields.find(f => resolveView(f).entry.id === "image") ?? null, [fields])
  const subtitleFields = useMemo(
    () => columns.filter(f => f.field !== imageField?.field).slice(0, 3),
    [columns, imageField]
  )

  return {
    collection,
    row,
    fields,
    columns,
    hiddenFields,
    titleField,
    // search + filter
    searchInput,
    setSearchInput,
    search,
    filterGroup,
    setFilterGroup,
    filterOpen,
    setFilterOpen,
    /** True when the view's stored filter never reached the builder — Save must keep it as stored. */
    filterOpaque: opaque,
    filter,
    hasActiveQuery: Boolean(searchInput) || filterGroup.rules.length > 0,
    // layout + options
    layout,
    setLayout,
    listOptions,
    setListOptions(listId: string, values: Record<string, unknown>) {
      setListOptionsAll(o => ({ ...o, [listId]: values }))
    },
    // columns
    toggleColumn(field: string) {
      setColumnNames(names => (names.includes(field) ? names.filter(n => n !== field) : [...names, field]))
    },
    moveColumn(from: number, to: number) {
      setColumnNames(
        moveItem(
          columns.map(f => f.field),
          from,
          to
        )
      )
    },
    setColumns: (names: string[]) => setColumnNames([...names]),
    // sort
    sort,
    /** The sort outright (`field`, `-field`, `''`) — the Layout options control. */
    setSort: (value: string) => setSortRaw(value),
    /** A column header: ascending, then descending. */
    toggleSort: (field: string) => setSortRaw(s => toggledSort(s, field)),
    /** The collection's `position_field` (a field of type `position`), or null. */
    positionField,
    /** True while the list is sorted by the position field — the only time a drag may reorder. */
    manualOrder,
    sortField: sort.replace(/^-/, ""),
    sortDesc: sort.startsWith("-"),
    sortIndicator: (field: string): "asc" | "desc" | "" =>
      sort === field ? "asc" : sort === `-${field}` ? "desc" : "",
    // the saved-view half
    viewId: config.viewId,
    dirty,
    snapshot,
    resetToView() {
      scratchByView.delete(scratchKey)
      apply(baseline)
    },
    markSaved() {
      setBaseline(snapshot())
      scratchByView.delete(scratchKey)
    },
    // rows
    records,
    total,
    loading: answer.loading,
    error: answer.error,
    unavailable: answer.data?.unavailable ?? null,
    reload: () => setReloads(n => n + 1),
    page,
    limit,
    from,
    to,
    hasPrev: page > 1,
    hasNext: page * limit < total,
    prevPage: () => page > 1 && setPage(page - 1),
    nextPage: () => page * limit < total && setPage(page + 1),
    openRecord: (record: Row) => navigate(recordRoute(collection, record.id)),
    recordTitleOf: (record: Row) => recordLabel(row, record, record.id),
    colorBy,
    tintOf: (record: Row) => tintStyle(tintFor(colorBy, fields, record)),
    imageField,
    subtitleFields,
    // selection
    selectedIds,
    isSelected: (id: string) => selectedIds.has(id),
    toggleSelect(id: string) {
      const next = new Set(selectedIds)
      if (!next.delete(id)) next.add(id)
      setSelected(next)
    },
    allVisibleSelected,
    toggleSelectAllVisible: () => setSelected(allVisibleSelected ? new Set() : new Set(records.map(r => r.id))),
    clearSelection: () => setSelected(new Set()),
    createdNotice,
    dismissCreated: () => setCreatedNotice(null),
    /** Tick exactly these rows — the chat's push (`dt:select`). */
    setSelection: (ids: Iterable<string>) => setSelected(new Set(ids)),
    deleting,
    async deleteSelected() {
      if (!selectedIds.size) return
      setDeleting(true)
      try {
        await Promise.all([...selectedIds].map(id => removeRecord(collection, id)))
        setSelected(new Set())
        setReloads(n => n + 1)
      } finally {
        setDeleting(false)
      }
    },
    // sources
    sources,
    sourceFacets,
    /** A record's mark, or null for one read from the workspace's own root, which carries none. */
    sourceOf(record: Row): SourceMarkProps | null {
      const name = record[SOURCE_FIELD]
      if (typeof name !== "string" || !name || isOwnSource(name, sources)) return null
      const entry = sourceEntry(sourceFacets, name) ?? sourceEntry(sources, name)
      return {
        name,
        record: entry?.record ?? null,
        ...(entry?.access ? { access: entry.access } : {}),
        ...(entry?.via ? { via: entry.via } : {}),
        ...(entry?.note ? { note: entry.note } : {}),
      }
    },
    // creating — where several roots take a new record, ask first (`TargetChoice`)
    pendingCreate,
    createRecord(prefill?: Record<string, unknown>) {
      const choice = targetChoice(sourceFacets, selectedSources(filterGroup))
      if (choice.mode === "choose") setPendingCreate({ prefill, choice })
      else openCreateForm(prefill, choice.target?.name)
    },
    chooseTarget(name: string) {
      const pending = pendingCreate
      setPendingCreate(null)
      openCreateForm(pending?.prefill, name)
    },
    cancelCreate: () => setPendingCreate(null),
    clearFilters: () => setFilterGroup(g => ({ ...g, rules: [] })),
    emptyFilter: emptyFilterGroup,
  }
}

export type BrowseState = ReturnType<typeof useBrowseState>
