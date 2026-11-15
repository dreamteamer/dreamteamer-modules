/**
 * THE API CLIENT — the slice of the protocol (PROTOCOL.md in @dreamteamer/protocol) this app reads and writes,
 * typed. Every call goes through the transport `mount` was handed; nothing here knows HTTP or postMessage.
 */
import type { Transport } from "../transport/types.ts"
import type { FieldRow, SourceEntry } from "./types.ts"
import type { PresentationCollection } from "./collection-rows.ts"
import type { NavNode } from "../lib/nav-tree.ts"

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

/** One node of `GET /nav` — the shape lives with the gestures that read its `target` (lib/nav-tree.ts). */
export type { NavNode } from "../lib/nav-tree.ts"

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

/** Where a hand-set order puts a record: `PATCH /collections/:c/position/*id` writes the collection's one
 *  `position` field, its key computed by the engine. */
export type PositionMove = { top: true } | { bottom: true } | { before: string } | { after: string }

export const moveRecord = (collection: string, id: string, move: PositionMove) =>
  request("PATCH", `/collections/${encName(collection)}/position/${encId(id)}`, move) as Promise<unknown>

/** `force` removes a record others reference (the host answers `409` without it), leaving their references. */
export const removeRecord = (collection: string, id: string, force = false) =>
  request(
    "DELETE",
    `/collections/${encName(collection)}/records/${encId(id)}${force ? "?force=true" : ""}`
  ) as Promise<{
    id: string
  }>

/** `POST /collections/:c/rename` — a new id for a record; every reference to it is rewritten (admin). */
export const renameRecord = (collection: string, from: string, to: string) =>
  request("POST", `/collections/${encName(collection)}/rename`, { old: from, new: to }) as Promise<unknown>

// ---- a record's history, commits, commands and notes -------------------------------------------------------

/** One commit touching a record's file, newest first. */
export interface HistoryEntry {
  hash: string
  date: string
  author: string
  subject: string
}

export const getHistory = (collection: string, id: string) =>
  request("GET", `/history/${encName(collection)}/${encId(id)}`) as Promise<HistoryEntry[]>

/** One commit's diff of the record's file against its parent. */
export const getHistoryDiff = (collection: string, id: string, hash: string) =>
  request("GET", `/history-diff/${encName(collection)}/${encId(id)}?hash=${encodeURIComponent(hash)}`) as Promise<{
    hash?: string
    path?: string
    diff?: string
  }>

/** Restore a record's content as of `hash`, validated against today's schema, as one new commit (admin). */
export const revertRecord = (collection: string, id: string, hash: string) =>
  request("POST", `/collections/${encName(collection)}/records-revert/${encId(id)}`, { hash }) as Promise<unknown>

/** One repo's pending rows, as `POST /commit` answers per repo (`dt commit --json`). */
export interface CommitPlan {
  repo: string
  rows: Array<{ collection: string; id: string; verb?: string }>
  subject?: string
  sha?: string | null
  /** an in-progress merge or rebase — the engine refused, and said why */
  blocked?: string | null
  /** committed, but worth saying (a detached HEAD) */
  warning?: string | null
}

/** `dryRun` is the pending count; `only` scopes a commit to `<collection>/<id>` refs or collections. */
export const commit = (body: { dryRun?: boolean; only?: string[]; message?: string }) =>
  request("POST", "/commit", body) as Promise<CommitPlan[] | null>

export const getCommands = (collection: string, ids: readonly string[]) =>
  request(
    "GET",
    `/commands/${encName(collection)}${ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : ""}`
  ) as Promise<{ commands: import("../lib/command-rows.ts").CommandRow[] }>

export const getNotes = (collection: string, ids: readonly string[]) =>
  request("GET", `/notes/${encName(collection)}?ids=${encodeURIComponent(ids.join(","))}`) as Promise<{
    notes?: import("../lib/next-notes.ts").NextNote[]
    sessionsFrom?: import("../lib/next-notes.ts").SessionsFrom
  }>

export const getQueue = () =>
  request("GET", "/queue") as Promise<{ items?: import("../lib/queue-items.ts").QueueItem[] }>

export const queueCommand = (command: string, refs: string[]) =>
  request("POST", "/queue", { command, refs }) as Promise<unknown>

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
