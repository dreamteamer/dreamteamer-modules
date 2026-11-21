import type { ModuleRecord } from "../fsdata.ts"
import * as yaml from "js-yaml"
import * as fs from "node:fs"
import * as path from "node:path"
import { runtimeModules } from "./runtimeModules.ts"

export function loadRuntimeModules(
  root: string,
  modules: ReadonlyArray<Pick<ModuleRecord, "id" | "path">>
): Map<string, string> {
  try {
    const doc: any = yaml.load(fs.readFileSync(path.join(root, ".dreamteamer", "manifest.yaml"), "utf8"))
    return runtimeModules(doc?.entries, modules)
  } catch {
    return new Map()
  }
}
