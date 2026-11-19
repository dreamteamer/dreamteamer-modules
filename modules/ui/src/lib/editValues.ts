/**
 * THE VALUE RULES the built-in Edits and Views share, pure so a test pins each one: what a control shows for a
 * stored value, and what it hands back. Every Edit clears to `null`, never to `""` or `[]` — a cleared field
 * reads as "not set" to the engine and to `changedFields`, and an empty string or array would be written as a
 * value somebody chose. A reference is stored the way the engine stores it: `collection/id`, no leading slash.
 */

/** What a text control shows: `''` for nothing, JSON for an object (never "[object Object]"). */
export function inputText(v: unknown): string {
  if (v === null || v === undefined) return ""
  return typeof v === "object" ? JSON.stringify(v) : String(v)
}

/** A text control's answer: an emptied field is cleared, not set to `''`. */
export const textOrNull = (s: string): string | null => (s === "" ? null : s)

/** A number control's answer: empty clears; anything the browser could not read as a number clears too. */
export function numberFromInput(raw: string): number | null {
  if (raw.trim() === "") return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** A `many` scalar as its chips — objects as JSON; a lone scalar (a field that became `many`) as one chip. */
export function tagsOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => (x !== null && typeof x === "object" ? JSON.stringify(x) : String(x)))
  if (v === null || v === undefined || v === "") return []
  return [typeof v === "object" ? JSON.stringify(v) : String(v)]
}

/** The tag list after committing `draft` (a trailing comma stripped), or null when nothing changes — an empty
 *  draft or one already in the list. */
export function addTag(tags: readonly string[], draft: string): string[] | null {
  const raw = draft.replace(/,$/, "").trim()
  if (!raw || tags.includes(raw)) return null
  return [...tags, raw]
}

/** A list's answer: an emptied list clears the field. */
export const listOrNull = <T>(list: readonly T[]): T[] | null => (list.length ? [...list] : null)

/** What the JSON editor shows for a stored value. */
export const jsonText = (v: unknown): string => (v === null || v === undefined ? "" : JSON.stringify(v, null, 2))

/** The JSON editor's draft, read: blank clears, valid JSON is the value, anything else is NOT written. */
export function parseJsonDraft(text: string): { ok: true; value: unknown } | { ok: false } {
  if (text.trim() === "") return { ok: true, value: null }
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

export const HEX_RE = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i

/** The colour value when it is a hex the swatch can draw, else null. */
export const hexOf = (v: unknown): string | null => (typeof v === "string" && HEX_RE.test(v) ? v : null)

/** A native `<input type=color>` takes `#rrggbb` only: a 3-digit hex is widened, anything else is a grey. */
export function swatchValue(v: unknown): string {
  const hex = hexOf(v)
  if (!hex) return "#cccccc"
  if (hex.length === 4) return `#${[...hex.slice(1)].map(c => c + c).join("")}`.toLowerCase()
  return hex.toLowerCase()
}

/** A slider's scale, from its `editor_options` (defaults 0–100 by 1), and where the thumb sits for `value`. */
export function sliderScale(
  options: Record<string, unknown> | undefined,
  value: unknown
): { min: number; max: number; step: number; at: number } {
  const num = (x: unknown, d: number) => {
    const n = Number(x)
    return x === undefined || x === null || x === "" || !Number.isFinite(n) ? d : n
  }
  const min = num(options?.["min"], 0)
  const max = num(options?.["max"], 100)
  const step = num(options?.["step"], 1)
  const n =
    typeof value === "number" ? value : value === null || value === undefined || value === "" ? NaN : Number(value)
  return { min, max, step, at: Number.isFinite(n) ? n : min }
}

/** A progress bar's fill, 0–100, against `options.max` (default 100), or null for a value that is no number. */
export function progressOf(
  value: unknown,
  options: Record<string, unknown> | undefined
): { pct: number; value: number; max: number } | null {
  const m = Number(options?.["max"] ?? 100)
  const max = Number.isFinite(m) && m > 0 ? m : 100
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return { pct: Math.max(0, Math.min(100, (n / max) * 100)), value: n, max }
}

/** A reference as the engine stores it: `collection/id`, no leading slash. */
export const bareRef = (v: unknown): string => (typeof v === "string" ? v.replace(/^\/+/, "") : "")

/** The references a relation value holds, slashless, empties dropped — one for a single reference, all of a list. */
export function refsOf(v: unknown): string[] {
  const all = Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]
  return all.map(bareRef).filter(Boolean)
}

/** A list reference after picking `ref`: added when absent, removed when present; null once emptied. */
export function toggleRef(refs: readonly string[], ref: string): string[] | null {
  return listOrNull(refs.includes(ref) ? refs.filter(r => r !== ref) : [...refs, ref])
}

/** One `many` object field's rows: a non-object element reads as an empty row, never a primitive. */
export function rowsOf(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.map(r => (r !== null && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : {}))
    : []
}

/** Move one element of a list from `from` to `to` — a drag reorder. Returns a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice()
  if (from === to || from < 0 || from >= next.length) return next
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved as T)
  return next
}

/** The fields a key/value read draws for one object: declared sub-fields first, in order, then extras. */
export function entriesOf(row: Record<string, unknown>, declared: readonly { field: string }[]): [string, unknown][] {
  const named = declared.map(f => f.field).filter(f => f in row)
  const extras = Object.keys(row).filter(k => !named.includes(k))
  return [...named, ...extras].map(k => [k, row[k]])
}

/** One value of a key/value read: `—` for nothing, JSON for an object. */
export const showValue = (v: unknown): string =>
  v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v, null, 1) : String(v)
