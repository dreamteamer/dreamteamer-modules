import { execFileSync } from "node:child_process"
import { GIT_SYNC } from "../gitExec.ts"
import * as fs from "node:fs"
import type { SourceStackEntry } from "../sources.ts"
import type { ModuleRecord } from "../fsdata.ts"
import * as path from "node:path"
import type { AccessTarget, Git } from "../remoteAccess.ts"

const realGit: Git = (args, cwd) => {
  try {
    return (
      execFileSync("git", args, { cwd, ...GIT_SYNC })
        .toString()
        .trim() || undefined
    )
  } catch {
    return undefined
  }
}

function topLevel(dir: string, git: Git): string | undefined {
  let real
  try {
    real = fs.realpathSync(dir)
  } catch {
    return undefined
  }
  const top = git(["rev-parse", "--show-toplevel"], real)
  return top ? safeReal(top) : undefined
}

function safeReal(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

/**
 * ONE RULE for every entry: take the entry's folder, resolve it, find its git top-level. The workspace's
 * own top-level → the workspace's push url (with a note for a module entry); any other top-level → that
 * repo's OWN push url, so a linked clone is never judged as the workspace. An installed package has no
 * target; a repo with no remote has a target with no url.
 */
export function accessTargets(
  stack: { workspace: SourceStackEntry; modules: SourceStackEntry[] },
  root: string,
  modules: Array<Pick<ModuleRecord, "id" | "path">>,
  git: Git = realGit
): AccessTarget[] {
  const wsTop = topLevel(root, git)
  const pushUrl = (top: string | undefined) => (top ? git(["remote", "get-url", "--push", "origin"], top) : undefined)
  const wsUrl = pushUrl(wsTop)
  const out = []
  const at = (source: string, url: string | undefined, repoDir: string, extra: Record<string, any> = {}) =>
    url
      ? { source, url, ...(repoDir ? { repoDir } : {}), ...extra }
      : { source, reason: extra.reason ?? "no remote", ...(extra.note ? { note: extra.note } : {}) }
  out.push(at(stack.workspace.name, wsUrl, wsTop))
  for (const m of stack.modules) {
    if (m.via === "package") continue
    const rec = modules.find(x => x.id === m.name)
    const folder = path.join(root, rec?.path && rec.path !== "." ? rec.path : m.repo)
    const top = topLevel(folder, git)
    if (!top) out.push(at(m.name, undefined, undefined))
    else if (top === wsTop) out.push(at(m.name, wsUrl, wsTop, { note: "the workspace's remote" }))
    else out.push(at(m.name, pushUrl(top), top))
  }
  return out
}
