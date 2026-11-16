/**
 * THE DATA MODEL — the Schema tab's `collections` list (ported from the Vue ui's pages/DataModelList.vue):
 * every compiled collection, grouped by namespace, each linked to its designer, and New collection….
 *
 * the Vue ui's Provenance and Layer columns are constants on every row the engine sends now (`disk`, local), so they are
 * not drawn; where the records are read from (the row's `sources`) is, with how many. Each row publishes
 * `data-vscode-context`, so an editor host gets its native Rename… / Move to Module… / Delete… menu.
 */
import { useState } from "react"
import { useApp } from "../app-context.tsx"
import { Icon } from "../components/Icon.tsx"
import { Link } from "../components/Link.tsx"
import { isOkfRow } from "../lib/okf.ts"
import { SCHEMA_BASE } from "../lib/route.ts"
import { schemaRowContext } from "../lib/vscode-context.ts"
import { CreateCollectionDialog } from "./CreateCollectionDialog.tsx"
import type { CollectionRow } from "../api/types.ts"

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
    <section className="dt-page dt-dm">
      <header className="dt-page-head">
        <div>
          <h1>
            <Icon name="symbol-structure" /> Data Model
          </h1>
          <p className="dt-subtle">Every collection this workspace compiles. Open one to edit its fields.</p>
        </div>
        <button
          type="button"
          className="dt-button is-primary"
          data-action="new-collection"
          onClick={() => setCreating(true)}
        >
          <Icon name="add" /> New collection
        </button>
      </header>
      {groups.map(group => (
        <section key={group.name || "__root"} className="dt-dm-group">
          {group.name && (
            <button
              type="button"
              className="dt-dm-group-head"
              aria-expanded={!closed[group.name]}
              onClick={() => setClosed(c => ({ ...c, [group.name]: !c[group.name] }))}
            >
              <Icon name={closed[group.name] ? "chevron-right" : "chevron-down"} /> {group.name}
            </button>
          )}
          {!closed[group.name] && (
            <table className="dt-table">
              <thead>
                <tr>
                  <th>Collection</th>
                  <th>Title</th>
                  <th>Read from</th>
                  <th className="is-num">Records</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map(row => (
                  <tr key={row.collection} data-vscode-context={schemaRowContext("collections", row.collection)}>
                    <td>
                      <Link to={`${SCHEMA_BASE}/collections/${row.collection}`} className="dt-dm-link">
                        <Icon name={row.nav.icon ?? "database"} /> {row.collection}
                      </Link>
                    </td>
                    <td className="dt-subtle">{row.title}</td>
                    <td className="dt-subtle">{(row.sources ?? []).map(s => s.name).join(", ") || "—"}</td>
                    <td className="is-num">{(row.sources ?? []).reduce((n, s) => n + s.count, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
      {!rows.length && <p className="dt-empty">No collections{only ? " in this module" : " yet"}.</p>}
      {creating && <CreateCollectionDialog onClose={() => setCreating(false)} />}
    </section>
  )
}
