/**
 * The pane's own routes (cr-modules-017 §4, §7): `/_dt/` is the server's prefix, not a protocol route, so the pane's
 * controls in the nav toolbar — the workspace switcher and the level — call it with the browser's fetch, the cookie
 * (same-origin) and a JSON Content-Type; a refusal rejects with the server's sentence. Ported from @dreamteamer/ui's
 * lib/pane-api.ts.
 */
export async function paneFetch(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* no body */
  }
  if (!res.ok) {
    const said = (data as { error?: unknown } | null)?.error
    throw new Error(typeof said === "string" ? said : `the server answered ${res.status}`)
  }
  return data
}
