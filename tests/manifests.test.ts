// EVERY MODULE IS AN NPM PACKAGE WITH ONE SHAPE — the manifest is the module's public promise.
//
// Checked here rather than discovered at publish time: a package that ships without a folder it needs,
// or with a name that disagrees with its folder, fails in a stranger's install with nothing pointing
// back at this repo.
import { test, describe, after } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import { MODULES, moduleIds, pkgOf, packedFiles, folderOf, cleanup } from "./helpers/workspace.ts"

after(cleanup)
const KINDS = ["collections", "mixins", "skills", "commands", "command-bindings", "ui-views", "agents"]
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/

test("the repo carries every module it is meant to", () => {
  assert.deepEqual(moduleIds(), [
    "artifacts",
    "assets",
    "code",
    "companies",
    "connectors-google-workspace",
    "connectors-linkedin",
    "connectors-macos",
    "contacts",
    "core",
    "docker-workspaces",
    "engagements",
    "files",
    "git-identities",
    "http",
    "knowledge",
    "meeting-docs",
    "meetings",
    "metrics",
    "notebooklm",
    "perspective",
    "projects",
    "proofs",
    "protocol",
    "recordings",
    "responsibilities",
    "rnd",
    "roles",
    "routines",
    "search",
    "sessions",
    "tasks",
    "ui",
    "ui2",
    "users",
    "web",
    "wikis",
    "workflows",
    "worktrees",
  ])
})

for (const m of moduleIds()) {
  describe(`@dreamteamer/${m}`, () => {
    const pkg = pkgOf(m)
    const dt = pkg.dreamteamer ?? {}
    test("is named for its folder, under the official scope, and publishable", () => {
      assert.equal(pkg.name, `@dreamteamer/${m}`)
      assert.ok(!pkg.private, "private: true would stop npm publish")
      assert.match(pkg.version, SEMVER)
      assert.equal(pkg.license, "Apache-2.0")
      assert.equal(pkg.repository?.directory, `modules/${m}`)
      assert.ok(pkg.keywords?.includes("dreamteamer-module"), "the keyword is how a search finds a module")
    })
    test("an extension entry, when declared, is a file the tarball ships", () => {
      if (!dt.extension) return
      assert.ok(packedFiles(m).includes(dt.extension.replace(/^\.\//, "")), `${dt.extension} is not in the tarball`)
    })
    test("says what it is twice — one npm line, one orienting paragraph", () => {
      assert.ok(pkg.description && pkg.description.length <= 160, "npm description: one line")
      assert.ok(dt.title, "dreamteamer.title")
      assert.ok(
        dt.description && dt.description.length > 80,
        "dreamteamer.description orients every session — it is not optional"
      )
    })
    test("declares the engine it is tested against", () => {
      assert.match(dt.engine ?? "", /^>=\d+\.\d+\.\d+$/)
    })
    test("spells every dependency as the full package name the engine keys modules by", () => {
      for (const d of dt.dependencies ?? []) {
        assert.match(
          d,
          /^@dreamteamer\//,
          `${d}: compile matches a dependency against the package NAME, so a bare id is "not installed"`
        )
        assert.ok(fs.existsSync(path.join(MODULES, folderOf(d), "package.json")), `${d} is not a module in this repo`)
      }
    })
    test("`files` lists every folder the module carries, and the tarball ships them", () => {
      // ui and ui2 are browser apps built by Vite into their own dist/, and ship their source on purpose
      const app = m === "ui" || m === "ui2"
      // what ships as its build (scripts/build.ts) rather than as itself: src/ and lib/, a bin/ of TypeScript,
      // and the skills of a module that stages them from dist/skills
      const tsIn = d => fs.existsSync(d) && fs.readdirSync(d).some(f => f.endsWith(".ts") && !f.endsWith(".d.ts"))
      const built = app
        ? []
        : ["src", "lib", "bin", "skills"].filter(k =>
            k === "skills"
              ? pkg.dreamteamer?.skills === "dist/skills"
              : k === "bin"
                ? tsIn(path.join(MODULES, m, "bin"))
                : fs.existsSync(path.join(MODULES, m, k))
          )
      const present = [...KINDS, "bin", "data", ...(app ? ["src"] : [])].filter(
        k => !built.includes(k) && fs.existsSync(path.join(MODULES, m, k))
      )
      for (const k of present)
        assert.ok(pkg.files.includes(k), `${k}/ exists but is not in files — npm would leave it out`)
      if (built.length) assert.ok(pkg.files.includes("dist"), `${built.join(", ")} exist but dist is not in files`)
      const files = packedFiles(m)
      const shipped = new Set(files.map(f => f.split("/")[0]))
      for (const k of [...present, "README.md", "package.json"])
        assert.ok(shipped.has(k), `the tarball does not ship ${k}`)
      for (const k of built)
        assert.ok(
          files.some(f => f.startsWith(`dist/${k}/`)),
          `the tarball does not ship dist/${k}`
        )
      const ts = files.filter(f => /\.m?ts$/.test(f) && !f.endsWith(".d.ts"))
      if (!app) assert.deepEqual(ts, [], "the TypeScript source ships — npm ships its build")
    })
    test("the tarball ships no tests, caches or virtualenvs", () => {
      const junk = packedFiles(m).filter(f => /(^|\/)(tests?|__pycache__|\.venv|\.pytest_cache|node_modules)\//.test(f))
      assert.deepEqual(junk, [])
    })
  })
}

// The README is the npm page, and its install line is the one a stranger copies. The engine loads
// direct dependencies only, so that line must name the module AND its whole dependency closure — a
// README that drifts from the manifest installs a module that refuses to compile.
import { closure } from "./helpers/workspace.ts"
for (const m of moduleIds()) {
  test(`${m}: the README's install line names exactly the module and its dependency closure`, () => {
    const readme = fs.readFileSync(path.join(MODULES, m, "README.md"), "utf8")
    // a module preset is expanded by the engine, never by npm: its one line is `dt install <the preset>`
    if (pkgOf(m).dreamteamer?.preset) {
      assert.ok(readme.split("\n").includes(`dt install @dreamteamer/${m}`), `no \`dt install @dreamteamer/${m}\` line`)
      assert.ok(
        !readme.split("\n").some(l => l.startsWith("npm install ")),
        "an `npm install` line installs a preset with no members"
      )
      return
    }
    const line = readme.split("\n").find(l => l.startsWith("npm install "))
    assert.ok(line, "no `npm install` line")
    const named = line
      .replace("npm install ", "")
      .trim()
      .split(/\s+/)
      .filter(w => !w.startsWith("-"))
      .sort()
    assert.deepEqual(named, [...closure(m)].map(x => `@dreamteamer/${x}`).sort())
  })
}
