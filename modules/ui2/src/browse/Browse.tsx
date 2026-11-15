/**
 * THE BROWSE — a collection's records, drawn by whichever List its layout names (ported from @dreamteamer/ui's
 * BrowseView.vue). It owns ONE browse state (`browse-state.ts`) and draws the frame around the List: the header
 * (search, the source picker, the filter, the table's density, the batch delete, Layout options, New), the active
 * filter as chips, what it could not draw, the List, and the pager.
 *
 * The List comes from the `lists` registry by the layout's id — the view's, else the collection's
 * `display.list.layout`, else the URL's `?layout=` — and takes ui's List props (`ListProps`: `state`,
 * `collection`, `query`, `options`). A layout ui2 has not registered yet (board, cards, calendar, …) draws the
 * table, and says so: a view naming one still opens.
 *
 * A bare collection and a named ui-view are the same browse: the view page hands its config in. The caller keys
 * the component on what it consumed at the start (the collection's list block, its sources, the view record), so
 * a change to any of them remounts it.
 */
import { useState } from "react"
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
import { useBrowseState, type BrowseConfig, type BrowseState } from "./browse-state.ts"
import { DensityMenu } from "./DensityMenu.tsx"
import { FilterBuilder } from "./FilterBuilder.tsx"
import { LayoutOptions } from "./LayoutOptions.tsx"
import { SourcePicker } from "./SourcePicker.tsx"
import { TargetChoice } from "./TargetChoice.tsx"
import { usePopover } from "./use-popover.ts"

/** The Layout options panel stays open across pages until closed — it is a working surface, not a dialog. */
const optionsOpen = signal(false)

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
      <section className="ui2-browse is-embedded" data-embedded-browse={collection}>
        {state.error && <p className="ui2-error">{state.error}</p>}
        {!entry && (
          <p className="ui2-note" data-degraded>
            <Icon name="info" /> Layout <code>{state.layout}</code> isn’t drawn by ui2 yet — showing the table instead.
          </p>
        )}
        {state.pendingCreate && (
          <div className="ui2-popover-anchor">
            <TargetChoice choice={state.pendingCreate.choice} onPick={state.chooseTarget} />
          </div>
        )}
        <div className="ui2-browse-list">
          <List {...listProps} />
          {!list.summarizes && (state.hasNext || state.hasPrev) && <Pager state={state} />}
        </div>
      </section>
    )

  return (
    <section className={`ui2-browse${list.fillsHeight ? " is-fill" : ""}`}>
      <header className="ui2-page-head ui2-browse-head">
        <div>
          {segments.length > 1 && <p className="ui2-crumbs ui2-subtle">{segments.slice(0, -1).join("/")}</p>}
          <h1>
            {row?.nav.icon && <Icon name={row.nav.icon} />} {heading}
          </h1>
        </div>
        <div className="ui2-toolbar">
          <label className="ui2-search">
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

          <div ref={filter.anchor} className="ui2-popover-anchor">
            <button
              type="button"
              className={`ui2-button is-icon${filter.open ? " is-active" : ""}`}
              title={prose ? `Filtered — ${prose}` : "Filter"}
              aria-expanded={filter.open}
              onClick={() => filter.setOpen(!filter.open)}
            >
              <Icon name="filter" />
              {chips.length > 0 && <span className="ui2-badge">{chips.length}</span>}
            </button>
            {filter.open && (
              <div className="ui2-filter-panel">
                <div className="ui2-filter-panel-head">
                  <span className="ui2-lo-label">Filter</span>
                  {state.filterGroup.rules.length > 0 && (
                    <button type="button" className="ui2-link-button" onClick={state.clearFilters}>
                      Clear all
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui2-icon-button"
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
              <span className="ui2-subtle">{state.selectedIds.size} selected</span>
              {editable && (
                <button
                  type="button"
                  className="ui2-button is-icon is-danger"
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
            className={`ui2-button is-icon${panelOpen ? " is-active" : ""}`}
            title="Layout options"
            aria-pressed={panelOpen}
            onClick={() => optionsOpen.set(!panelOpen)}
          >
            <Icon name="settings" />
          </button>

          {canCreate && (
            <div className="ui2-popover-anchor">
              <button
                type="button"
                className="ui2-button is-primary"
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
        <div className="ui2-chips ui2-filter-chips">
          {chips.map(chip => (
            <span key={chip.id} className="ui2-filter-chip" data-source-chip={chip.sources?.join(",")}>
              {chip.sources ? (
                <button
                  type="button"
                  className="ui2-link-button"
                  title="Change the sources"
                  onClick={() => setSourcesOpen(true)}
                >
                  {chip.sources.map(n => (
                    <span
                      key={n}
                      className="ui2-source-dot"
                      style={{ background: sourceColor(n) }}
                      aria-hidden="true"
                    />
                  ))}
                  {chip.label}
                </button>
              ) : (
                <button type="button" className="ui2-link-button" onClick={() => filter.setOpen(true)}>
                  {chip.label}
                </button>
              )}
              <button
                type="button"
                className="ui2-chip-remove"
                aria-label="Remove filter"
                onClick={() => removeRule(chip.id)}
              >
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}

      {state.error && <p className="ui2-error">{state.error}</p>}
      {state.unavailable && (
        <p className="ui2-note" data-unavailable>
          <Icon name="info" /> Not read on this machine: {state.unavailable}
        </p>
      )}
      {!entry && (
        <p className="ui2-note" data-degraded>
          <Icon name="info" /> Layout <code>{state.layout}</code> isn’t drawn by ui2 yet — showing the table instead.
        </p>
      )}
      {unknown.filter(o => o.renamedTo).length > 0 && (
        <p className="ui2-note">
          <Icon name="info" /> Renamed layout options:{" "}
          {unknown
            .filter(o => o.renamedTo)
            .map(o => `${o.key} is now ${o.renamedTo}`)
            .join(", ")}{" "}
          — rename them in the view.
        </p>
      )}
      {unknown.filter(o => !o.renamedTo).length > 0 && (
        <p className="ui2-note">
          <Icon name="info" /> Layout options{" "}
          {unknown
            .filter(o => !o.renamedTo)
            .map(o => o.key)
            .join(", ")}{" "}
          aren’t known to this build — check the spelling in the view.
        </p>
      )}

      <div className="ui2-browse-body">
        <div className="ui2-browse-list">
          <List {...listProps} />
          {!list.summarizes && <Pager state={state} />}
        </div>
        {panelOpen && <LayoutOptions state={state} onClose={() => optionsOpen.set(false)} />}
      </div>
    </section>
  )
}

function Pager({ state }: { state: BrowseState }) {
  return (
    <footer className="ui2-pager">
      <span className="ui2-subtle">
        {state.loading && <Icon name="loading" />} {state.from}–{state.to} of {state.total}
      </span>
      <button
        type="button"
        className="ui2-button is-icon"
        disabled={!state.hasPrev}
        onClick={state.prevPage}
        title="Previous page"
      >
        <Icon name="chevron-left" />
      </button>
      <button
        type="button"
        className="ui2-button is-icon"
        disabled={!state.hasNext}
        onClick={state.nextPage}
        title="Next page"
      >
        <Icon name="chevron-right" />
      </button>
    </footer>
  )
}
