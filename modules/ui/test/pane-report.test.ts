// The page's report to the chat (lib/pane-report.ts) — the expectations of the Vue ui's render-tier
// test/webview/pane-select.test.ts, asked of the reporter itself: ONE PUT /selection per settle, the place and at
// most 50 refs, a refusal dropped; and the chat's push held for its collection's list, going there first.
import { test } from "node:test"
import assert from "node:assert/strict"
import { pushedSelection, type PaneView } from "../src/lib/pane-place.ts"
import { MAX_REPORTED, receiveSelect, startPaneReport } from "../src/lib/pane-report.ts"
import { signal } from "../src/lib/signal.ts"

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

function reporter(fail = false) {
  const sent: unknown[] = []
  const place = signal<PaneView>({ collection: "tasks" })
  const selection = signal<{ collection: string; ids: string[] } | null>(null)
  const stop = startPaneReport({
    place,
    selection,
    debounceMs: 10,
    request: async (method, path, body) => {
      sent.push({ method, path, body })
      if (fail) throw new Error("no record tasks/gone")
      return {}
    },
  })
  return { sent, place, selection, stop }
}

test("on start the place is reported once, with no refs", async () => {
  const r = reporter()
  await wait(30)
  assert.deepEqual(r.sent, [{ method: "PUT", path: "/selection", body: { view: { collection: "tasks" }, refs: [] } }])
  r.stop()
})

test("ticking two rows sends ONE PUT /selection with both refs after the debounce", async () => {
  const r = reporter()
  await wait(30)
  r.selection.set({ collection: "tasks", ids: ["a"] })
  r.selection.set({ collection: "tasks", ids: ["a", "b"] })
  await wait(30)
  assert.equal(r.sent.length, 2)
  assert.deepEqual(r.sent[1], {
    method: "PUT",
    path: "/selection",
    body: { view: { collection: "tasks" }, refs: ["tasks/a", "tasks/b"] },
  })
  r.stop()
})

test("a navigation to a record reports { collection, id }", async () => {
  const r = reporter()
  r.place.set({ collection: "tasks", id: "brief-dana" })
  await wait(30)
  assert.equal(r.sent.length, 1, "the start and the move settle as one")
  assert.deepEqual((r.sent[0] as { body: { view: unknown } }).body.view, { collection: "tasks", id: "brief-dana" })
  r.stop()
})

test(`a larger selection sends the first ${MAX_REPORTED}`, async () => {
  const r = reporter()
  r.selection.set({ collection: "tasks", ids: Array.from({ length: 60 }, (_, i) => `t${i}`) })
  await wait(30)
  const refs = (r.sent.at(-1) as { body: { refs: string[] } }).body.refs
  assert.equal(refs.length, MAX_REPORTED)
  assert.equal(refs[0], "tasks/t0")
  r.stop()
})

test("a refusal is dropped silently, and stopping sends nothing more", async () => {
  const r = reporter(true)
  await wait(30)
  assert.equal(r.sent.length, 1)
  r.stop()
  r.selection.set({ collection: "tasks", ids: ["a"] })
  await wait(30)
  assert.equal(r.sent.length, 1)
})

test("dt:select holds the refs; another collection's list is navigated to first, this one's is not", () => {
  const moved: string[] = []
  const navigate = (to: string) => moved.push(to)
  const collections = ["tasks", "rnd/change-requests"]
  receiveSelect(["rnd/change-requests/cr-x"], { collections, here: { collection: "tasks" }, navigate })
  assert.deepEqual(pushedSelection.get()?.refs, ["rnd/change-requests/cr-x"])
  receiveSelect(["tasks/a", "tasks/b"], { collections, here: { collection: "tasks" }, navigate })
  receiveSelect(["tasks/a"], { collections, here: { collection: "tasks", id: "a" }, navigate })
  receiveSelect([], { collections, here: { other: true }, navigate })
  receiveSelect("nonsense", { collections, here: { other: true }, navigate })
  assert.deepEqual(moved, ["/content/rnd/change-requests", "/content/tasks"])
  assert.deepEqual(pushedSelection.get()?.refs, [])
})
