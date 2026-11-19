// `dt web --app ui|ui2`: the flag is parsed and refused when it names no app, it chooses the page AND the module
// frames' guest from ONE package, and a package this one does not depend on is found where the workspace installed
// it. Nothing is remembered: without the flag it is ui. In process, no server.
import { test, after, describe } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { parseArgs } from "../src/cli.ts"
import { resolveApp } from "../src/resolveApp.ts"

// real path: resolution answers with it (macOS /var is /private/var)
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dt-web-app-")))
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** A workspace with the given UI packages installed, each with a page and a guest that name it. */
const workspace = (name: string, apps: Record<string, { built?: boolean }>) => {
  const root = path.join(tmp, name)
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(path.join(root, "package.json"), '{ "name": "ws" }\n')
  for (const [app, { built = true }] of Object.entries(apps)) {
    const dir = path.join(root, "node_modules", "@dreamteamer", app)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `@dreamteamer/${app}` }))
    if (!built) continue
    fs.mkdirSync(path.join(dir, "dist", "app"), { recursive: true })
    fs.mkdirSync(path.join(dir, "dist", "guest"), { recursive: true })
    fs.writeFileSync(path.join(dir, "dist", "app", "index.html"), `<!doctype html><title>${app} page</title>`)
    fs.writeFileSync(path.join(dir, "dist", "guest", "guest.js"), `/* ${app} guest */`)
    fs.writeFileSync(path.join(dir, "dist", "guest", "guest.css"), `/* ${app} style */`)
  }
  return root
}
// resolution "from" a folder that installs nothing, so only the workspace's node_modules can answer
const nowhere = pathToFileURL(path.join(fs.mkdtempSync(path.join(tmp, "nowhere-")), "x.js")).href

describe("the flag", () => {
  test("open and start take --app ui|ui2, in both spellings", () => {
    assert.equal(parseArgs(["open", "--app", "ui2"]).app, "ui2")
    assert.equal(parseArgs(["open", "--app=ui"]).app, "ui")
    assert.equal(parseArgs(["start", "--app", "ui2", "--port", "4000"]).app, "ui2")
    assert.equal(parseArgs(["open"]).app, undefined)
  })
  test("an app that is not ui or ui2 is refused, and a verb that starts nothing does not take it", () => {
    assert.throws(() => parseArgs(["open", "--app", "vue"]), /--app takes ui or ui2, not "vue"/)
    assert.throws(() => parseArgs(["open", "--app"]), /--app needs a value/)
    assert.throws(() => parseArgs(["status", "--app", "ui2"]), /does not take "--app"/)
  })
})

describe("the choice", () => {
  const root = workspace("both", { ui: {}, ui2: {} })

  test("--app ui2 serves ui2's page with ui2's guest — never the other package's", () => {
    const c = resolveApp(root, { app: "ui2", from: nowhere })
    assert.equal(c.app, "ui2")
    assert.equal(c.appDir, path.join(root, "node_modules", "@dreamteamer", "ui2", "dist", "app"))
    assert.match(fs.readFileSync(path.join(c.appDir, "index.html"), "utf8"), /ui2 page/)
    assert.equal(c.guest?.guestText, "/* ui2 guest */")
    assert.equal(c.guest?.styleText, "/* ui2 style */")
  })
  test("no flag: ui, even with ui2 installed", () => {
    const c = resolveApp(root, { from: nowhere })
    assert.equal(c.app, "ui")
    assert.equal(c.guest?.guestText, "/* ui guest */")
  })
  test("--app beats a DT_WEB_APP_DIR page; without it that page is served", () => {
    assert.equal(resolveApp(root, { app: "ui2", appDir: "/elsewhere", from: nowhere }).app, "ui2")
    assert.deepEqual(resolveApp(root, { appDir: "/elsewhere", from: nowhere }), {
      app: null,
      appDir: "/elsewhere",
    })
  })
  test("this package's own resolution comes first: ui is the one @dreamteamer/web depends on", () => {
    const c = resolveApp(root, { app: "ui" })
    assert.notEqual(c.appDir, path.join(root, "node_modules", "@dreamteamer", "ui", "dist", "app"))
  })
  test("ui2 not installed, or installed without its build, says how to fix it", () => {
    const only = workspace("only-ui", { ui: {} })
    assert.throws(
      () => resolveApp(only, { app: "ui2", from: nowhere }),
      /--app ui2 needs @dreamteamer\/ui2, which is not installed — npm install @dreamteamer\/ui2/
    )
    const unbuilt = workspace("unbuilt", { ui2: { built: false } })
    assert.throws(
      () => resolveApp(unbuilt, { app: "ui2", from: nowhere }),
      /@dreamteamer\/ui2 is installed without its build/
    )
  })
})
