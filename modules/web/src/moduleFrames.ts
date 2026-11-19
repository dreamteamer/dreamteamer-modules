// cr-modules-008 task 6, on the one listener since cr-modules-017: /_frames/<key>/<module>/<kind>.html serves each
// module surface as ONE self-contained frame document under `sandbox allow-scripts` —
// the module's app.js read once and embedded as data, the guest from the UI package the page comes from,
// the frame policy with no host, hash or nonce. Nothing in the frame is fetched afterwards.
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { buildFrameDocument, FRAME_POLICY } from "@dreamteamer/protocol/frame-document"

export const FRAME_KINDS = new Set(["registry", "app", "list", "edit", "view", "panel"])
const NAME = /^[a-z0-9@][a-z0-9._-]*$/i

/** A UI package's frame guest: the runtime text and the stylesheet a module draws with. */
export interface Guest {
  guestText: string
  styleText?: string
}

/** The guest a UI package at `pkgDir` builds (dist/guest/guest.js + guest.css), or null when it has none. */
export function guestOf(pkgDir: string): Guest | null {
  const js = path.join(pkgDir, "dist", "guest", "guest.js")
  const css = path.join(pkgDir, "dist", "guest", "guest.css")
  try {
    return { guestText: fs.readFileSync(js, "utf8"), styleText: fs.existsSync(css) ? fs.readFileSync(css, "utf8") : "" }
  } catch {
    return null
  }
}

/** The guest @dreamteamer/ui builds, or null when that package is absent — startWeb's default. */
export function resolveGuest(from: string): Guest | null {
  try {
    const req = createRequire(path.join(from, "package.json"))
    return guestOf(path.dirname(req.resolve("@dreamteamer/ui/package.json")))
  } catch {
    return null
  }
}

/** The frame route startWeb serves under /_frames/<key>/: the segments after the key are [module, "<kind>.html"]. */
export function moduleFrameRoute({
  root,
  appPort,
  guest,
}: {
  root: string
  appPort: () => number
  guest: { guestText: string; styleText?: string } | null
}) {
  return (segments: string[], _req?: unknown) => {
    if (segments.length !== 2) return null
    const [module, file] = segments
    const kind = file.endsWith(".html") ? file.slice(0, -5) : ""
    if (!NAME.test(module) || !FRAME_KINDS.has(kind)) return null
    const bundleFile = path.join(root, ".dreamteamer", "ui", module, "app.js")
    if (!fs.existsSync(bundleFile)) return null
    if (!guest)
      return {
        status: 503,
        body: "module apps need the frame guest from @dreamteamer/ui, which is not installed — reinstall @dreamteamer/web",
      }
    const { html } = buildFrameDocument({
      guestText: guest.guestText,
      styleText: guest.styleText ?? "",
      bundleText: fs.readFileSync(bundleFile, "utf8"),
    })
    const p = appPort()
    return {
      body: html,
      type: "text/html; charset=utf-8",
      headers: {
        "Content-Security-Policy": `sandbox allow-scripts; ${FRAME_POLICY}; frame-ancestors http://127.0.0.1:${p} http://localhost:${p}`,
        "Cache-Control": "no-store",
      },
    }
  }
}
