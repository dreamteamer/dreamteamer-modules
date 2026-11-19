// Ported from the dreamteamer VS Code extension's host side (src/changes.ts); PROTOCOL.md is the contract it answers.

export type ChangeScope = "schema" | "data"
export interface InvalidateMessage {
  type: "dt:invalidate"
  scope: ChangeScope
  pages?: true
}

export function strongerScope(a: ChangeScope | undefined, b: ChangeScope | undefined): ChangeScope {
  return a === "schema" || b === "schema" ? "schema" : "data"
}
export function changeScope(root: string, file: string): ChangeScope {
  const rel = relativeSegments(root, file)
  if (rel[0] !== RUNTIME_DIR) return "data"
  return rel.slice(1).some(isDotEntry) ? "data" : "schema"
}
const RUNTIME_DIR = ".dreamteamer"
export const RECORD_WATCH_GLOB = "{data,state,.dreamteamer,git_modules,modules}/**"
const ALWAYS_WATCHED = new Set(["data", "state", RUNTIME_DIR])
export const NAV_DOC_FILE = "nav.yaml"
export function isWatchedChange(root: string, file: string, underRecordRoot: (file: string) => boolean): boolean {
  const rel = relativeSegments(root, file)
  if (!rel.length) return false
  // the left nav (cr-dt-008): a hand edit of nav.yaml redraws it like a record change
  if (rel.length === 1 && rel[0] === NAV_DOC_FILE) return true
  if (ALWAYS_WATCHED.has(rel[0])) return true
  return underRecordRoot(file)
}
function isDotEntry(segment: string): boolean {
  return segment.startsWith(".")
}
function relativeSegments(root: string, file: string): string[] {
  const r = normalize(root)
  const f = normalize(file)
  if (f === r) return []
  if (!f.startsWith(r + "/")) return []
  return f
    .slice(r.length + 1)
    .split("/")
    .filter(Boolean)
}
function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "")
}
export function invalidateMessage(
  scope: ChangeScope,
  opts: {
    pages?: boolean
  } = {}
): InvalidateMessage {
  return opts.pages ? { type: "dt:invalidate", scope, pages: true } : { type: "dt:invalidate", scope }
}
