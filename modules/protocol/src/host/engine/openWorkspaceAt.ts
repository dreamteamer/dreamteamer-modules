import * as path from "node:path"
import { loadedApi, type EngineWorkspace } from "../engine.ts"

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
