// REMOTE ACCESS, the protocol's half (cr-vscode-012, re-homed with cr-modules-005): every Sources entry is
// checked against the right remote, the redaction
// guard scrubs what a provider could leak, and the two routes answer through the handler with and without a
// provider. The providers themselves (GitHub, Bitbucket) are the VS Code extension's and are tested there.
import { test, describe, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { ENGINE_DIR } from "../../../tests/helpers/fixture.ts"
import { accessTargets, redactSecrets, unavailableAccess, NOT_AVAILABLE } from "../src/host/remoteAccess.ts"

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const load = rel => import(pathToFileURL(path.join(PKG, rel)).href)
const quietly = async fn => {
  const log = console.log
  console.log = () => {}
  try {
    return await fn()
  } finally {
    console.log = log
  }
}
const secret = ["sec", "ret", "Value"].join("")

describe("accessTargets — which remote each entry is checked against", () => {
  const stack: Parameters<typeof accessTargets>[0] = {
    workspace: { name: "my-hq", kind: "own", repo: ".", installed: true, via: "own", access: "write", collections: [] },
    modules: [
      { name: "inline", kind: "module", repo: ".", installed: true, via: "own", access: "write", collections: [] },
      { name: "project-a", kind: "module", repo: ".", installed: true, via: "clone", access: "write", collections: [] },
      {
        name: "pkg",
        kind: "module",
        repo: "node_modules/@x/pkg",
        installed: true,
        via: "package",
        access: "read",
        collections: [],
      },
    ],
  }
  // the folders exist (top-level resolution reads the real path); git itself is scripted below
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dt-ra-")))
  fs.mkdirSync(path.join(root, "modules", "project-a"), { recursive: true })
  after(() => fs.rmSync(root, { recursive: true, force: true }))
  // a scripted git: top-levels by folder, push urls by top-level — no repo on disk is read
  const git = (args, cwd) => {
    if (args[0] === "rev-parse")
      return cwd.startsWith(path.join(root, "modules", "project-a"))
        ? path.join(root, "modules", "project-a")
        : cwd.startsWith(root)
          ? root
          : undefined
    if (args[0] === "remote")
      return cwd === root ? "git@github.example:acme/my-hq.git" : "git@github.example:acme/project-a.git"
    return undefined
  }
  test("the workspace and a module that is its own clone each get their own push url; an inline module notes the workspace remote; a package is skipped", () => {
    const targets = accessTargets(
      stack,
      root,
      [
        { id: "inline", path: "." },
        { id: "project-a", path: "modules/project-a" },
      ],
      git
    )
    assert.deepEqual(
      targets.map(t => t.source),
      ["my-hq", "inline", "project-a"]
    )
    assert.equal(targets[0].url, "git@github.example:acme/my-hq.git")
    assert.equal(targets[1].note, "the workspace's remote")
    assert.equal(targets[2].url, "git@github.example:acme/project-a.git")
  })
  test("a host without a provider answers every target not-checked, with the one reason", () => {
    const out = unavailableAccess([
      { source: "a", url: "x" },
      { source: "b", reason: "no remote" },
    ])
    assert.equal(out.available, false)
    assert.deepEqual(out.access, {
      a: { state: "not-checked", reason: NOT_AVAILABLE },
      b: { state: "not-checked", reason: NOT_AVAILABLE },
    })
  })
})

describe("redactSecrets — the second line of the token rule", () => {
  test("full token shapes and exact held values are replaced everywhere in a body; short names survive", () => {
    const token = "ghp_" + "A".repeat(40)
    const held = "held-" + secret
    const out = redactSecrets(
      { a: `Bearer ${"b".repeat(20)}`, b: [`x ${token} y`, { c: `saw ${held}` }], d: "ghp_tools", e: "short" },
      [held, "tiny"]
    )
    assert.deepEqual(out, {
      a: "[redacted]",
      b: ["x [redacted] y", { c: "saw [redacted]" }],
      d: "ghp_tools",
      e: "short",
    })
  })
})

let fixture
after(() => fixture?.cleanup())

test(
  "the handler answers /sources/access without a provider, and with a scripted one through the seam",
  { timeout: 120_000 },
  async () => {
    const { makeFixture } = await load("lib/contract/fixture.ts")
    const { createHandler } = await load("src/createHandler.ts")
    fixture = makeFixture({ engineDir: ENGINE_DIR })
    const handler = await createHandler({ root: fixture.root })
    const request = (m, p, b?) => quietly(() => handler.handle(m, p, b))

    assert.equal(handler.api.hasRemoteAccess(), false)
    const none = await request("GET", "/sources/access")
    assert.equal(none.status, 200)
    assert.equal(none.body.available, false)
    assert.equal(none.body.access.lab?.state, "not-checked")
    assert.equal(none.body.access.lab?.reason, NOT_AVAILABLE)
    const noneMembers = await request("GET", "/sources/access/members?source=lab")
    assert.deepEqual(noneMembers.body, { state: "unknown", members: [], reason: NOT_AVAILABLE })

    const asked = []
    const token = "ghp_" + "Z".repeat(40)
    handler.api.useRemoteAccess({
      own: async (targets, opts) => (
        asked.push(opts),
        Object.fromEntries(
          targets.map(t => [
            t.source,
            {
              state: "ok",
              level: "write",
              role: "push",
              account: "dev-one",
              tiedToPushKey: true,
              note: `saw ${token} and ${secret}`,
            },
          ])
        )
      ),
      members: async target => ({
        state: "ok",
        members: [{ name: "dev-one", kind: "user", level: "write" }],
        account: `dev-one ${secret}`,
        reason: target.source,
      }),
      heldSecrets: async () => [secret],
    })
    assert.equal(handler.api.hasRemoteAccess(), true)
    const own = await request("GET", "/sources/access?fresh=1")
    assert.equal(own.status, 200)
    assert.equal(own.body.available, true)
    assert.deepEqual(asked, [{ fresh: true }])
    assert.ok(Object.keys(own.body.access).includes("lab"), Object.keys(own.body.access).join())
    assert.equal(own.body.access.lab.note, "saw [redacted] and [redacted]")
    const members = await request("GET", "/sources/access/members?source=lab")
    assert.deepEqual(
      members.body.members.map(m => m.name),
      ["dev-one"]
    )
    assert.equal(members.body.account, "dev-one [redacted]")
    assert.equal((await request("GET", "/sources/access/members?source=nope")).status, 404)

    // a provider that throws never leaks its message: our sentence and the route
    handler.api.useRemoteAccess({
      own: async () => {
        throw new Error(`boom ${token}`)
      },
      members: async () => {
        throw new Error("x")
      },
      heldSecrets: async () => [],
    })
    const thrown = await request("GET", "/sources/access")
    assert.equal(thrown.status, 500)
    assert.equal(thrown.body.error, "remote access failed (/sources/access)")
  }
)
