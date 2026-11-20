/**
 * The workspace's MODULES as the Schema tab draws them — two reads, merged (ported from the Vue ui's
 * composables/modules.ts):
 *  - the compiled `modules` RECORDS (id, title, package name, namespaces, dependencies, what each ships);
 *  - `GET /info`'s manifest `modules`, which is where LOCATION and PATH come from: how a module arrived is a fact
 *    about the manifest, and asking the records for it would let the page disagree with what compiled.
 *
 * ⚠ `location` is read with `channel` as a fallback — the field was `channel` up to engine 0.18, and the manifest
 * kept a compat read of the old key, so both spellings are live.
 */
import type { HostWorkspace } from "../api/client.ts"

export interface ModuleEntry {
  /** The record id — the identity everywhere the operator types it (`--module <id>`). */
  id: string
  title: string
  /** The package name, verbatim. */
  name: string
  /** How it arrived: `modules` · `node_modules` · `root`. */
  location: string
  /** Workspace-relative root of its sources. */
  path: string
  namespaces: string[]
  dependencies: string[]
  peerDependencies: string[]
  /** Collections it contributed a source for. */
  collections: string[]
  description: string
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v.trim() ? [v] : [])

export function moduleEntries(
  records: ReadonlyArray<Record<string, unknown>>,
  info: HostWorkspace | null
): ModuleEntry[] {
  const byName = new Map((info?.modules ?? []).filter(m => m?.name).map(m => [String(m.name), m]))
  return records.map(r => {
    const name = String(r["name"] ?? r["id"] ?? "")
    const entry = byName.get(name)
    return {
      id: String(r["id"] ?? ""),
      title: String(r["title"] ?? r["id"] ?? name),
      name,
      location: String(entry?.location ?? entry?.channel ?? r["location"] ?? r["channel"] ?? ""),
      path: String(entry?.path ?? entry?.root ?? r["path"] ?? ""),
      namespaces: list(r["namespaces"]),
      dependencies: list(r["dependencies"]),
      peerDependencies: list(r["peer_dependencies"] ?? r["peerDependencies"]),
      collections: list(r["collections"]),
      description: String(r["description"] ?? ""),
    }
  })
}

/** What a module ships, in the words `dt list modules` prints: the collections it contributes (`collections/x` → `x`). */
export function shipsOf(m: Pick<ModuleEntry, "collections">): string {
  return m.collections.map(c => c.replace(/^collections\//, "")).join(", ")
}
