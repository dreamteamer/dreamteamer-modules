/**
 * THE PAGE'S BOOT VALUES — what the host answers on `GET /host` (level, chat, the workspace, the files base),
 * read before mount and again after every reconnect. A 401 from anywhere means the session is gone: the app
 * draws the signed-out sentence instead of itself. Ported from the Vue ui's lib/host-boot.ts.
 */
import { HostError } from "../transport/types.ts"
import { signal } from "./signal.ts"

export interface HostInfo {
  level?: "read" | "edit" | "admin"
  chat?: boolean
  workspace?: { id?: string; name?: string }
  /** While a raise from the chat holds (`dt web open --edit|--admin`): since when, ISO. */
  raisedAt?: string
  filesBase?: string
  framesBase?: string
  [key: string]: unknown
}

/** What the host answered on GET /host, or null — a host without the route, or a page not loaded yet. */
export const hostInfo = signal<HostInfo | null>(null)
/** The session is gone (a 401): the page draws SIGNED_OUT instead of itself. */
export const signedOut = signal(false)

/** The sentence a signed-out page shows — the chat is where a person gets back in. */
export const SIGNED_OUT = "This pane is signed out. Ask the chat to show it again — it runs dt web open."

type Request = (method: string, path: string, body?: unknown) => Promise<unknown>

/** Ask the host for the page's boot values. 401 → signed out, null; any other failure → null. Never rejects. */
export async function loadHost(request: Request): Promise<HostInfo | null> {
  try {
    const info = await request("GET", "/host")
    hostInfo.set(info && typeof info === "object" ? (info as HostInfo) : null)
    return hostInfo.get()
  } catch (err) {
    if (err instanceof HostError && err.status === 401) {
      signedOut.set(true)
      hostInfo.set(null)
    }
    return null
  }
}

/** Where record files are served from: the host's base, else the global an older shell set. */
export function filesBase(): string | undefined {
  const w = typeof window !== "undefined" ? (window as unknown as { __DT_FILES__?: string }) : {}
  return hostInfo.get()?.filesBase ?? w.__DT_FILES__
}

/** Edits are offered unless the host said the page reads only. A host that answers no level (an editor) edits. */
export function canEdit(info: HostInfo | null): boolean {
  return info?.level !== "read"
}

/** Admin routes (commit, rename, revert) are offered only at admin; a host that answers no level (an editor)
 *  answers every route at admin. */
export function isAdmin(info: HostInfo | null): boolean {
  return !info || info.level === undefined || info.level === "admin"
}

/** A host that answered a workspace id is a PANE host (reading 3 — the editor answers no id): the switcher and the
 *  level in the nav toolbar, the place report and the arrange lock's level rule apply only there. */
export function paneHost(info: HostInfo | null): boolean {
  return typeof info?.workspace?.id === "string"
}
