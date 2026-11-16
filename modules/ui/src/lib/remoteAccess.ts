/**
 * THE REMOTE MARK's words (cr-vscode-012), pure — ported from the Vue ui's RemoteAccessMark.vue `view`. What a
 * source's REMOTE grants, beside the local mark (which says only whether THIS window writes the files), computed
 * live by the host as the account the remote pushes as.
 *
 * One line of words, never a lone glyph. A WARNING only when all three hold — the local mark writes (write · edit),
 * the remote level is below write, and the answer is tied to the push key — because then a push is refused before
 * it happens. An answer that could not be tied says so and draws no warning it cannot stand behind.
 */
import type { OwnAccess, SourceAccess } from "../api/types.ts"

export interface RemoteMarkView {
  state: string
  words: string
  title: string
  warning: boolean
}

const PROVIDER: Record<string, string> = { github: "GitHub", bitbucket: "Bitbucket" }
export const UNCONFIRMED = "the push key's account could not be confirmed"

export function remoteMark(a: OwnAccess | null | undefined, local?: SourceAccess): RemoteMarkView {
  if (!a) return { state: "checking", words: "remote …", title: "asking the remote", warning: false }
  const where = a.remote ? `${a.remote.owner}/${a.remote.repo}` : ""
  const hover = [
    a.remote ? `${PROVIDER[a.remote.provider] ?? a.remote.provider}: ${a.role ?? a.level ?? a.state} on ${where}` : "",
    a.reason ?? "",
    a.note ?? "",
  ].filter(Boolean)
  if (a.state === "ok") {
    const writesHere = local === "write" || local === "edit"
    const below = a.level === "read" || a.level === "none"
    if (writesHere && below && a.tiedToPushKey)
      return {
        state: "ok",
        words: `push refused — ${a.account} has ${a.level} on ${where}`,
        title: hover.join(" · "),
        warning: true,
      }
    if (writesHere && below)
      return {
        state: "ok",
        words: `remote ${a.level} · as ${a.account} (${UNCONFIRMED})`,
        title: [...hover, UNCONFIRMED].join(" · "),
        warning: false,
      }
    return {
      state: "ok",
      words: `remote ${a.level} · as ${a.account}`,
      title: [...hover, ...(a.tiedToPushKey === false ? [UNCONFIRMED] : [])].join(" · "),
      warning: false,
    }
  }
  if (a.state === "no-access")
    return { state: a.state, words: `no access — ${a.reason ?? where}`, title: hover.join(" · "), warning: true }
  if (a.state === "no-login")
    return { state: a.state, words: a.reason ?? "no login", title: hover.join(" · "), warning: false }
  if (a.state === "not-checked")
    return { state: a.state, words: `remote not checked — ${a.reason ?? ""}`, title: hover.join(" · "), warning: false }
  return { state: a.state, words: `remote unknown — ${a.reason ?? ""}`, title: hover.join(" · "), warning: false }
}
