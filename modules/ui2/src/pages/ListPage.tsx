/**
 * A COLLECTION'S LIST — a table of its records, one page of 200 at a time: search (the host's `q`, a substring
 * over the row), sort by a column header (asc, desc, off), a row opens its record. The columns are the
 * descriptor's fields bar the body; `New` opens an empty record form when edits are offered.
 */
import { useEffect, useState } from "react"
import { listRecords } from "../api/client.ts"
import { useApp, useAsync } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Value } from "../components/Value.tsx"
import { columnsOf, fieldsOf, labelOf, recordTitle, singularOf, titleOf } from "../lib/fields.ts"
import { createRoute, recordRoute } from "../lib/route.ts"

const PAGE = 200

export function ListPage({ collection }: { collection: string }) {
  const { descriptors, navigate, editable, version } = useApp()
  const d = descriptors.find(x => x.name === collection)
  const columns = columnsOf(fieldsOf(d))
  const [q, setQ] = useState("")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<string | undefined>(undefined)
  const [offset, setOffset] = useState(0)

  // the search is sent once typing pauses; a new collection starts from its first page, unsorted
  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    setQ("")
    setQuery("")
    setSort(undefined)
    setOffset(0)
  }, [collection])
  useEffect(() => setOffset(0), [query, sort])

  const page = useAsync(
    () => listRecords(collection, { limit: PAGE, offset, sort, q: query || undefined }),
    [collection, offset, sort, query, version]
  )
  const rows = page.data?.records ?? []
  const total = page.data?.total ?? 0

  const cycleSort = (name: string) => setSort(s => (s === name ? `-${name}` : s === `-${name}` ? undefined : name))

  return (
    <section className="ui2-page">
      <header className="ui2-page-head">
        <div>
          <h1>{titleOf(d, collection)}</h1>
          {d?.description && <p className="ui2-subtle">{d.description}</p>}
        </div>
        <div className="ui2-toolbar">
          <label className="ui2-search">
            <Icon name="search" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search records" />
          </label>
          {editable && (
            <button className="ui2-button is-primary" onClick={() => navigate(createRoute(collection))}>
              <Icon name="add" /> New {singularOf(d)}
            </button>
          )}
        </div>
      </header>

      {page.error && <p className="ui2-error">{page.error}</p>}

      <div className="ui2-table-wrap" aria-busy={page.loading}>
        <table className="ui2-table">
          <thead>
            <tr>
              <th>Title</th>
              {columns.map(c => (
                <th key={c.name} onClick={() => cycleSort(c.name)} className="is-sortable" title={c.description}>
                  {labelOf(c)}
                  {sort === c.name && <Icon name="arrow-up" />}
                  {sort === `-${c.name}` && <Icon name="arrow-down" />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${String(r.$source ?? "")}/${r.id}`} onClick={() => navigate(recordRoute(collection, r.id))}>
                <td className="ui2-cell-title">{recordTitle(r, r.id)}</td>
                {columns.map(c => (
                  <td key={c.name}>
                    <Value field={c} value={r[c.name]} />
                  </td>
                ))}
              </tr>
            ))}
            {!page.loading && rows.length === 0 && (
              <tr className="ui2-empty-row">
                <td colSpan={columns.length + 1}>{query ? `Nothing matches “${query}”.` : "No records yet."}</td>
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
