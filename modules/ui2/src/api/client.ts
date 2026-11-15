/**
 * THE API CLIENT — the slice of the protocol (PROTOCOL.md in @dreamteamer/protocol) this app reads and writes,
 * typed. Every call goes through the transport `mount` was handed; nothing here knows HTTP or postMessage.
 */
import type { Transport } from "../transport/types.ts"
import type { FieldRow, SourceEntry } from "./types.ts"
import type { PresentationCollection } from "./collection-rows.ts"

let current: Transport | null = null

export function setTransport(t: Transport): void {
  current = t
}

function transport(): Transport {
  if (!current) throw new Error("ui2: no transport — mount() sets it")
  return current
}

export const request = (method: string, path: string, body?: unknown): Promise<unknown> =>
  transport().request(method, path, body)

/** Tell the host something; a host that does not know the type ignores it. */
export const notify = (type: string, payload?: unknown): void => current?.notify(type, payload)

/** One path segment per id segment: ids may hold `/`, which routes keep as a separator. */
export const encId = (id: string): string => id.split("/").map(encodeURIComponent).join("/")
const encName = (name: string): string => encodeURIComponent(name)

// ---- shapes ---------------------------------------------------------------------------------------------

export interface NavNode {
  kind: "workspace" | "collection" | "namespace" | "view" | "folder" | string
  key: string
  label: string
  icon?: string
  route?: string
  tooltip?: string
  description?: string
  marks?: string
  notice?: string
  children?: NavNode[]
}

/** One relation the display contract names: `collection.field` holds refs to `related_collection`. */
export interface Relation {
  collection: string
  field: string
  related_collection: string
  list: boolean
}

/** `GET /presentation` — the display contract: every collection's resolved display, its field rows, the
 *  relations between them. What every page draws from (descriptor format v2, §4.3). */
export interface Presentation {
  collections: PresentationCollection[]
  fields: Record<string, FieldRow[]>
  relations: Relation[]
}

export type Row = Record<string, unknown> & { id: string }

export interface RecordsPage {
  records: Row[]
  total: number
  sources?: SourceEntry[]
  /** Why this machine cannot read the collection (an env-pointed root whose variable is unset) — not an
   *  error: the page draws, says so, and offers no create. */
  unavailable?: string
}

export interface RecordDoc {
  id: string
  fields: Record<string, unknown>
  path?: string
}

// ---- calls ----------------------------------------------------------------------------------------------

export const getNav = () => request("GET", "/nav") as Promise<NavNode[]>
export const getPresentation = () => request("GET", "/presentation") as Promise<Presentation>

export interface ListQuery {
  limit?: number
  offset?: number
  sort?: string
  q?: string
  /** The engine's filter object (`{ subject: { _in: [...] } }`), sent as JSON. */
  filter?: unknown
}

export function listQuery({ limit, offset, sort, q, filter }: ListQuery = {}): string {
  const p = new URLSearchParams()
  if (limit !== undefined) p.set("limit", String(limit))
  if (offset) p.set("offset", String(offset))
  if (sort) p.set("sort", sort)
  if (q) p.set("q", q)
  if (filter !== undefined) p.set("filter", JSON.stringify(filter))
  const s = p.toString()
  return s ? `?${s}` : ""
}

export const listRecords = (collection: string, query: ListQuery = {}) =>
  request("GET", `/collections/${encName(collection)}/records${listQuery(query)}`) as Promise<RecordsPage>

export const getRecord = (collection: string, id: string) =>
  request("GET", `/collections/${encName(collection)}/records/${encId(id)}`) as Promise<RecordDoc>

export const updateRecord = (collection: string, id: string, fields: Record<string, unknown>) =>
  request("PATCH", `/collections/${encName(collection)}/records/${encId(id)}`, fields) as Promise<{ id: string }>

/** `target` names the root a new record is written to (a layer that takes writes); absent, the write root. */
export const createRecord = (collection: string, fields: Record<string, unknown>, target?: string) =>
  request(
    "POST",
    `/collections/${encName(collection)}/records${target ? `?target=${encodeURIComponent(target)}` : ""}`,
    fields
  ) as Promise<{ id: string; path?: string }>

export const removeRecord = (collection: string, id: string) =>
  request("DELETE", `/collections/${encName(collection)}/records/${encId(id)}`) as Promise<{ id: string }>

/** `GET /collections/:c/values/:field` — the values a field actually holds, with counts: a filter's vocabulary. */
export interface FieldValues {
  values: { value: unknown; count: number | null }[]
  total: number
  truncated: boolean
  skipped?: string
}

export const fieldValues = (collection: string, field: string) =>
  request("GET", `/collections/${encName(collection)}/values/${encName(field)}`) as Promise<FieldValues>

/** Write a ui-view's whole source (the engine replaces it and compiles); `id` absent creates one, `module`
 *  chooses the module a new view lands in. */
export const saveUiView = (id: string | undefined, view: object, module?: string) =>
  request("POST", `/collections/ui-views/records${module ? `?module=${encodeURIComponent(module)}` : ""}`, {
    ...(id ? { id } : {}),
    ...view,
  }) as Promise<Record<string, unknown> | null>

export const deleteUiView = (id: string) =>
  request("DELETE", `/collections/ui-views/records/${encName(id)}`) as Promise<unknown>

/** `dt set collections/<c> <path>=<value>…` — collection keys by their v2 path (`display.list.columns`). */
export const setCollectionKeys = (collection: string, changes: Record<string, unknown>) =>
  request("PATCH", `/collections/collections/records/${encName(collection)}`, changes) as Promise<Record<
    string,
    unknown
  > | null>
