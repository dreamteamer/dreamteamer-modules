// The declarations of the @dreamteamer/protocol entries this app imports, for its typecheck only (tsconfig
// `paths`). The package's own .d.ts files sit beside its .ts sources, and TypeScript reads `./gate.d.ts` (or the
// exports' `./src/gate.js`) as gate.ts — the protocol's NON-strict source — so a strict consumer inherits every
// error in it. These restate the package's declarations (gate.d.ts, routes.d.ts, reshape.d.ts, applyWrite.d.ts,
// createFrameBridge.d.ts, buildModuleScope.d.ts, buildFrameDocument.d.ts) as far as ui uses them. Runtime is untouched: Vite
// bundles the package's own code. Drop this file once the protocol's sources typecheck strictly.
export type Op = "create" | "update" | "delete" | "position"
export interface WriteGrant {
  ops: Set<Op>
  fields: Set<string> | "own-fields"
  mirroredRefs: "refuse" | "allow"
  commit: boolean
}
export interface Scope {
  kind: "artifact" | "module"
  label: string
  routes: Set<string>
  reads: Set<string>
  writes: Map<string, WriteGrant>
  home?: string
  module?: string
  own?: Set<string>
  sentences: unknown
}
export interface Call {
  method: string
  path: string
  query: Record<string, string>
  body: unknown
  routeId: string
  collection?: string
}
export type Decision =
  | { ok: true; call: Call; needsSource?: "home"; commit?: { only: string[] | null; message: string } }
  | { ok: false; status: number; error: string }

export declare function gate(
  scope: Scope,
  descriptors: Array<{ name: string; fields?: Record<string, any>; runtime?: boolean }>,
  method: string,
  path: string,
  query?: URLSearchParams | Record<string, string>,
  body?: unknown
): Decision

export declare function matchRoute(
  method: string,
  rawPath: string
): { route: { id: string; pattern: string }; params: Record<string, string> } | null

export declare function reshape(routeId: string, body: unknown, scope: Scope, collection?: string): unknown

export declare function applyWrite(
  handle: (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>,
  decision: Extract<Decision, { ok: true }>
): Promise<{ status: number; body: any }>

export interface FrameBridge<M = unknown> {
  add(win: object, meta: M): void
  remove(win: object): void
  loaded(win: object): void
  accept(event: {
    source: unknown
    data: unknown
  }): { meta: M; msg: { dt: 1; id: unknown; op: string; [k: string]: unknown } } | null
  reply(win: { postMessage(m: unknown, t: string): void }, id: unknown, reply: unknown): void
  post(win: { postMessage(m: unknown, t: string): void }, msg: Record<string, unknown>): void
}
export declare function createFrameBridge<M = unknown>(): FrameBridge<M>

export declare function buildModuleScope(input: {
  module: string
  home: string
  collectionsRows: Array<{ id: string; $module?: string }>
  descriptors: Array<{
    name: string
    fields?: Record<string, any>
    compiled?: { overlaid_by?: string[] }
    runtime?: boolean
  }>
  grant: Record<string, { reads?: string[]; writes?: string[] }>
}): Scope & { kind: "module"; module: string; home: string; own: Set<string> }

export declare function buildFrameDocument(input: {
  guestText: string
  bundleText?: string
  styleText?: string
  meta?: boolean
  policy?: string
  bodyHtml?: string
  scripts?: Array<{ text: string; type?: "classic" | "module" }>
}): { html: string; scriptTexts: string[] }
