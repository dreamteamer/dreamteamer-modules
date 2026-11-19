// The client speaks the protocol's paths through whatever transport mount was handed: names and ids encoded,
// a query only when asked for.
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  commit,
  getCommands,
  getHistory,
  getHistoryDiff,
  getNotes,
  getRecord,
  listQuery,
  listRecords,
  moveRecord,
  removeRecord,
  renameRecord,
  revertRecord,
  setTransport,
  updateRecord,
} from "../src/api/client.ts"

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

test("a hand-set order moves through the protocol's position route", async () => {
  calls.length = 0
  await moveRecord("projects", "northwind-launch", { before: "harbor-mutual-renewal" })
  await moveRecord("lab/samples", "2026/one", { bottom: true })
  assert.deepEqual(calls, [
    ["PATCH", "/collections/projects/position/northwind-launch", { before: "harbor-mutual-renewal" }],
    ["PATCH", "/collections/lab%2Fsamples/position/2026/one", { bottom: true }],
  ])
})

test("the record page's routes: forced delete, rename, history, diff, revert, commit, commands and notes", async () => {
  calls.length = 0
  await removeRecord("projects", "northwind-launch")
  await removeRecord("lab/samples", "2026/one", true)
  await renameRecord("tasks", "brief-dana", "brief-dana-oren")
  await getHistory("lab/samples", "2026/one")
  await getHistoryDiff("projects", "northwind-launch", "ff04675")
  await revertRecord("lab/samples", "2026/one", "ff04675")
  await commit({ dryRun: true })
  await getCommands("projects", ["northwind-launch", "harbor-mutual-renewal"])
  await getCommands("projects", [])
  await getNotes("lab/samples", ["2026/one"])
  assert.deepEqual(calls, [
    ["DELETE", "/collections/projects/records/northwind-launch", undefined],
    ["DELETE", "/collections/lab%2Fsamples/records/2026/one?force=true", undefined],
    ["POST", "/collections/tasks/rename", { old: "brief-dana", new: "brief-dana-oren" }],
    ["GET", "/history/lab%2Fsamples/2026/one", undefined],
    ["GET", "/history-diff/projects/northwind-launch?hash=ff04675", undefined],
    ["POST", "/collections/lab%2Fsamples/records-revert/2026/one", { hash: "ff04675" }],
    ["POST", "/commit", { dryRun: true }],
    ["GET", "/commands/projects?ids=northwind-launch%2Charbor-mutual-renewal", undefined],
    ["GET", "/commands/projects", undefined],
    ["GET", "/notes/lab%2Fsamples?ids=2026%2Fone", undefined],
  ])
})
