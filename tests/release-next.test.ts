// The pure half of `npm run release:next` (scripts/release-next.ts): the version a module's next build
// carries, the manifest it ships with — pinned to the engine's next and to its siblings in the same set —
// and the leak rules each tarball is held to, with exemptions written against SOURCE paths.
import { test } from "node:test"
import assert from "node:assert"
import { nextVersion, stampManifest, hebrewAllowedIn, scan } from "../scripts/release-next.ts"

const at = new Date("2026-11-19T14:30:05Z")
const ENGINE = "0.50.1-next.20261119120000.gb9cc19b"
const file = (path, text) => ({ path, bytes: Buffer.from(text) })

test("one stamp for the whole set: next patch, utc time, g + commit", () => {
  assert.equal(nextVersion("0.3.4", at, "2611810"), "0.3.5-next.20261119143005.g2611810")
  assert.equal(nextVersion("0.4.0-rc.1", at, "2611810"), "0.4.0-next.20261119143005.g2611810")
  assert.throws(() => nextVersion("0.3.4", at, "HEAD"), /not a commit sha/)
})

test("the stamped manifest floors the engine at its next and pins siblings in the set exactly", () => {
  const versions = new Map([
    ["@dreamteamer/tasks", "0.3.5-next.1.gaaaaaaa"],
    ["@dreamteamer/users", "0.3.1-next.1.gaaaaaaa"],
  ])
  const pkg = {
    name: "@dreamteamer/tasks",
    version: "0.3.4",
    dreamteamer: { engine: ">=0.50.0", dependencies: ["@dreamteamer/users"] },
    peerDependencies: { "@dreamteamer/users": ">=0.2.1", "@dreamteamer/elsewhere": ">=1.0.0" },
    dependencies: { express: "^5.0.0" },
  }
  const out = stampManifest(pkg, versions, ENGINE)
  assert.equal(out.version, "0.3.5-next.1.gaaaaaaa")
  assert.equal(out.dreamteamer.engine, `>=${ENGINE}`)
  assert.deepEqual(out.dreamteamer.dependencies, ["@dreamteamer/users"])
  assert.deepEqual(out.peerDependencies, {
    "@dreamteamer/users": "0.3.1-next.1.gaaaaaaa",
    "@dreamteamer/elsewhere": ">=1.0.0",
  })
  assert.deepEqual(out.dependencies, { express: "^5.0.0" }, "a dependency outside the set is untouched")
  assert.equal(pkg.version, "0.3.4", "the input manifest is not mutated")
  assert.equal(pkg.peerDependencies["@dreamteamer/users"], ">=0.2.1")
})

test("a preset's member pins move to the set's next versions", () => {
  const versions = new Map([
    ["@dreamteamer/core", "0.13.3-next.1.gaaaaaaa"],
    ["@dreamteamer/users", "0.3.1-next.1.gaaaaaaa"],
  ])
  const core = {
    name: "@dreamteamer/core",
    version: "0.13.2",
    dreamteamer: { preset: { "@dreamteamer/users": "0.3.0" } },
  }
  assert.deepEqual(stampManifest(core, versions, ENGINE).dreamteamer.preset, {
    "@dreamteamer/users": "0.3.1-next.1.gaaaaaaa",
  })
})

test("a module outside the set refuses, rather than shipping its stable version as next", () => {
  assert.throws(() => stampManifest({ name: "@dreamteamer/x", version: "1.0.0" }, new Map(), ENGINE), /not in the set/)
})

test("a Hebrew exemption on a source path covers what that source ships as", () => {
  const allow = [
    "# comment",
    "modules/recordings/skills/ingesting-recordings/bin/detect.mts\thebrew\twhy",
    "modules/recordings/README.md\tnames\twhy",
    "modules/connectors-google-workspace/skills/fetching-meetings/SKILL.md\thebrew\twhy",
  ].join("\n")
  const allowed = hebrewAllowedIn(allow, "recordings")
  const heb = "\u05E9\u05DC\u05D5\u05DD"
  const hits = scan(
    [
      file("dist/skills/ingesting-recordings/bin/detect.mjs", heb),
      file("dist/skills/ingesting-recordings/bin/detect.d.mts", heb),
      file("dist/skills/ingesting-recordings/bin/detect.mjs.map", heb),
      file("README.md", heb),
      file("skills/fetching-meetings/SKILL.md", heb),
    ],
    null,
    allowed
  )
  assert.deepEqual(hits.hebrew, ["README.md", "skills/fetching-meetings/SKILL.md"])
})

test("names and credential shapes are reported by path; binaries are skipped", () => {
  const hits = scan(
    [
      file("a.js", "made for ACME"),
      file("b.js", "npm_" + "a".repeat(36)),
      { path: "c.png", bytes: Buffer.concat([Buffer.from([0]), Buffer.from("ACME")]) },
    ],
    /acme/i,
    new Set()
  )
  assert.deepEqual(hits, { names: ["a.js"], secrets: ["b.js"], hebrew: [] })
})
