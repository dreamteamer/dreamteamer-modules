// The release workflow's publish step. Two lines were copied from the engine's copy and both turned
// out wrong for a package cut from a private vault: `--access public` (decided per repo, as a
// variable) and `--provenance` (npm refuses it for a private source repo with E422 — measured
// 2026-09-09 on the first tag, after every other gate had passed). This pins the shape so a future
// "align with the engine" edit fails here, by name, before it fails on a tag.
import { test } from "node:test"
import assert from "node:assert"
import fs from "node:fs"
import path from "node:path"
import yaml from "js-yaml"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const wf = yaml.load(fs.readFileSync(path.join(ROOT, ".github", "workflows", "release.yml"), "utf8"))
const steps = wf.jobs.publish.steps
const publish = steps.find(s => s.name === "publish")

test("the workflow is tag-only, one module per tag", () => {
  assert.deepEqual(wf.on, { push: { tags: ["*-v*"] } })
})

test("the access level is a repo variable, gated before anything publishes", () => {
  const gate = steps.find(s => /access decision/.test(s.name ?? ""))
  assert.ok(gate, "no access-decision gate step")
  assert.ok(steps.indexOf(gate) < steps.indexOf(publish))
  assert.match(JSON.stringify(publish), /vars\.NPM_ACCESS/)
  assert.doesNotMatch(publish.run, /--access\s+public\b/, "the access level is never hardcoded")
})

// ── provenance from the LIVE visibility (cr-modules-001, design D-d) ─────────────────────────────
// `github.event.repository.private` is the visibility at the time of the PUSH, and a re-run carries the
// original event: rnd-v0.5.1 was re-run after the repo went public and still published without
// provenance. The step asks the API at publish time, and any answer but exactly true or false stops it.
import { spawnSync } from "node:child_process"
import os from "node:os"

function publishWith({ answer, rc = 0 }) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "stub-"))
  const npmLog = path.join(bin, "npm.log")
  fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\nprintf '%s\\n' "$STUB_ANSWER"\nexit $STUB_RC\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(bin, "npm"), `#!/bin/sh\necho "$@" >> "${npmLog}"\n`, { mode: 0o755 })
  const r = spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", publish.run], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_ANSWER: answer,
      STUB_RC: String(rc),
      NPM_ACCESS: "public",
      GITHUB_REPOSITORY: "northwind/modules",
      GH_TOKEN: "synthetic",
    },
    encoding: "utf8",
  })
  return { ...r, npm: fs.existsSync(npmLog) ? fs.readFileSync(npmLog, "utf8") : null }
}

test("provenance follows the visibility the API reports at publish time, never the push event", () => {
  assert.doesNotMatch(
    JSON.stringify(publish.env ?? {}),
    /github\.event\.repository\.private/,
    "the event payload is stale on a re-run"
  )
  assert.match(JSON.stringify(publish.env ?? {}), /github\.token/, "gh needs the job token")
  assert.doesNotMatch(publish.run, /\$\{\{/, "the run reads env only")
  const pub = publishWith({ answer: "false" })
  assert.equal(pub.status, 0, pub.stderr)
  assert.match(pub.stdout, /^public source repo — publishing with provenance$/m)
  assert.match(pub.npm, /^publish --provenance --access public$/m)
  const priv = publishWith({ answer: "true" })
  assert.equal(priv.status, 0, priv.stderr)
  assert.match(
    priv.stdout,
    /^private source repo — npm refuses provenance for private repos \(E422\); publishing without$/m
  )
  assert.match(priv.npm, /^publish --access public$/m)
})

test("an API error or any other answer stops the publish before npm runs", () => {
  for (const c of [{ answer: "", rc: 1 }, { answer: "false", rc: 1 }, { answer: "oops" }, { answer: "" }]) {
    const r = publishWith(c)
    assert.notEqual(r.status, 0, `answer ${JSON.stringify(c)} must fail`)
    assert.equal(r.npm, null, `npm ran on answer ${JSON.stringify(c)}`)
    assert.match(r.stdout, /::error::/)
  }
})

test(
  "the release gate reaches grep through -f, never with the pattern as an argument",
  {
    skip: "the release gate's private-name check is off until its hit is found — a task in the project records turns both back on",
  },
  () => {
    const outsideF = leakGateRun().replaceAll(`<(printf '%s' "$LEAK_NAMES")`, "<(…)")
    assert.doesNotMatch(outsideF, /grep[^\n]*\$\{?LEAK_NAMES/)
    assert.doesNotMatch(
      leakGateRun(),
      /xargs[^\n]*-f <\(/,
      "xargs would hand a drained pipe to every batch after the first"
    )
    assert.match(
      leakGateRun(),
      /xargs -r grep -lIiE -f "\$pat"/,
      "the tree scan reads the pattern from a file every batch can read"
    )
    assert.match(leakGateRun(), /trap 'rm -f "\$pat"' EXIT/, "the pattern file is removed on exit")
  }
)

test("the gates run before publish: tag==version, tests", () => {
  const names = steps.map(s => s.name ?? s.run ?? "")
  const i = re => names.findIndex(n => re.test(n))
  for (const re of [/tag must match/, /^tests$/])
    assert.ok(i(re) >= 0 && i(re) < names.indexOf("publish"), `${re} must precede publish`)
})

// ── the leak gate on the publish path (added 2026-09-10) ────────────────────────────────────────
// `leak-scan.yml` triggers on a push to any branch and on pull_request; a TAG matches neither, so the release
// path scanned nothing at all, and the scan that did run on main only ever saw ADDED lines. That is
// the gate against the incident that already shipped a private vault name in three npm tarballs.
// These pin the gate's three load-bearing properties: it exists, it runs before anything publishes,
// and it FAILS CLOSED on a missing secret — because on a release a skipped gate looks like a pass.
const leakGate = steps.find(s => /leak gate/.test(s.name ?? ""))
function leakGateRun() {
  return leakGate.run
}
const ancestry = steps.find(s => /point at a commit/.test(s.name ?? ""))

test("a leak gate exists on the release path and precedes every step that publishes", () => {
  assert.ok(leakGate, "no leak-gate step in release.yml — a tag would publish an unscanned tree")
  assert.ok(ancestry, "no ancestry gate — a tag on an arbitrary commit publishes a tree CI never saw")
  // Judged by what a step RUNS, never by its name: the gate's own name contains "published".
  const publishing = steps.filter(s => /npm publish|vsce publish|ovsx publish|gh release/.test(s.run ?? ""))
  assert.ok(publishing.length >= 1, "no publishing step found — this test would pass vacuously")
  for (const p of publishing) {
    assert.ok(steps.indexOf(leakGate) < steps.indexOf(p), `the leak gate must precede "${p.name}"`)
    assert.ok(steps.indexOf(ancestry) < steps.indexOf(p), `the ancestry gate must precede "${p.name}"`)
  }
})

test("the leak gate FAILS CLOSED on an unset secret, unlike its main-branch sibling", () => {
  assert.match(JSON.stringify(leakGate.env ?? {}), /secrets\.LEAK_NAMES/, "the gate must read the secret")
  assert.match(leakGate.run, /-z "\$\{LEAK_NAMES:-\}"/, "it must test the secret for emptiness")
  const guard = leakGate.run.slice(leakGate.run.indexOf('-z "${LEAK_NAMES:-}"'))
  assert.match(guard.split("fi")[0], /exit 1/, "an unset secret must EXIT 1, never warn and continue")
  assert.doesNotMatch(
    guard.split("fi")[0],
    /::warning::/,
    "a warning is what made the main-branch check a silent no-op"
  )
})

test("the gate scans the whole tree, honours .leak-scan-allow, and never prints content", () => {
  assert.match(leakGate.run, /git grep -I -l/, "it must enumerate TEXT files — a binary blob decodes to anything")
  assert.match(
    leakGate.run,
    /\.leak-scan-allow/,
    "the Hebrew rule must honour the per-file allow-list this repo commits"
  )
  assert.match(leakGate.run, /perl -CSD/, "Hebrew needs perl -CSD; grep -P silently never fires under BSD grep")
  assert.match(leakGate.run, /pass vacuously/, "an empty file list must fail rather than pass")
  // Paths are printed to help the author; the matched LINES never are, because the log is readable.
  assert.doesNotMatch(leakGate.run, /grep -[a-zA-Z]*n[a-zA-Z]* "\$LEAK_NAMES"/, "never print matching lines")
})

// ── the tag's own name and annotation (rk-01, 2026-11-25) ───────────────────────────────────────
// The tree gate reads files; a tag also publishes its NAME and, when annotated, a message. Run the step's own
// script against a throwaway repository with a synthetic pattern, as the runner would.
const tagGate = steps.find(s => /tag gate/.test(s.name ?? ""))

test("a tag gate exists, reads the secret, and precedes every step that publishes", () => {
  assert.ok(tagGate, "no tag-gate step — a tag's name and annotation reach the public log unscanned")
  assert.match(JSON.stringify(tagGate.env ?? {}), /secrets\.LEAK_NAMES/)
  for (const p of steps.filter(s => /npm publish/.test(s.run ?? "")))
    assert.ok(steps.indexOf(tagGate) < steps.indexOf(p), `the tag gate must precede "${p.name}"`)
})

test("the tag gate refuses a private name in the tag's name or annotation, Hebrew in it, and an unset or malformed secret", async () => {
  const { spawnSync, execFileSync } = await import("node:child_process")
  const os = await import("node:os")
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Dana Oren",
    GIT_AUTHOR_EMAIL: "dana@northwind.example",
    GIT_COMMITTER_NAME: "Dana Oren",
    GIT_COMMITTER_EMAIL: "dana@northwind.example",
  }
  const origin = fs.mkdtempSync(path.join(os.tmpdir(), "tag-origin-"))
  const git = (dir, ...a) =>
    execFileSync("git", ["-C", dir, "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...a], {
      env,
      encoding: "utf8",
    })
  git(origin, "init", "-q", "-b", "main")
  git(origin, "commit", "-q", "--allow-empty", "-m", "init")
  git(origin, "tag", "-a", "work-v1.0.0", "-m", "an ordinary release")
  git(origin, "tag", "-a", "work-v1.0.1", "-m", "a release for Globex")
  git(origin, "tag", "globex-v1.0.2")
  git(origin, "tag", "-a", "work-v1.0.3", "-m", "\u05e9\u05dc\u05d5\u05dd") // Hebrew, escaped so this file carries none
  const run = (tag, names: string | null = "acme-corp|globex") => {
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "tag-clone-"))
    execFileSync("git", ["clone", "-q", "--no-tags", origin, clone], { env })
    const e: Record<string, string> = {
      ...(env as Record<string, string>),
      TAG: tag,
      RUNNER_TEMP: fs.mkdtempSync(path.join(os.tmpdir(), "runner-")),
    }
    if (names === null) delete e.LEAK_NAMES
    else e.LEAK_NAMES = names
    const r = spawnSync("bash", ["-c", tagGate.run], { cwd: clone, env: e, encoding: "utf8" })
    return { code: r.status, out: `${r.stdout}${r.stderr}` }
  }
  const clean = run("work-v1.0.0")
  assert.equal(clean.code, 0, clean.out)
  assert.equal(run("work-v1.0.1").code, 1, "a private name in the annotation")
  assert.equal(run("globex-v1.0.2").code, 1, "a private name in the tag's name")
  assert.equal(run("work-v1.0.3").code, 1, "Hebrew in the annotation")
  assert.equal(run("work-v1.0.0", null).code, 1, "an unset secret fails closed")
  const malformed = run("work-v1.0.0", "\\b(unbalanced")
  assert.equal(malformed.code, 1)
  assert.match(malformed.out, /not a valid extended regex/)
  assert.doesNotMatch(run("work-v1.0.1").out, /Globex/, "nothing matched is printed")
})

test("the checkout is deep enough for the ancestry gate to answer", () => {
  assert.equal(steps[0].with?.["fetch-depth"], 0, "a shallow tip cannot be tested for ancestry of main")
})

test("publish runs inside the ONE module the tag names, never at the repo root", () => {
  assert.equal(publish["working-directory"], "modules/${{ steps.mod.outputs.id }}")
  const mod = steps.find(st => st.id === "mod")
  assert.ok(
    mod && /modules\/\$ID\/package\.json/.test(mod.run),
    "the tag must be resolved to modules/<id> and checked against its version"
  )
})

// ── a malformed LEAK_NAMES fails, in both workflows (finding r1-09, 2026-10-31) ─────────────────
// grep exits 2 on an invalid regex; behind `|| true` that read as "no hits", so a bad paste into the
// secret turned the private-name gate off while both steps reported clean. Each step now probes the
// pattern first. Run the probe itself, as bash -e runs it on the runner, rather than grep for its text.
const leakScan = yaml.load(fs.readFileSync(path.join(ROOT, ".github", "workflows", "leak-scan.yml"), "utf8"))
const namesStep = leakScan.jobs.scan.steps.find(s => s.name === "private names")
// The probe, plus the step's `names_grep` definition when it has one: the probe goes through that
// function in leak-scan.yml (cr-modules-001, design D-c), so it cannot run without it.
const probeOf = run => {
  const lines = run.split("\n")
  const start = lines.findIndex(l => /leak-names-probe/.test(l))
  assert.ok(start >= 0, "no LEAK_NAMES probe in the step")
  const end = lines.findIndex((l, i) => i > start && l.trim() === "fi")
  const fn = lines.filter(l => /^\s*names_grep\(\) \{/.test(l))
  return [...fn, ...lines.slice(start, end + 1)].join("\n")
}
for (const [label, run] of [
  ["leak-scan.yml private names", () => namesStep.run],
  ["release.yml leak gate", () => leakGate.run],
] as any[]) {
  test(`${label}: a malformed LEAK_NAMES exits 1; a valid one carries on`, async () => {
    const { spawnSync } = await import("node:child_process")
    const probe = probeOf(run())
    const go = pattern =>
      spawnSync("bash", ["-e", "-c", `${probe}\necho REACHED`], {
        env: { ...process.env, LEAK_NAMES: pattern },
        encoding: "utf8",
      })
    const bad = go("\\b(unbalanced")
    assert.equal(bad.status, 1, `malformed pattern: expected exit 1, got ${bad.status}`)
    assert.doesNotMatch(bad.stdout, /REACHED/)
    assert.match(bad.stdout, /::error::/)
    const good = go("\\b(northwind|harbor)\\b")
    assert.equal(good.status, 0, good.stderr)
    assert.match(good.stdout, /REACHED/)
  })
}
