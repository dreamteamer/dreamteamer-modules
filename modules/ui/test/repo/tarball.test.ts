// The package a host installs: built, packed, and carrying what a host reads — the library (`mount` and its
// stylesheet) an editor bundles, the browser page a web host serves, and the module frames' guest (Vue + the guest
// runtime, with this app's stylesheet) a host inlines into every module frame. As the Vue ui's
// test/tarball.test.ts checks the Vue ui's; one folder down so ui's `npm test` does not build.
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const UI2 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

test(
  "the build, packed: dist/lib with its types and style.css, dist/app with its assets, dist/guest, the source",
  { timeout: 300_000 },
  () => {
    const built = spawnSync(process.execPath, ["scripts/build.ts"], { cwd: UI2, encoding: "utf8", timeout: 240_000 })
    assert.equal(built.status, 0, `the build failed:\n${built.stdout}\n${built.stderr}`)
    const packed = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: UI2,
      encoding: "utf8",
      timeout: 60_000,
    })
    assert.equal(packed.status, 0, packed.stderr)
    const files: string[] = JSON.parse(packed.stdout)[0].files.map((f: { path: string }) => f.path)
    for (const f of [
      "dist/lib/index.js",
      "dist/lib/index.d.ts",
      "dist/lib/style.css",
      "dist/app/index.html",
      "dist/guest/guest.js",
      "dist/guest/guest.css",
      "dist/guest/SOURCE.json",
      "src/mount.tsx",
      "src/modules/guest/guest.ts",
      "README.md",
    ])
      assert.ok(files.includes(f), `${f} is not in the tarball`)
    assert.ok(
      !files.some(f => f.startsWith("test/") || f.startsWith("scripts/")),
      "tests and build scripts do not ship"
    )
    const page = fs.readFileSync(path.join(UI2, "dist", "app", "index.html"), "utf8")
    const script = /<script type="module"[^>]*src="\.\/assets\/([^"]+\.js)"/.exec(page)?.[1]
    assert.ok(
      script && files.includes(`dist/app/assets/${script}`),
      "the page loads its entry from ./assets/, and the entry ships"
    )
    const lib = fs.readFileSync(path.join(UI2, "dist", "lib", "index.js"), "utf8")
    assert.match(lib, /export\s*\{[^}]*\bmount\b/, "the library exports mount")
    assert.match(fs.readFileSync(path.join(UI2, "dist", "lib", "style.css"), "utf8"), /--dt-/, "the tokens ship")
    const guest = fs.readFileSync(path.join(UI2, "dist", "guest", "guest.js"), "utf8")
    assert.match(guest, /createApp/, "the guest carries the Vue runtime a module bundle draws with")
    assert.doesNotMatch(guest, /<\/script/i, "the guest is one inline block")
    const css = fs.readFileSync(path.join(UI2, "dist", "guest", "guest.css"), "utf8")
    assert.match(css, /--dt-/, "the guest's stylesheet is this app's")
    assert.doesNotMatch(css, /url\((?!data:|#|'data:|"data:)/, "every font and image is inlined: a frame loads nothing")
  }
)
