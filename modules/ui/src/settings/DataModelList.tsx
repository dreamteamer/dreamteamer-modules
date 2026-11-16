/**
 * THE DATA MODEL — the Schema tab's `collections` list (ported from the Vue ui's pages/DataModelList.vue):
 * every compiled collection, grouped by namespace, each linked to its designer, and New collection….
 *
 * the Vue ui's Provenance and Layer columns are constants on every row the engine sends now (`disk`, local), so they are
 * not drawn; where the records are read from (the row's `sources`) is, with how many. Each row publishes
 * `data-vscode-context`, so an editor host gets its native Rename… / Move to Module… / Delete… menu.
 */
import { useState } from "react"
import { useApp } from "../AppContext.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { isOkfRow } from "../lib/okf.ts"
import { SCHEMA_BASE } from "../lib/route.ts"
import { schemaRowContext } from "../lib/vscode-context.ts"
import { CreateCollectionDialog } from "./CreateCollectionDialog.tsx"
import type { CollectionRow } from "../api/types.ts"
import { button, buttonSize, buttonTone, cx, page, pageHead, pageHeadSpace, subtle } from "../styles/classes.ts"
import { num, table } from "./looks.ts"

/** Rows by namespace: un-namespaced first, then each namespace in first-seen order. */
export function namespaceGroups(rows: readonly CollectionRow[]): Array<{ name: string; rows: CollectionRow[] }> {
  const groups = new Map<string, CollectionRow[]>()
  for (const row of rows) {
    const slash = row.collection.indexOf("/")
    const name = slash === -1 ? "" : row.collection.slice(0, slash)
    groups.set(name, [...(groups.get(name) ?? []), row])
  }
  const root = groups.get("")
  groups.delete("")
  return [...(root ? [{ name: "", rows: root }] : []), ...[...groups].map(([name, rows]) => ({ name, rows }))]
}

export function DataModelList({ only }: { only: readonly string[] | null }) {
  const { schema } = useApp()
  const [closed, setClosed] = useState<Record<string, boolean>>({ ".schema": true })
  const [creating, setCreating] = useState(false)
  const rows = schema.collections.filter(r => isOkfRow(r) && (!only || only.includes(r.collection)))
  const groups = namespaceGroups(rows)
  return (
    <section className={page}>
      <header className={cx(pageHead, pageHeadSpace.page)}>
        <div>
          <h1>
            <Icon name="symbol-structure" /> Data Model
          </h1>
          <p className={subtle}>Every collection this workspace compiles. Open one to edit its fields.</p>
        </div>
        <button
          type="button"
          className={cx(button, buttonTone.primary, buttonSize.default)}
          data-action="new-collection"
          onClick={() => setCreating(true)}
        >
          <Icon name="add" /> New collection
        </button>
      </header>
      {groups.map(group => (
        <section key={group.name || "__root"} className="mb-5">
          {group.name && (
            <button
              type="button"
              className="inline-flex items-center gap-1 py-1 px-0 border-0 bg-transparent text-fg-subtle text-small font-bold tracking-[0.04em] uppercase cursor-pointer"
              aria-expanded={!closed[group.name]}
              onClick={() => setClosed(c => ({ ...c, [group.name]: !c[group.name] }))}
            >
              <Icon name={closed[group.name] ? "chevron-right" : "chevron-down"} /> {group.name}
            </button>
          )}
          {!closed[group.name] && (
            <table className={table}>
              <thead>
                <tr>
                  <th>Collection</th>
                  <th>Title</th>
                  <th>Read from</th>
                  <th className={num}>Records</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => (
                  <tr key={row.collection} data-vscode-context={schemaRowContext("collections", row.collection)}>
                    <td>
                      <Link
                        to={`${SCHEMA_BASE}/collections/${row.collection}`}
                        className="inline-flex items-center gap-1.5 text-fg font-semibold"
                      >
                        <Icon name={row.nav.icon ?? "database"} /> {row.collection}
                      </Link>
                    </td>
                    <td className={subtle}>{row.title}</td>
                    <td className={subtle}>{(row.sources ?? []).map(s => s.name).join(", ") || "—"}</td>
                    <td className={num}>{(row.sources ?? []).reduce((n, s) => n + s.count, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      {!rows.length && <p className={subtle}>No collections{only ? " in this module" : " yet"}.</p>}
      {creating && <CreateCollectionDialog onClose={() => setCreating(false)} />}
    </section>
  )
}
