// The page's boot values (lib/host.ts) — ported from the Vue ui's test/unit/host-boot.test.ts, minus the
// file-codec and var-root lookups ui does not have: GET /host fills `hostInfo`; a 401 is the signed-out page; a host
// without the route leaves it null; and only a host that answers a workspace id is a PANE host.
import { test } from "node:test"
import assert from "node:assert/strict"
import { HostError } from "../src/transport/HostError.ts"
import { canEdit, filesBase, hostInfo, isAdmin, loadHost, paneHost, signedOut } from "../src/lib/host.ts"

const host = (key: string) => ({
  level: "edit",
  chat: true,
  workspace: { id: "a1b2c3d4e5f60718", name: "Northwind" },
  filesBase: `/_files/${key}`,
})

test("a 404 (a host without the route) leaves hostInfo null and paneHost false", async () => {
  const got = await loadHost(async () => {
    throw new HostError("no route", 404)
  })
  assert.equal(got, null)
  assert.equal(hostInfo.get(), null)
  assert.equal(paneHost(hostInfo.get()), false)
  assert.equal(signedOut.get(), false)
})

test("loadHost sets hostInfo from GET /host; a second load replaces it", async () => {
  const asked: string[] = []
  const got = await loadHost(async (method, path) => {
    asked.push(`${method} ${path}`)
    return host("k1")
  })
  assert.deepEqual(asked, ["GET /host"])
  assert.equal(got?.workspace?.name, "Northwind")
  assert.equal(paneHost(hostInfo.get()), true)
  assert.equal(filesBase(), "/_files/k1")
  await loadHost(async () => host("k2"))
  assert.equal(filesBase(), "/_files/k2")
})

test("a host answering no workspace id (the editor, the playground) is not a pane host", async () => {
  await loadHost(async () => ({ level: "admin", chat: false, workspace: { name: "x" } }))
  assert.equal(paneHost(hostInfo.get()), false)
})

test("canEdit and isAdmin: no level (an editor) edits at admin; read edits nothing", () => {
  assert.equal(canEdit(null), true)
  assert.equal(canEdit({ level: "read" }), false)
  assert.equal(isAdmin({}), true)
  assert.equal(isAdmin({ level: "edit" }), false)
})

test("a 401 is the signed-out page: signedOut true, hostInfo null", async () => {
  const got = await loadHost(async () => {
    throw new HostError("sign in again", 401)
  })
  assert.equal(got, null)
  assert.equal(signedOut.get(), true)
  assert.equal(hostInfo.get(), null)
})
