// REMOTE ACCESS, the host's half (cr-vscode-012, re-homed with cr-modules-005): which remote each Sources
// entry is checked against, and the redaction guard every answer passes. The PROVIDERS — who asks GitHub
// and Bitbucket, as the account the remote pushes as — are the host's own (the VS Code extension injects
// them through `WorkspaceApi.useRemoteAccess`); a host with none answers `not-checked` and says why.
export { accessTargets } from "./remoteAccess/accessTargets.ts"
export { redactSecrets } from "./remoteAccess/redactSecrets.ts"
export { unavailableAccess } from "./remoteAccess/unavailableAccess.ts"
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
export const NOT_AVAILABLE = "remote access is not available in this host"
