/**
 * `GET /sources` — the stack of roots a workspace reads, top to bottom: the workspace's own data, then each
 * module-owned collection under its module (host
 * `src/sources.ts`). The shapes the Schema tab's Sources page draws, and the one sum it shows per root.
 */
import type { SourceAccess, SourceVia } from "../api/types.ts"

export interface StackEntry {
  name: string
  kind: "own" | "module"
  repo: string
  installed: boolean
  /** The root's class and whether a write lands there (cr-vscode-004) — the source mark's glyph. */
  via?: SourceVia
  access?: SourceAccess
  note?: string
  collections: Array<{ collection: string; path: string; count: number }>
}

export interface SourceStack {
  workspace: StackEntry
  modules: StackEntry[]
}

/** The records read from one root, over every collection it contributes to. */
export const recordsIn = (e: Pick<StackEntry, "collections">): number => e.collections.reduce((n, c) => n + c.count, 0)

/** `3 records read`, `1 record read`. */
export const recordCount = (n: number, suffix = ""): string => `${n} record${n === 1 ? "" : "s"}${suffix}`
