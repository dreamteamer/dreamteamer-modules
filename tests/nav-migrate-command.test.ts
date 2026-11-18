// THE NAV MIGRATION COMMAND NAMES A PROTOCOL NPM HOLDS (rnd/tests dreamteamer-modules/nav-migrate-command-names-published-protocol
// and dreamteamer-modules/nav-hint-release-versions).
//
// `dt-nav` first shipped in @dreamteamer/protocol 0.3.0; npm holds 0.0.0-stage, 0.1.0, 0.1.1 and 0.3.0 and never a 0.2.
// The 409 a host answers, the bin's usage line and the upgrade notes once told a person to run the command at @0.2,
// which ends in ETARGET. This scan reads every text file the packages SHIP — the list npm itself would pack, not
// the source tree, so history under docs/ and tests are not its business — and refuses that spelling, any protocol
// minor below the first with `dt-nav` or above this repo's own, the editor version that never wrote nav.yaml, and a
// contract check message that sends a host author to protocol 0.2. The command's form is the engine's (0.49.1,
// NAV_GUARD_LINE): `npx -p @dreamteamer/protocol@0.3 dt-nav migrate`.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { ROOT, pkgOf } from "./helpers/workspace.ts"

const COMMAND = "npx -p @dreamteamer/protocol@0.3 dt-nav migrate"
const FIRST_WITH_DT_NAV = [0, 3]
const TEXT = /\.(md|js|mjs|cjs|ts|json|yaml|yml|vue|html|css|sh|txt)$/

/** Every text file each package ships, as `{ pkg, file, abs }`, from `npm pack --dry-run --json --workspaces`.
 *  ⚠ Less @dreamteamer/ui's `dist/`: gitignored build output of the `src/` this scan reads, and rebuilt (vite
 *  `emptyOutDir`) by modules/ui/test/tarball.test.mjs in the same run — read while it is emptied, a listed file is
 *  gone and the scan fails on ENOENT though nothing changed (code review finding scan-races-ui-rebuild; reproduced
 *  2 of 42 scans beside a build). The leak gate leaves it out for the same reason. */
const shipped = (() => {
  let cache
  return () =>
    (cache ??= JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json", "--workspaces"], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    )
      .flatMap(p =>
        p.files.map(f => ({
          pkg: p.name,
          file: f.path,
          abs: path.join(ROOT, "modules", p.name.replace(/^@dreamteamer\//, ""), f.path),
        }))
      )
      .filter(f => TEXT.test(f.file) && !(f.pkg === "@dreamteamer/ui" && f.file.startsWith("dist/"))))
})()
/** Each shipped line matching `re`, as `<package>:<file>:<line>: <text>`. */
const lines = (re, keep: (f: any, l: string) => boolean = () => true) => {
  const out = []
  for (const f of shipped()) {
    fs.readFileSync(f.abs, "utf8")
      .split("\n")
      .forEach((l, i) => {
        if (re.test(l) && keep(f, l)) out.push(`${f.pkg}:${f.file}:${i + 1}: ${l.trim().slice(0, 140)}`)
      })
  }
  return out
}
const minor = (v): number[] => v.split(".").slice(0, 2).map(Number)
const cmp = ([a, b]: number[], [c, d]: number[]) => a - c || b - d

describe("shipped text", () => {
  test("npm lists the shipped files of every package in the repo", () => {
    const pkgs = new Set(shipped().map(f => f.pkg))
    const dirs = fs
      .readdirSync(path.join(ROOT, "modules"))
      .filter(m => fs.existsSync(path.join(ROOT, "modules", m, "package.json")))
    assert.equal(pkgs.size, dirs.length, `npm pack listed ${pkgs.size} packages, modules/ holds ${dirs.length}`)
    assert.ok(
      shipped().some(f => f.pkg === "@dreamteamer/protocol" && f.file === "src/createHandler.ts"),
      "protocol src/createHandler.ts is not in the list"
    )
  })
  test("no shipped file spells the never-published @dreamteamer/protocol@0.2", () => {
    assert.deepEqual(lines(/@dreamteamer\/protocol@\^?~?0\.2(?![0-9])/), [])
  })
  test("every @dreamteamer/protocol@<version> a shipped file spells is a minor from the first with dt-nav to this repo's own", () => {
    const own = minor(pkgOf("protocol").version)
    const wrong = lines(/@dreamteamer\/protocol@/, (f, l) =>
      [...l.matchAll(/@dreamteamer\/protocol@\^?~?(\d+)\.(\d+)/g)].some(m => {
        const v = [Number(m[1]), Number(m[2])]
        return cmp(v, FIRST_WITH_DT_NAV) < 0 || cmp(v, own) > 0
      })
    )
    assert.deepEqual(wrong, [])
  })
  test("no shipped file names the editor 0.26 (the first editor that writes nav.yaml is 0.27)", () => {
    assert.deepEqual(lines(/\beditor 0\.26\b/), [])
  })
  test("no check message of the shipped contract suite sends a host author to protocol 0.2", () => {
    assert.deepEqual(
      lines(
        /\bprotocol 0\.2(?![0-9])/,
        (f, l) => f.pkg === "@dreamteamer/protocol" && f.file.startsWith("lib/contract/") && /\bcheck\(/.test(l)
      ),
      []
    )
  })
  test("the 409 a host answers for unmigrated nav settings carries the command as the engine spells it", async () => {
    const { NAV_UNMIGRATED } = await import(path.join(ROOT, "modules", "protocol", "src", "createHandler.ts"))
    assert.ok(NAV_UNMIGRATED.includes(COMMAND), NAV_UNMIGRATED)
  })
})

// The release that carries the fix: each package whose tarball it changes, at least at the version that first ships
// it, with the lockfile in step and a release-notes section of that version. "At least", not "equal": a later release
// of the same package must not have to rewrite this test.
describe("the release", () => {
  const FIRST = { protocol: ["0.3.1", "README.md"], core: ["0.13.1", "UPDATING.md"], rnd: ["0.11.1", "UPDATING.md"] }
  const semver = v => v.split("-")[0].split(".").map(Number)
  const atLeast = (v, floor) => {
    const [a, b] = [semver(v), semver(floor)]
    return (a[0] - b[0] || a[1] - b[1] || a[2] - b[2]) >= 0
  }
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"))
  for (const [id, [version, notes]] of Object.entries(FIRST)) {
    test(`${id} is ${version} or later, the lockfile agrees, and ${notes} has a ## ${version} section`, () => {
      const v = pkgOf(id).version
      assert.ok(atLeast(v, version), `modules/${id}/package.json is ${v}`)
      assert.equal(lock.packages[`modules/${id}`]?.version, v, `package-lock.json's modules/${id} is not ${v}`)
      const text = fs.readFileSync(path.join(ROOT, "modules", id, notes), "utf8")
      assert.ok(
        new RegExp(`^## ${version.replace(/\./g, "\\.")}(?![0-9.])`, "m").test(text),
        `modules/${id}/${notes} has no ## ${version} section`
      )
    })
  }
})
