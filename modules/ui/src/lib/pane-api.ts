/**
 * The pane's own routes (cr-modules-017 §4, §7): `/_dt/` is the server's prefix, not a protocol route, so the pane's
 * controls in the nav toolbar — the workspace switcher and the level — call it with the browser's fetch, the cookie
 * (same-origin) and a JSON Content-Type; a refusal rejects with the server's sentence.
 *
 * `paneMenu` is which menu of the nav is open (lib/open-menu.ts): one at a time across the pane's two controls, the
 * row menus and the toolbar's asks, so opening one closes the others.
 */
import { openMenu } from "./open-menu"

export async function paneFetch(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data: any = null
  try {
    data = await res.json()
  } catch {
    /* no body */
  }
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : `the server answered ${res.status}`)
  return data
}

/** The nav menu that is open: the switcher (`'switch'`), the level (`'level'`), a row menu or ask (`'nav'`), or none. */
export const paneMenu = openMenu
