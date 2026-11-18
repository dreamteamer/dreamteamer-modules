/**
 * THE API CLIENT — the slice of the protocol (PROTOCOL.md in @dreamteamer/protocol) this app reads and writes,
 * typed. Every call goes through the transport `mount` was handed; nothing here knows HTTP or postMessage.
 */
import type { Transport } from "../transport/HostError.ts"
import type { FieldRow, SourceEntry } from "./types.ts"
import type { PresentationCollection } from "./collectionRows.ts"
import type { NavNode } from "../lib/navTree.ts"

let current: Transport | null = null

export function setTransport(t: Transport): void {
  current = t
}

function transport(): Transport {
  if (!current) throw new Error("ui: no transport — mount() sets it")
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

/** One node of `GET /nav` — the shape lives with the gestures that read its `target` (lib/navTree.ts). */
export type { NavNode } from "../lib/navTree.ts"

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

/** The images a record's folder-template field points at (the carousel): the folder as rendered for this machine,
 *  its image files, or why nothing is listed — never an error for a missing folder. */
export const getFolder = (collection: string, id: string, field: string) =>
  request("GET", `/folder/${encName(collection)}/${encId(id)}?field=${encodeURIComponent(field)}`) as Promise<{
    path?: string | null
    files?: string[]
    reason?: string | null
  }>

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
  ) as Promise<{ commands: import("../lib/commandRows.ts").CommandRow[] }>

export const getNotes = (collection: string, ids: readonly string[]) =>
  request("GET", `/notes/${encName(collection)}?ids=${encodeURIComponent(ids.join(","))}`) as Promise<{
    notes?: import("../lib/nextNotes.ts").NextNote[]
    sessionsFrom?: import("../lib/nextNotes.ts").SessionsFrom
  }>

export const getQueue = () =>
  request("GET", "/queue") as Promise<{ items?: import("../lib/queueItems.ts").QueueItem[] }>

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

// ---- schema writes ----------------------------------------------------------------------------------------
// Each is a compile-gated SOURCE write host-side: the engine writes the descriptor, proves it with a real compile
// (400 with the compiler's own sentence, the source restored), commits, and reloads. ⚠ A selector rides in the
// QUERY (`?module=<id>` — which module's source a write lands in); a `module` in a BODY is a value being written
// (the move). The two never blur.

const selector = (module?: string | null) => (module ? `?module=${encodeURIComponent(module)}` : "")
const fieldsPath = (collection: string, field?: string) =>
  `/fields/${encName(collection)}${field ? `/${encName(field)}` : ""}`
const dryRunQuery = (dryRun?: boolean) => (dryRun ? "?dry-run=true" : "")

/** `GET /info` — the workspace as the host loaded it; `modules` is the manifest's (where each module came from). */
export interface HostWorkspace {
  name?: string
  modules?: Array<{ name?: string; location?: string; channel?: string; path?: string; root?: string }>
  workspace_module?: string | null
  user?: string | null
}
export const getInfo = () => request("GET", "/info") as Promise<HostWorkspace>

/** A collection's descriptor as its source authored it — the `collections` record's own fields (`fields` is the
 *  authored field map). */
export const getCollectionSource = (collection: string) => getRecord("collections", collection).then(doc => doc.fields)

/** `POST /collections/collections/records[?module=]` — a new collection (`lib/createCollection.ts` builds the body). */
export const createCollection = (body: Record<string, unknown>, module?: string | null) =>
  request("POST", `/collections/collections/records${selector(module)}`, body) as Promise<unknown>

export const deleteCollection = (collection: string) =>
  request("DELETE", `/collections/collections/records/${encName(collection)}`) as Promise<unknown>

/** A whole v2 field (`lib/fieldDef.ts`): a new one. */
export const createField = (collection: string, name: string, field: Record<string, unknown>) =>
  request("POST", fieldsPath(collection), { name, field }) as Promise<unknown>

/** A whole v2 field REPLACES the one in the source that declares it. */
export const updateField = (collection: string, name: string, field: Record<string, unknown>) =>
  request("PATCH", fieldsPath(collection, name), { field }) as Promise<unknown>

/** The CLI's flag vocabulary (`{ name, type, unique, "mirror-of" }`) — `type` may name a collection. */
export const createFieldFlags = (collection: string, flags: Record<string, unknown>) =>
  request("POST", fieldsPath(collection), flags) as Promise<unknown>

/** Flags restate only what they name over the field as declared — the safe write on ANOTHER collection's field. */
export const updateFieldFlags = (collection: string, field: string, flags: Record<string, unknown>) =>
  request("PATCH", fieldsPath(collection, field), flags) as Promise<unknown>

/** Remove a field; its values go with it, in the same commit. `cleared` counts the records touched. */
export const deleteField = (collection: string, field: string) =>
  request("DELETE", fieldsPath(collection, field)) as Promise<{ cleared?: number } | null>

/** Rename a field in every record, descriptor, view and binding that names it; `dryRun` answers the plan. */
export const renameField = (collection: string, field: string, to: string, dryRun?: boolean) =>
  request("POST", `${fieldsPath(collection, field)}/rename${dryRunQuery(dryRun)}`, { to }) as Promise<Record<
    string,
    unknown
  > | null>

/** Rename one enum value in every record and descriptor; `dryRun` answers the plan. */
export const renameFieldValue = (collection: string, field: string, from: string, to: string, dryRun?: boolean) =>
  request("POST", `${fieldsPath(collection, field)}/rename-value${dryRunQuery(dryRun)}`, {
    from,
    to,
  }) as Promise<Record<string, unknown> | null>

/** MOVE a view's source to another module — `module` in the BODY is the value written. */
export const moveUiView = (id: string, module: string) =>
  request("PATCH", `/collections/ui-views/records/${encName(id)}`, { module }) as Promise<Record<
    string,
    unknown
  > | null>

// ---- sources and activity ---------------------------------------------------------------------------------

export const getSources = () => request("GET", "/sources") as Promise<import("../lib/sourcesStack.ts").SourceStack>

export const getSourcesAccess = (fresh = false) =>
  request("GET", `/sources/access${fresh ? "?fresh=1" : ""}`) as Promise<{
    available: boolean
    access: Record<string, import("./types.ts").OwnAccess>
  }>

export const getSourceMembers = (source: string) =>
  request("GET", `/sources/access/members?source=${encodeURIComponent(source)}`) as Promise<
    import("./types.ts").RemoteMembers
  >

export const getActivity = (q: {
  module?: string
  source?: string
  limit: number
  offset: number
  settled?: number
}) => {
  const p = new URLSearchParams({ limit: String(q.limit), offset: String(q.offset) })
  if (q.module) p.set("module", q.module)
  if (q.source) p.set("source", q.source)
  if (q.settled !== undefined) p.set("settled", String(q.settled))
  return request("GET", `/activity?${p}`) as Promise<import("../lib/activity.ts").Activity>
}
