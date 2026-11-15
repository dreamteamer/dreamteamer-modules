/**
 * WHERE A MODULE FRAME'S DOCUMENT COMES FROM (cr-modules-008 D6/D15, cr-modules-017) — ported from
 * @dreamteamer/ui's modules.ts `frameSource`. Two hosts, two answers:
 *
 *   dt web (`__DT_HOST__.moduleFrames: "url"`)  a URL under the frames base GET /host answered — the server
 *                                               builds the document (guest + bundle) on its files origin
 *   an editor (the default, srcdoc)              the page builds the ONE self-contained document itself: the
 *                                               guest at `__DT_GUEST_URL__`, the stylesheet beside it, the
 *                                               module's bundle at `__DT_UI_BASE__/<module>/app.js`
 *
 * The document builder is @dreamteamer/protocol's `buildFrameDocument`, handed in by the caller so this file
 * loads under Node for its test (the protocol package's exports still name .js files Node cannot find).
 */
import { hostInfo } from "../lib/host.ts"

declare global {
  interface Window {
    __DT_MODULE_GRANTS__?: Record<string, { reads: string[]; writes: string[] }>
    __DT_MODULE_GRANT_PROBLEM__?: string
    __DT_UI_BASE__?: string
    __DT_GUEST_URL__?: string
    __DT_HOST__?: { moduleFrames?: "url" | "srcdoc" }
  }
}

export type BuildFrameDocument = (input: {
  guestText: string
  styleText?: string
  bundleText?: string
  meta?: boolean
}) => { html: string }

export interface FrameSource {
  src?: string
  srcdoc?: string
}

/** True when this page can frame a module at all: a frames base (dt web), or a guest to inline (an editor). A
 *  host that offers neither (the playground, a test page) loads no module app rather than framing an error page. */
export function canFrame(): boolean {
  if (typeof window === "undefined") return false
  if ((window.__DT_HOST__?.moduleFrames ?? "srcdoc") === "url") return !!hostInfo.get()?.framesBase
  return !!window.__DT_GUEST_URL__ && !!window.__DT_UI_BASE__
}

export function makeFrameSource(build: BuildFrameDocument) {
  // each text once per page: every frame of a module carries the same guest and bundle
  const texts = new Map<string, Promise<string>>()
  const once = (url: string, read: (url: string) => Promise<string>) => {
    if (!texts.has(url)) texts.set(url, read(url))
    return texts.get(url)!
  }
  const text = (url: string) => once(url, u => fetch(u).then(r => r.text()))
  // the stylesheet sits beside the guest on every host; a host without one frames unstyled, never an error page
  const textOrEmpty = (url: string) =>
    once(url, u =>
      fetch(u).then(
        r => (r.ok ? r.text() : ""),
        () => ""
      )
    )

  return async function frameSource(module: string, kind: string): Promise<FrameSource> {
    // dt web: the frames base comes from GET /host and rotates with the files key every start
    if ((window.__DT_HOST__?.moduleFrames ?? "srcdoc") === "url")
      return { src: `${hostInfo.get()?.framesBase ?? ""}/${encodeURIComponent(module)}/${kind}.html` }
    const guestUrl = window.__DT_GUEST_URL__ ?? ""
    const [guestText, styleText, bundleText] = await Promise.all([
      text(guestUrl),
      textOrEmpty(guestUrl.replace(/guest\.js(?=[?#]|$)/, "guest.css")),
      text(`${window.__DT_UI_BASE__}/${module}/app.js`),
    ])
    return { srcdoc: build({ guestText, styleText, bundleText, meta: true }).html }
  }
}
