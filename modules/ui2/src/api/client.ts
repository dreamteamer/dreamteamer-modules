/**
 * THE API CLIENT — the slice of the protocol (PROTOCOL.md in @dreamteamer/protocol) this app reads and writes,
 * typed. Every call goes through the transport `mount` was handed; nothing here knows HTTP or postMessage.
 */
import type { Transport } from "../transport/types.ts"

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

export interface FieldDef {
  type: string
  title?: string
  description?: string
  required?: boolean
  many?: boolean
  body?: boolean
  virtual?: boolean
  derived?: boolean
  enum?: string[] | Record<string, { color?: string; title?: string } | null>
}

export interface Descriptor {
  name: string
  description?: string
  fields?: Record<string, FieldDef>
  compiled?: {
    runtime?: boolean
    fields?: Record<string, FieldDef>
    defaults?: { title?: string; singular?: string; record_title?: string }
  }
}

export type Row = Record<string, unknown> & { id: string }

export interface RecordsPage {
  records: Row[]
  total: number
  sources?: { name: string; kind: string; count: number; access?: string }[]
}

export interface RecordDoc {
  id: string
  fields: Record<string, unknown>
  path?: string
}

// ---- calls ----------------------------------------------------------------------------------------------

export const getNav = () => request("GET", "/nav") as Promise<NavNode[]>
export const getSchema = () => request("GET", "/schema") as Promise<Descriptor[]>

export interface ListQuery {
  limit?: number
  offset?: number
  sort?: string
  q?: string
}

export function listQuery({ limit, offset, sort, q }: ListQuery = {}): string {
  const p = new URLSearchParams()
  if (limit !== undefined) p.set("limit", String(limit))
  if (offset) p.set("offset", String(offset))
  if (sort) p.set("sort", sort)
  if (q) p.set("q", q)
  const s = p.toString()
  return s ? `?${s}` : ""
}

export const listRecords = (collection: string, query: ListQuery = {}) =>
  request("GET", `/collections/${encName(collection)}/records${listQuery(query)}`) as Promise<RecordsPage>

export const getRecord = (collection: string, id: string) =>
  request("GET", `/collections/${encName(collection)}/records/${encId(id)}`) as Promise<RecordDoc>

export const updateRecord = (collection: string, id: string, fields: Record<string, unknown>) =>
  request("PATCH", `/collections/${encName(collection)}/records/${encId(id)}`, fields) as Promise<{ id: string }>

export const createRecord = (collection: string, fields: Record<string, unknown>) =>
  request("POST", `/collections/${encName(collection)}/records`, fields) as Promise<{ id: string; path?: string }>

export const removeRecord = (collection: string, id: string) =>
  request("DELETE", `/collections/${encName(collection)}/records/${encId(id)}`) as Promise<{ id: string }>
