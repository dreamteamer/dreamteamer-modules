#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import yaml from "js-yaml"
import { kinds, validate } from "../src/desired-state.ts"
import type { Records, Schemas } from "../src/desired-state.ts"
export function checkRecords(dataRoot: string, moduleRoot: string, organizationId?: string) {
  if (!fs.existsSync(dataRoot) || !fs.statSync(dataRoot).isDirectory()) throw new Error("Data directory unavailable")
  const records = Object.fromEntries(kinds.map(k => [k, {}])) as Records
  const schemas = {} as Schemas
  const violations = []
  let checked = 0
  const workspaceDir = path.join(dataRoot, "workspaces")
  if (fs.existsSync(workspaceDir) && !fs.lstatSync(workspaceDir).isDirectory())
    throw new Error("Invalid record namespace")
  for (const kind of kinds) {
    schemas[kind] = yaml.load(
      fs.readFileSync(path.join(moduleRoot, "collections", "workspaces", `${kind}.collection.yaml`), "utf8")
    ) as Schemas[typeof kind]
    const dir = path.join(dataRoot, "workspaces", kind)
    if (!fs.existsSync(dir)) continue
    if (!fs.lstatSync(dir).isDirectory()) {
      violations.push(`${kind}: invalid record directory`)
      continue
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const suffix = `.${schemas[kind].storage.suffix}.md`
      const id = entry.name.endsWith(suffix) ? entry.name.slice(0, -suffix.length) : ""
      if (!entry.isFile() || !/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        violations.push(`${kind}: unsupported record entry`)
        continue
      }
      checked++
      try {
        const text = fs.readFileSync(path.join(dir, entry.name), "utf8")
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text)
        if (!match || match[2].trim()) throw new Error("only typed frontmatter allowed")
        const row = yaml.load(match[1])
        if (!row || typeof row !== "object" || Array.isArray(row) || Object.hasOwn(records[kind], id))
          throw new Error("invalid record")
        records[kind][id] = row as Record<string, unknown>
      } catch {
        violations.push(`${kind}: invalid record (details suppressed)`)
      }
    }
  }
  if (organizationId !== undefined) {
    const org = Object.hasOwn(records.organizations, organizationId) ? records.organizations[organizationId] : undefined
    const ref = `workspaces/organizations/${organizationId}`
    if (!org || Object.keys(records.organizations).length !== 1) {
      violations.push("Expected exactly the selected organization")
    } else {
      for (const kind of [
        "repositories",
        "workspaces",
        "roles",
        "operators",
        "teams",
        "business-roles",
        "responsibilities",
        "work-areas",
        "assignments",
      ] as const)
        if (Object.values(records[kind]).some(r => r.organization !== ref))
          violations.push(`${kind}: records outside selected organization`)
      if (Object.keys(records.providers).some(id => `workspaces/providers/${id}` !== org.provider))
        violations.push("providers: records outside selected organization")
      const roles = Object.values(records.roles).filter(r => r.organization === ref)
      if (!roles.some(r => r.role === "ai-ops")) violations.push("Organization requires an AI Ops role")
      const roster = new Set(roles.map(r => r.user))
      if (Object.keys(records.users).some(id => !roster.has(`workspaces/users/${id}`)))
        violations.push("users: records outside selected organization")
    }
  }
  return { checked, violations: [...violations, ...validate(records, schemas)] }
}
function main() {
  const args = process.argv.slice(2)
  if (
    args[0] !== "--data-root" ||
    (args.length !== 2 && (args.length !== 4 || args[2] !== "--organization" || !/^[a-z0-9][a-z0-9-]*$/.test(args[3])))
  ) {
    console.error("Usage: check-records --data-root <workspace-data-directory> [--organization <id>]")
    process.exitCode = 2
    return
  }
  const here = path.dirname(fileURLToPath(import.meta.url))
  const moduleRoot =
    path.basename(path.dirname(here)) === "dist" ? path.resolve(here, "../..") : path.resolve(here, "..")
  try {
    const result = checkRecords(path.resolve(args[1]), moduleRoot, args[3])
    console.log(JSON.stringify(result))
    process.exitCode = result.violations.length ? 1 : 0
  } catch {
    console.error("Unable to read workspace configuration; no changes made.")
    process.exitCode = 2
  }
}
const real = (p: string) => fs.realpathSync(p)
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main()
