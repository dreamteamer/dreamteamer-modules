// Ported from the dreamteamer VS Code extension's host side (src/engine.ts); PROTOCOL.md is the contract it answers.
import * as fs from "node:fs"
import * as path from "node:path"
import { pathToFileURL } from "node:url"
import { EngineTooOldError, meetsFloor } from "./floor.ts"

import type { BelowFloorNotice } from "./floor.ts"
import type { NavDoc } from "../navDoc.ts"

export interface EngineWorkspace {
  root: string
  pkg: any
  extensions: unknown[]
}
export interface EngineNote {
  id: string | null
  text: string
  by: string
  error?: true
}
export interface DescriptorStorage {
  path: string
  format: "md" | "yaml" | "json" | "binary"
  shape: "file" | "folder"
  suffix?: string
  entry?: string
  repo?: string
  runtime?: boolean
  under?: {
    parent: string
    subfolder: string
    collection?: string
    id?: string
  }
  unavailable?: string | null
  max_bytes?: number
  accept?: string[]
}
export interface DescriptorDisplay {
  nav?: {
    icon?: string
    order?: number
    section?: string
  }
  list?: Record<string, any>
  record?: Record<string, any>
  form?: Record<string, any>
}
export interface EngineModules {
  Store: any
  bodyField: (d: any) => string | undefined
  serialize: (d: any, fields: Record<string, any>) => string
  parseRecordText: (text: string, d: any, bodyField?: string) => Record<string, any>
  presentation: (descriptors: Map<string, any>) => any
  matchesFilter: (row: any, filter: any, resolve?: (ref: string) => any) => boolean
  readManifest: (root: string) => any
  staleness: (root: string) => any
  compile: (ws: EngineWorkspace) => number
  CompileError: any
  slugOrHash: (s: string) => string
  slug: (s: string) => string
  check: (
    ws: EngineWorkspace,
    opts?: {
      extra?: {
        file: string
        msg: string
      }[]
    }
  ) => number
  contributedViolations: (ws: EngineWorkspace) => Promise<
    {
      file: string
      msg: string
    }[]
  >
  commandsFor: (store: any, collection: string, ids: string[]) => any
  contributedNotes?: (ws: EngineWorkspace, collection: string, ids: string[]) => EngineNote[]
  recordResolver: (store: any) => (ref: string) => any
  distinctValues: (
    store: any,
    collection: string,
    field: string,
    opts?: {
      limit?: number
    }
  ) => any
  commitPending: (
    store: any,
    opts?: {
      only?: string[]
      message?: string
      dryRun?: boolean
    }
  ) => any[]
  history: (store: any, collection: string, id: string) => unknown
  historyDiff: (store: any, collection: string, id: string, hash?: string) => unknown
  sortRows: (rows: any[], sort: string | null | undefined, jsonSchema?: any) => any[]
  renderEnv: (template: string) => string
  declaredVars: string[]
  placementKey: (
    rows: {
      id: string
      key: string
    }[],
    id: string,
    dest: Record<string, unknown>,
    collection?: string
  ) => string
  schema: {
    createCollection: Function
    removeCollection: Function
    renameCollection: Function
    moveCollection: Function
    setCollectionScalars: Function
    addField: Function
    updateField: Function
    removeField: Function
    removeFieldPlan: Function
    renameField: Function
    renameFieldPlan: Function
    renameValue: Function
    renameValuePlan: Function
    fieldFromFlags: Function
    saveUiView: Function
    removeUiView: Function
    moveUiView?: Function
    createModule: Function
    setModule: Function
    renameModule: Function
    removeModule: Function
    createSkill: Function
    refuseHandAuthored: Function
    removeEntity: Function
    renameEntity: Function
    setEntityFrontmatter: Function
  }
  parseRef: (ref: string) => {
    collection: string
    id: string
  } | null
  namespaces: string[]
  loadDescriptors: (root: string) => Map<string, any> | null
  /** The nav document (engine 0.49, cr-dt-008); each undefined on an engine before it. */
  readNavDoc?: (root: string) => NavDoc | null
  validateNavDoc?: (
    doc: NavDoc,
    ctx: {
      collections: Set<string>
      namespaces: string[]
    }
  ) => {
    warning: string
  }[]
  writeNavDoc?: (root: string, doc: NavDoc) => boolean
  applyNavFragments?: (
    root: string,
    opts?: {
      names?: string[]
      ignoreSettings?: boolean
    }
  ) => {
    written: boolean
    placed: string[]
    skipped?: "settings"
  }
  descriptor: {
    moduleOf: (d: any) => string | undefined
    isInternal: (d: any) => boolean
    isRuntime: (d: any) => boolean
    isBinary: (d: any) => boolean
    displayOf: (d: any) => DescriptorDisplay
    overlaidByOf: (d: any) => string[]
    positionFieldOf: (d: any) => string | undefined
    storageOf: (d: any) => DescriptorStorage
    titleOf: (d: any) => string
    fieldsOf: (d: any) => Record<string, any>
    idsOf: (d: any) => {
      from?: string | string[]
      pattern?: string
    }
    jsonSchemaOf: (d: any) => any
  }
  ws: EngineWorkspace
}
export interface InitEngineOptions {
  minEngine?: string
  allowBelowFloor?: boolean
}
// through new Function, so a bundler building CommonJS (the VS Code extension) keeps a real dynamic import
const esmImport = new Function("specifier", "return import(specifier)")
export const ENGINE_API_VERSION = 1
let loaded: EngineModules | undefined
/** The workspace's own engine, loaded at run time — whatever version it is, so read as it answers. */
let loadedApi: Record<string, any> | undefined
let resolvedBase: string | null = null
export function engineBase(): string | null {
  return resolvedBase
}
export function engine(): EngineModules {
  if (!loaded) throw new Error("dreamteamer engine not loaded yet")
  return loaded
}
export function engineLoaded(): boolean {
  return loaded !== undefined
}
export function engineRoot(root: string): string {
  const found = path.join(root, "node_modules", "dreamteamer")
  if (fs.existsSync(path.join(found, "package.json"))) return found
  throw new Error("no dreamteamer engine in this workspace — looked in node_modules/dreamteamer (run: npm install)")
}
export function readEngineVersion(engineDir: string): string | null {
  try {
    const v = JSON.parse(fs.readFileSync(path.join(engineDir, "package.json"), "utf8")).version
    return typeof v === "string" ? v : null
  } catch {
    return null
  }
}
/**
 * The file an engine package resolves `subpath` to (`"."` the public API, `"./records"` the records API): its
 * package.json `exports`, else `main` — never a path guessed here. An engine through 0.49 answers `src/api.js`,
 * a TypeScript engine `dist/api.js`; both say so in their manifest. Null when it names none that exists.
 */
export function engineEntry(base: string, subpath: string = "."): string | null {
  const pick = (e: unknown): string | null =>
    typeof e === "string"
      ? e
      : e && typeof e === "object"
        ? (pick((e as Record<string, unknown>).import) ??
          pick((e as Record<string, unknown>).node) ??
          pick((e as Record<string, unknown>).default))
        : null
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(base, "package.json"), "utf8"))
    const exported = pkg.exports && typeof pkg.exports === "object" ? pick(pkg.exports[subpath]) : null
    const target = exported ?? (subpath === "." && typeof pkg.main === "string" ? pkg.main : null)
    const file = target ? path.join(base, target) : null
    return file && fs.existsSync(file) ? file : null
  } catch {
    return null
  }
}
let belowFloor: BelowFloorNotice | null = null
export function engineBelowFloor(): BelowFloorNotice | null {
  return belowFloor
}
export async function initEngine(root: string, opts: InitEngineOptions = {}): Promise<EngineModules> {
  const base = engineRoot(root)
  resolvedBase = base
  const version = readEngineVersion(base)
  const engineLabel = path.relative(root, base) || base
  belowFloor = null
  if (opts.minEngine && !meetsFloor(version, opts.minEngine)) {
    const notice = { floor: opts.minEngine, version, engineLabel }
    if (!opts.allowBelowFloor) throw new EngineTooOldError(notice)
    belowFloor = notice
  }
  const apiFile = engineEntry(base)
  if (!apiFile) {
    throw new Error(
      `${engineLabel} (v${version ?? "?"}) has no public API (its package.json exports none) — this extension loads the engine only through it. ` +
        `Install ${opts.minEngine ? `dreamteamer ${opts.minEngine} or later` : "an engine that ships it"}, then Compile and reload.`
    )
  }
  const api = await esmImport(pathToFileURL(apiFile).href)
  if (api.apiVersion !== ENGINE_API_VERSION) {
    throw new Error(
      `${engineLabel} (v${version ?? "?"}) exposes engine API version ${String(api.apiVersion)}; ` +
        `this extension requires API version ${ENGINE_API_VERSION}. ` +
        `Install an engine that speaks it (or an extension release that matches this engine), then reload.`
    )
  }
  const ws = await api.openWorkspace(root)
  const namespaces = api.namespaces(root)
  loadedApi = api
  loaded = {
    Store: api.Store,
    bodyField: api.bodyField,
    serialize: api.serialize,
    parseRecordText: api.parseRecordText,
    presentation: api.presentation,
    matchesFilter: api.matchesFilter,
    readManifest: api.readManifest,
    staleness: api.staleness,
    compile: api.compile,
    CompileError: api.CompileError,
    slugOrHash: api.slugOrHash,
    slug: api.slug,
    check: api.check,
    contributedViolations: api.contributedViolations,
    commandsFor: api.commandsFor,
    contributedNotes: api["contributedNotes"],
    recordResolver: api.recordResolver,
    distinctValues: api.distinctValues,
    commitPending: api.commitPending,
    history: api.history,
    historyDiff: api.historyDiff,
    sortRows: api.sortRows,
    placementKey: api.placementKey,
    renderEnv: (template: string) => api.renderTemplate(template, api.envContext(engine().ws)),
    declaredVars: declaredVarsOf(ws.pkg),
    loadDescriptors: api.loadDescriptors,
    // the nav document (engine 0.49, cr-dt-008): each undefined on an older engine, where the protocol's own
    // reader, name check and writer stand in (navDoc.js) and there are no fragments to apply
    readNavDoc: api["readNavDoc"],
    validateNavDoc: api["validateNavDoc"],
    writeNavDoc: api["writeNavDoc"],
    applyNavFragments: api["applyNavFragments"],
    descriptor: {
      moduleOf: api.moduleOf,
      isInternal: api.isInternal,
      isRuntime: api.isRuntime,
      isBinary: api.isBinary,
      displayOf: api.displayOf,
      overlaidByOf: api.overlaidByOf,
      positionFieldOf: api.positionFieldOf,
      storageOf: api.storageOf,
      titleOf: api.titleOf,
      fieldsOf: api.fieldsOf,
      idsOf: api.idsOf,
      jsonSchemaOf: api.jsonSchemaOf,
    },
    namespaces,
    parseRef: (ref: string) => api.parseRef(ref, namespaces),
    schema: {
      createCollection: api.createCollection,
      removeCollection: api.removeCollection,
      renameCollection: api.renameCollection,
      moveCollection: api.moveCollection,
      setCollectionScalars: api.setCollectionScalars,
      addField: api.addField,
      updateField: api.updateField,
      removeField: api.removeField,
      removeFieldPlan: api.removeFieldPlan,
      renameField: api.renameField,
      renameFieldPlan: api.renameFieldPlan,
      renameValue: api.renameValue,
      renameValuePlan: api.renameValuePlan,
      fieldFromFlags: api.fieldFromFlags,
      saveUiView: api.saveUiView,
      removeUiView: api.removeUiView,
      moveUiView: api["moveUiView"],
      createModule: api.createModule,
      setModule: api.setModule,
      renameModule: api.renameModule,
      removeModule: api.removeModule,
      createSkill: api.createSkill,
      refuseHandAuthored: api.refuseHandAuthored,
      removeEntity: api.removeEntity,
      renameEntity: api.renameEntity,
      setEntityFrontmatter: api.setEntityFrontmatter,
    },
    ws,
  }
  return loaded
}
function declaredVarsOf(pkg: Record<string, any> | undefined): string[] {
  const vars = pkg?.dreamteamer?.vars
  return Array.isArray(vars) ? vars.filter(v => typeof v === "string") : []
}
export function openWorkspaceAt(dir: string): Promise<EngineWorkspace> {
  if (!loadedApi) return Promise.reject(new Error("engine not loaded"))
  const key = Symbol.for("dreamteamer.workspace")
  const g = globalThis as Record<symbol, unknown>
  const had = Object.prototype.hasOwnProperty.call(g, key)
  const prev = g[key]
  g[key] = path.resolve(dir)
  try {
    return Promise.resolve(loadedApi.openWorkspace(dir))
  } finally {
    if (had) g[key] = prev
    else delete g[key]
  }
}
export async function refreshWorkspace(): Promise<void> {
  if (!loaded) return
  const ws = await loadedApi.openWorkspace(loaded.ws.root)
  loaded.ws = ws
  loaded.declaredVars = declaredVarsOf(ws.pkg)
  loaded.namespaces.splice(0, loaded.namespaces.length, ...loadedApi.namespaces(ws.root))
}
