/**
 * A COLLECTION'S LIST — a table of its records, one page of 200 at a time, drawn from the display contract:
 * the columns are the collection's `list.columns` (else every field the list surface draws), the first sort
 * its `list.sort`, each cell the field's resolved View, each row's title its `record_title` template. Search
 * is the host's `q`; a column header cycles its sort (asc, desc, the collection's own); a row opens its record.
 *
 * (The other layouts — board, cards, calendar, … — and filters, grouping and saved views come in later steps.)
 */
import { useEffect, useState } from "react"
import { listRecords } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { listColumns, recordLabel } from "../lib/schema.ts"
import { templateFields } from "../lib/template.ts"
import { createRoute, recordRoute } from "../lib/route.ts"
import { RenderView } from "../render/Render.tsx"

const PAGE = 200

export function ListPage({ collection }: { collection: string }) {
  const { schema, navigate, editable, version } = useApp()
  const row = schema.collection(collection)
  const columns = listColumns(row, schema.fields(collection))
  // a title column only when the title says something the columns do not (`{{ name }}` with a name column
  // would print the same words twice)
  const shown = new Set(columns.map(c => c.field))
  const titleColumn = !templateFields(row?.record_title ?? "").every(f => shown.has(f))
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<string | undefined>(row?.list.sort)
  const [offset, setOffset] = useState(0)

  // the search is sent once typing pauses; a new collection starts from its first page and its own sort
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    setQ("")
    setQuery("")
    setSort(row?.list.sort)
    setOffset(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a different collection
  }, [collection])
  useEffect(() => setOffset(0), [query, sort])

  const page = useAsync(
    () => listRecords(collection, { limit: PAGE, offset, sort, q: query || undefined }),
    [collection, offset, sort, query, version]
  )
  const rows = page.data?.records ?? []
  const total = page.data?.total ?? 0

  const cycleSort = (name: string) => setSort(s => (s === name ? `-${name}` : s === `-${name}` ? row?.list.sort : name))

  return (
    <section className="ui2-page">
      <header className="ui2-page-head">
        <div>
          <h1>
            {row?.nav.icon && <Icon name={row.nav.icon} />} {row?.title ?? collection}
          </h1>
          <p className="ui2-subtle">{total === 1 ? "1 record" : `${total} records`}</p>
        </div>
        <div className="ui2-toolbar">
          <label className="ui2-search">
            <Icon name="search" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search records" />
          </label>
          {editable && !row?.runtime && (
            <button className="ui2-button is-primary" onClick={() => navigate(createRoute(collection))}>
              <Icon name="add" /> New {row?.record_type ?? "record"}
            </button>
          )}
        </div>
      </header>

      {page.error && <p className="ui2-error">{page.error}</p>}

      <div className="ui2-table-wrap" aria-busy={page.loading}>
        <table className="ui2-table">
          <thead>
            <tr>
              {titleColumn && <th>Title</th>}
              {columns.map(c => (
                <th
                  key={c.field}
                  onClick={() => cycleSort(c.field)}
                  className="is-sortable"
                  title={c.description}
                  style={c.width ? { minWidth: `${c.width}ch` } : undefined}
                >
                  {c.title}
                  {sort === c.field && <Icon name="arrow-up" />}
                  {sort === `-${c.field}` && <Icon name="arrow-down" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${String(r.$source ?? "")}/${r.id}`} onClick={() => navigate(recordRoute(collection, r.id))}>
                {titleColumn && <td className="ui2-cell-title">{recordLabel(row, r, r.id)}</td>}
                {columns.map((c, i) => (
                  <td key={c.field} className={!titleColumn && i === 0 ? "ui2-cell-title" : undefined}>
                    <RenderView field={c} value={r[c.field]} record={r} />
                  </td>
                ))}
              </tr>
            ))}
            {!page.loading && rows.length === 0 && (
              <tr className="ui2-empty-row">
                <td colSpan={columns.length + (titleColumn ? 1 : 0)}>
                  {query ? `Nothing matches “${query}”.` : "No records yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="ui2-pager">
        <span className="ui2-subtle">
          {total === 0 ? "0 records" : `${offset + 1}–${offset + rows.length} of ${total}`}
        </span>
        <button className="ui2-button" disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}>
          Previous
        </button>
        <button
          className="ui2-button"
          disabled={offset + rows.length >= total}
          onClick={() => setOffset(o => o + PAGE)}
        >
          Next
        </button>
      </footer>
    </section>
  )
}
