// REMOTE ACCESS, the host's half (cr-vscode-012, re-homed with cr-modules-005): which remote each Sources
// entry is checked against, and the redaction guard every answer passes. The PROVIDERS — who asks GitHub
// and Bitbucket, as the account the remote pushes as — are the host's own (the VS Code extension injects
// them through `WorkspaceApi.useRemoteAccess`); a host with none answers `not-checked` and says why.
import * as fs from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"
import { GIT_SYNC } from "./gitExec.ts"

import type { ModuleRecord } from "./fsdata.ts"
import type { SourceStackEntry, SourcesContext } from "./sources.ts"

export type Provider = "github" | "bitbucket"
export type Level = "none" | "read" | "write" | "admin"
/** What a remote names — never the alias it was reached through, never userinfo. */
export interface RemoteRef {
  provider: Provider
  host: string
  owner: string
  repo: string
}
export interface AccessTarget {
  /** The source's NAME, as the Sources section names it. */
  source: string
  /** The push url (`git remote get-url --push origin`), when there is one. */
  url?: string
  /** The git top-level the url was read in — where git's own ssh command is read for the greeting. */
  repoDir?: string
  /** A word for the hover: "the workspace's remote" for an inline module. */
  note?: string
  /** Why there is no url ("no remote", "not installed"). */
  reason?: string
}
export interface OwnAccess {
  remote?: RemoteRef
  state: "ok" | "no-login" | "no-access" | "unknown" | "not-checked"
  level?: Level
  role?: string
  account?: string
  tiedToPushKey?: boolean
  reason?: string
  note?: string
}
export interface Member {
  name: string
  kind: "user" | "team" | "group"
  level: Level
  role?: string
  via?: string
}
export interface Members {
  remote?: RemoteRef
  state: "ok" | "partial" | "refused" | "no-login" | "no-access" | "unknown"
  members: Member[]
  account?: string
  reason?: string
}
/** What a host injects through `WorkspaceApi.useRemoteAccess`: the providers, as the account each remote
 *  pushes as. `heldSecrets` is every credential VALUE the host holds right now, for the redaction guard. */
export interface RemoteAccessProvider {
  own(targets: AccessTarget[], opts?: { fresh?: boolean }): Promise<Record<string, OwnAccess>>
  members(target: AccessTarget): Promise<Members>
  heldSecrets(): Promise<string[]>
  forget?(): void
}
export type Git = (args: string[], cwd: string) => string | undefined

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
 * repo's OWN push url, so a linked clone is never judged as the workspace. A layer folder that is not its
 * own clone falls back to its declared `git_modules` url. An installed package has no target; an
 * uninstalled layer, or a repo with no remote, has a target with no url.
 */
export function accessTargets(
  stack: { workspace: SourceStackEntry; layers: SourceStackEntry[]; modules: SourceStackEntry[] },
  root: string,
  modules: Array<Pick<ModuleRecord, "id" | "path">>,
  gitModules: SourcesContext["gitModules"],
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
  for (const l of stack.layers) {
    if (!l.installed) {
      out.push({ source: l.name, reason: "not installed" })
      continue
    }
    const top = topLevel(path.join(root, l.repo), git)
    if (top && top !== wsTop) out.push(at(l.name, pushUrl(top), top))
    else out.push(at(l.name, gitModules[l.name]?.url, undefined))
  }
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
export const NOT_AVAILABLE = "remote access is not available in this host"
/** What a host with no provider answers `GET /sources/access`: every target not checked, and why. */
export function unavailableAccess(targets: AccessTarget[]): {
  available: false
  access: Record<string, OwnAccess>
} {
  return {
    available: false,
    access: Object.fromEntries(targets.map(t => [t.source, { state: "not-checked", reason: NOT_AVAILABLE }])),
  }
}
const TOKEN_SHAPES = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bATATT[A-Za-z0-9_\-=]{20,}/g,
  /\b(?:Basic|Bearer)\s+[A-Za-z0-9+/=._-]{16,}/g,
]
/**
 * Every string in `value` with each FULL token shape — and each exact value in `extra` (eight characters
 * or more) — replaced by `[redacted]`. Full shapes only, so a name a provider reports (`ghp_tools`,
 * `Basic Users`) reaches the screen as reported. The second line, never the first: a provider's text is
 * not forwarded in the first place.
 */
export function redactSecrets<T>(value: T, extra: string[] = []): T {
  const exact = extra.filter(s => typeof s === "string" && s.length >= 8)
  const scrub = (s: string) => {
    let out = s
    for (const e of exact) out = out.split(e).join("[redacted]")
    for (const re of TOKEN_SHAPES) out = out.replace(re, "[redacted]")
    return out
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return scrub(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}
