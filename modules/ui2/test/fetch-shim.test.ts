// The module compatibility shim: `fetch('/api/…')` answered by the transport with a real Response, any other URL
// left to the browser, a host error kept as its status.
import { test } from "node:test"
import assert from "node:assert/strict"
import { installApiFetchShim } from "../src/api/fetch-shim.ts"
import { HostError } from "../src/transport/types.ts"

test("/api goes through the transport; the rest is the browser's", async () => {
  const asked: unknown[] = []
  const target = { fetch: (async (u: string) => new Response(`browser ${u}`)) as typeof fetch }
  const undo = installApiFetchShim(async (method, path, body) => {
    asked.push([method, path, body])
    if (path === "/missing") throw new HostError("no such record", 404)
    return { records: [{ id: "northwind-launch" }] }
  }, target)
  const r = await target.fetch("/api/collections/projects/records?limit=2")
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { records: [{ id: "northwind-launch" }] })
  const w = await target.fetch("/api/collections/tasks/records", { method: "post", body: '{"title":"Call Priya"}' })
  assert.equal(w.ok, true)
  const miss = await target.fetch("/api/missing")
  assert.equal(miss.status, 404)
  assert.deepEqual(await miss.json(), { error: "no such record" })
  assert.equal(await (await target.fetch("/apiary")).text(), "browser /apiary")
  assert.deepEqual(asked, [
    ["GET", "/collections/projects/records?limit=2", undefined],
    ["POST", "/collections/tasks/records", { title: "Call Priya" }],
    ["GET", "/missing", undefined],
  ])
  undo()
  assert.equal(await (await target.fetch("/api/x")).text(), "browser /api/x", "undone")
})
