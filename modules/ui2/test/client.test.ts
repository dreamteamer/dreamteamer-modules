// The client speaks the protocol's paths through whatever transport mount was handed: names and ids encoded,
// a query only when asked for.
import { test } from "node:test"
import assert from "node:assert/strict"
import { getRecord, listQuery, listRecords, setTransport, updateRecord } from "../src/api/client.ts"

const calls: unknown[][] = []
setTransport({
  request: async (...args) => {
    calls.push(args)
    return { records: [], total: 0 }
  },
  notify: () => {},
})

test("paths encode a namespaced collection and keep an id's slashes", async () => {
  calls.length = 0
  await listRecords("lab/samples", { q: "one", sort: "-name", limit: 200 })
  await getRecord("lab/samples", "2026/sample one")
  await updateRecord("projects", "northwind-launch", { status: "paused" })
  assert.deepEqual(calls, [
    ["GET", "/collections/lab%2Fsamples/records?limit=200&sort=-name&q=one", undefined],
    ["GET", "/collections/lab%2Fsamples/records/2026/sample%20one", undefined],
    ["PATCH", "/collections/projects/records/northwind-launch", { status: "paused" }],
  ])
})

test("an empty query is no query", () => {
  assert.equal(listQuery(), "")
  assert.equal(listQuery({ offset: 0 }), "")
  assert.equal(listQuery({ offset: 200 }), "?offset=200")
})
