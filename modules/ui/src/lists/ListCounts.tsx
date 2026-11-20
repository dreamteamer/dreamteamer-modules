/**
 * THE COUNTS LAYOUT — the built-in `counts` List (ported from the Vue ui's ListCounts.vue): a collection view
 * grouped by one field, drawn as ONE NUMBER PER VALUE, each a link to the collection's list filtered to that
 * value — the at-a-glance panel a page view nests (requests suggested vs accepted, issues open vs fixed).
 *
 * Not a second query vocabulary: the view's own filter, the page's source scope and the browse's filter all apply
 * before a record is counted, and the bands are `bucketize`'s — the same buckets, order, labels and colours the
 * table bands by, so a number here and a band header there cannot disagree. A grouped browse requests All rows
 * and the layout `summarizes` (no pager), so a count is never one page's worth. With no `group_by` it draws the
 * total alone; a list-valued field counts a record once under each of its values.
 *
 * A link carries the view's own filter, `<field> is <value>` and the page's `$source` as ordinary removable rules
 * (`lib/pageView.ts#countLink`); a view filter the flat builder cannot carry leaves the number unlinked, and says
 * why.
 */
import { useContext, useMemo } from "react"
import { useSignal } from "../AppContext.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { themeColor } from "../lib/collectionDisplay.ts"
import { bucketize, type Bucket } from "../lib/grouping.ts"
import { countLink, UNLINKED_COUNT } from "../lib/pageView.ts"
import { uiViews, type UiViewRecord } from "../lib/uiViews.ts"
import { PageSource } from "../pages/PageSource.ts"
import type { ListProps } from "../registry/props.ts"
import { cx } from "../styles/classes.ts"

export function ListCounts({ state }: ListProps) {
  const options = state.listOptions["counts"] ?? {}
  const source = useContext(PageSource)
  const views = useSignal(uiViews) ?? []
  const named = options["group_by"]
  const groupField = typeof named === "string" && named ? (state.fields.find(f => f.field === named) ?? null) : null
  const bands = useMemo<Bucket[]>(
    () =>
      groupField
        ? bucketize(groupField, state.records, {
            showUngrouped: options["show_ungrouped_rows"] === true,
            showEmpty: options["show_empty_rows"] === true,
            ungroupedLabel: "none",
            multi: groupField.many === true,
          })
        : [],
    [groupField, state.records, options]
  )
  // the records behind a number: the view's own filter when a view governs this browse, else none of its own
  const subject: UiViewRecord = (state.viewId ? views.find(v => v.id === state.viewId) : undefined) ?? {
    id: "",
    route: `/content/${state.collection}`,
    scope: "collection",
    collection: state.collection,
  }
  const loading = state.loading && !state.records.length
  const totalLink = countLink(subject, undefined, null, source)

  return (
    <div className="flex flex-wrap gap-1.5" data-group-by={groupField?.field ?? ""}>
      <Count
        to={totalLink}
        className="bg-bg-subtle"
        title={totalLink ? "Open the whole list" : UNLINKED_COUNT}
        num={loading ? "…" : String(state.total)}
        label="total"
      />
      {groupField &&
        bands.map(b => {
          const to = countLink(subject, groupField.field, b.ungrouped ? null : b.value, source)
          return (
            <Count
              key={b.value}
              to={to}
              value={b.ungrouped ? "" : b.value}
              title={
                to
                  ? (b.description ?? `Open the list where ${groupField.field} is ${b.ungrouped ? "empty" : b.label}`)
                  : UNLINKED_COUNT
              }
              num={String(b.records.length)}
              color={b.color}
              icon={b.icon && !b.icon.includes("/") ? b.icon : undefined}
              label={b.label}
            />
          )
        })}
    </div>
  )
}

function Count(props: {
  to: string | null
  className?: string
  value?: string
  title: string
  num: string
  label: string
  color?: string
  icon?: string
}) {
  const body = (
    <>
      <span
        className="text-[length:calc(var(--dt-text)+6px)] font-semibold tabular-nums leading-[1.2]"
        style={props.color ? { color: themeColor(props.color) } : undefined}
      >
        {props.num}
      </span>
      <span className="flex items-center gap-1 text-fg-subtle text-small whitespace-nowrap">
        {props.icon && <Icon name={props.icon} />}
        {props.label}
      </span>
    </>
  )
  const className = cx(
    "flex flex-col items-start min-w-[72px] py-1.5 px-2.5 border border-border rounded text-fg no-underline",
    props.className,
    props.to ? "hover:border-focus hover:no-underline" : "cursor-default"
  )
  return props.to ? (
    <Link to={props.to} className={className} title={props.title} data-value={props.value}>
      {body}
    </Link>
  ) : (
    <span className={className} title={props.title} data-value={props.value}>
      {body}
    </span>
  )
}
