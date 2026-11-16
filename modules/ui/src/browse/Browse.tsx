/**
 * THE BROWSE — a collection's records, drawn by whichever List its layout names (ported from the Vue ui's
 * BrowseView.vue). It owns ONE browse state (`browse-state.ts`) and draws the frame around the List: the header
 * (search, the source picker, the filter, the table's density, the batch delete, Layout options, New), the active
 * filter as chips, what it could not draw, the List, and the pager.
 *
 * The List comes from the `lists` registry by the layout's id — the view's, else the collection's
 * `display.list.layout`, else the URL's `?layout=` — and takes the Vue ui's List props (`ListProps`: `state`,
 * `collection`, `query`, `options`). A layout ui has not registered yet (board, cards, calendar, …) draws the
 * table, and says so: a view naming one still opens.
 *
 * A bare collection and a named ui-view are the same browse: the view page hands its config in. The caller keys
 * the component on what it consumed at the start (the collection's list block, its sources, the view record), so
 * a change to any of them remounts it.
 */
import { useEffect, useState } from "react"
import { useApp, useSignal } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { displayValue, filterToProse, operatorLabel, operatorTakesPair } from "../lib/filter-query.ts"
import { formatTitle } from "../lib/format-title.ts"
import { unknownOptions } from "../lib/list-options.ts"
import {
  SOURCE_FIELD,
  hasForeignSource,
  isSourceRule,
  selectedSources,
  sourceChipLabel,
  sourceColor,
} from "../lib/sources.ts"
import { signal } from "../lib/signal.ts"
import { lists } from "../registry/index.ts"
import type { ListProps } from "../registry/props.ts"
import { CommitButton } from "../components/CommitButton.tsx"
import { SourceMark } from "../components/SourceMark.tsx"
import { pageSelection, pushedIds, pushedSelection } from "../lib/pane-place.ts"
import { RecordCommands } from "../record/RecordCommands.tsx"
import { useBrowseState, type BrowseConfig, type BrowseState } from "./browse-state.ts"
import { DensityMenu } from "./DensityMenu.tsx"
import { FilterBuilder } from "./FilterBuilder.tsx"
import { LayoutOptions } from "./LayoutOptions.tsx"
import { SourcePicker } from "./SourcePicker.tsx"
import { TargetChoice } from "./TargetChoice.tsx"
import { usePopover } from "./use-popover.ts"
import {
  button,
  buttonSize,
  buttonTone,
  chipRemove,
  cx,
  error,
  iconButton,
  linkButton,
  note,
  pageHead,
  pageHeadSpace,
  popoverAnchor,
  subtle,
  toolbar,
} from "../styles/classes.ts"
import { capsLabel, floatingPanel, panelHead, panelTitle, sidePanel, sourceDot } from "./looks.ts"

// ---- the looks (was dt-browse-*, dt-search, dt-filter-*, dt-pager) -----------------------------------------------
/** The search box: an input-like frame with the input bare inside. */
const searchCls =
  "inline-flex items-center gap-1.5 pl-2 border border-input-border rounded-dt bg-input-bg [&_input]:w-[200px] [&_input]:border-0 [&_input]:bg-transparent [&_input]:outline-none"
/** The count on the filter button. */
const badgeCls = "min-w-4 px-1 rounded-full bg-accent text-accent-fg text-[10px] leading-4 text-center"
const filterPanelCls = cx(
  floatingPanel,
  "absolute top-[calc(100%+4px)] right-0 z-20 w-[min(640px,calc(100vw-48px))] max-h-[70vh] overflow-y-auto px-3 py-2.5"
)
/** An active filter, as a chip under the header. */
const filterChipCls =
  "inline-flex items-center gap-0.5 py-px pr-1 pl-2.5 border border-border rounded-full bg-bg-subtle text-small"
/** The list and the panels beside it; stacked when narrow. */
const bodyCls = "flex flex-auto gap-4 min-h-0 max-[900px]:flex-col"
/** The List and its pager. The table's scroller fills it only when the browse fills the page. */
const listCls = (fill: boolean) =>
  cx("flex flex-auto flex-col min-w-0 min-h-0", !fill && "[&_[data-table-scroll]]:flex-none")

/** The Layout options panel stays open across pages until closed — it is a working surface, not a dialog. */
const optionsOpen = signal(false)
/** So does the Commands panel: the commands bound to the collection, over the ticked rows. */
const commandsOpen = signal(false)

/**
 * cr-modules-017 §5: the page's own browse publishes its ticked rows (the pane reporter sends them to the chat) and
 * applies the chat's push (`dt:select`) — the ids of the refs in THIS collection; `[]` clears. A push is consumed by
 * the list it was for, so it is not applied again when that list mounts later.
 */
function usePaneSelection(state: BrowseState, collection: string, embedded: boolean) {
  const ids = [...state.selectedIds]
  const key = ids.join("\n")
  useEffect(() => {
    if (!embedded) pageSelection.set({ collection, ids: key ? key.split("\n") : [] })
  }, [collection, key, embedded])
  useEffect(
    () => () => {
      if (!embedded && pageSelection.get()?.collection === collection) pageSelection.set(null)
    },
    [collection, embedded]
  )
  const push = useSignal(pushedSelection)
  const { setSelection } = state
  useEffect(() => {
    if (embedded || !push) return
    const mine = pushedIds(push, collection)
    if (mine === null) return
    setSelection(mine)
    pushedSelection.set(null)
  }, [push, collection, embedded, setSelection])
}

/** The selection, settled: one engine call per pause in the ticking, not one per tick. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}

export function Browse({
  collection,
  config,
  title,
  viewOptions,
}: {
  collection: string
  config?: BrowseConfig
  /** The header's title: a view's nav label; else the collection's title. */
  title?: string
  /** A view's `display.list.options` — the module-List `options` prop. */
  viewOptions?: Record<string, unknown>
}) {
  const { editable } = useApp()
  const state = useBrowseState(collection, config)
  const row = state.row
  const panelOpen = useSignal(optionsOpen)
  const cmdsOpen = useSignal(commandsOpen)
  usePaneSelection(state, collection, !!config?.embedded)
  const selectedKey = useSettled([...state.selectedIds].join(","), 300)
  const filter = usePopover([state.filterOpen, state.setFilterOpen])
  const [sourcesOpen, setSourcesOpen] = useState(false)

  const entry = lists.get(state.layout)
  const list = entry ?? lists.get("table")!
  const List = list.component
  const listProps: ListProps = {
    state,
    collection,
    query: { search: state.search, filter: state.filter, sort: state.sort },
    options: viewOptions ?? {},
  }
  const unknown = entry ? unknownOptions(state.listOptions[state.layout], entry.options) : []

  const segments = collection.split("/").filter(Boolean)
  const heading = title ?? row?.title ?? formatTitle(segments[segments.length - 1] ?? collection)

  /** A field path as a person reads it: `project.status` → `Project › Status`. */
  const pathLabel = (path: string) => {
    if (path === SOURCE_FIELD) return "Source"
    const parts = path.split(".")
    const root = state.fields.find(f => f.field === parts[0])
    return [root?.title ?? formatTitle(parts[0] ?? ""), ...parts.slice(1).map(formatTitle)].join(" › ")
  }
  const chips = state.filterGroup.rules.map(rule => {
    if (isSourceRule(rule)) {
      const names = selectedSources({ logic: "_and", rules: [rule] })
      return { id: rule.id, label: sourceChipLabel(names), sources: names }
    }
    const has = Array.isArray(rule.value)
      ? rule.value.length > 0
      : rule.value !== "" && rule.value !== null && rule.value !== undefined
    const value = Array.isArray(rule.value)
      ? rule.value.map(displayValue).join(operatorTakesPair(rule.operator) ? " → " : ", ")
      : displayValue(rule.value)
    return {
      id: rule.id,
      label: `${pathLabel(rule.field)} ${operatorLabel(rule.operator)}${has ? ` ${value}` : ""}`,
      sources: null as string[] | null,
    }
  })
  const prose = filterToProse(state.filterGroup, pathLabel)
  const removeRule = (id: string) => state.setFilterGroup(g => ({ ...g, rules: g.rules.filter(r => r.id !== id) }))

  const canCreate = editable && !row?.runtime && !state.unavailable

  // EMBEDDED (a relation's records on a record page): the List and its pager, no header — the record page is
  // the page. A List's own create gesture (a column's +) still asks its target choice, drawn above the List.
  if (config?.embedded)
    return (
      <section className="flex flex-col gap-1.5 p-0 min-h-0" data-embedded-browse={collection}>
        {state.error && <p className={error}>{state.error}</p>}
        {!entry && (
          <p className={note} data-degraded>
            <Icon name="info" /> Layout <code>{state.layout}</code> isn’t drawn by ui yet — showing the table instead.
          </p>
        )}
        {state.pendingCreate && (
          <div className={popoverAnchor}>
            <TargetChoice choice={state.pendingCreate.choice} onPick={state.chooseTarget} />
          </div>
        )}
        <div className={listCls(false)}>
          <List {...listProps} />
          {!list.summarizes && (state.hasNext || state.hasPrev) && <Pager state={state} />}
        </div>
      </section>
    )

  return (
    <section className={cx("flex flex-col gap-2.5 min-h-full px-6 py-5", list.fillsHeight && "h-full")}>
      <header className={cx(pageHead, pageHeadSpace.column)}>
        <div>
          {segments.length > 1 && (
            <div className={cx(subtle, "mb-1 text-small")}>{segments.slice(0, -1).join("/")}</div>
          )}
          <h1>
            {row?.nav.icon && <Icon name={row.nav.icon} />} {heading}
          </h1>
        </div>
        <div className={toolbar}>
          <label className={searchCls}>
            <Icon name="search" />
            <input
              type="search"
              value={state.searchInput}
              onChange={e => state.setSearchInput(e.target.value)}
              placeholder="Search…"
              aria-label="Search records"
            />
          </label>

          <CommitButton onCommitted={state.reload} />

          {hasForeignSource(state.sources) && (
            <SourcePicker
              facets={state.sourceFacets}
              filterGroup={state.filterGroup}
              setFilterGroup={state.setFilterGroup}
              open={[sourcesOpen, setSourcesOpen]}
            />
          )}

          <div ref={filter.anchor} className={popoverAnchor}>
            <button
              type="button"
              className={cx(button, buttonTone[filter.open ? "active" : "default"], buttonSize.icon)}
              title={prose ? `Filtered — ${prose}` : "Filter"}
              aria-expanded={filter.open}
              onClick={() => filter.setOpen(!filter.open)}
            >
              <Icon name="filter" />
              {chips.length > 0 && <span className={badgeCls}>{chips.length}</span>}
            </button>
            {filter.open && (
              <div className={filterPanelCls}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={cx(capsLabel, "flex-1 m-0")}>Filter</span>
                  {state.filterGroup.rules.length > 0 && (
                    <button type="button" className={linkButton} onClick={state.clearFilters}>
                      Clear all
                    </button>
                  )}
                  <button
                    type="button"
                    className={iconButton}
                    aria-label="Close filter"
                    onClick={() => filter.setOpen(false)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
                <FilterBuilder
                  value={state.filterGroup}
                  setValue={state.setFilterGroup}
                  collection={collection}
                  fields={state.fields}
                />
              </div>
            )}
          </div>

          {list.id === "table" && <DensityMenu state={state} />}

          {state.selectedIds.size > 0 && (
            <>
              <span className={subtle}>{state.selectedIds.size} selected</span>
              {editable && (
                <button
                  type="button"
                  className={cx(button, buttonTone.danger, buttonSize.icon)}
                  title="Delete selected"
                  disabled={state.deleting}
                  onClick={() => {
                    if (confirm(`Delete ${state.selectedIds.size} record(s)? This can't be undone.`))
                      void state.deleteSelected()
                  }}
                >
                  <Icon name="trash" />
                </button>
              )}
            </>
          )}

          <button
            type="button"
            className={cx(button, buttonTone[cmdsOpen ? "active" : "default"], buttonSize.icon)}
            title="Commands — over the ticked rows"
            aria-pressed={cmdsOpen}
            data-commands-toggle
            onClick={() => commandsOpen.set(!cmdsOpen)}
          >
            <Icon name="terminal" />
          </button>

          <button
            type="button"
            className={cx(button, buttonTone[panelOpen ? "active" : "default"], buttonSize.icon)}
            title="Layout options"
            aria-pressed={panelOpen}
            onClick={() => optionsOpen.set(!panelOpen)}
          >
            <Icon name="settings" />
          </button>

          {canCreate && (
            <div className={popoverAnchor}>
              <button
                type="button"
                className={cx(button, buttonTone.primary, buttonSize.default)}
                aria-expanded={!!state.pendingCreate}
                onClick={() => (state.pendingCreate ? state.cancelCreate() : state.createRecord())}
              >
                <Icon name="add" /> New {row?.record_type ?? "record"}
              </button>
              {state.pendingCreate && <TargetChoice choice={state.pendingCreate.choice} onPick={state.chooseTarget} />}
            </div>
          )}
        </div>
      </header>

      {chips.length > 0 && (
        <div className="inline-flex flex-wrap gap-1.5">
          {chips.map(chip => (
            <span key={chip.id} className={filterChipCls} data-source-chip={chip.sources?.join(",")}>
              {chip.sources ? (
                <button
                  type="button"
                  className={linkButton}
                  title="Change the sources"
                  onClick={() => setSourcesOpen(true)}
                >
                  {chip.sources.map(n => (
                    <span key={n} className={sourceDot} style={{ background: sourceColor(n) }} aria-hidden="true" />
                  ))}
                  {chip.label}
                </button>
              ) : (
                <button type="button" className={linkButton} onClick={() => filter.setOpen(true)}>
                  {chip.label}
                </button>
              )}
              <button
                type="button"
                className={chipRemove}
                aria-label="Remove filter"
                onClick={() => removeRule(chip.id)}
              >
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}

      {state.createdNotice && (
        // a record just created from this list, which the Sources selection would have hidden: the selection
        // widened to its root (`lib/created-visibility.ts`), said once
        <p className={note} data-created-notice>
          <span>Showing</span>
          <SourceMark name={state.createdNotice.source} />
          <span>too — the new record {state.createdNotice.id} was saved there.</span>
          <button type="button" className={iconButton} title="Dismiss" onClick={state.dismissCreated}>
            <Icon name="close" />
          </button>
        </p>
      )}
      {state.error && <p className={error}>{state.error}</p>}
      {state.unavailable && (
        <p className={note} data-unavailable>
          <Icon name="info" /> Not read on this machine: {state.unavailable}
        </p>
      )}
      {!entry && (
        <p className={note} data-degraded>
          <Icon name="info" /> Layout <code>{state.layout}</code> isn’t drawn by ui yet — showing the table instead.
        </p>
      )}
      {unknown.filter(o => o.renamedTo).length > 0 && (
        <p className={note}>
          <Icon name="info" /> Renamed layout options:{" "}
          {unknown
            .filter(o => o.renamedTo)
            .map(o => `${o.key} is now ${o.renamedTo}`)
            .join(", ")}{" "}
          — rename them in the view.
        </p>
      )}
      {unknown.filter(o => !o.renamedTo).length > 0 && (
        <p className={note}>
          <Icon name="info" /> Layout options{" "}
          {unknown
            .filter(o => !o.renamedTo)
            .map(o => o.key)
            .join(", ")}{" "}
          aren’t known to this build — check the spelling in the view.
        </p>
      )}

      <div className={bodyCls}>
        <div className={listCls(!!list.fillsHeight)}>
          <List {...listProps} />
          {!list.summarizes && <Pager state={state} />}
        </div>
        {cmdsOpen && (
          <aside className={sidePanel} aria-label="Commands">
            <header className={panelHead}>
              <span className={panelTitle}>Commands</span>
              <span className={subtle}>
                {state.selectedIds.size ? `${state.selectedIds.size} ticked` : "tick rows to run one on them"}
              </span>
              <button
                type="button"
                className={iconButton}
                aria-label="Close commands"
                onClick={() => commandsOpen.set(false)}
              >
                <Icon name="close" />
              </button>
            </header>
            <RecordCommands collection={collection} ids={selectedKey ? selectedKey.split(",") : []} />
          </aside>
        )}
        {panelOpen && <LayoutOptions state={state} onClose={() => optionsOpen.set(false)} />}
      </div>
    </section>
  )
}

function Pager({ state }: { state: BrowseState }) {
  return (
    <footer className="flex justify-end items-center gap-2 mt-2">
      <span className={cx(subtle, "mr-auto")}>
        {state.loading && <Icon name="loading" />} {state.from}–{state.to} of {state.total}
      </span>
      <button
        type="button"
        className={cx(button, buttonTone.default, buttonSize.icon)}
        disabled={!state.hasPrev}
        onClick={state.prevPage}
        title="Previous page"
      >
        <Icon name="chevron-left" />
      </button>
      <button
        type="button"
        className={cx(button, buttonTone.default, buttonSize.icon)}
        disabled={!state.hasNext}
        onClick={state.nextPage}
        title="Next page"
      >
        <Icon name="chevron-right" />
      </button>
    </footer>
  )
}
