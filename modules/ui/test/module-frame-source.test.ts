// cr-modules-008 D6/D15: a module frame is ONE self-contained document carrying the host's stylesheet — the Vue ui's
// test/unit/module-frame-source.test.ts, re-pointed at ui's modules/frame-source.ts with the protocol's real
// document builder. Plus ui's own rule: a host that can frame nothing loads no module.
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildFrameDocument } from "../../protocol/src/frame-document.ts"

const served: Record<string, string> = {
  "vscode-resource://x/guest/guest.js": "window.guest=1",
  "vscode-resource://x/guest/guest.css": "body{font-family:var(--dt-font)}",
  "vscode-resource://ui/m1/app.js": "export default 1",
}
const win: Record<string, unknown> = {
  __DT_GUEST_URL__: "vscode-resource://x/guest/guest.js",
  __DT_UI_BASE__: "vscode-resource://ui",
  __DT_HOST__: { moduleFrames: "srcdoc" },
  addEventListener() {},
}
;(globalThis as any).window = win
;(globalThis as any).fetch = async (url: string) => ({
  ok: url in served,
  status: url in served ? 200 : 404,
  text: async () => served[url] ?? "not found",
})
const { canFrame, makeFrameSource } = await import("../src/modules/frame-source.ts")
const { hostInfo } = await import("../src/lib/host.ts")
const frameSource = makeFrameSource(buildFrameDocument)

test("the srcdoc frame document carries the stylesheet beside the guest, inline", async () => {
  const s = await frameSource("m1", "edit")
  assert.ok(s.srcdoc && !s.src, "srcdoc on the VS Code host")
  assert.match(s.srcdoc!, /<style>body\{font-family:var\(--dt-font\)\}<\/style>/, "guest.css inlined in the frame")
  assert.match(s.srcdoc!, /window\.guest=1/, "the guest script")
  assert.match(s.srcdoc!, /id="dt-bundle">"export default 1"/, "the bundle travels as a JSON data block")
})

test("a guest without a stylesheet beside it still frames — unstyled, never broken", async () => {
  delete served["vscode-resource://x/guest/guest.css"]
  const s = await makeFrameSource(buildFrameDocument)("m1", "view")
  assert.ok(s.srcdoc, "the document is built")
  assert.doesNotMatch(s.srcdoc!, /not found/, "a 404 body is never inlined as a stylesheet")
})

test("cr-modules-017: a url-framed host draws the frame from the frames base GET /host answered", async () => {
  win["__DT_HOST__"] = { moduleFrames: "url" }
  hostInfo.set({ level: "admin", chat: false, workspace: { id: "w", name: "w" }, framesBase: "/_frames/k1" })
  assert.deepEqual(await frameSource("m1", "edit"), { src: "/_frames/k1/m1/edit.html" })
  hostInfo.set({ ...hostInfo.get(), framesBase: "/_frames/k2" })
  assert.deepEqual(await frameSource("m1", "edit"), { src: "/_frames/k2/m1/edit.html" })
  win["__DT_HOST__"] = { moduleFrames: "srcdoc" }
})

test("a host frames only with a frames base (url) or a guest and a bundle base (srcdoc)", () => {
  assert.equal(canFrame(), true)
  delete win["__DT_GUEST_URL__"]
  assert.equal(canFrame(), false, "the playground: no guest, no module")
  win["__DT_HOST__"] = { moduleFrames: "url" }
  assert.equal(canFrame(), true, "dt web: the frames base")
  hostInfo.set({ level: "admin" })
  assert.equal(canFrame(), false, "a url host that answered no frames base")
})
