/**
 * THE RECORD PAGE'S SMALL ANSWERS, pure so each is a test rather than a screenshot: the path row, the commit
 * line, what a delete refusal means, which key chord saves, what a rename may be, the duplicate-id badge, what
 * counts as an empty value, and the draft a page edits. Each follows the Vue ui's record page
 * (pages/ContentDetail.vue, components/PageHeader.vue, ItemProperties.vue, composables/items.ts); the delete
 * force, the rename and Mod-S are ui's own, over the routes PROTOCOL.md names.
 */
import { listRoute } from "./createRoute.ts"

export interface Crumb {
  label: string
  to?: string
}

/**
 * Row 1's path: the collection (a link back to its browse), then the record id split on `/` — `tasks / 2026 /
 * 07 / kickoff`, the way a note's folder path reads. Only the collection links: an id's segments are folder
 * names inside it, not routes. A new record ends in `new`.
 */
export function pathCrumbs(collection: string, id: string | null, base?: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: collection, to: listRoute(collection, base) }]
  if (id === null) return [...crumbs, { label: "new" }]
  for (const segment of id.split("/").filter(Boolean)) crumbs.push({ label: segment })
  return crumbs
}

export interface CommitInfo {
  author: string
  date: string
  message: string
}

/** The commit line under the header — the last commit touching the record's file, from the computed keys a
 *  single-record GET carries; null when the host computed none (a new record, a file no commit holds). */
export function commitInfo(record: Record<string, unknown> | null | undefined): CommitInfo | null {
  const author = record?.["$last-modified-by"]
  const date = record?.["last-modified"] ?? record?.["last_modified"]
  if (typeof author !== "string" || typeof date !== "string") return null
  const message = record?.["$last-commit-message"]
  return { author, date, message: typeof message === "string" ? message : "" }
}

/** A delete the host refused because other records reference this one (`409`) — the page then offers
 *  `?force=true`, which removes it anyway and leaves the references dangling. Any other refusal is final. */
export function isReferencedRefusal(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status
  if (status === 409) return true
  // a host that lost the status (a webview bridge) still says it in the engine's words
  const text = err instanceof Error ? err.message : String(err)
  return status === undefined && /\breferenced\b/i.test(text)
}

/** Cmd-S on a Mac, Ctrl-S elsewhere — the record page's save; nothing with Alt or Shift (those are the
 *  browser's and the editor's own). */
export function isSaveShortcut(e: {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}): boolean {
  return (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s"
}

/**
 * Why a new id cannot be offered, or null when it can — only what the page can know without asking: the
 * engine validates the rest and its sentence is shown as it says it. An id is a path, so `/` is allowed
 * between segments but not at either end, and no segment is `.` or `..` or empty.
 */
export function renameProblem(from: string, to: string): string | null {
  const next = to.trim()
  if (!next) return "Type the new id."
  if (next === from) return "That is the record's id already."
  if (next.startsWith("/") || next.endsWith("/")) return "An id neither starts nor ends with /."
  if (next.split("/").some(s => s === "" || s === "." || s === "..")) return "An id's segments are names, not . or ..."
  if (/\s/.test(next)) return "An id holds no spaces."
  return null
}

/** "Nothing here yet": null, undefined, the empty string and the empty list. `false` and `0` are values. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true
  return Array.isArray(value) && value.length === 0
}

/** The record with the pending edits laid over it — what a currency field reads its code from, and what the
 *  title and badges read while a page is being edited. */
export function withEdits(
  record: Record<string, unknown> | null | undefined,
  edits: Record<string, unknown>
): Record<string, unknown> {
  return { ...(record ?? {}), ...edits }
}

/**
 * One field's pending edit applied to the edits map: a value equal to what was read drops the edit (typing a
 * value back is not a change), anything else replaces it. Compared by JSON, so `["a"]` equals `["a"]`.
 */
export function setEdit(
  edits: Record<string, unknown>,
  read: Record<string, unknown> | null | undefined,
  field: string,
  value: unknown
): Record<string, unknown> {
  const same = JSON.stringify(read?.[field] ?? null) === JSON.stringify(value ?? null)
  if (same) {
    if (!(field in edits)) return edits
    const rest = { ...edits }
    delete rest[field]
    return rest
  }
  return { ...edits, [field]: value }
}
