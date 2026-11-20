#!/usr/bin/env node
// migrate-change-request-stage — fills `stage` on a workspace's own change requests: the gate `dt next`
// names on each (lib/crStage.mjs, read through the workspace's own engine), dry run first. Also the repair
// for a stage that drifted — a card dragged on the board, a lifecycle step that skipped the write.
//
//   npx dreamteamer run @dreamteamer/rnd migrate-change-request-stage            # the plan, nothing written
//   npx dreamteamer run @dreamteamer/rnd migrate-change-request-stage --write    # apply it
//   … [--root <workspace>] [--json]
//
// Per change request:
//   a gate open, stage empty or different     set stage to the gate's (through `dt set`, so the engine validates)
//   no gate open, stage empty or contradicted  reported with the stages its record allows — never guessed
// Order: install, `dt compile`, this, `dt check`; before compile it refuses.
import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"
import { engineEntry } from "../lib/engineEntry.ts"
import { findWorkspace } from "../lib/findWorkspace.ts"
import { COLLECTION, compilesStage, readRequests, allowedStages, stageContradictions } from "../lib/crStage.ts"

/** The workspace's own engine: its API module and its CLI, with no harness session id leaking in. */
async function engineOf(root: string) {
  const pkg = createRequire(path.join(root, "package.json")).resolve("dreamteamer/package.json")
  const dir = path.dirname(pkg)
  const apiFile = engineEntry(dir)
  if (!apiFile) throw new Error(`${dir}: the engine's package.json exports no API`)
  const dt = await import(pathToFileURL(apiFile).href)
  const bin = path.join(dir, "bin", "dreamteamer.js")
  const env = { ...process.env }
  delete env.CLAUDE_CODE_SESSION_ID
  const cli = (args: string[]) => {
    const r = spawnSync(process.execPath, [bin, ...args, "--workspace", root], {
      cwd: root,
      encoding: "utf8",
      env,
      timeout: 120_000,
    })
    return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" }
  }
  return { dt, cli }
}

export async function main(argv = process.argv.slice(2), out = console.log) {
  const flag = (n: string) => argv.includes(`--${n}`)
  const rootAt = argv.indexOf("--root")
  const root = rootAt >= 0 ? path.resolve(argv[rootAt + 1] ?? "") : findWorkspace()
  if (!root || !fs.existsSync(path.join(root, "package.json"))) {
    out(
      "no workspace here — run it from the workspace root (the folder with package.json and package-lock.json), or pass --root"
    )
    return 1
  }
  const write = flag("write")
  const json = flag("json")

  const { dt, cli } = await engineOf(root)
  // read THIS workspace, even when it sits inside another (the engine climbs out otherwise)
  ;(globalThis as Record<symbol, unknown>)[Symbol.for("dreamteamer.workspace")] = root
  const ws = await dt.openWorkspace(root)
  const store = new dt.Store(ws)
  if (!store.descriptors?.has?.(COLLECTION)) {
    out(`no ${COLLECTION} in this workspace — nothing to migrate`)
    return 0
  }
  if (!compilesStage(store)) {
    out(`run dt compile first: the compiled ${COLLECTION} has no stage field. nothing was written.`)
    return 1
  }
  if (typeof dt.commandsFor !== "function") {
    out(`this engine has no commandsFor — upgrade the engine to read the gates. nothing was written.`)
    return 1
  }

  const report = {
    planned: [] as { id: string; stage: string; was?: string | null }[],
    set: [] as string[],
    cannot_tell: [] as { id: string; reason: string; allowed: string[]; by: string }[],
    failed: [] as string[],
  }
  for (const r of readRequests(store, dt)) {
    const stage = (r.stage as string) || null
    if (r.expected) {
      if (stage === r.expected) continue
      report.planned.push({ id: r.id, stage: r.expected, was: stage })
      continue
    }
    const allowed = allowedStages(r.fields)
    if (!stage)
      report.cannot_tell.push({
        id: r.id,
        reason: `no gate open (status ${r.fields.status ?? "empty"})`,
        allowed,
        by: "hand",
      })
    else {
      const [why] = stageContradictions(r.fields, String(stage))
      if (why)
        report.cannot_tell.push({
          id: r.id,
          reason: `stage ${stage} contradicts the record (${why})`,
          allowed,
          by: "one",
        })
    }
  }

  for (const p of report.planned) {
    const ref = `${COLLECTION}/${p.id}`
    if (!write) {
      if (!json) out(`would set ${ref} stage=${p.stage} (was ${p.was ?? "empty"})`)
      continue
    }
    const res = cli(["set", ref, `stage=${p.stage}`])
    if (res.code !== 0) {
      report.failed.push(p.id)
      if (!json) out(`✖ ${ref}: ${(res.err || res.out).trim()}`)
      continue
    }
    report.set.push(p.id)
    if (!json) out(`set ${ref} stage=${p.stage} (was ${p.was ?? "empty"})`)
  }
  if (!json) {
    for (const c of report.cannot_tell) {
      const tail = c.by === "hand" ? "set stage by hand" : "set stage to one of them"
      out(
        `cannot tell ${COLLECTION}/${c.id}: ${c.reason} — the record allows ${c.allowed.join(" · ") || "no stage"}; ${tail}`
      )
    }
    if (write) out(`${report.set.length} set${report.failed.length ? `, ${report.failed.length} failed` : ""}`)
    else out(report.planned.length ? `${report.planned.length} to set — run again with --write` : "nothing to set")
  } else out(JSON.stringify(report, null, 2))
  return report.failed.length ? 1 : 0
}

const self = fs.realpathSync(fileURLToPath(import.meta.url))
if (process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === self)
  main().then(code => {
    process.exitCode = code
  })
